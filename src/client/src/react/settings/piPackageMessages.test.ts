import { describe, expect, it } from "vitest";
import type { PiPackageMutationResponse } from "../../../../shared/apiTypes";
import { piPackageRemoveMessage, piPackageUpdateMessage } from "./piPackageSettingsState";

function response(overrides: Partial<PiPackageMutationResponse>): PiPackageMutationResponse {
  return { packages: [], action: "remove", source: "../pkg/pi-demo-extension", scope: "user", requiresReload: true, ...overrides };
}

/**
 * A removal says what the machine did.
 *
 * pi answers a remove with `removed`, and the page has to carry that fact: the reader is about to look
 * at a list that still names the package, so a sentence claiming it was removed teaches the reader that
 * the page lies. The refused answer names the source and the scope it looked in.
 */
describe("package mutation messages", () => {
  it("names a removal the machine carried out", () => {
    expect(piPackageRemoveMessage(response({ removed: true }))).toBe(
      "Removed ../pkg/pi-demo-extension (Global). Reload running sessions to apply it.",
    );
  });

  it("refuses a removal the machine did not carry out, in the scope it was given", () => {
    const message = piPackageRemoveMessage(response({ removed: false }));
    expect(message).toContain("Nothing was removed");
    expect(message).toContain("../pkg/pi-demo-extension");
    expect(message).toContain("Global settings");
    expect(message).not.toMatch(/^Removed/);
    expect(message).not.toContain("Reload running sessions");
  });

  it("names a project scope in the refusal", () => {
    expect(piPackageRemoveMessage(response({ removed: false, scope: "project" }))).toContain("Project settings");
  });

  it("keeps the old sentence for a machine that answers without the fact", () => {
    expect(piPackageRemoveMessage(response({}))).toBe(
      "Removed ../pkg/pi-demo-extension (Global). Reload running sessions to apply it.",
    );
  });

  it("leaves an update's own answer intact", () => {
    expect(piPackageUpdateMessage(response({ action: "update" }))).toContain("Update completed for");
  });
});
