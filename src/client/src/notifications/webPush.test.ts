import { describe, expect, it } from "vitest";
import { appBaseUrl, pushSupport } from "./webPush.js";

describe("appBaseUrl", () => {
  it("is the application root, not the page the reader happens to be on", () => {
    expect(appBaseUrl({ viteBaseUrl: "/", documentBaseUrl: "https://pi.example/settings" })).toBe("https://pi.example/");
    expect(appBaseUrl({ viteBaseUrl: "/", documentBaseUrl: "https://pi.example/sessions/one" })).toBe("https://pi.example/");
  });

  it("keeps a subpath deployment's prefix, which is the address a phone's push has to open", () => {
    expect(appBaseUrl({ viteBaseUrl: "/pi/", documentBaseUrl: "https://example.com/pi/settings" })).toBe("https://example.com/pi/");
    expect(appBaseUrl({ viteBaseUrl: "/pi/web/", documentBaseUrl: "http://127.0.0.1:8505/pi/web/settings" })).toBe("http://127.0.0.1:8505/pi/web/");
  });

  it("is the same address for every page of one deployment, so one device is one registration", () => {
    const context = (path: string) => ({ viteBaseUrl: "/pi/", documentBaseUrl: `https://example.com/pi/${path}` });
    expect(appBaseUrl(context("settings"))).toBe(appBaseUrl(context("sessions")));
  });
});

describe("pushSupport", () => {
  it("says this has no push where the browser has none, rather than reporting a failure to subscribe", () => {
    expect(pushSupport()).toBe("unsupported");
  });
});
