import { describe, expect, it } from "vitest";
import { parseTerminalServerFrame, terminalInputFrame, terminalResizeFrame } from "./terminalRuntime";

const encoder = new TextEncoder();

function bytes(text: string): ArrayBuffer {
  const view = encoder.encode(text);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

describe("the terminal socket's frames", () => {
  it("sends a keystroke as an input frame", () => {
    expect(JSON.parse(terminalInputFrame("ls\u000d"))).toEqual({ type: "input", data: "ls\u000d" });
  });

  it("sends the fitted size as a resize frame", () => {
    expect(JSON.parse(terminalResizeFrame(120, 40))).toEqual({ type: "resize", cols: 120, rows: 40 });
  });

  it("reads the machine's output as text, not as control words", () => {
    expect(parseTerminalServerFrame('{"type":"output","data":"$ ","replay":true}')).toEqual({
      type: "output",
      data: "$ ",
      replay: true,
    });
  });

  it("reads an output frame that arrives as bytes", () => {
    expect(parseTerminalServerFrame(bytes('{"type":"output","data":"ready"}'))).toEqual({
      type: "output",
      data: "ready",
      replay: false,
    });
  });

  it("keeps an exit code with the exit frame", () => {
    expect(parseTerminalServerFrame('{"type":"exit","exitCode":2}')).toEqual({ type: "exit", exitCode: 2 });
    expect(parseTerminalServerFrame('{"type":"exit"}')).toEqual({ type: "exit", exitCode: undefined });
  });

  it("keeps the machine's reason with an error frame", () => {
    expect(parseTerminalServerFrame('{"type":"error","message":"no such terminal"}')).toEqual({
      type: "error",
      message: "no such terminal",
    });
  });

  it("answers nothing for a frame the daemon does not send", () => {
    expect(parseTerminalServerFrame("plain text")).toBeUndefined();
    expect(parseTerminalServerFrame('{"type":"output"}')).toBeUndefined();
    expect(parseTerminalServerFrame('{"type":"mystery"}')).toBeUndefined();
    expect(parseTerminalServerFrame(42)).toBeUndefined();
  });
});
