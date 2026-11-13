import type { FastifyInstance, FastifyReply } from "fastify";
import { ntfyFetch } from "../../notifications/ntfyFetch.js";
import type { NtfyConfig } from "../../../shared/apiTypes.js";
import {
  ntfyReadiness,
  ntfyTopicConfigured,
  parseNtfyConfig,
  publicNtfyConfig,
  sendNtfyNotice,
  NtfyConfigError,
  type NtfyStatus,
} from "../../../shared/ntfy.js";

/**
 * The ntfy routes the Settings panel talks to: its status, and its test notice.
 *
 * Both are served at the plain `/api` prefix by the PI WEB the browser is talking to, because the
 * config that decides them is that machine's. Neither one reads like a config write: the panel gets a
 * status without the topic (`topicConfigured` says there is one) and a test that answers with the
 * delivery's own outcome, so the reader learns what the channel does before a task depends on it.
 *
 * The topic is never part of an answer, and a failure's reason comes back already with the topic cut
 * out of it - see `shared/ntfy.ts` for why that is a rule and not a nicety.
 */
export interface NtfyRoutesOptions {
  /** The stored ntfy block, read live so a saved change needs no restart. */
  readConfig: () => NtfyConfig | undefined;
  fetchImpl?: typeof fetch;
}

/** What the panel sends with a test: the block it is showing, so a test proves the drafted channel. */
interface NtfyTestBody {
  ntfy?: Partial<NtfyConfig>;
}

export function registerNtfyRoutes(app: FastifyInstance, options: NtfyRoutesOptions): void {
  app.get("/api/notifications/ntfy/status", () => ntfyStatus(options.readConfig()));

  app.post<{ Body: NtfyTestBody | undefined }>("/api/notifications/ntfy/test", async (request, reply) => {
    const config = configToTest(request.body, options.readConfig(), reply);
    if (config === undefined) return;
    const readiness = ntfyReadiness(config);
    if (!readiness.ready) return refused(reply, readiness.reason ?? "ntfy is not ready.");
    const delivery = await sendNtfyNotice(
      {
        event: "completed",
        title: "PI WEB",
        message: "This is the ntfy notice you asked for. Your server and topic are working.",
        dedupeKey: `test\u0000${String(Date.now())}`,
        tags: ["white_check_mark"],
      },
      config,
      { fetchImpl: options.fetchImpl ?? ntfyFetch },
    );
    return {
      delivered: delivery.delivered,
      attempts: delivery.attempts,
      ...(delivery.reason === undefined ? {} : { reason: delivery.reason }),
    };
  });
}

/**
 * The block a test publishes to: what the panel is showing if it sent one, the stored config if it sent
 * nothing.
 *
 * A test that always published the stored block told a reader who had just typed a topic that their
 * channel works, about a channel they had not saved, while the topic in the box was never contacted
 * (2026-11-13). The panel sends what it is showing, and the answer is about that.
 */
/**
 * The block a test publishes to: the panel's draft over the stored channel, and the stored channel when
 * the panel sent no draft.
 *
 * A test that always published the stored block told a reader who had just typed a topic that their
 * channel works, about a channel they had not saved, while the topic in the box was never contacted
 * (2026-11-13). Only the fields the browser sent count, so a panel that shows the server and the
 * switches - and never the topic, which does not travel to a browser - can test the pair it is showing.
 * The switch is forced on: pressing "send me one now" is the same request in words. The draft travels
 * over the same parser a config write uses, so a test proves the bytes a save would store.
 */
function configToTest(body: NtfyTestBody | undefined, stored: NtfyConfig | undefined, reply: FastifyReply): NtfyConfig | undefined {
  const draft = body?.ntfy;
  if (draft === undefined) {
    if (stored === undefined) {
      refused(reply, "ntfy is not configured in Settings.");
      return undefined;
    }
    return stored;
  }
  const keys = ["serverUrl", "topic", "onCompleted", "onFailed", "onAskUser", "clickUrlBase", "timeoutMs"] as const;
  const merged: Record<string, unknown> = { ...(stored ?? {}), enabled: true };
  for (const key of keys) {
    const value = draft[key];
    if (value === undefined) continue;
    merged[key] = value;
  }
  try {
    return parseNtfyConfig(merged, "test request");
  } catch (error: unknown) {
    refused(reply, error instanceof NtfyConfigError ? error.message.replace("test request ", "") : "The settings in the box are not valid.");
    return undefined;
  }
}

/**
 * What the panel can say about ntfy without knowing the topic.
 *
 * The switches, the server, and whether a topic is stored: enough to show a state and to write a
 * change, not enough to publish to the reader's channel.
 */
export function ntfyStatus(config: NtfyConfig | undefined): NtfyStatus {
  const readiness = ntfyReadiness(config);
  const configValue = parseNtfyConfigResponse(config);
  return {
    enabled: config?.enabled === true,
    ready: readiness.ready,
    ...(readiness.reason === undefined ? {} : { reason: readiness.reason }),
    topicConfigured: ntfyTopicConfigured(config),
    ...(configValue === undefined ? {} : { config: configValue }),
  };
}

function parseNtfyConfigResponse(config: NtfyConfig | undefined): NtfyConfig | undefined {
  if (config === undefined) return undefined;
  return publicNtfyConfig(config);
}

function refused(reply: FastifyReply, reason: string) {
  return reply.code(400).send({ error: reason });
}
