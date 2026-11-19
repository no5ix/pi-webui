import { createElement, useEffect, useState } from "react";
import { NTFY_EVENT_FIELDS, type NtfyStatus } from "../../../shared/ntfy";
import { isInstalledApp, isIOS } from "../browserProfile";
import { configApi, notificationsApi } from "../api";
import { NOTIFICATION_AVAILABILITY_SENTENCES, NOTIFICATION_AVAILABILITY_WORDS, TOPIC_STORED_PLACEHOLDER, describeNtfyFailure, ntfyDraftFromConfig, ntfyDraftToConfig, type NtfyDraft } from "../notifications/ntfyForm";
import { notifyTaskFinished, notificationAvailability, requestTaskNotificationPermission, setTaskNotificationsWanted, taskNotificationsWanted } from "../notifications/taskNotifications";

export interface NotificationsSettingsPanelProps {
  readonly busy: boolean;
  readonly run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}

/**
 * Device notifications, on this browser and on the reader's phone.
 *
 * The reader is asking one question here: "will this device tell me when a task finishes?" Two channels
 * answer it, and they stay separate on purpose. What the browser allows and what the reader wants are
 * two facts and are shown as two, because a denied permission is the browser's answer and no switch on
 * this page can undo it. ntfy is the channel that does not need this browser open at all: it is
 * configured on the server, and the panel writes its topic and is never shown it, so the topic box only
 * ever reports that one is stored - and a save that leaves it empty keeps it.
 *
 * A test is always sent with the fields the reader is looking at, saved or not, and the answer says
 * which of the two it was about.
 */
export function NotificationsSettingsPanel({ busy, run }: NotificationsSettingsPanelProps) {
  const [availability, setAvailability] = useState(notificationAvailability);
  const [wanted, setWanted] = useState(taskNotificationsWanted);
  const [browserAnswer, setBrowserAnswer] = useState<string>();
  const [status, setStatus] = useState<NtfyStatus>();
  const [draft, setDraft] = useState<NtfyDraft>();
  const [ntfyAnswer, setNtfyAnswer] = useState<string>();
  const [ntfyError, setNtfyError] = useState<string>();
  const [writing, setWriting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setNtfyError(undefined);
    void notificationsApi.ntfyStatus().then((response) => {
      if (!active) return;
      setStatus(response);
      setDraft((current) => current ?? ntfyDraftFromConfig(response.config));
    }).catch((error: unknown) => {
      if (active) setNtfyError(describeNtfyFailure(error));
    });
    return () => { active = false; };
  }, [reloadKey]);

  const form = draft ?? ntfyDraftFromConfig(status?.config);

  const enableBrowserChannel = () => run(async () => {
    const answer = await requestTaskNotificationPermission();
    setAvailability(answer);
    if (answer !== "granted") {
      setBrowserAnswer(NOTIFICATION_AVAILABILITY_WORDS[answer]);
      return;
    }
    setTaskNotificationsWanted(true);
    setWanted(true);
    setBrowserAnswer(NOTIFICATION_AVAILABILITY_WORDS.granted);
  });

  const toggleBrowserChannel = () => {
    setTaskNotificationsWanted(!wanted);
    setWanted(!wanted);
    setBrowserAnswer(!wanted ? NOTIFICATION_AVAILABILITY_WORDS[availability] : "Notices are off on this device. The server keeps sending to ntfy.");
  };

  const testBrowserChannel = () => run(async () => {
    const posted = await notifyTaskFinished({ title: "PI WEB", body: "This is the notice you asked for.", url: window.location.href }, "task-test");
    setBrowserAnswer(posted ? "A notice went to the notification centre." : "Nothing was sent: this browser is not letting this page post notifications.");
  });

  const saveNtfy = (write: { readonly clearTopic?: boolean } = {}) => run(async () => {
    setWriting(true);
    setNtfyError(undefined);
    setNtfyAnswer(undefined);
    try {
      await configApi.saveNtfy(ntfyDraftToConfig(form), write);
      const refreshed = await notificationsApi.ntfyStatus().catch(() => undefined);
      if (refreshed !== undefined) setStatus(refreshed);
      setDraft(undefined);
      setNtfyAnswer(write.clearTopic === true
        ? "Saved. The topic is gone: notices stop until you type a new one."
        : "Saved. The next event uses these settings.");
    } catch (error: unknown) {
      setNtfyError(describeNtfyFailure(error));
    } finally {
      setWriting(false);
    }
  });

  const testNtfy = () => run(async () => {
    setNtfyAnswer("Sending…");
    setNtfyError(undefined);
    try {
      const outcome = await notificationsApi.sendNtfyTest(ntfyDraftToConfig(form));
      setNtfyAnswer(outcome.delivered
        ? `ntfy accepted the test notice.${draft === undefined ? "" : " The draft settings are not saved yet."} Check the subscribed topic on your phone.`
        : `ntfy did not accept the test notice: ${outcome.reason ?? "the delivery failed."}`);
    } catch (error: unknown) {
      setNtfyError(describeNtfyFailure(error));
    }
  });

  const disabled = busy || writing;

  return <div className="rw-notifications">
    <h4>Browser notifications</h4>
    <p className="rw-setting-note">{NOTIFICATION_AVAILABILITY_SENTENCES[availability]}</p>
    <div className="rw-setting-row">
      <span><b>Tell me when a task finishes</b><small>{wanted ? "On for this device" : "Off for this device"}</small></span>
      <label className="rw-setting-check"><input type="checkbox" checked={wanted} disabled={disabled} onChange={toggleBrowserChannel} aria-label="Tell me when a task finishes" /></label>
    </div>
    <div className="rw-settings-actions">
      {availability !== "granted" && <button type="button" onClick={enableBrowserChannel} disabled={disabled}>Ask the browser for permission</button>}
      <button type="button" onClick={testBrowserChannel} disabled={disabled || availability !== "granted"}>Send a test notice in this browser</button>
    </div>
    {browserAnswer && <p className="rw-setting-note">{browserAnswer}</p>}
    {isIOS() && !isInstalledApp() && <p className="rw-setting-note">On iPhone and iPad, Safari only shows these notices to the installed web app: use Add to Home Screen, then turn this on there.</p>}
    <p className="rw-setting-note">The notice arrives while this browser is open, including in a background tab. Use ntfy below to be told on a phone.</p>

    <h4>ntfy</h4>
    <p className="rw-setting-note">The session daemon posts a message to ntfy, and the ntfy app on your phone shows it. One topic receives notices from all sessions this PI WEB manages, and it works with any ntfy server, including your own, with no browser open.</p>
    {status === undefined && <div className="rw-setting-stack">
      <p className="rw-setting-note">{ntfyError ?? "What the ntfy channel is set to on this server has not been read."} The settings are not shown, and nothing is written, until they are: a box left empty next to a topic you cannot see would save no topic.</p>
      <div className="rw-settings-actions"><button type="button" onClick={() => setReloadKey((key) => key + 1)} disabled={busy}>Try again</button></div>
    </div>}
    {status !== undefined && <>
      <div className="rw-setting-row">
        <span><b>Send ntfy notices</b><small>{status.ready ? "Ready" : status.reason ?? "Not ready"}</small></span>
        <label className="rw-setting-check"><input type="checkbox" checked={form.enabled} disabled={disabled} onChange={(event) => setDraft({ ...form, enabled: event.target.checked })} aria-label="Send ntfy notices" /></label>
      </div>
      <div className="rw-settings-grid">
        <label>Server<input type="text" spellCheck={false} autoComplete="off" placeholder="https://ntfy.sh" value={form.serverUrl} disabled={disabled} onChange={(event) => setDraft({ ...form, serverUrl: event.target.value })} /></label>
        <label>Topic<input type="text" spellCheck={false} autoComplete="off" placeholder={status.topicConfigured ? TOPIC_STORED_PLACEHOLDER : "your-topic"} value={form.topic} disabled={disabled} onChange={(event) => setDraft({ ...form, topic: event.target.value })} /></label>
        <label>Server address for taps<input type="text" spellCheck={false} autoComplete="off" placeholder="https://pi.example.ts.net:8505" value={form.clickUrlBase} disabled={disabled} onChange={(event) => setDraft({ ...form, clickUrlBase: event.target.value })} /></label>
      </div>
      <p className="rw-setting-note">Every notice names the session and the event. With a server address, tapping a notice opens that session on the device that received it; the address is the one that device uses, not the one this browser happens to be on.</p>
      <p className="rw-setting-note">{status.topicConfigured
        ? "A topic is stored on the server. It is never shown here. Leave the box empty to keep it, or type a new one to replace it."
        : "The topic is the address: anyone who knows it can publish to it and read what arrives, so treat it as a password. On a server you run, an access token is the safer choice."}</p>
      <div className="rw-setting-stack">
        {NTFY_EVENT_FIELDS.map((field) => <label className="rw-setting-check" key={field.key}>
          <input type="checkbox" checked={form[field.key]} disabled={disabled} onChange={(event) => setDraft({ ...form, [field.key]: event.target.checked })} />
          <span>{field.label}</span>
        </label>)}
      </div>
      <div className="rw-settings-actions">
        <button type="button" onClick={() => saveNtfy()} disabled={disabled}>Save ntfy settings</button>
        <button type="button" onClick={testNtfy} disabled={disabled}>Send a test notice through ntfy</button>
        {status.topicConfigured && <button type="button" onClick={() => saveNtfy({ clearTopic: true })} disabled={disabled}>Stop using this topic</button>}
      </div>
    </>}
    {ntfyAnswer && <p className="rw-setting-note">{ntfyAnswer}</p>}
    {ntfyError && <p className="rw-setting-error">{ntfyError}</p>}
    <p className="rw-setting-note">Notices are posted by the session daemon, so they arrive with no browser open. Each channel is switched on apart from the other, and one channel failing never stops the other.</p>
  </div>;
}
