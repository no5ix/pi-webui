import { describe, expect, it } from "vitest";
import { conversationRole, conversationRows, hasAssistantResponseAfter, latestUserPrompt, nextAssistantResponse } from "./conversationNavigation.js";

const rows = conversationRows([
  { index: "0", role: "user" },
  { index: "1", role: "other" },
  { index: "2", role: "assistant" },
  { index: "3", role: "user" },
  { index: "4", role: "other" },
  { index: "5", role: "other" },
  { index: "6", role: "assistant" },
  { index: "7", role: "other" },
  { index: "8", role: "assistant" },
]);

describe("conversationRole", () => {
  it("separates the two things a reader navigates between from everything a task does on the way", () => {
    expect(conversationRole(["msg", "user"])).toBe("user");
    expect(conversationRole(["msg", "assistant"])).toBe("assistant");
    expect(conversationRole(["msg", "bash"])).toBe("other");
    expect(conversationRole(["msg", "custom", "reading"])).toBe("other");
  });

  it("reads the classes the page really renders", () => {
    expect(conversationRole(["msg", "tool-execution-shell"])).toBe("other");
    expect(conversationRole(["msg", "tool-image-output"])).toBe("other");
    expect(conversationRole(["msg", "user", "command", "sent"])).toBe("user");
    expect(conversationRole(["msg", "assistant", " queued"])).toBe("assistant");
  });

  it("is not moved by decorations on the row", () => {
    expect(conversationRole(["msg", "user", "newer-boundary"])).toBe("user");
    expect(conversationRole(["msg", "assistant", "streaming"])).toBe("assistant");
    expect(conversationRole(["msg"])).toBe("other");
    expect(conversationRole([])).toBe("other");
    // A row the page never renders: the reader's own row wins, because the prompt is what navigation
    // above goes to, and a row that is both has nothing below it to answer.
    expect(conversationRole(["msg", "user", "assistant"])).toBe("user");
  });
});

describe("conversationRows", () => {
  it("keeps only the rows that carry a transcript index, and reads the index as a number", () => {
    const built = conversationRows([{ index: "7", role: "user" }, { index: undefined, role: "assistant" }, { index: "nope", role: "assistant" }, { index: "9", role: "assistant" }]);
    expect(built).toEqual([{ index: 7, role: "user" }, { index: 9, role: "assistant" }]);
  });

  it("collapses a row the page shows twice across a page boundary", () => {
    expect(conversationRows([{ index: "4", role: "assistant" }, { index: "4", role: "assistant" }])).toEqual([{ index: 4, role: "assistant" }]);
  });
});

describe("latestUserPrompt", () => {
  it("lands on the most recent prompt above the reader", () => {
    expect(latestUserPrompt(rows, 5)).toBe(3);
    expect(latestUserPrompt(rows, 4)).toBe(3);
    expect(latestUserPrompt(rows, 0)).toBeUndefined();
  });

  it("is the prompt the reader sent, not the message a task answered with", () => {
    expect(latestUserPrompt(rows, 3)).toBe(0);
  });

  it("stands on the start of a user message and asks for the one before it", () => {
    expect(latestUserPrompt(rows, 1)).toBe(0);
  });

  it("is total about nothing", () => {
    expect(latestUserPrompt([], 5)).toBeUndefined();
    expect(latestUserPrompt(rows, Number.MAX_SAFE_INTEGER)).toBe(3);
  });
});

describe("nextAssistantResponse", () => {
  it("skips the tool runs and thinking rows to the next answer", () => {
    expect(nextAssistantResponse(rows, 3)).toBe(6);
    expect(nextAssistantResponse(rows, 0)).toBe(2);
  });

  it("passes a row the reader is reading, and moves on from the answer they are on", () => {
    expect(nextAssistantResponse(rows, 2)).toBe(6);
    expect(nextAssistantResponse(rows, 6)).toBe(8);
  });

  it("says there is nothing below, rather than wrapping around", () => {
    expect(nextAssistantResponse(rows, 8)).toBeUndefined();
    expect(nextAssistantResponse(rows, 9)).toBeUndefined();
    expect(nextAssistantResponse([], 0)).toBeUndefined();
  });

  it("treats an execution row as neither a prompt nor an answer", () => {
    expect(nextAssistantResponse([{ index: 1, role: "other" }, { index: 2, role: "assistant" }], 0)).toBe(2);
    expect(latestUserPrompt([{ index: 1, role: "other" }], 5)).toBeUndefined();
  });

  it("answers the same question the control asks, without naming a row", () => {
    expect(hasAssistantResponseAfter(rows, 6)).toBe(true);
    expect(hasAssistantResponseAfter(rows, 8)).toBe(false);
  });
});
