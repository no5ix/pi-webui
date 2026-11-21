import { DEFAULT_NTFY_SERVER_URL, type NtfyConfig } from "../../../shared/ntfy";
import type { NotificationAvailability } from "./taskNotifications";

/**
 * The ntfy settings as a form holds them, and the rules that turn them into a write.
 *
 * The rules are the part worth owning, and they are not a rendering concern:
 *
 * - The topic is a bearer secret. The server never sends it back, so a form box can only ever report
 *   that one is stored (`topicStoredPlaceholder`), and an empty box writes no `topic` key at all, which
 *   is how the server knows to keep the stored one. Forgetting a topic is a named act - the
 *   `clearTopic` write - because a blank box has to stay safe for someone who only flipped a switch.
 * - An empty server box writes the public server. A reader who turns the channel on without thinking
 *   about the server gets `https://ntfy.sh`, which is what ntfy's own documentation calls the default.
 * - A tap target is only sent when the reader named one. The daemon must not guess the address a phone
 *   should open, and a notice pointed at the wrong address is a notice that goes nowhere.
 */
export interface NtfyDraft {
  enabled: boolean;
  serverUrl: string;
  topic: string;
  /** The address a tap opens: this PI WEB, as the device that got the notice reaches it. Empty means the notice gets no tap target. */
  clickUrlBase: string;
  onCompleted: boolean;
  onFailed: boolean;
  onAskUser: boolean;
}

const DEFAULT_DRAFT: NtfyDraft = {
  enabled: false,
  serverUrl: "",
  topic: "",
  clickUrlBase: "",
  onCompleted: true,
  onFailed: true,
  onAskUser: true,
};

export const TOPIC_STORED_PLACEHOLDER = "•••••• stored";

export function ntfyDraftFromConfig(config: NtfyConfig | undefined): NtfyDraft {
  if (config === undefined) return { ...DEFAULT_DRAFT };
  return {
    enabled: config.enabled === true,
    serverUrl: config.serverUrl ?? "",
    topic: "",
    clickUrlBase: config.clickUrlBase ?? "",
    onCompleted: config.onCompleted === true,
    onFailed: config.onFailed === true,
    onAskUser: config.onAskUser === true,
  };
}

/** The draft as a write: a blank topic writes nothing, a blank server writes the public one. */
export function ntfyDraftToConfig(draft: NtfyDraft): NtfyConfig {
  const topic = draft.topic.trim();
  const serverUrl = draft.serverUrl.trim();
  const clickUrlBase = draft.clickUrlBase.trim();
  return {
    enabled: draft.enabled,
    serverUrl: serverUrl === "" ? DEFAULT_NTFY_SERVER_URL : serverUrl,
    ...(topic === "" ? {} : { topic }),
    ...(clickUrlBase === "" ? {} : { clickUrlBase }),
    onCompleted: draft.onCompleted,
    onFailed: draft.onFailed,
    onAskUser: draft.onAskUser,
  };
}

/**
 * A failure the panel reports.
 *
 * The server's own validation and delivery messages are written for the reader, so they are the words
 * shown. A transport failure is not - it names an address this page is talking to, not ntfy - so it
 * becomes the sentence about the settings not being saved, which is the fact the reader can act on.
 */
export function describeNtfyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch|NetworkError|Load failed/iu.test(message)) return "The browser could not reach PI WEB to complete this request. Check the connection and try again.";
  return message;
}

/** What the reader's own switch says, per answer the browser gave. */
export const NOTIFICATION_AVAILABILITY_WORDS: Record<NotificationAvailability, string> = {
  unsupported: "This browser does not offer web notifications.",
  insecure: "This page is not served over HTTPS, so the browser will not offer notifications.",
  unregistered: "The page's notification service is not registered on this browser.",
  prompt: "The browser will ask for permission when the switch is turned on.",
  denied: "The browser has blocked notifications for this site. Allow them in the browser's site settings, then turn the switch on.",
  granted: "This browser allows notifications.",
};

/** What the channel's state sentence says, per answer the browser gave. */
export const NOTIFICATION_AVAILABILITY_SENTENCES: Record<NotificationAvailability, string> = {
  unsupported: "This browser does not offer web notifications.",
  insecure: "Notifications need HTTPS: this page is served over a plain http address the browser will not notify from.",
  unregistered: "Notifications are allowed, but the page's notification service is not registered here.",
  prompt: "This browser has not been asked yet. Turning the switch on asks it.",
  denied: "This browser blocks notifications for this site. Unblock them in its site settings first.",
  granted: "This browser allows notifications from PI WEB.",
};
