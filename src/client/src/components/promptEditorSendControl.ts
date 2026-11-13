/**
 * What the composer's main button is, in the reader's words.
 *
 * The button used to be a steer control that changed meaning with the session: one icon, and a tooltip
 * a reader had to open to find out what the press would do. Pressing it mid-turn then interrupted work
 * they had not asked to interrupt. The button now says, on its face, what the press does, and it says
 * the truth of the session it was drawn from: a running task gets a control that appends to the queue,
 * an idle session gets a control that sends.
 *
 * `canSteer` is the app's session state - the same `isSessionActive` the dock, the rows and the header
 * read - arriving as a property, not this component's input state: a composer that decided from its own
 * focus, caret, or a draft it had queued is a composer that lies about a session it is not watching.
 * The state is read again at the moment of the press, in `send`, so a task that finished between the
 * render and the click sends now rather than queueing behind work that has already ended.
 *
 * The states are named here, in one classifier, so a caller stays a dumb executor and a new state is a
 * type error rather than a silent third label.
 */
export type SendControlAction = "queue" | "compacting" | "send";

export interface SendControl {
  readonly action: SendControlAction;
  /** The word on the button, and the name a screen reader reads. */
  readonly label: string;
  /** What the press does, in full, for the tooltip. */
  readonly title: string;
}

export function sendControlOf(running: boolean, compacting: boolean): SendControl {
  if (running) {
    return {
      action: "queue",
      label: "Append to message queue",
      title: "The session is working. This appends to the message queue, and pi reads it when the current turn ends. Enter steers the current turn now.",
    };
  }
  if (compacting) {
    return {
      action: "compacting",
      label: "Queue message",
      title: "PI WEB is compacting the history. The message is queued and goes next.",
    };
  }
  return { action: "send", label: "Send", title: "Send the message" };
}

/**
 * Whether the press has anything to do.
 *
 * A button labelled "Append to message queue" that answers a press with nothing is a control the
 * reader has to test to understand (2026-11-13). A message is words, an attachment, or both, so the
 * button stays quiet until the composer holds one of them.
 */
export function sendDisabled(draft: string, attachments: readonly unknown[]): boolean {
  return draft.trim() === "" && attachments.length === 0;
}
