import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { settingsControlStyles } from "./settingsControlStyles.js";
import type { NotificationAvailability } from "../../notifications/taskNotifications";

/**
 * Device notifications, on this browser only.
 *
 * The reader is asking one question here: "will this device tell me when a task finishes?" The
 * answer depends on two things that are not the same and must not be reported as one - what the
 * browser allows (it decides: a denied permission is the browser's answer, and the page cannot
 * re-ask its way past it) and what the reader wants (a preference stored on this device, which
 * never travels to the machine PI WEB runs on).
 *
 * What a page-posted notification cannot do is arrive after the browser has been quit. On iPhone
 * and iPad the notice needs the installed web app; that is said here, in the panel that answers
 * "why did nothing arrive", rather than discovered by the reader at the lock screen.
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
  @state() private busy = false;
  @state() private answer: string | undefined;

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
        <p class="lede">When a task finishes, PI WEB posts a notice to this device's notification centre - for the session open in this tab, while this browser is running.</p>
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
        <p class="hint">The notice arrives while this browser is open, including in a background tab. A notice that arrives after the browser was quit has to be sent by the server through Apple's push service; PI WEB does not do that yet.</p>
      </div>
    `;
  }

  private availabilitySentence(): string {
    return AVAILABILITY_SENTENCES[this.availability];
  }

  static override styles = [interactiveSurfaceStyles, settingsControlStyles, css`
    :host { display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; }
    .heading { margin-bottom: var(--pi-space-6); }
    h2 { margin: 0 0 var(--pi-space-2); font-family: var(--pi-font-display); font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); letter-spacing: -0.01em; }
    .lede { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .row { display: grid; gap: var(--pi-space-4); }
    .field { display: inline-flex; align-items: center; gap: var(--pi-space-4); }
    .field-heading { font-size: var(--pi-text-sm); }
    .switch { box-sizing: border-box; display: inline-flex; align-items: center; width: var(--pi-control-height-touch); height: 26px; padding: 0 3px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); cursor: pointer; }
    .switch.on { background: var(--pi-accent); border-color: var(--pi-accent); }
    .switch[disabled] { opacity: .5; cursor: default; }
    .switch-knob { display: block; width: 20px; height: 20px; border-radius: 50%; background: var(--pi-text); transition: transform var(--pi-motion-fast) var(--pi-ease); }
    .switch.on .switch-knob { transform: translateX(18px); }
    .state { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .hint { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .actions { display: inline-flex; gap: var(--pi-space-4); }
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
