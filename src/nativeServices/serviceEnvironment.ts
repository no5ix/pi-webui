/**
 * Which installed service the running command sits inside, when it is one.
 *
 * Restarting that service cannot be done as a teardown followed by a start:
 * the teardown kills the command before it reaches the start, leaving the
 * label not-loaded, where KeepAlive does not bring it back. A self-update
 * started from the pi-web UI runs in the session daemon, which is exactly that
 * case.
 *
 * PI_WEB_SESSION is set for every process spawned from a pi-web session.
 */
export function hostingServiceId(source: Readonly<Record<string, string | undefined>>): string | undefined {
  const inSession = source[sessionMarker];
  return inSession === undefined || inSession === "" ? undefined : "sessiond";
}

const sessionMarker = "PI_WEB_SESSION";

/** `source` without the session marker, for a command started here that runs outside the session daemon's lifetime. */
export function environmentOutsideSession(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) => key !== sessionMarker));
}
