import { describe, it, expect } from "vitest";
import {
  PI_WEB_TAILNET_LOGIN_HEADER,
  PI_WEB_TAILNET_NAME_HEADER,
  TAILSCALE_LOGIN_HEADER,
  TAILSCALE_NAME_HEADER,
  decodeTailscaleHeaderValue,
  tailnetForwardHeaders,
  tailnetIdentityFromProxy,
  tailnetIdentityFromTailscale,
} from "./tailscaleIdentity.js";
import { isTailnetLogin, tailnetLoginAllowed } from "../../shared/deviceIdentity.js";

/**
 * Who registered a device, read the way the two processes have to read it.
 *
 * The point of the pair of readers is that each trusts exactly one header and ignores the other: the
 * web process reads Tailscale's header and ignores the one PI WEB uses inward, and the daemon does the
 * reverse. That is what makes the identity unforgeable by a browser, and a test that only checks that a
 * login is read would not catch a fallback that let the forged value in.
 */

describe("decodeTailscaleHeaderValue", () => {
  it("reads the value in both forms Tailscale sends", () => {
    expect(decodeTailscaleHeaderValue("reader@example.com")).toBe("reader@example.com");
    expect(decodeTailscaleHeaderValue("  reader@example.com  ")).toBe("reader@example.com");
    // Tailscale encodes a value that is not printable ASCII as `b64:` plus standard base64.
    expect(decodeTailscaleHeaderValue(`b64:${Buffer.from("Renée Example").toString("base64")}`)).toBe("Renée Example");
  });

  it("leaves a value it cannot decode alone, so a string Tailscale never minted is not accepted as decoded", () => {
    expect(decodeTailscaleHeaderValue("b64:not base64 at all!")).toBe("b64:not base64 at all!");
    expect(decodeTailscaleHeaderValue(`b64:${Buffer.from("evil\u0000reader@example.com").toString("base64")}`)).toBe(`b64:${Buffer.from("evil\u0000reader@example.com").toString("base64")}`);
  });
});

describe("tailnetIdentityFromTailscale", () => {
  it("reads Tailscale's headers and lowercases the login", () => {
    expect(tailnetIdentityFromTailscale({ [TAILSCALE_LOGIN_HEADER]: "Reader@GitHub", [TAILSCALE_NAME_HEADER]: "A Reader" }))
      .toEqual({ login: "reader@github", name: "A Reader" });
  });

  it("decodes a name Tailscale sent encoded", () => {
    const identity = tailnetIdentityFromTailscale({
      [TAILSCALE_LOGIN_HEADER]: "reader@example.com",
      [TAILSCALE_NAME_HEADER]: `b64:${Buffer.from("Renée Example").toString("base64")}`,
    });
    expect(identity?.name).toBe("Renée Example");
  });

  it("refuses a login that is not an address, so a header cannot put arbitrary text in a device list", () => {
    expect(tailnetIdentityFromTailscale({ [TAILSCALE_LOGIN_HEADER]: "not-an-address" })).toBeUndefined();
    expect(tailnetIdentityFromTailscale({ [TAILSCALE_LOGIN_HEADER]: "reader@localhost" })).toBeUndefined();
    expect(tailnetIdentityFromTailscale({ [TAILSCALE_LOGIN_HEADER]: "reader@evil.example/path?x=1" })).toBeUndefined();
    expect(tailnetIdentityFromTailscale({ [TAILSCALE_LOGIN_HEADER]: `${"a".repeat(120)}@example.com` })).toBeUndefined();
    expect(tailnetIdentityFromTailscale({})).toBeUndefined();
  });

  it("refuses a name with control characters and keeps a long one bounded", () => {
    expect(tailnetIdentityFromTailscale({ [TAILSCALE_LOGIN_HEADER]: "reader@example.com", [TAILSCALE_NAME_HEADER]: "evil\u0007name" })?.name).toBe("");
    expect((tailnetIdentityFromTailscale({ [TAILSCALE_LOGIN_HEADER]: "reader@example.com", [TAILSCALE_NAME_HEADER]: "x".repeat(400) })?.name ?? "")).toBe("");
  });

  it("ignores the header PI WEB uses inward, so a browser cannot claim a tailnet user", () => {
    expect(tailnetIdentityFromTailscale({ [PI_WEB_TAILNET_LOGIN_HEADER]: "victim@example.com" })).toBeUndefined();
    expect(tailnetIdentityFromTailscale({ [PI_WEB_TAILNET_LOGIN_HEADER]: "victim@example.com", [TAILSCALE_LOGIN_HEADER]: "attacker@example.com" })?.login).toBe("attacker@example.com");
  });

  it("takes an array-valued header as one value, as Node hands it to a framework", () => {
    expect(tailnetIdentityFromTailscale({ [TAILSCALE_LOGIN_HEADER]: ["reader@github", "second@github"] })?.login).toBe("reader@github");
  });
});

describe("tailnetIdentityFromProxy", () => {
  it("reads only the header the web process writes", () => {
    expect(tailnetIdentityFromProxy({ [PI_WEB_TAILNET_LOGIN_HEADER]: "reader@github", [PI_WEB_TAILNET_NAME_HEADER]: "A Reader" }))
      .toEqual({ login: "reader@github", name: "A Reader" });
    expect(tailnetIdentityFromProxy({ [TAILSCALE_LOGIN_HEADER]: "reader@github" })).toBeUndefined();
  });

  it("round-trips through the headers the web process forwards", () => {
    const edge = tailnetIdentityFromTailscale({ [TAILSCALE_LOGIN_HEADER]: "Reader@GitHub", [TAILSCALE_NAME_HEADER]: "A Reader" });
    const identity = edge === undefined ? undefined : tailnetIdentityFromProxy(tailnetForwardHeaders(edge));
    expect(identity).toEqual({ login: "reader@github", name: "A Reader" });
  });

  it("forwards no name header when Tailscale reported no name", () => {
    const identity = tailnetIdentityFromTailscale({ [TAILSCALE_LOGIN_HEADER]: "reader@github" });
    const forwarded = identity === undefined ? {} : tailnetForwardHeaders(identity);
    expect(Object.keys(forwarded)).toEqual([PI_WEB_TAILNET_LOGIN_HEADER]);
  });
});

describe("isTailnetLogin", () => {
  it("accepts the shapes Tailscale hands out, including external identity providers", () => {
    expect(isTailnetLogin("reader@example.com")).toBe(true);
    expect(isTailnetLogin("reader@github")).toBe(true);
    expect(isTailnetLogin("reader@login.tailnet.ts.net")).toBe(true);
    expect(isTailnetLogin("reader+pi@sub.example.co.uk")).toBe(true);
    expect(isTailnetLogin("")).toBe(false);
    expect(isTailnetLogin("Reader@Example.com")).toBe(false);
  });
});

describe("tailnetLoginAllowed", () => {
  it("lets the network be the boundary while the allowlist names no one", () => {
    expect(tailnetLoginAllowed("reader@example.com", [])).toBe(true);
    expect(tailnetLoginAllowed("", [])).toBe(true);
  });

  it("refuses everyone else once logins are named, including a request with no identity", () => {
    expect(tailnetLoginAllowed("reader@example.com", ["Reader@Example.com"])).toBe(true);
    expect(tailnetLoginAllowed("friend@example.com", ["reader@example.com"])).toBe(false);
    expect(tailnetLoginAllowed("", ["reader@example.com"])).toBe(false);
  });
});
