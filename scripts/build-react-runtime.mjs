#!/usr/bin/env node
/**
 * Emit the React runtime the page publishes to plugins.
 *
 * The three modules are a published contract: a plugin's JSX compiles against
 * `@gang-of-beads/pi-web/jsx-runtime` and its hooks against
 * `@gang-of-beads/pi-web/plugin-react-hooks`, and the page names them to the browser in an import
 * map. Nothing in the application's module graph imports them by the name a plugin uses, so an
 * application bundler evaluates them as entries whose exports nobody reached: the shipped
 * `jsx-runtime.js` became three bare calls with no exports, a plugin's `import { jsx }` failed to
 * link, and the page loaded a plugin that contributed nothing while the page itself looked healthy.
 *
 * They are built here, with the same esbuild rule the plugin build uses, and the emitted text is
 * checked for every name the contract publishes: a runtime that ships without its exports fails the
 * build instead of silently disarming every React plugin.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? join(REPO, "dist/client"));

/** The published names, exactly as a plugin writes them. */
const published = {
  "plugin-react": ["piWebReactMember", "PiWebReactRuntimeError"],
  "plugin-react-hooks": ["useState", "useReducer", "useEffect", "useLayoutEffect", "useMemo", "useCallback", "useRef", "useImperativeHandle", "useDebugValue", "useTransition", "useDeferredValue", "useId", "useSyncExternalStore", "useContext", "createContext", "createElement", "cloneElement", "isValidElement", "memo", "forwardRef", "lazy", "startTransition", "Fragment", "Suspense"],
  "jsx-runtime": ["jsx", "jsxs", "Fragment"],
};

async function main() {
  await mkdir(outDir, { recursive: true });
  const built = [];
  for (const name of Object.keys(published)) {
    const result = await esbuild.build({
      absWorkingDir: REPO,
      bundle: true,
      entryPoints: [`src/${name}.ts`],
      outfile: join(outDir, `${name}.js`),
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: true,
      legalComments: "none",
      write: true,
    });
    if (result.errors.length > 0) throw new Error(`${name}: ${result.errors.map((error) => error.text).join("; ")}`);
    const emitted = await readFile(join(outDir, `${name}.js`), "utf8");
    const missing = published[name]?.filter((member) => !exportsNames(emitted, member)) ?? [];
    if (missing.length > 0) {
      throw new Error(`dist/client/${name}.js does not export ${missing.join(", ")}. A plugin imports these by name; an application bundler that tree-shakes this entry leaves every React plugin on the page contributing nothing. Built by scripts/build-react-runtime.mjs, not by the client bundle.`);
    }
    built.push(`${name}.js (${emitted.length} bytes, ${published[name]?.length ?? 0} names)`);
  }
  console.log(`published React runtime: ${built.join(", ")} → ${outDir}`);
}

/** True when the emitted module exports `member` under that exact name. */
function exportsNames(source, member) {
  const exportStatement = /(?:^|[;})\n])\s*export\s*\{([^}]*)\}/gu.exec(source);
  const names = exportStatement?.[1]?.split(",").map((entry) => entry.trim().split(/\s+as\s+/u).at(-1) ?? "") ?? [];
  return names.includes(member);
}

void main();
