/**
 * Who a request came from, when Tailscale vouched for it.
 *
 * PI WEB has no accounts of its own: a deployment's boundary is the network it is reachable on, and
 * the common one is a tailnet, where `tailscale serve` terminates TLS, checks the tailnet ACL and
 * tells the app who it let in through the `Tailscale-User-Login` and `Tailscale-User-Name` headers.
 * Those headers are the only identity a PI WEB install can get, and a push subscription is a device
 * that will be sent session titles for the rest of its life, so a subscription records who registered
 * it: a reader who revokes a phone in the device list is revoking a named tailnet user's device, and a
 * deployment that names allowed logins refuses a subscription from anyone else.
 *
 * The header arrives from Tailscale, not from a browser, so the web/API - the process Tailscale faces
 * - is the only writer of the identity the daemon is shown. It reads the Tailscale headers off its own
 * inbound request and forwards them under PI WEB's own names, having removed any copy a client put
 * there; the daemon reads only the PI WEB names. A browser cannot claim an identity, and a LAN client
 * that sets `tailscale-user-login` gets that header dropped at the edge.
 *
 * Tailscale encodes a header value that is not printable ASCII as `b64:` plus standard base64
 * (`encTailscaleHeaderValue` in tailscale's `ipn/ipnlocal/serve.go`), so a name with an accent arrives
 * encoded and a decoded value is what a device list may show.
 */

import type { IncomingHttpHeaders } from "node:http";
import { isTailnetLogin, TAILNET_IDENTITY_MAX_LENGTH } from "../../shared/deviceIdentity.js";

export { isTailnetLogin, tailnetLoginAllowed, TAILNET_IDENTITY_MAX_LENGTH } from "../../shared/deviceIdentity.js";

export const TAILSCALE_LOGIN_HEADER = "tailscale-user-login";
export const TAILSCALE_NAME_HEADER = "tailscale-user-name";
/** The identity the web/API hands the daemon. Inbound copies are removed at the edge. */
export const PI_WEB_TAILNET_LOGIN_HEADER = "x-pi-web-tailnet-login";
export const PI_WEB_TAILNET_NAME_HEADER = "x-pi-web-tailnet-name";

export interface TailnetIdentity {
  /** The tailnet login, lowercased: `user@github`, `user@example.com`. */
  readonly login: string;
  /** The display name Tailscale reported, when it reported one. */
  readonly name: string;
}

/** The headers a request carries, as Node types them and as Fastify hands them over. */
export type HeaderSource = IncomingHttpHeaders;

/**
 * Tailscale's own encoding, read back: a `b64:` value is base64, anything else is the value.
 *
 * A value that is not valid base64 after the prefix is used as it stands, which is what Tailscale's
 * decoder does with a string it never minted - the identity is then refused for shape, not accepted
 * decoded from something that was not encoded.
 */
export function decodeTailscaleHeaderValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("b64:")) return trimmed;
  const encoded = trimmed.slice("b64:".length).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) return trimmed;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    return decoded.includes("\u0000") ? trimmed : decoded.trim();
  } catch {
    return trimmed;
  }
}

/**
 * The tailnet identity Tailscale put on this request. For the web process, which is the edge
 * Tailscale faces: only Tailscale's own headers count, so a browser that sets
 * `x-pi-web-tailnet-login` claims nothing.
 */
export function tailnetIdentityFromTailscale(headers: HeaderSource | undefined): TailnetIdentity | undefined {
  return readIdentity(headers, TAILSCALE_LOGIN_HEADER, TAILSCALE_NAME_HEADER);
}

/**
 * The tailnet identity the web process forwarded. For the daemon, which is reached through the web
 * process: only PI WEB's own headers count, and the web process is their only writer, because the
 * daemon client forwards no inbound browser headers.
 */
export function tailnetIdentityFromProxy(headers: HeaderSource | undefined): TailnetIdentity | undefined {
  return readIdentity(headers, PI_WEB_TAILNET_LOGIN_HEADER, PI_WEB_TAILNET_NAME_HEADER);
}

/**
 * The identity a request carries, in the form this product stores.
 *
 * Control characters, a credential, and an over-long value are refused: the value goes into a device
 * list and into a file on disk, so a login is an address-shaped string and a name is printable text.
 * No login means no identity - a browser on the same machine, a tagged device, a plain-LAN install -
 * and that is reported as "no tailnet identity", never as an empty user.
 */
function readIdentity(headers: HeaderSource | undefined, loginHeader: string, nameHeader: string): TailnetIdentity | undefined {
  const login = headerValue(headers, loginHeader);
  if (login === undefined) return undefined;
  const decoded = decodeTailscaleHeaderValue(login).toLowerCase();
  if (!isTailnetLogin(decoded)) return undefined;
  const name = headerValue(headers, nameHeader);
  const decodedName = name === undefined ? "" : printableTailnetName(decodeTailscaleHeaderValue(name));
  return { login: decoded, name: decodedName };
}

function headerValue(headers: HeaderSource | undefined, name: string): string | undefined {
  if (headers === undefined) return undefined;
  const value = Reflect.get(headers, name);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

/** The headers the web process puts on a daemon request to carry an identity Tailscale vouched for. */
export function tailnetForwardHeaders(identity: TailnetIdentity): Record<string, string> {
  return {
    [PI_WEB_TAILNET_LOGIN_HEADER]: identity.login,
    ...(identity.name === "" ? {} : { [PI_WEB_TAILNET_NAME_HEADER]: identity.name }),
  };
}

function printableTailnetName(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0 || collapsed.length > TAILNET_IDENTITY_MAX_LENGTH) return "";
  for (const character of collapsed) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return "";
  }
  return collapsed;
}
