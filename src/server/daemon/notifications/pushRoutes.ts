import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { parsePushRegistration, pushDeviceView, type DeviceNotificationEvent } from "../../../shared/notificationEvents.js";
import { tailnetIdentityFromProxy } from "../../shared/tailscaleIdentity.js";
import { isRecord } from "../../../shared/unknownValues.js";
import type { PushSubscriptionStore } from "./pushSubscriptionStore.js";
import type { DeviceNotificationService } from "./deviceNotificationService.js";

/**
 * The push routes a browser talks to, on the daemon, forwarded by the web/API.
 *
 * A subscription is a device's address and the daemon is the process that has events to send, so the
 * store and the senders live where the events are: a web/API restart must not stop a phone being
 * told. The routes are the smallest set that covers the lifecycle - register, list, remove, test -
 * and the settings page reports from the same answers it writes, so a device list a reader sees is
 * the list the server is actually sending to.
 *
 * The registration is validated by the shared contract (`parsePushRegistration`): an endpoint on plain
 * HTTP and a key that is not a key are refused with the reason, because a stored subscription that can
 * never be delivered to is a device the reader believes is notified.
 *
 * What these routes answer about a device is the public view (`pushDeviceView`): a label, the push
 * service's host, who registered it, and the last answer from that service. The endpoint carries a
 * service-issued token and the keys carry the auth secret, so neither leaves the daemon - a page that
 * held them could send to the device itself.
 */
export function registerPushRoutes(
  app: FastifyInstance,
  notifications: DeviceNotificationService,
  subscriptions: PushSubscriptionStore,
  options: { createId?: () => string; prefix?: string } = {},
): void {
  const createId = options.createId ?? (() => randomUUID());
  // The daemon answers its routes unprefixed; the web/API strips `/api` before it forwards. A route
  // registered at `/api/push` here is a route nobody can reach, and the settings panel would report a
  // server that has no key pair.
  const prefix = options.prefix ?? "";

  app.get(`${prefix}/push/state`, async () => {
    const health = await subscriptions.health();
    return {
      state: await notifications.state(),
      publicKey: notifications.publicKey(),
      problem: notifications.problem(),
      // A device file the daemon cannot read answers with no devices. The reason travels with the
      // list, because "no devices" would send a reader to unsubscribe a phone that is registered.
      devicesUnknown: health.unreadable,
      devices: (await subscriptions.list()).map(pushDeviceView),
    };
  });

  app.post(`${prefix}/push/subscriptions`, async (request, reply) => {
    // A server with push turned off registers no devices. Storing endpoints, keys and auth secrets
    // that will never be sent to would fill the device list with devices the reader believes are
    // notified, and leave a phone's address on a disk that has decided not to use it.
    if ((await notifications.state()).disabled) {
      return reply.code(409).send({ error: "This PI WEB has push turned off in its config (push.enabled: false), so it registers no device." });
    }
    const parsed = parsePushRegistration(request.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.refusal });
    // The identity is the one the web process forwarded - it is the only writer of that header, because
    // the daemon client forwards no browser headers - and it is stored with the address, so a device
    // list says whose device each row is and an allowlist can refuse someone's phone.
    const identity = tailnetIdentityFromProxy(request.headers);
    if (identity === undefined) {
      if (!notifications.identityAllowed("")) return reply.code(403).send({ error: "This PI WEB only registers devices that come through Tailscale with an allowed login (push.allowedTailnetLogins)." });
    } else if (!notifications.identityAllowed(identity.login)) {
      return reply.code(403).send({ error: `The Tailscale login ${identity.login} is not in push.allowedTailnetLogins, so this PI WEB will not register its device.` });
    }
    const registered = await subscriptions.register(parsed.registration, identity === undefined ? { login: "", name: "" } : { login: identity.login, name: identity.name });
    if (registered === undefined) return reply.code(507).send({ error: "This PI WEB holds too many push subscriptions. Unsubscribe a device in its browser, then try again." });
    return { id: registered.record.id, created: registered.created, device: pushDeviceView(registered.record) };
  });

  /**
   * Forget one device, and only that device.
   *
   * Revocation is per row: a reader who lost a phone, or who stopped letting a friend's laptop see their
   * session titles, removes that address and every other device keeps receiving. The browser side of the
   * same action (unsubscribe at the push service) is the page's, and a device that unsubscribed there
   * answers 410 here and is dropped by the sender.
   */
  app.delete<{ Params: { id?: string } }>(`${prefix}/push/subscriptions/:id`, async (request, reply) => {
    const id = request.params.id;
    if (typeof id !== "string" || id === "") return reply.code(400).send({ error: "A subscription id is required" });
    const removed = await subscriptions.remove(decodeURIComponent(id));
    if (!removed) return reply.code(404).send({ error: "That subscription is not registered" });
    return { removed: true };
  });

  /**
   * Send a test event to every registered device, or to one.
   *
   * It is a real event with a real id, so the reader sees exactly the notification a real lifecycle
   * event produces, and a device that is not registered is reported as such rather than the page
   * claiming a notice was sent. The answer is per device and says what the push service answered:
   * `accepted` is that service taking the message, which is the strongest claim available from a server,
   * and the panel says in words that only the device can show a notice.
   */
  const testEvent = (sessionId: string, sessionName: string, projectName: string): DeviceNotificationEvent => ({
    id: `test:${createId()}`,
    kind: "task_completed",
    sessionId,
    sessionName,
    projectName,
    occurredAt: new Date().toISOString(),
    outcome: "completed",
    title: "PI WEB",
    body: "This is the push notification you asked for.",
  });

  const readTestBody = (body: unknown, reply: FastifyReply): { sessionId: string; sessionName: string; projectName: string } | undefined => {
    const record: Record<string, unknown> | undefined = isRecord(body) ? body : undefined;
    const sessionId = record === undefined ? undefined : Reflect.get(record, "sessionId");
    if (typeof sessionId !== "string" || sessionId === "") {
      reply.code(400).send({ error: "A sessionId is required" });
      return undefined;
    }
    const text = (key: string): string => {
      const value = record === undefined ? undefined : record[key];
      if (typeof value !== "string") return key === "sessionName" ? "PI WEB" : "";
      return value;
    };
    return { sessionId, sessionName: text("sessionName"), projectName: text("projectName") };
  };

  const testAnswer = async (event: DeviceNotificationEvent, only: string | undefined) => {
    const devices = await subscriptions.list();
    const view = new Map(devices.map((device) => [device.id, pushDeviceView(device)]));
    const delivery = await notifications.notify(event, only === undefined ? {} : { only });
    return {
      targets: delivery.targets,
      results: delivery.results.map((result) => ({
        deviceId: result.subscriptionId,
        label: view.get(result.subscriptionId)?.label ?? "",
        outcome: result.outcome,
        status: result.status,
        reason: result.reason,
      })),
      problem: notifications.problem(),
    };
  };

  app.post<{ Body: unknown; Params: { id?: string } }>(`${prefix}/push/test`, async (request, reply) => {
    const test = readTestBody(request.body, reply);
    if (test === undefined) return undefined;
    return testAnswer(testEvent(test.sessionId, test.sessionName, test.projectName), undefined);
  });

  app.post<{ Body: unknown; Params: { id?: string } }>(`${prefix}/push/subscriptions/:id/test`, async (request, reply) => {
    const id = request.params.id;
    if (typeof id !== "string" || id === "") return reply.code(400).send({ error: "A subscription id is required" });
    const deviceId = decodeURIComponent(id);
    if (!(await subscriptions.list()).some((device) => device.id === deviceId)) return reply.code(404).send({ error: "That subscription is not registered" });
    const test = readTestBody(request.body, reply);
    if (test === undefined) return undefined;
    return testAnswer(testEvent(test.sessionId, test.sessionName, test.projectName), deviceId);
  });
}
