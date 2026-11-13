/**
 * The identity a device is registered under, in the form PI WEB stores.
 *
 * PI WEB has no accounts: a deployment's boundary is the network it is reachable on, and the common one
 * is a tailnet, where `tailscale serve` checks the tailnet ACL and names the user it let in. That name
 * is the only identity a push subscription can carry, and a subscription outlives the browser that made
 * it, so a device list that a reader can revoke has to say whose device each row is - and an allowlist
 * has to be able to refuse a login.
 *
 * The shape rule is here, in one pure function, because three places need the same answer: the edge
 * that reads Tailscale's header, the store that keeps the login, and the config layer that refuses a
 * `push.allowedTailnetLogins` entry which would match no device at all.
 */

/** Long enough for a login and a display name, short enough that a header cannot grow a stored file. */
export const TAILNET_IDENTITY_MAX_LENGTH = 120;

/**
 * A tailnet login: an address-shaped identity. Tailscale hands out `user@example.com` for an email
 * provider and `user@github`, `user@discord`, `user@login.tailnet.ts.net` for the rest, so a single
 * label after the `@` is a real login here - unlike a VAPID contact, where a dotless address identifies
 * nobody and Apple refuses it. A path, a query, a credential, `localhost` and an address literal are
 * refused: the value goes into a stored device list, and a login that is not one shape cannot be
 * matched against an allowlist.
 */
export function isTailnetLogin(value: string): boolean {
  if (value.length === 0 || value.length > TAILNET_IDENTITY_MAX_LENGTH) return false;
  if (!/^[a-z0-9._%+-]+@[a-z0-9._-]+$/u.test(value)) return false;
  const domain = value.slice(value.indexOf("@") + 1);
  if (domain.includes("..") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return !domain.split(".").includes("localhost") && !/^[0-9.]+$/u.test(domain);
}

/**
 * Whether a tailnet identity may register a device, and be sent to.
 *
 * An empty allowlist means the deployment named no one, which is PI WEB's existing posture: the network
 * is the boundary, and the login is recorded but never gates. Once logins are named, a request with no
 * identity is refused too - a deployment that named its people is not asking for anonymous devices.
 */
export function tailnetLoginAllowed(login: string, allowedLogins: readonly string[]): boolean {
  if (allowedLogins.length === 0) return true;
  if (login === "") return false;
  return allowedLogins.some((entry) => entry.trim().toLowerCase() === login);
}
