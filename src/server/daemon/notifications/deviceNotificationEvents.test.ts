import { describe, it, expect } from "vitest";
import { askUserEvent, runNoticeOutcome, taskFinishedEvent } from "./deviceNotificationEvents.js";
import { askUserQuestionCount } from "../../../shared/notificationEvents.js";
import { taskNoticeLines } from "../../../shared/notificationContent.js";
import type { PendingExtensionDialog } from "../../../shared/apiTypes.js";

const finished = (over: Partial<Parameters<typeof taskFinishedEvent>[0]> = {}) => taskFinishedEvent({
  id: "session-1:task:1700:completed",
  sessionId: "session-1",
  sessionName: "Refactor the parser",
  projectName: "pi-webui",
  ending: { outcome: "completed" },
  elapsedMs: 134_000,
  occurredAt: "2026-11-05T10:00:00.000Z",
  ...over,
});

describe("taskFinishedEvent", () => {
  it("says completed, the span, and the project, on a run that completed", () => {
    const { event, outcome } = finished();
    expect(outcome).toBe("completed");
    expect(event.kind).toBe("task_completed");
    expect(event.title).toBe("Refactor the parser finished");
    expect(event.body).toContain("Finished in 2m 14s.");
    expect(event.body).toContain("pi-webui");
    expect(event.elapsedMs).toBe(134_000);
    expect(event.id).toBe("session-1:task:1700:completed");
  });

  it("names a failure without carrying pi's error text to a device", () => {
    const { event } = finished({ ending: { outcome: "failed", error: "429 Too Many Requests from https://api.example\nread /home/reader/.env of the prompt" } });
    expect(event.kind).toBe("task_failed");
    expect(event.title).toBe("Refactor the parser failed");
    expect(event.body).toContain("Failed after 2m 14s.");
    expect(event.body).toContain("Open PI WEB to read what went wrong");
    // A runtime message can carry a prompt, a path, a command, or a tool argument, and this body
    // leaves the machine through a push service. The page shows the reason; a lock screen is told
    // that there is one and where to read it.
    expect(event.body).not.toContain("429");
    expect(event.body).not.toContain("https://api.example");
    expect(event.body).not.toContain("/home/reader");
    expect(event.body).not.toContain("prompt");
  });

  it("keeps a failure this party watched only part of hedged, like every other verdict", () => {
    const partial = taskNoticeLines({ sessionName: "S", verdict: "failed", elapsedMs: 134_000, partial: true });
    expect(partial.body).toContain("Failed after 2m 14s.");
    expect(partial.body).toContain("This page watched part of it.");
    expect(taskNoticeLines({ sessionName: "S", verdict: "failed", elapsedMs: 134_000 }).body).not.toContain("part of it");
  });

  it("calls the reader's Stop and an interrupted run a cancellation", () => {
    expect(finished({ ending: { outcome: "stopped" } }).event.kind).toBe("task_cancelled");
    expect(finished({ ending: { outcome: "interrupted" } }).event.kind).toBe("task_cancelled");
    expect(finished({ ending: { outcome: "stopped" } }).event.title).toBe("Refactor the parser stopped");
  });

  it("says the task ended without inventing a time the daemon never measured", () => {
    const { event } = finished({ elapsedMs: undefined });
    expect(event.body).toContain("The task is done.");
    expect(event.body).not.toMatch(/\d+m \d+s/);
    expect(event.elapsedMs).toBeUndefined();
  });

  it("leaves the project out of the sentence when the daemon has no project for the session", () => {
    const { event } = finished({ projectName: "  " });
    expect(event.body).not.toContain("  ");
    expect(event.body).toContain("Open PI WEB to read the answer.");
  });

  it("names the session when it has no name, rather than starting the line with a space", () => {
    expect(finished({ sessionName: "  " }).event.title).toBe("A pi session finished");
  });

  it("maps the daemon's five words onto the reader's four", () => {
    expect(runNoticeOutcome("completed")).toBe("completed");
    expect(runNoticeOutcome("failed")).toBe("failed");
    expect(runNoticeOutcome("stopped")).toBe("cancelled");
    expect(runNoticeOutcome("interrupted")).toBe("cancelled");
  });
});

const dialog = (over: Partial<PendingExtensionDialog> = {}): PendingExtensionDialog => ({
  dialogId: "dialog-1",
  kind: "custom",
  title: "Questions",
  askedAt: "2026-11-05T10:00:00.000Z",
  runScoped: true,
  ...over,
});

const questionnaire = dialog({
  screen: {
    kind: "card",
    title: "Questions",
    fields: [
      { type: "text", id: "intro", text: "Two things before I start" },
      { type: "choice", id: "q1", label: "Which file?", options: [{ value: "a", label: "a.ts" }, { value: "b", label: "b.ts" }] },
      { type: "choice", id: "q2", label: "Which branch?", options: [{ value: "main", label: "main" }], multiple: true },
      { type: "input", id: "q3", label: "Any constraints?" },
    ],
  },
});

describe("askUserEvent", () => {
  it("asks about the questions a questionnaire is waiting on, counted", () => {
    const event = askUserEvent({ id: "session-1:ask:dialog-1", sessionId: "session-1", sessionName: "Refactor the parser", projectName: "pi-webui", occurredAt: "2026-11-05T10:00:00.000Z", dialog: questionnaire });
    expect(event.kind).toBe("user_input_required");
    expect(event.title).toBe("Refactor the parser is asking");
    expect(event.body).toContain("3 questions are waiting.");
    expect(event.questionCount).toBe(3);
    expect(event.id).toBe("session-1:ask:dialog-1");
  });

  it("counts one question per answerable card field, and a heading is not a question", () => {
    expect(askUserQuestionCount(questionnaire)).toBe(3);
  });

  it("says one question, not one questions", () => {
    const one = dialog({ screen: { kind: "card", fields: [{ type: "confirm", id: "ship", label: "Ship it?" }] } });
    const event = askUserEvent({ id: "x", sessionId: "s", sessionName: "S", projectName: "", occurredAt: "", dialog: one });
    expect(event.body).toContain("One question is waiting.");
    expect(event.body).not.toContain("pi-webui");
  });

  it("reports a dialog that asks one thing as waiting for an answer, not as a questionnaire", () => {
    for (const asked of [
      dialog({ kind: "confirm", title: "Ship it?" }),
      dialog({ kind: "select", title: "Which one?", options: ["a", "b", "c"] }),
      dialog({ kind: "input", title: "Name it?" }),
      dialog({ screen: { kind: "card", fields: [{ type: "text", id: "notice", text: "A plugin's card that presents something" }] } }),
    ]) {
      const event = askUserEvent({ id: "x", sessionId: "s", sessionName: "S", projectName: "", occurredAt: "", dialog: asked });
      expect(event.title).toBe("S is waiting for you");
      expect(event.body).toContain("It is waiting for an answer.");
      expect(event.questionCount).toBeUndefined();
    }
  });

  it("counts a questionnaire's fields, and one for a plain dialog, in the shared classifier", () => {
    expect(askUserQuestionCount(questionnaire)).toBe(3);
    expect(askUserQuestionCount(dialog({ kind: "confirm" }))).toBe(1);
    expect(askUserQuestionCount(dialog({ kind: "select", options: ["a", "b", "c"] }))).toBe(1);
  });
});
