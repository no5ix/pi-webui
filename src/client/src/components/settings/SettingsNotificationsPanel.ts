import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { settingsControlStyles } from "./settingsControlStyles";
import type { NotificationAvailability } from "../../notifications/taskNotifications";
import { NTFY_EVENT_FIELDS, type NtfyConfig, type NtfyStatus } from "../../../../shared/ntfy";

/**
 * Device notifications, on this browser and on the reader's phone.
 *
 * The reader is asking one question here: "will this device tell me when a task finishes?" Two
 * channels answer it, and they are deliberately separate.
 *
 * The browser's own notice depends on two things that are not the same and must not be reported as
 * one - what the browser allows (it decides: a denied permission is the browser's answer, and the
 * page cannot re-ask its way past it) and what the reader wants (a preference stored on this device,
 * which never travels to the machine PI WEB runs on). What a page-posted notification cannot do is
 * arrive after the browser has been quit; on iPhone and iPad the notice needs the installed web app,
 * and that is said here, in the panel that answers "why did nothing arrive", rather than discovered
 * by the reader at the lock screen.
 *
 * ntfy is the channel that does not need this browser at all: the session daemon posts to a topic and
 * the phone's ntfy app shows it, with the laptop's browser closed. It is configured on the server
 * (the notices are sent from the machine that ran the task), and its topic is a bearer secret on the
 * public ntfy server - so this panel writes the topic and is never shown it. It is told only that one
 * is stored, and saving anything else keeps it.
 */
@customElement("settings-notifications-panel")
export class SettingsNotificationsPanel extends LitElement {
  /** What the browser allows, as it answered. */
  @property({ attribute: false }) availability: NotificationAvailability = "unsupported";
  /** What the reader asked for on this device. */
  @property({ attribute: false }) wanted = false;
  /** Turns the preference on (asking the browser) or off. Reports what the browser answered. */
  @property({ attribute: false }) onToggle?: (wanted: boolean) => Promise<NotificationAvailability>;
  /** Sends a notice now, so the reader can see the answer in the notification centre. */
  @property({ attribute: false }) onTest?: () => Promise<boolean>;
  /** What this PI WEB says about its ntfy channel; undefined means it has not answered yet. */
  @property({ attribute: false }) ntfy: NtfyStatus | undefined = undefined;
  /** Saves the ntfy block. A draft with no topic keeps the stored one; `clearTopic` forgets it and keeps the block. */
  @property({ attribute: false }) onSaveNtfy?: (draft: NtfyConfig, write: { readonly clearTopic?: boolean }) => Promise<void>;
  /** Asks the server to post one notice now, through the same path a real notice takes, to the block the panel is showing. */
  @property({ attribute: false }) onTestNtfy?: (draft: NtfyConfig) => Promise<NtfyTestOutcome>;
  @state() private busy = false;
  @state() private answer: string | undefined;
  @state() private ntfyDraft: NtfyDraft | undefined = undefined;
  @state() private ntfyBusy = false;
  @state() private ntfyAnswer: string | undefined;
  @state() private ntfyError = "";

  private async toggle(wanted: boolean): Promise<void> {
    const onToggle = this.onToggle;
    if (onToggle === undefined || this.busy) return;
    this.busy = true;
    const availability = await onToggle(wanted);
    this.busy = false;
    this.answer = AVAILABILITY_WORDS[availability];
    this.requestUpdate();
  }

  private async test(): Promise<void> {
    const onTest = this.onTest;
    if (onTest === undefined || this.busy) return;
    this.busy = true;
    const posted = await onTest();
    this.busy = false;
    this.answer = posted ? "A notice went to the notification centre." : "Nothing was sent: this browser is not letting this page post notifications.";
    this.requestUpdate();
  }

  protected override render(): TemplateResult {
    const granted = this.availability === "granted";
    return html`
      <div class="heading">
        <h2>Notifications</h2>
        <p class="lede">When a task ends, PI WEB tells the devices you chose: this browser's notification centre, and an ntfy topic that reaches a phone.</p>
      </div>
      <div class="row">
        <label class="field">
          <span class="field-heading">Tell me when a task finishes</span>
          <button
            type="button"
            role="switch"
            class=${`switch ${this.wanted ? "on" : ""}`}
            aria-checked=${this.wanted ? "true" : "false"}
            aria-label="Tell me when a task finishes"
            ?disabled=${this.busy}
            @click=${() => { void this.toggle(!this.wanted); }}
          ><span class="switch-knob"></span></button>
        </label>
        <p class="state">${this.availabilitySentence()}</p>
        ${this.answer === undefined ? null : html`<p class="state">${this.answer}</p>`}
        <div class="actions">
          <button type="button" @click=${() => { void this.test(); }} ?disabled=${this.busy || !granted}>Send a test notice</button>
        </div>
        ${isIOS() && !isInstalledApp() ? html`<p class="hint">On iPhone and iPad, Safari only shows these notices to the installed web app: use Add to Home Screen, then turn this on there.</p>` : null}
        <p class="hint">The notice arrives while this browser is open, including in a background tab. A notice that arrives after the browser was quit has to be sent by the server through Apple's push service; PI WEB does not do that yet. Use ntfy below to be told on a phone.</p>
      </div>
      ${this.renderNtfy()}
    `;
  }

  /**
   * The ntfy channel.
   *
   * The draft is the panel's own: a reader who types a server and a topic and then presses Test has
   * asked a question about settings they have not saved yet, so the panel says what it is about to
   * send and keeps the fields. The topic box never shows the stored value - it reports that one is
   * stored - and a save that leaves it empty keeps it.
   */
  private renderNtfy(): TemplateResult {
    const status = this.ntfy;
    const draft = this.ntfyDraft ?? draftFrom(status?.config);
    return html`
      <div class="ntfy">
        <h3>ntfy</h3>
        <p class="lede">The session daemon posts a message to ntfy, and the ntfy app on your phone shows it. One topic receives notices from all sessions managed by this PI WEB installation. This works with any ntfy server, including your own, and does not need this browser open.</p>
        ${status === undefined ? html`<p class="state">Loading the ntfy channel…</p>` : null}
        <label class="field">
          <span class="field-heading">Send ntfy notices</span>
          <button
            type="button"
            role="switch"
            class=${`switch ${draft.enabled ? "on" : ""}`}
            aria-checked=${draft.enabled ? "true" : "false"}
            aria-label="Send ntfy notices"
            ?disabled=${this.ntfyBusy}
            @click=${() => { this.ntfyDraft = { ...draft, enabled: !draft.enabled }; }}
          ><span class="switch-knob"></span></button>
        </label>
        <div class="fields">
          <label class="text-field">
            <span class="field-heading">Server</span>
            <input type="text" spellcheck="false" autocomplete="off" placeholder="https://ntfy.sh" .value=${draft.serverUrl}
              @input=${(event: Event) => { this.ntfyDraft = { ...draft, serverUrl: inputValue(event) }; }} />
          </label>
          <label class="text-field">
            <span class="field-heading">Topic</span>
            <input type="text" spellcheck="false" autocomplete="off" .placeholder=${status?.topicConfigured === true ? TOPIC_STORED_PLACEHOLDER : "your-topic"} .value=${draft.topic}
              aria-describedby="ntfy-topic-note" @input=${(event: Event) => { this.ntfyDraft = { ...draft, topic: inputValue(event) }; }} />
          </label>
          <label class="text-field">
            <span class="field-heading">Server address for taps</span>
            <input type="text" spellcheck="false" autocomplete="off" placeholder="https://pi.example.ts.net:8505" .value=${draft.clickUrlBase}
              aria-describedby="ntfy-tap-note" @input=${(event: Event) => { this.ntfyDraft = { ...draft, clickUrlBase: inputValue(event) }; }} />
          </label>
        </div>
        <p class="hint" id="ntfy-tap-note">Every notice names the session and the event. With a server address, tapping a notice opens that session on the device that received it; the address is the one that device uses, not the one this browser happens to be on.</p>
        <p class="hint" id="ntfy-topic-note">${status?.topicConfigured === true
          ? "A topic is stored on the server. It is never shown here. Leave the box empty to keep it, or type a new one to replace it."
          : "The topic is the address: anyone who knows it can publish to it and read what arrives, so treat it as a password. On a server you run, an access token is the safer choice."}</p>
        <div class="events">
          ${NTFY_EVENT_FIELDS.map((field) => html`
            <label class="field">
              <span class="field-heading">${field.label}</span>
              <button
                type="button"
                role="switch"
                class=${`switch ${draft[field.key] ? "on" : ""}`}
                aria-checked=${draft[field.key] ? "true" : "false"}
                aria-label=${field.label}
                ?disabled=${this.ntfyBusy}
                @click=${() => { this.ntfyDraft = { ...draft, [field.key]: !draft[field.key] }; }}
              ><span class="switch-knob"></span></button>
            </label>
          `)}
        </div>
        <div class="actions">
          <button type="button" @click=${() => { void this.saveNtfy(draft); }} ?disabled=${this.ntfyBusy || this.onSaveNtfy === undefined}>Save ntfy settings</button>
          <button type="button" @click=${() => { void this.testNtfy(draft); }} ?disabled=${this.ntfyBusy || this.onTestNtfy === undefined}>Send a test notice</button>
          ${status?.topicConfigured === true
            ? html`<button type="button" class="quiet" @click=${() => { void this.clearTopic(draft); }} ?disabled=${this.ntfyBusy || this.onSaveNtfy === undefined}>Stop using this topic</button>`
            : null}
        </div>
        ${this.ntfyAnswer === undefined ? null : html`<p class="state">${this.ntfyAnswer}</p>`}
        ${this.ntfyError === "" ? null : html`<p class="state error">${this.ntfyError}</p>`}
        ${status === undefined || status.ready ? null : html`<p class="state">${status.reason ?? "ntfy is not ready."}</p>`}
        <p class="hint">Notices are posted by the session daemon, so they arrive with no browser open. Each channel is switched on apart from the other, and one channel failing never stops the other.</p>
      </div>
    `;
  }

  private async saveNtfy(draft: NtfyDraft, write: { readonly clearTopic?: boolean } = {}): Promise<void> {
    const onSave = this.onSaveNtfy;
    if (onSave === undefined || this.ntfyBusy) return;
    this.ntfyBusy = true;
    this.ntfyError = "";
    this.ntfyAnswer = undefined;
    try {
      await onSave(draftToConfig(draft), write);
      this.ntfyAnswer = write.clearTopic === true
        ? "Saved. The topic is gone: notices stop until you type a new one."
        : "Saved. The next event uses these settings.";
      this.ntfyDraft = undefined;
    } catch (error: unknown) {
      this.ntfyError = describeNtfyFailure(error);
    } finally {
      this.ntfyBusy = false;
    }
  }

  /**
   * The one write that forgets a stored topic.
   *
   * A blank topic box keeps the stored one - that is what makes turning a switch on safe - so stopping
   * has to be an act the reader named. The block stays: the switches and the server are the reader's
   * and are not this button's business.
   */
  private async clearTopic(draft: NtfyDraft): Promise<void> {
    await this.saveNtfy(draft, { clearTopic: true });
  }

  private async testNtfy(draft: NtfyDraft): Promise<void> {
    const onTest = this.onTestNtfy;
    if (onTest === undefined || this.ntfyBusy) return;
    this.ntfyBusy = true;
    this.ntfyError = "";
    this.ntfyAnswer = "Sending…";
    try {
      const outcome = await onTest(draftToConfig(draft));
      // The notice went to the boxes, which is what the reader asked about; the answer says so, because
      // a channel that works and a channel that is saved are two facts and the reader needs both.
      this.ntfyAnswer = outcome.delivered
        ? `ntfy accepted the test notice.${this.ntfyDraft === undefined ? "" : " The draft settings are not saved yet."} Check the subscribed topic on your phone.`
        : `ntfy did not accept the test notice: ${outcome.reason ?? "the delivery failed."}`;
    } catch (error: unknown) {
      this.ntfyError = describeNtfyFailure(error);
    } finally {
      this.ntfyBusy = false;
    }
  }

  private availabilitySentence(): string {
    return AVAILABILITY_SENTENCES[this.availability];
  }

  static override styles = [interactiveSurfaceStyles, settingsControlStyles, css`
    :host { display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; }
    .heading { margin-bottom: var(--pi-space-6); }
    h2 { margin: 0 0 var(--pi-space-2); font-family: var(--pi-font-display); font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); letter-spacing: -0.01em; }
    h3 { margin: 0 0 var(--pi-space-2); font-family: var(--pi-font-display); font-size: var(--pi-text-base); font-weight: var(--pi-weight-semibold); }
    .lede { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .row { display: grid; gap: var(--pi-space-4); }
    .ntfy { display: grid; gap: var(--pi-space-4); margin-top: var(--pi-space-8); padding-top: var(--pi-space-6); border-top: 1px solid var(--pi-border); }
    .field { display: inline-flex; align-items: center; gap: var(--pi-space-4); }
    .fields { display: grid; gap: var(--pi-space-4); grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
    .events { display: grid; gap: var(--pi-space-3); }
    .text-field { display: grid; gap: var(--pi-space-2); min-width: 0; }
    .text-field input { box-sizing: border-box; min-width: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-2) var(--pi-space-3); font: var(--pi-text-sm) var(--pi-font-mono); }
    .text-field input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
    .field-heading { font-size: var(--pi-text-sm); }
    .switch { box-sizing: border-box; display: inline-flex; align-items: center; width: var(--pi-control-height-touch); height: 26px; padding: 0 3px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); cursor: pointer; flex: 0 0 auto; }
    .switch.on { background: var(--pi-accent); border-color: var(--pi-accent); }
    .switch[disabled] { opacity: .5; cursor: default; }
    .switch-knob { display: block; width: 20px; height: 20px; border-radius: 50%; background: var(--pi-text); transition: transform var(--pi-motion-fast) var(--pi-ease); }
    .switch.on .switch-knob { transform: translateX(18px); }
    .state { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .state.error { color: var(--pi-danger); }
    .hint { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .actions { display: inline-flex; flex-wrap: wrap; gap: var(--pi-space-4); }
    .actions button { box-sizing: border-box; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-2) var(--pi-space-4); font: var(--pi-text-sm) var(--pi-font-ui); cursor: pointer; }
    @media (pointer: coarse) { .actions button { min-height: var(--pi-control-height-touch); } }
    @media (hover: hover) { .actions button:hover { border-color: var(--pi-accent); } }
    .actions button:disabled { opacity: var(--pi-disabled-opacity); cursor: default; }
    .actions button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
  `];
}

const AVAILABILITY_WORDS: Record<NotificationAvailability, string> = {
  unsupported: "This browser does not offer web notifications.",
  insecure: "This page is not served over HTTPS, so the browser will not offer notifications.",
  unregistered: "The page's notification service is not registered on this browser.",
  prompt: "The browser will ask for permission when the switch is turned on.",
  denied: "The browser has blocked notifications for this site. Allow them in the browser's site settings, then turn the switch on.",
  granted: "This browser allows notifications.",
};

const AVAILABILITY_SENTENCES: Record<NotificationAvailability, string> = {
  unsupported: "This browser does not offer web notifications.",
  insecure: "Notifications need HTTPS: this page is served over a plain http address the browser will not notify from.",
  unregistered: "Notifications are allowed, but the page's notification service is not registered here.",
  prompt: "This browser has not been asked yet. Turning the switch on asks it.",
  denied: "This browser blocks notifications for this site. Unblock them in its site settings first.",
  granted: "This browser allows notifications from PI WEB.",
};

/** What the panel edits, in the shape a form holds it: every field a string or a switch. */
interface NtfyDraft {
  enabled: boolean;
  serverUrl: string;
  topic: string;
  /** The address a tap opens: this PI WEB, as the device that got the notice reaches it. Empty means the notice gets no tap target. */
  clickUrlBase: string;
  onCompleted: boolean;
  onFailed: boolean;
  onAskUser: boolean;
}

const TOPIC_STORED_PLACEHOLDER = "•••••• stored";

const DEFAULT_DRAFT: NtfyDraft = {
  enabled: false,
  serverUrl: "",
  topic: "",
  clickUrlBase: "",
  onCompleted: true,
  onFailed: true,
  onAskUser: true,
};

function draftFrom(config: NtfyConfig | undefined): NtfyDraft {
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

/**
 * The draft as a write.
 *
 * An empty topic box writes no `topic` at all, which is how the server knows to keep the stored one.
 * An empty server box writes the default, so a reader who turns the channel on without thinking about
 * the server gets `https://ntfy.sh` - what ntfy's own documentation calls the public server.
 */
function draftToConfig(draft: NtfyDraft): NtfyConfig {
  const topic = draft.topic.trim();
  const clickUrlBase = draft.clickUrlBase.trim();
  return {
    enabled: draft.enabled,
    serverUrl: draft.serverUrl.trim() === "" ? DEFAULT_SERVER_URL : draft.serverUrl.trim(),
    ...(topic === "" ? {} : { topic }),
    // A tap target is only worth sending when the reader named one: the daemon must not guess the
    // address a phone should open, and a notice pointed at the wrong address is a notice that goes nowhere.
    ...(clickUrlBase === "" ? {} : { clickUrlBase }),
    onCompleted: draft.onCompleted,
    onFailed: draft.onFailed,
    onAskUser: draft.onAskUser,
  };
}

const DEFAULT_SERVER_URL = "https://ntfy.sh";

export interface NtfyTestOutcome {
  readonly delivered: boolean;
  readonly attempts: number;
  readonly reason?: string;
}

function inputValue(event: Event): string {
  const target = event.target;
  return target instanceof HTMLInputElement ? target.value : "";
}

/**
 * A failure the panel reports.
 *
 * The server's own validation and delivery messages are written for the reader, so they are the words
 * shown. A transport failure is not - it names an address this page is talking to, not ntfy - so it
 * becomes the sentence about the settings not being saved, which is the fact the reader can act on.
 */
function describeNtfyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch|NetworkError|Load failed/iu.test(message)) return "The browser could not reach PI WEB to complete this request. Check the connection and try again.";
  return message;
}

/**
 * Running as an installed web app.
 *
 * iOS reports `display-mode: standalone` in its ordinary Safari tab as well, so that test alone
 * hides the "add to Home Screen" hint exactly where it is needed; iOS is asked the question it
 * answers truthfully - `navigator.standalone`, true only when the app was launched from its icon.
 */
function isInstalledApp(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isIOS()) return Reflect.get(navigator, "standalone") === true;
  return window.matchMedia("(display-mode: standalone)").matches;
}

/** iPhone and iPad, told apart from a Mac by the platform plus the pointer, as iOS reports itself. */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/u.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-notifications-panel": SettingsNotificationsPanel;
  }
}
