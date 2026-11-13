import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { parsePushRegistration, type DeviceNotificationEvent } from "../../../shared/notificationEvents.js";
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
 * The registration is validated by the shared contract (`parsePushRegistration`): an endpoint on
 * plain HTTP and a key that is not a key are refused with the reason, because a stored subscription
 * that can never be delivered to is a device the reader believes is notified.
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
      devices: (await subscriptions.list()).map((entry) => ({
        id: entry.id,
        userAgent: entry.userAgent,
        createdAt: entry.createdAt,
        lastDeliveredAt: entry.lastDeliveredAt,
        failures: entry.failures,
      })),
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
    const registered = await subscriptions.register(parsed.registration);
    if (registered === undefined) return reply.code(507).send({ error: "This PI WEB holds too many push subscriptions. Unsubscribe a device in its browser, then try again." });
    return { id: registered.record.id, created: registered.created };
  });

  app.delete<{ Params: { id?: string } }>(`${prefix}/push/subscriptions/:id`, async (request, reply) => {
    const id = request.params.id;
    if (typeof id !== "string" || id === "") return reply.code(400).send({ error: "A subscription id is required" });
    const removed = await subscriptions.remove(decodeURIComponent(id));
    if (!removed) return reply.code(404).send({ error: "That subscription is not registered" });
    return { removed: true };
  });

  /**
   * Send a test event to every registered device.
   *
   * It is a real event with a real id, so the reader sees exactly the notification a real lifecycle
   * event produces, and a device that is not registered is reported as such rather than the page
   * claiming a notice was sent.
   */
  app.post<{ Body: unknown }>(`${prefix}/push/test`, async (request, reply) => {
    const body: unknown = request.body;
    const sessionId: unknown = body === null || typeof body !== "object" ? undefined : Reflect.get(body, "sessionId");
    if (typeof sessionId !== "string" || sessionId === "") return reply.code(400).send({ error: "A sessionId is required" });
    const event: DeviceNotificationEvent = {
      id: `test:${createId()}`,
      kind: "task_completed",
      sessionId,
      sessionName: typeof body === "object" && body !== null && typeof Reflect.get(body, "sessionName") === "string" ? String(Reflect.get(body, "sessionName")) : "PI WEB",
      projectName: typeof body === "object" && body !== null && typeof Reflect.get(body, "projectName") === "string" ? String(Reflect.get(body, "projectName")) : "",
      occurredAt: new Date().toISOString(),
      outcome: "completed",
      title: "PI WEB",
      body: "This is the push notification you asked for.",
    };
    const delivery = await notifications.notify(event);
    return {
      targets: delivery.targets,
      results: delivery.results.map((result) => ({ outcome: result.outcome, status: result.status, reason: result.reason })),
      problem: notifications.problem(),
    };
  });
}
