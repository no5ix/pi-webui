import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { settingsControlStyles } from "./settingsControlStyles.js";
import type { NotificationAvailability } from "../../notifications/taskNotifications";
import { emptyPushPanelState, type PushActionOutcome, type PushDevice, type PushPanelState } from "../../notifications/webPush";
import { PUSH_DELIVERY_OUTCOMES, type PushDeliveryOutcome } from "../../../../shared/notificationEvents";
import { errorMessage } from "../../../../shared/unknownValues";

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
  /**
   * Push, for this device: what its browser can do, what the server can send, and which devices the
   * server is sending to. Read from the server, because a device list assembled from what one browser
   * remembers is not the list anything is delivered to.
   */
  @property({ attribute: false }) push: PushPanelState = emptyPushPanelState("unsupported");
  @property({ attribute: false }) onPushToggle?: (on: boolean) => Promise<PushActionOutcome>;
  @property({ attribute: false }) onPushTest?: () => Promise<string>;
  /** Register this device again at the push service, for a server that minted a new push key. */
  @property({ attribute: false }) onPushReregister?: () => Promise<PushActionOutcome>;
  /** Send a test to one device, so a list of four is diagnosed one row at a time. */
  @property({ attribute: false }) onPushTestDevice?: (id: string) => Promise<string>;
  /** Revoke one device's address, and only that device's. */
  @property({ attribute: false }) onPushRemoveDevice?: (id: string) => Promise<PushActionOutcome>;
  @state() private busy = false;
  @state() private answer: string | undefined;
  @state() private pushBusy = false;
  @state() private pushAnswer: string | undefined;

  private async toggle(wanted: boolean): Promise<void> {
    const onToggle = this.onToggle;
    if (onToggle === undefined || this.busy) return;
    this.busy = true;
    try {
      this.answer = AVAILABILITY_WORDS[await onToggle(wanted)];
    } catch (error: unknown) {
      this.answer = `The browser did not answer: ${errorMessage(error)}`;
    } finally {
      this.busy = false;
      this.requestUpdate();
    }
  }

  private async test(): Promise<void> {
    const onTest = this.onTest;
    if (onTest === undefined || this.busy) return;
    this.busy = true;
    try {
      this.answer = (await onTest()) ? "A notice went to the notification centre." : "Nothing was sent: this browser is not letting this page post notifications.";
    } catch (error: unknown) {
      this.answer = `Nothing was sent: ${errorMessage(error)}`;
    } finally {
      this.busy = false;
      this.requestUpdate();
    }
  }

  private async pushToggle(on: boolean): Promise<void> {
    const onPushToggle = this.onPushToggle;
    if (onPushToggle === undefined || this.pushBusy) return;
    this.pushBusy = true;
    this.requestUpdate();
    try {
      this.pushAnswer = (await onPushToggle(on)).reason;
    } catch (error: unknown) {
      this.pushAnswer = `Push was not turned ${on ? "on" : "off"}: ${errorMessage(error)}`;
    } finally {
      this.pushBusy = false;
      this.requestUpdate();
    }
  }

  /**
   * Register this device again, at the push service as well as on the server.
   *
   * A browser gives back the subscription it already has, so a server that minted a new push key
   * leaves this device registered with the old one and refused on every send. Only a new
   * subscription can follow the server, and the switch cannot say that on its own.
   */
  private async pushReregister(): Promise<void> {
    const onPushReregister = this.onPushReregister;
    if (onPushReregister === undefined || this.pushBusy) return;
    this.pushBusy = true;
    this.requestUpdate();
    try {
      const outcome = await onPushReregister();
      this.pushAnswer = outcome.reason;
    } catch (error: unknown) {
      this.pushAnswer = `Re-registering this device failed: ${errorMessage(error)}`;
    } finally {
      this.pushBusy = false;
      this.requestUpdate();
    }
  }

  private async pushTest(): Promise<void> {
    const onPushTest = this.onPushTest;
    if (onPushTest === undefined || this.pushBusy) return;
    this.pushBusy = true;
    this.requestUpdate();
    try {
      this.pushAnswer = await onPushTest();
    } catch (error: unknown) {
      this.pushAnswer = `The test push did not run: ${errorMessage(error)}`;
    } finally {
      this.pushBusy = false;
      this.requestUpdate();
    }
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
        <p class="hint">The notice arrives while this browser is open, including in a background tab. A notice that arrives after the browser was quit is sent by the server through the push services - register this device under "Reach this device when its browser is closed".</p>
      </div>
      <div class="row">
        <label class="field">
          <span class="field-heading">Reach this device when its browser is closed</span>
          <button
            type="button"
            role="switch"
            class=${`switch ${this.push.self !== undefined ? "on" : ""}`}
            aria-checked=${this.push.self !== undefined ? "true" : "false"}
            aria-label="Reach this device with push notifications when its browser is closed"
            ?disabled=${this.pushBusy || this.push.support === "unsupported" || this.push.support === "insecure" || this.push.serverDisabled || !this.push.serverConfigured}
            @click=${() => { void this.pushToggle(this.push.self === undefined); }}
          ><span class="switch-knob"></span></button>
        </label>
        <p class="state">${this.pushSentence()}</p>
        ${this.pushAnswer === undefined ? null : html`<p class="state">${this.pushAnswer}</p>`}
        <div class="actions">
          <button type="button" @click=${() => { void this.pushTest(); }} ?disabled=${this.pushBusy || !this.push.serverConfigured || this.push.serverDisabled}>Send a test push</button>
          ${this.push.keyChanged ? html`<button type="button" @click=${() => { void this.pushReregister(); }} ?disabled=${this.pushBusy}>Register this device again</button>` : null}
        </div>
        <ul class="devices">
          ${this.renderDevices()}
        </ul>
        <p class="hint">Each device registers its own address, and every registered device is sent the events. A push service accepting a message is how the server knows a device was woken; it is not a claim that a person saw the notice.</p>
        ${isIOS() && !isInstalledApp() ? html`<p class="hint">On iPhone and iPad, Safari gives push only to a web app added to the Home Screen, over HTTPS with a certificate the phone trusts: add PI WEB to the Home Screen first, then turn this on there.</p>` : null}
    `;
  }

  /**
   * The devices this server can wake, each with what the server knows about the last time it tried.
   *
   * A device with no delivery has never been reached; a device with failures is a device whose
   * messages the push service is refusing. Both are said, because a list of names that are not being
   * reached is the most misleading kind of list.
   */
  private renderDevices() {
    if (this.push.readFailure !== undefined) {
      return html`<li class="hint">The device list did not answer (${this.push.readFailure}). This is not a list of no devices.</li>`;
    }
    if (this.push.devicesUnknown !== undefined) {
      return html`<li class="hint">The server cannot read its push file (${this.push.devicesUnknown}), so a device that registered earlier is missing from what follows.</li>`;
    }
    if (this.push.devices.length === 0) {
      return html`<li class="hint">No device is registered for push notifications on this PI WEB.</li>`;
    }
    return this.push.devices.map((device) => this.renderDevice(device));
  }

  /**
   * One device: what it is, who registered it, what the push service answered last, and the two things
   * to do about it.
   *
   * The row is built from what the server said, never from what this browser guesses: the label, the
   * service, and the last answer all belong to the device, not to the page looking at it.
   */
  private renderDevice(device: PushDevice) {
    const isSelf = this.push.self?.id === device.id;
    return html`<li class="device">
      <span class="device-name">${device.label}${isSelf ? html` <b>(this device)</b>` : null}</span>
      <span class="device-detail">${deviceSentence(device)}</span>
      <span class="actions">
        <button
          type="button"
          aria-label=${`Send a test push to ${device.label}`}
          ?disabled=${this.pushBusy || this.onPushTestDevice === undefined}
          @click=${() => { void this.pushDeviceTest(device.id); }}
        >Test</button>
        <button
          type="button"
          aria-label=${`Remove ${device.label} from the push devices`}
          ?disabled=${this.pushBusy || this.onPushRemoveDevice === undefined}
          @click=${() => { void this.pushDeviceRemove(device.id); }}
        >Remove</button>
      </span>
    </li>`;
  }

  private async pushDeviceTest(id: string): Promise<void> {
    const onPushTestDevice = this.onPushTestDevice;
    if (onPushTestDevice === undefined || this.pushBusy) return;
    this.pushBusy = true;
    this.requestUpdate();
    try {
      this.pushAnswer = await onPushTestDevice(id);
    } catch (error: unknown) {
      this.pushAnswer = `The test push did not run: ${errorMessage(error)}`;
    } finally {
      this.pushBusy = false;
      this.requestUpdate();
    }
  }

  private async pushDeviceRemove(id: string): Promise<void> {
    const onPushRemoveDevice = this.onPushRemoveDevice;
    if (onPushRemoveDevice === undefined || this.pushBusy) return;
    this.pushBusy = true;
    this.requestUpdate();
    try {
      this.pushAnswer = (await onPushRemoveDevice(id)).reason;
    } catch (error: unknown) {
      this.pushAnswer = `The device was not removed: ${errorMessage(error)}`;
    } finally {
      this.pushBusy = false;
      this.requestUpdate();
    }
  }

  private availabilitySentence(): string {
    return AVAILABILITY_SENTENCES[this.availability];
  }

  /** What push can do for this device, said as the truth of it: browser, server, or both. */
  private pushSentence(): string {
    if (this.push.readFailure !== undefined) return `This PI WEB did not answer its push state: ${this.push.readFailure}`;
    if (this.push.support === "unsupported") return "This browser has no push notifications, so this device cannot be registered here. On iPhone and iPad, Safari gives them only to a web app added to the Home Screen.";
    if (this.push.support === "insecure") return "Push needs HTTPS: this page is served over a plain http address the browser will not subscribe from.";
    if (this.push.serverDisabled) return "This PI WEB has push turned off in its config (push.enabled: false).";
    if (!this.push.serverConfigured) return "This PI WEB cannot send push: " + (this.push.serverProblem ?? "no VAPID key pair is available.");
    if (this.push.devicesUnknown !== undefined) return `The server cannot read its push file: ${this.push.devicesUnknown}`;
    if (this.push.keyChanged) return "This device is registered with a push key this server no longer has, so its messages are refused. Register it again.";
    if (this.push.self !== undefined) return "This device is registered for push notifications.";
    return "Push is available. Turning this on registers this device's address with PI WEB.";
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
    .devices { margin: 0; padding: 0 0 0 var(--pi-space-5); list-style: none; display: grid; gap: var(--pi-space-3); }
    .devices li { overflow-wrap: anywhere; }
    .device { display: grid; gap: var(--pi-space-1); }
    .device-name { font-size: var(--pi-text-sm); }
    .device-detail { color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .device .actions { gap: var(--pi-space-2); }
    .device .actions button { box-sizing: border-box; padding: var(--pi-space-1) var(--pi-space-3); font-size: var(--pi-text-xs); }
    @media (pointer: coarse) { .device .actions button { min-height: var(--pi-control-height-touch); font-size: var(--pi-text-sm); } }
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

/**
 * What the server last learned about a device, in one line.
 *
 * Three facts a reader needs apart: whose device it is, when the push service last accepted a message
 * for it, and what the service said when it refused. "Not delivered to yet" is said as itself - an
 * absence is not a failure, and a device registered five minutes ago has had nothing to answer.
 */
function deviceSentence(device: PushDevice): string {
  const parts: string[] = [];
  parts.push(device.tailnetLogin === "" ? "registered by no named tailnet user" : `registered by ${device.tailnetName === "" ? device.tailnetLogin : `${device.tailnetName} (${device.tailnetLogin})`}`);
  if (device.pushService !== "") parts.push(`carried by ${device.pushService}`);
  parts.push(device.lastDeliveredAt === undefined ? "no message accepted by its push service yet" : `last accepted ${deviceDate(device.lastDeliveredAt)}`);
  const failure = device.lastFailure;
  if (failure !== undefined) {
    const status = failure.status === undefined ? "" : ` (${String(failure.status)}${failure.reason === undefined ? "" : ` ${failure.reason}`})`;
    parts.push(`last refused ${deviceDate(failure.at)}: ${refusalSentence(failure.outcome)}${status}`);
  }
  return parts.join(". ") + ".";
}

/** The refusal in the words a reader acts on, one per outcome, so an unhandled outcome is a type error. */
function refusalSentence(outcome: string): string {
  const known = PUSH_DELIVERY_OUTCOMES.find((entry) => entry === outcome);
  return known === undefined ? `its push service answered "${outcome}"` : REFUSAL_SENTENCES[known];
}

const REFUSAL_SENTENCES: Record<PushDeliveryOutcome, string> = {
  sent: "its push service accepted the message",
  expired: "its push service says the address is gone, so the device must register again",
  rejected: "its push service rejected the message",
  unauthorized: "its push service refused this server's push key",
  failed: "its push service did not answer",
  unreachable: "its push service could not be reached",
};

/** The date a device was last woken, in the short form a settings list uses. */
function deviceDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-notifications-panel": SettingsNotificationsPanel;
  }
}
