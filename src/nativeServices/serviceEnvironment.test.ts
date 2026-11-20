import { describe, expect, it } from "vitest";
import { hostingServiceId } from "./serviceEnvironment";

describe("which service the running command sits inside", () => {
  /**
   * A restart PI WEB runs for this machine starts in the session daemon, so a
   * command that tore the daemon down killed the runner before it could start
   * anything again. Naming the host is what lets the restart avoid that.
   *
   * PI_WEB_SESSION is set for every process spawned from a pi-web session, so
   * it is the signal that the command is inside the session daemon.
   */
  it("names the session daemon for a command spawned from a session", () => {
    expect(hostingServiceId({ PI_WEB_SESSION: "1" })).toBe("sessiond");
  });

  it("names nothing for a command run from an ordinary shell", () => {
    expect(hostingServiceId({})).toBe(undefined);
  });

  it("treats an empty value as not being inside a session", () => {
    expect(hostingServiceId({ PI_WEB_SESSION: "" })).toBe(undefined);
  });
});
