/**
 * The VAPID contact this PI WEB identifies itself to the push services with.
 *
 * A VAPID assertion carries a `sub` claim: a contact URL for the application, per RFC 8292. Push
 * services check it, and Apple checks it early and strictly - measured against `web.push.apple.com`, a
 * contact of `mailto:pi-web@localhost` is answered `403 {"reason":"BadJwtToken"}`, while the same
 * request with `mailto:pi-web@example.com` or with an https URL gets past the assertion to the push
 * token check (`400 {"reason":"BadWebPushRequest"}`). A default every iPhone and iPad refuses is worse
 * than a generic contact every service takes, so a contact that will not be accepted is replaced by the
 * project's own URL rather than sent.
 *
 * The rule lives in one pure function because two processes need it: the daemon signs with the answer,
 * and the config layer rejects, at startup, a `push.subject` that will be refused on every send.
 */

/** The contact used when config names none: a public URL of this project, which every service accepts. */
export const DEFAULT_VAPID_SUBJECT = "https://github.com/Gang-of-Beads/pi-web";

/**
 * The contact to sign a push with: what config asked for when a push service will take it, the default
 * when it will not.
 */
export function effectiveVapidSubject(subject: string | undefined): string {
  const trimmed = (subject ?? "").trim();
  if (trimmed === "") return DEFAULT_VAPID_SUBJECT;
  if (/^https?:\/\//u.test(trimmed)) return trimmed;
  // A bare address becomes the mailto: URL a contact is expected to be. Anything with the shape of a
  // display name - a space, an angle bracket - is not a contact a push service will take, and a contact
  // that is refused on every send is worse for a deployment than a generic one that is accepted.
  const address = trimmed.startsWith("mailto:") ? trimmed.slice("mailto:".length).trim() : trimmed;
  if (isReachableMailAddress(address)) return `mailto:${address}`;
  return DEFAULT_VAPID_SUBJECT;
}

/**
 * Whether a mail address is a contact a push service will treat as one: a local part, a domain with a
 * dot, and not a machine name. `user@localhost`, `user@box` and an address literal are the shapes Apple
 * refuses, and an address with no domain behind it identifies nobody to a service anyway.
 */
export function isReachableMailAddress(value: string): boolean {
  const match = /^([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+)$/u.exec(value);
  if (match === null) return false;
  const domain = match[2] ?? "";
  if (!domain.includes(".")) return false;
  const labels = domain.split(".");
  return !labels.includes("localhost") && !/^[0-9]+$/u.test(labels[labels.length - 1] ?? "");
}

/** Why a configured contact will be refused by the push services, in the words the settings panel shows. */
export function vapidSubjectProblem(subject: string | undefined): string | undefined {
  const trimmed = (subject ?? "").trim();
  if (trimmed === "" || effectiveVapidSubject(trimmed) === trimmed) return undefined;
  return `The configured push.subject "${trimmed}" is not a contact the push services accept - a mail address needs a real domain (Apple answers 403 BadJwtToken for a localhost address), and https://github.com/Gang-of-Beads/pi-web is sent in its place.`;
}
