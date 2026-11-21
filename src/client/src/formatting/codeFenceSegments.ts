/**
 * The text of one message part, cut at the fences a plugin may claim.
 *
 * The React transcript sanitizes markdown into an HTML string, so a fence that survives as text
 * cannot be reached once that happens. Splitting the source first lets a claimed language be drawn
 * by its plugin while every other word — including unclaimed fences — still goes through the same
 * sanitizer as before. A fence is a line starting with three or more backticks, or three or more
 * tildes, and its info string's first word names the language; an unterminated fence runs to the
 * end of the text, because a streaming message is half a message by design.
 */

export type MarkdownSegment =
  | { kind: "markdown"; text: string }
  | { kind: "code"; text: string; language: string | undefined; marker: string };

const OPENER = /^[\t ]*(`{3,}|~{3,})[ \t]*([^\r\n]*)$/u;

function closerPattern(marker: string): RegExp {
  const lead = marker.startsWith("`") ? "`" : "~";
  return new RegExp(`^[\\t ]*${lead}{${String(marker.length)}}[\\t ]*$`, "u");
}

function languageOf(info: string): string | undefined {
  const first = info.trim().split(/\s+/u)[0];
  if (first === undefined || first === "") return undefined;
  return first.toLowerCase();
}

export function splitCodeFences(text: string): MarkdownSegment[] {
  const lines = text.split(/\r?\n/u);
  const segments: MarkdownSegment[] = [];
  const prose: string[] = [];

  const flushProse = () => {
    const joined = prose.join("\n");
    prose.length = 0;
    if (joined.trim() !== "") segments.push({ kind: "markdown", text: joined });
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const opener = OPENER.exec(line);
    if (opener === null) {
      prose.push(line);
      index += 1;
      continue;
    }

    const marker = opener[1] ?? "```";
    const language = languageOf(opener[2] ?? "");
    const body: string[] = [];
    const closer = closerPattern(marker);
    index += 1;
    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      index += 1;
      if (closer.test(candidate)) break;
      body.push(candidate);
    }

    flushProse();
    segments.push({ kind: "code", text: body.join("\n"), language, marker });
  }

  flushProse();
  return segments;
}
