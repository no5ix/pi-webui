import { describe, expect, it } from "vitest";
import type { ChatLine } from "../chatTypes";
import { groupReactTranscriptMessages } from "./ReactWorkspaceApp";
import { collectEditedFileDiffs, collectToolRecords, summarizeActivityGroup } from "./ActivityWorkbenchPanels";

describe("React workspace activity panels", () => {
  it("summarizes consecutive thinking and tool events", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "plan" }] },
      { role: "assistant", parts: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", summary: "Read a file" }] },
      { role: "tool", parts: [{ type: "toolResult", toolCallId: "call-1", toolName: "read", text: "ok", isError: false }] },
      { role: "assistant", parts: [{ type: "thinking", text: "continue" }] },
    ];
    expect(summarizeActivityGroup(messages)).toBe("2 thinkings, 1 tool call, 1 tool result");
  });


  it("keeps the final assistant report visible after collapsing preceding activity", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "thinking", text: "inspect files" }] },
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "Read files" }] },
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "file contents", isError: false }] },
      { role: "assistant", parts: [{ type: "text", text: "The review is complete. Here is the report." }] },
    ];
    const groups = groupReactTranscriptMessages(messages);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: "group", messages: messages.slice(0, 3) });
    expect(groups[1]).toMatchObject({ kind: "message", message: messages[3] });
  });

  it("omits only the internal background-task notification sentinel", () => {
    const notification: ChatLine = { role: "system", parts: [{ type: "text", text: "background-task-notification" }] };
    const actualSystem: ChatLine = { role: "system", parts: [{ type: "text", text: "Authentication failed." }] };
    const groups = groupReactTranscriptMessages([notification, actualSystem]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "message", message: actualSystem });
  });

  it("deduplicates a tool call and its execution record", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "toolCall", toolCallId: "sub-1", toolName: "subagent", summary: "Research" }] },
      { role: "assistant", meta: { timestamp: "2026-11-21T00:00:00Z" }, parts: [{ type: "toolExecution", toolCallId: "sub-1", toolName: "subagent", summary: "Research", status: "success" }] },
    ];
    expect(collectToolRecords(messages, /subagent/i)).toHaveLength(1);
    expect(collectToolRecords(messages, /subagent/i)[0]?.status).toBe("success");
  });

  it("uses the latest recorded preview diff for each edited file", () => {
    const messages: ChatLine[] = [
      { role: "assistant", parts: [{ type: "toolExecution", toolName: "edit", summary: "Edit", status: "success", args: { path: "src/App.tsx" }, preview: { diff: "-old\n+new" } }] },
    ];
    expect(collectEditedFileDiffs(messages)).toEqual([{ path: "src/App.tsx", diff: "-old\n+new" }]);
  });
});
