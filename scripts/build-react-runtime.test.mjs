import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The names a plugin writes in its source, per published module. */
const published = {
  "plugin-react": ["piWebReactMember"],
  "plugin-react-hooks": ["useState", "useMemo", "createElement", "memo"],
  "jsx-runtime": ["jsx", "jsxs", "Fragment"],
};

function exportedNames(source) {
  const statement = /(?:^|[;}\n])\s*export\s*\{([^}]*)\}/gu.exec(source);
  return (statement?.[1] ?? "").split(",").map((entry) => entry.trim().split(/\s+as\s+/u).at(-1) ?? "").filter((name) => name !== "");
}

describe("published React runtime emit", () => {
  it("ships every name a plugin imports, so a plugin's React contribution can link", async () => {
    const out = await mkdtemp(join(tmpdir(), "pi-web-react-runtime-"));
    execFileSync(process.execPath, ["scripts/build-react-runtime.mjs", out], { encoding: "utf8" });
    for (const [name, members] of Object.entries(published)) {
      const exported = exportedNames(await readFile(join(out, `${name}.js`), "utf8"));
      expect(exported, `dist/client/${name}.js`).toEqual(expect.arrayContaining(members));
    }
  }, 60_000);

  it("refuses a shipped runtime whose exports were tree-shaken away", async () => {
    const jsx = "import{p}from'./plugin-react.js';p('jsx'),p('jsxs'),p('Fragment');";
    expect(exportedNames(jsx)).toEqual([]);
    const shipped = "var e=class extends Error{};function t(){}export{t as piWebReactMember};";
    expect(exportedNames(shipped)).toEqual(["piWebReactMember"]);
  });
});
