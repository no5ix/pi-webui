/**
 * The browser facts a panel needs to be honest about, told from the platform's own signals.
 *
 * iOS is the awkward one: it reports `display-mode: standalone` in its ordinary Safari tab, so the
 * standards test alone hides an "install the web app" hint exactly where it is needed. iOS is asked the
 * question it answers truthfully - `navigator.standalone`, true only when the app was launched from its
 * icon - and a touch-capable Mac is read as an iPad, which is how iPadOS reports itself.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/u.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Running as an installed web app, as far as this platform will honestly say. */
export function isInstalledApp(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isIOS()) return Reflect.get(navigator, "standalone") === true;
  return window.matchMedia("(display-mode: standalone)").matches;
}
