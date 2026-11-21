import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { PiWebPluginCatalog } from "../piWebPluginCatalog";

/**
 * npm on this platform. Windows ships it as the npm.cmd shim, and since Node 20 spawning a .cmd
 * without a shell is refused with EINVAL, so the command and the shell flag travel together.
 */
const npm = process.platform === "win32" ? { command: "npm.cmd", shell: true } : { command: "npm", shell: false };

/**
 * A plugin has to be installable as a package, not only readable from this
 * repository's own directory. The split repositories are only useful if
 * pi-web can load what they publish, so this builds one plugin into a real
 * tarball, installs it the way pi installs a package, and asks the catalog
 * what it found - a directory root is deliberately not offered, so a pass
 * cannot come from the bundled copy.
 */

/**
 * The fixture plugin bundles to one self-contained ESM file - built here rather
 * than read out of `dist`, which a fresh checkout does not have when the test
 * suite runs. Its package name deliberately differs from the plugin id it
 * registers, so a pass proves the catalog reads the manifest, not the folder.
 */
async function bundleFixturePlugin(): Promise<string> {
  const source = resolve("pi-web-plugins", "info", "pi-web-plugin.ts");
  const staging = mkdtempSync(join(tmpdir(), "pi-web-plugin-build-"));
  const outfile = join(staging, "pi-web-plugin.js");
  await build({ entryPoints: [source], bundle: true, format: "esm", outfile, logLevel: "silent" });
  return outfile;
}

async function packagedPluginRoot(): Promise<string> {
  const built = await bundleFixturePlugin();
  const staging = mkdtempSync(join(tmpdir(), "pi-web-plugin-package-"));
  const packageDir = join(staging, "package");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "pi-web-plugin.js"), readFileSync(built), "utf8");
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({
    name: "@gang-of-beads/pi-web-info",
    version: "0.0.1",
    type: "module",
    files: ["pi-web-plugin.js"],
    piWeb: { plugins: [{ id: "themes", browserRoot: ".", module: "pi-web-plugin.js" }] },
  }), "utf8");
  const tarball = execFileSync(npm.command, ["pack", "--silent"], { cwd: packageDir, encoding: "utf8", shell: npm.shell }).trim();

  const agentDir = join(staging, "agent");
  mkdirSync(join(agentDir, "npm"), { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:@gang-of-beads/pi-web-info"] }), "utf8");
  execFileSync(npm.command, ["init", "-y", "--silent"], { cwd: join(agentDir, "npm"), stdio: "ignore", shell: npm.shell });
  execFileSync(npm.command, ["install", "--silent", "--no-audit", "--no-fund", join(packageDir, tarball)], { cwd: join(agentDir, "npm"), stdio: "ignore", shell: npm.shell });
  return agentDir;
}

describe("a plugin installed as a package", () => {
  it("is discovered from node_modules rather than from a repository directory", { timeout: 180_000 }, async () => {
    const agentDir = await packagedPluginRoot();
    const catalog = new PiWebPluginCatalog({ cwd: agentDir, agentDir, roots: [], configProvider: () => ({}) });

    const snapshot = await catalog.snapshot();
    const themes = snapshot.plugins.find((plugin) => plugin.id === "themes");

    expect(themes?.packageRoot).toContain(join("node_modules", "@gang-of-beads", "pi-web-info"));
    expect(themes?.browserModule?.path).toBe("pi-web-plugin.js");
    expect(snapshot.diagnostics).toEqual([]);
  });
});
