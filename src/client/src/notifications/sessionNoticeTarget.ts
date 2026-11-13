/**
 * Where a notice points, and whether the reader is in front of the page.
 *
 * A notification's tap has to land on the session it speaks about, in the app the device already
 * uses. The route is the app's own (`?session=`, plus `?machine=` for a session that is not on this
 * machine), so a tap opens the session the way a click in the session list does - and it drops `tool`
 * and `view`, which would open a plugin page with a session id the page has no use for.
 */

/** The app URL a notification opens: the session it speaks about, on the machine it lives on. */
export function sessionNoticeUrl(machineId: string, sessionId: string, href = window.location.href): string {
  const url = new URL(href);
  url.searchParams.delete("tool");
  url.searchParams.delete("view");
  url.searchParams.set("session", sessionId);
  if (machineId === "" || machineId === "local") url.searchParams.delete("machine");
  else url.searchParams.set("machine", machineId);
  return url.toString();
}

/** The reader is in front of this page: a notice about what they are watching tells them nothing. */
export function isPageInFront(documentObject: Document = globalThis.document): boolean {
  return documentObject.visibilityState === "visible" && documentObject.hasFocus();
}

/** One open dialog of one session, as the key of the notices this page has already posted. */
export function dialogKey(sessionId: string, dialogId: string): string {
  return `${sessionId}\u0000${dialogId}`;
}
