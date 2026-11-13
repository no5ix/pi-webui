#!/usr/bin/env node
/**
 * The device side of a push test, driven against a running PI WEB.
 *
 * A Web Push test has two halves, and only one of them is a browser. This module is the server half:
 * the state a settings panel shows, a send and what each device's push service answered, a synthetic
 * device that proves the whole send path without a phone in the room, and the daemon's own delivery
 * log read back as outcomes. It prints what a push service answered - status and the service's reason -
 * because "the API returned 200" is a page talking to PI WEB, not a notice arriving.
 *
 * A probe device is a real subscription shape at a real push service with a made-up endpoint token.
 * Every service answers it (Apple checks the VAPID assertion first and reaches its token check, so a
 * good assertion is a `400 BadWebPushRequest`; FCM says a retired address is `410`; Mozilla says `404`;
 * WNS says `404` over IPv4), and every answer travels the same code path a real device's answer
 * travels: encryption, the signed assertion, the address-family choice, and the outcome recorded on
 * the device's row.
 *
 * Endpoint tokens, subscription keys, and VAPID private keys are never printed. The device list is
 * printed by label, push service host, and what the service answered last.
 */

import { createECDH, randomBytes } from "node:crypto";

/** The push services a probe device can claim to live at, and how to address each one. */
export const PROBE_SERVICES = {
  apple: () => `https://web.push.apple.com/${randomBytes(24).toString("base64url")}`,
  fcm: () => `https://fcm.googleapis.com/fcm/send/${randomBytes(24).toString("base64url")}`,
  mozilla: () => `https://updates.push.services.mozilla.com/wpush/v2/${randomBytes(24).toString("base64url")}`,
  wns: () => `https://wns2-bl2p.notify.windows.com/w/?token=${randomBytes(32).toString("base64url")}`,
};

/** A subscription body a browser would have sent, for a probe endpoint at `service`. */
export function probeRegistration(service, appBaseUrl) {
  const build = PROBE_SERVICES[service];
  if (build === undefined) throw new Error(`Unknown probe push service "${String(service)}". Known: ${Object.keys(PROBE_SERVICES).join(", ")}.`);
  const ecdh = createECDH("prime256v1");
  return {
    endpoint: build(),
    keys: { p256dh: ecdh.generateKeys("base64url", "uncompressed"), auth: randomBytes(16).toString("base64url") },
    appBaseUrl,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  };
}

/** The address a device's notices open, built from the origin the test is run against. */
export function appBaseFor(origin) {
  const url = new URL(origin);
  return url.origin + (url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`);
}

/** One HTTP call to the running server, with the answer's status kept for the report. */
export async function call(origin, path, init) {
  const response = await fetch(new URL(path, origin), {
    ...init,
    ...(init?.body === undefined ? {} : { headers: { "content-type": "application/json", ...(init.headers ?? {}) } }),
  });
  const text = await response.text();
  let body;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

/** The state a device registration would face: VAPID, the contact, the TTL, the allowlist, the devices. */
export function describeState(answer) {
  const state = answer.body?.state ?? {};
  const devices = Array.isArray(answer.body?.devices) ? answer.body.devices : [];
  const lines = [];
  lines.push(`push configured: ${String(state.configured === true)}${state.disabled === true ? " (turned off in the config)" : ""}`);
  if (typeof answer.body?.problem === "string" && answer.body.problem !== "") lines.push(`server says: ${answer.body.problem}`);
  if (typeof answer.body?.devicesUnknown === "string" && answer.body.devicesUnknown !== "") lines.push(`device file: ${answer.body.devicesUnknown}`);
  lines.push(`vapid public key: ${typeof answer.body?.publicKey === "string" ? `${answer.body.publicKey.slice(0, 12)}\u2026` : "none"}`);
  if (typeof state.subject === "string") lines.push(`contact sent to push services: ${state.subject}`);
  if (state.ttlSeconds !== undefined) lines.push(`message window: ${String(state.ttlSeconds)}s`);
  if (Array.isArray(state.allowedTailnetLogins)) lines.push(`allowed tailnet logins: ${state.allowedTailnetLogins.length === 0 ? "(none named: the network is the boundary)" : state.allowedTailnetLogins.join(", ")}`);
  lines.push(`registered devices: ${String(devices.length)}`);
  for (const device of devices) lines.push(`  ${describeDevice(device)}`);
  return { lines, devices, state, problem: answer.body?.problem };
}

/** A device row, in the words a reader would recognise: never its endpoint token or its keys. */
export function describeDevice(device) {
  const bits = [String(device.label ?? "a device"), String(device.pushService ?? "unknown service")];
  if (typeof device.tailnetLogin === "string" && device.tailnetLogin !== "") bits.push(`by ${device.tailnetLogin}`);
  bits.push(device.lastDeliveredAt === undefined ? "never accepted" : `accepted ${device.lastDeliveredAt}`);
  const failure = device.lastFailure;
  if (failure !== undefined) bits.push(`last refused ${String(failure.outcome)}${failure.status === undefined ? "" : ` ${String(failure.status)}`}${failure.reason === undefined ? "" : ` ${failure.reason}`}`);
  return `${bits.join(" | ")} (id ${String(device.id ?? "?")})`;
}

/** What a send did, per device, as the push services answered. */
export function describeSend(answer) {
  const body = answer.body ?? {};
  const results = Array.isArray(body.results) ? body.results : [];
  const lines = [`status ${String(answer.status)}: ${String(body.targets ?? results.length)} device(s) sent to`];
  if (typeof body.problem === "string" && body.problem !== "") lines.push(`server says: ${body.problem}`);
  for (const result of results) {
    lines.push(`  ${String(result.label ?? "a device")}: ${String(result.outcome)}${result.status === undefined ? "" : ` ${String(result.status)}`}${result.reason === undefined ? "" : ` (${String(result.reason)})`}`);
  }
  const accepted = results.filter((result) => result.outcome === "sent").length;
  return { lines, accepted, total: results.length };
}

/**
 * The daemon's delivery lines, read back from its log.
 *
 * The daemon logs one line per event with the outcome of each send: it is the only place a push
 * service's answer outlives the request that produced it, and the only place a "0 devices accepted"
 * is said in the server's own words.
 */
export function notificationLogLines(text) {
  return text.split("\n").filter((line) => line.includes("[notifications]")).map(redact);
}

/** Drop anything shaped like a credential before a line is printed. */
export function redact(line) {
  return line
    .replace(/(https:\/\/[^/\s]+)\/[^\s"]*/gu, "$1/…")
    .replace(/token=[A-Za-z0-9_\-]+/gu, "token=…")
    .replace(/(p256dh|auth|vapidPrivateKey)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-+/=]{8,}/gu, "$1=…");
}

/** The session a test notice speaks about. */
export function testBody(session) {
  return { sessionId: session.sessionId, sessionName: session.sessionName, projectName: session.projectName ?? "" };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith("--")) {
      args._.push(entry);
      continue;
    }
    const key = entry.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

const USAGE = `Usage: node scripts/push-probe.mjs <command> [--origin URL] [options]

  state                         what the server can send, and which devices are registered
  test [--device ID] --session ID [--name NAME] [--project NAME]
                                send a real test push, to one device when --device is given
  register-probe --service apple|fcm|mozilla|wns
                                register a synthetic device at a real push service
  forget ID                     remove one device
  watch [--file LOG] [--lines N] the daemon's delivery lines, redacted
  session --cwd DIR             create a session for a real run, and print its URL

--origin defaults to PI_WEB_PUSH_ORIGIN, then http://127.0.0.1:8506.`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const origin = args.origin ?? process.env.PI_WEB_PUSH_ORIGIN ?? "http://127.0.0.1:8506";
  const json = (body) => ({ method: "POST", body: JSON.stringify(body) });

  if (command === "state") {
    const answer = await call(origin, "api/push/state");
    for (const line of describeState(answer).lines) console.log(line);
    return;
  }
  if (command === "test") {
    if (args.session === undefined || args.session === true) throw new Error("test needs --session ID (a test notice opens the session it speaks about)");
    const body = json(testBody({ sessionId: String(args.session), sessionName: String(args.name ?? "PI WEB test"), projectName: args.project === true || args.project === undefined ? "" : String(args.project) }));
    const answer = args.device === undefined || args.device === true
      ? await call(origin, "api/push/test", body)
      : await call(origin, `api/push/subscriptions/${encodeURIComponent(String(args.device))}/test`, body);
    const send = describeSend(answer);
    for (const line of send.lines) console.log(line);
    process.exitCode = send.total === 0 ? 2 : 0;
    return;
  }
  if (command === "register-probe") {
    const service = args.service === true || args.service === undefined ? "apple" : String(args.service);
    const registration = probeRegistration(service, appBaseFor(origin));
    const answer = await call(origin, "api/push/subscriptions", json(registration));
    const device = answer.body?.device ?? {};
    console.log(`probe device at ${service}: status ${String(answer.status)} id ${String(answer.body?.id ?? "?")} label ${String(device.label ?? "?")}`);
    if (answer.status >= 300) console.log(`refused: ${JSON.stringify(answer.body)}`);
    process.exitCode = answer.status >= 300 ? 1 : 0;
    return;
  }
  if (command === "forget") {
    const id = args._[1];
    if (id === undefined) throw new Error("forget needs a device id");
    const answer = await call(origin, `api/push/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
    console.log(`removed ${String(answer.body?.removed)}: status ${String(answer.status)}`);
    process.exitCode = answer.status >= 300 ? 1 : 0;
    return;
  }
  if (command === "session") {
    const cwd = args.cwd === true || args.cwd === undefined ? undefined : String(args.cwd);
    if (cwd === undefined) throw new Error("session needs --cwd DIR");
    const answer = await call(origin, "api/sessions", json({ cwd }));
    const session = answer.body ?? {};
    console.log(`status ${String(answer.status)} session ${String(session.id ?? "?")} cwd ${String(session.cwd ?? cwd)}`);
    console.log(`open it at ${origin}?session=${String(session.id ?? "")}`);
    process.exitCode = answer.status >= 300 ? 1 : 0;
    return;
  }
  if (command === "watch") {
    const { readFile } = await import("node:fs/promises");
    const file = args.file === undefined || args.file === true ? undefined : String(args.file);
    if (file === undefined) throw new Error("watch needs --file LOG");
    const lines = notificationLogLines(await readFile(file, "utf8"));
    const limit = args.lines === undefined ? 20 : Number(args.lines);
    for (const line of lines.slice(-limit)) console.log(line);
    return;
  }
  console.log(USAGE);
  process.exitCode = command === undefined ? 1 : 2;
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
