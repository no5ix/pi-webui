import { describe, expect, it } from "vitest";
import { languageForPath } from "./WorkspaceCodeEditor.js";

describe("workspace editor language selection", () => {
  it.each([
    ["src/main.ts", "typescript"],
    ["view.jsx", "javascript"],
    ["styles.css", "css"],
    ["page.html", "html"],
    ["settings.json", "json"],
    ["README.md", "markdown"],
    ["task.py", "python"],
    ["lib.rs", "rust"],
    ["main.go", "go"],
  ])("selects %s as %s", (path, name) => {
    const extension = languageForPath(path);
    if (Array.isArray(extension)) throw new Error(`${path} did not resolve to a language support`);
    expect(extension).toMatchObject({ language: { name } });
  });

  it("leaves unknown text files editable without pretending they have a language", () => {
    expect(languageForPath("notes.txt")).toEqual([]);
  });
});
