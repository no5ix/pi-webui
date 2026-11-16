import { describe, expect, it } from "vitest";
import { editedFileRows } from "./editedFiles.js";

describe("edited files", () => {
  it("keeps the path exactly as the tool named it, and splits the name from its directory", () => {
    expect(editedFileRows(["src/client/app.ts"])).toEqual([
      { path: "src/client/app.ts", name: "app.ts", directory: "src/client" },
    ]);
  });

  it("presents a bare filename with no directory tail", () => {
    expect(editedFileRows(["README.md"])).toEqual([
      { path: "README.md", name: "README.md", directory: "" },
    ]);
  });

  it("collapses a file named twice into one row", () => {
    expect(editedFileRows(["a.ts", "b.ts", "a.ts"])).toEqual([
      { path: "a.ts", name: "a.ts", directory: "" },
      { path: "b.ts", name: "b.ts", directory: "" },
    ]);
  });

  it("treats a windows-style path as one path, and reads its name from the last segment", () => {
    expect(editedFileRows(["C:\\repo\\src\\a.ts"])).toEqual([
      { path: "C:\\repo\\src\\a.ts", name: "a.ts", directory: "C:/repo/src" },
    ]);
  });

  it("drops blank entries", () => {
    expect(editedFileRows(["", "   ", "a.ts"])).toEqual([
      { path: "a.ts", name: "a.ts", directory: "" },
    ]);
  });

  it("keeps two files of the same name under one row, because the row is a name", () => {
    const rows = editedFileRows(["src/a.ts", "tests/a.ts"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("a.ts");
  });
});
