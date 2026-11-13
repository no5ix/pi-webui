import { describe, it, expect } from "vitest";
import { askUserNoticeContent, taskNoticeContent } from "./deviceNoticeContent.js";
import { askingNoticeLines, taskNoticeLines } from "../../../shared/notificationContent.js";
import type { TaskRunRecord } from "../taskRunLedger.js";
import type { PendingExtensionDialog } from "../../../shared/apiTypes.js";

const record = (over: Partial<TaskRunRecord> = {}): TaskRunRecord => ({
  outcome: "completed",
  elapsedMs: 134_000,
  finishedAtMs: 1_700_000_134_000,
  partial: false,
  ...over,
});

describe("taskNoticeContent", () => {
  it("says the verdict and the measured span, in the words the shared builder owns", () => {
    const built = taskNoticeContent("Refactor the parser", record());
    expect(built.title).toBe("Refactor the parser finished");
    expect(built.body).toBe(taskNoticeLines({ sessionName: "Refactor the parser", verdict: "completed", elapsedMs: 134_000 }).body);
    expect(built.body).toContain("Finished in 2m 14s.");
  });

  it("keeps a page's two facts in the sentence: a failed run's span, and a stopped one's", () => {
    expect(taskNoticeContent("S", record({ outcome: "failed" })).title).toBe("S failed");
    expect(taskNoticeContent("S", record({ outcome: "stopped" })).body).toContain("Stopped after 2m 14s.");
    expect(taskNoticeContent("S", record({ outcome: "interrupted" })).title).toBe("S stopped");
  });

  it("says an end the page did not confirm as an end, and never as a completion", () => {
    const built = taskNoticeContent("S", record({ outcome: "unknown" }));
    expect(built.title).toBe("S ended");
    expect(built.body).toContain("did not see how it ended");
    expect(built.body).not.toContain("finished");
    expect(built.body).not.toContain("Finished");
  });

  it("says when it watched only part of the run", () => {
    expect(taskNoticeContent("S", record({ partial: true })).body).toContain("This page watched part of it.");
    expect(taskNoticeContent("S", record()).body).not.toContain("part of it");
  });

  it("gives a sentence with no number when there was no span to measure", () => {
    const body = taskNoticeLines({ sessionName: "S", verdict: "completed", elapsedMs: undefined }).body;
    expect(body).toBe("The task is done. Open PI WEB to read the answer.");
    expect(body).not.toMatch(/\d/);
  });

  it("is total about a session with no name", () => {
    expect(taskNoticeContent("   ", record()).title).toBe("A pi session finished");
  });
});

const card = (fields: NonNullable<PendingExtensionDialog["screen"]>["fields"]): PendingExtensionDialog => ({
  dialogId: "d",
  kind: "custom",
  title: "Questions",
  askedAt: "2026-11-05T10:00:00.000Z",
  runScoped: true,
  screen: { kind: "card", fields },
});

describe("askUserNoticeContent", () => {
  it("counts the questions of every questionnaire that is open, in the shared classifier", () => {
    const open = [
      card([{ type: "choice", id: "a", label: "A?", options: [] }]),
      card([{ type: "input", id: "b", label: "B?" }, { type: "input", id: "c", label: "C?", multiline: true }]),
    ];
    const built = askUserNoticeContent("S", open);
    expect(built.title).toBe("S is asking");
    expect(built.questionCount).toBe(3);
    expect(built.body).toContain("3 questions are waiting.");
  });

  it("reports a dialog that asks one thing as waiting for an answer", () => {
    const built = askUserNoticeContent("S", [{ dialogId: "d", kind: "confirm", title: "Ship it?", askedAt: "2026-11-05T10:00:00.000Z", runScoped: true }]);
    expect(built.title).toBe("S is waiting for you");
    expect(built.questionCount).toBeUndefined();
    expect(built.body).toContain("It is waiting for an answer.");
  });

  it("says the same thing as the shared builder for the same dialogs, so a phone and a laptop read one sentence", () => {
    const open = [card([{ type: "confirm", id: "ship", label: "Ship it?" }])];
    expect(askUserNoticeContent("S", open).body).toBe(askingNoticeLines({ sessionName: "S", dialogs: open }).body);
  });

  it("is total about no dialogs at all", () => {
    const built = askUserNoticeContent("S", []);
    expect(built.title).toBe("S is waiting for you");
    expect(built.questionCount).toBeUndefined();
  });
});
