import { describe, expect, it } from "vitest";
import { describeNtfyFailure, ntfyDraftFromConfig, ntfyDraftToConfig, TOPIC_STORED_PLACEHOLDER, type NtfyDraft } from "./ntfyForm";

function draft(fields: Partial<NtfyDraft> = {}): NtfyDraft {
  return { enabled: true, serverUrl: "https://ntfy.sh", topic: "", clickUrlBase: "", onCompleted: true, onFailed: true, onAskUser: true, ...fields };
}

describe("the ntfy form's write rules", () => {
  it("a blank topic box writes no topic key at all, which is how the stored one survives", () => {
    expect(ntfyDraftToConfig(draft({ topic: "   " }))).not.toHaveProperty("topic");
  });

  it("a topic that was typed is written trimmed", () => {
    expect(ntfyDraftToConfig(draft({ topic: "  my-topic  " }))).toMatchObject({ topic: "my-topic" });
  });

  it("a blank server box writes the public server, not an empty address", () => {
    expect(ntfyDraftToConfig(draft({ serverUrl: "  " }))).toMatchObject({ serverUrl: "https://ntfy.sh" });
  });

  it("a tap target is only sent when the reader named one", () => {
    expect(ntfyDraftToConfig(draft())).not.toHaveProperty("clickUrlBase");
    expect(ntfyDraftToConfig(draft({ clickUrlBase: " https://pi.lan:8505 " }))).toMatchObject({ clickUrlBase: "https://pi.lan:8505" });
  });

  it("a stored block prefills every field the panel shows, and never its topic", () => {
    const form = ntfyDraftFromConfig({ enabled: true, serverUrl: "https://ntfy.example.com", topic: "kept-secret", clickUrlBase: "https://pi.lan:8505", onCompleted: true, onFailed: false, onAskUser: false });
    expect(form).toEqual({ enabled: true, serverUrl: "https://ntfy.example.com", topic: "", clickUrlBase: "https://pi.lan:8505", onCompleted: true, onFailed: false, onAskUser: false });
  });

  it("nothing configured means a channel that is off, with the events on", () => {
    expect(ntfyDraftFromConfig(undefined)).toMatchObject({ enabled: false, serverUrl: "", topic: "", onCompleted: true, onFailed: true, onAskUser: true });
  });

  it("the panel says a topic is stored without saying which one", () => {
    expect(TOPIC_STORED_PLACEHOLDER).not.toContain("topic");
  });

  it("the server's own reason is the word shown, and a transport failure is the connection", () => {
    expect(describeNtfyFailure(new Error("The ntfy topic uses characters ntfy does not allow."))).toBe("The ntfy topic uses characters ntfy does not allow.");
    expect(describeNtfyFailure(new TypeError("Failed to fetch"))).toContain("could not reach PI WEB");
    expect(describeNtfyFailure(new Error("Load failed"))).toContain("could not reach PI WEB");
  });
});
