import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { effectivePiWebConfig, piWebTlsConfig } from "./src/config";

const { config } = effectivePiWebConfig();
const apiPort = config.port ?? 8504;
const apiOrigin = `${piWebTlsConfig() === undefined ? "http" : "https"}://localhost:${String(apiPort)}`;
// Tailscale Serve takes the served port on the tailnet interface, so the development server keeps to
// loopback: binding every interface on 8505 is refused with EADDRINUSE once `tailscale serve` is
// running, and the serve proxy forwards to http://127.0.0.1:8505, which is exactly where this listener
// belongs. The rule is documented for production installs too (docs/faq.md, "With Tailscale Serve").
const devHost = "127.0.0.1";
const devPort = 8505;
/**
 * Host names the development server answers, beyond what the config lists.
 *
 * `pnpm run dev` adds the tailnet's own suffix through `PI_WEB_ALLOWED_HOSTS`, so a name in this list
 * is a specific device a reader asked to reach by name. Both sets are answered: a config file that
 * names a host and a suffix from the dev script are additive, never one replacing the other.
 */
const devAllowedHostNames = ["macb00kpr0m4.taila0e40f.ts.net"];

function devAllowedHosts(): string[] | true {
  if (config.allowedHosts === true) return true;
  const configured = config.allowedHosts ?? [];
  return [...new Set([...devAllowedHostNames, ...configured])];
}
const docsRoot = resolve("docs");
const docsPrefix = "/site";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".xml": "application/xml; charset=utf-8",
};

type MiddlewareNext = (error?: unknown) => void;

async function serveDevDocs(request: IncomingMessage, response: ServerResponse, next: MiddlewareNext): Promise<void> {
  const requestUrl = request.url;
  if (requestUrl === undefined) {
    next();
    return;
  }

  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname === docsPrefix) {
    response.statusCode = 302;
    response.setHeader("Location", `${docsPrefix}/`);
    response.end();
    return;
  }
  if (!url.pathname.startsWith(`${docsPrefix}/`)) {
    next();
    return;
  }

  const relativePath = decodeURIComponent(url.pathname.slice(docsPrefix.length + 1)) || "index.html";
  const requestedPath = relativePath.endsWith("/") ? join(relativePath, "index.html") : relativePath;
  const candidatePaths = extname(requestedPath) === "" ? [requestedPath, `${requestedPath}.html`] : [requestedPath];

  for (const candidatePath of candidatePaths) {
    const filePath = resolve(docsRoot, candidatePath);
    if (filePath !== docsRoot && !filePath.startsWith(`${docsRoot}${sep}`)) {
      response.statusCode = 403;
      response.end("Forbidden");
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;

      response.statusCode = 200;
      response.setHeader("Content-Type", contentTypes[extname(filePath)] ?? "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      createReadStream(filePath).pipe(response);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") continue;
      next(error);
      return;
    }
  }

  response.statusCode = 404;
  response.end("Not found");
}

function devDocsPlugin(): Plugin {
  return {
    name: "pi-web-dev-docs",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void serveDevDocs(request, response, next);
      });
    },
  };
}

const parsedPackage: unknown = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const packageVersion = typeof parsedPackage === "object" && parsedPackage !== null && "version" in parsedPackage && typeof parsedPackage.version === "string" ? parsedPackage.version : "";

export default defineConfig({
  plugins: [devDocsPlugin()],
  define: {
    __PI_WEB_CLIENT_VERSION__: JSON.stringify(packageVersion),
  },
  root: "src/client",
  base: "./",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@codemirror/legacy-modes")) return "vendor-editor-legacy";
          if (id.includes("@lezer/common") || id.includes("@lezer/highlight") || id.includes("@lezer/lr")) return "vendor-editor-core";
          if (id.includes("@codemirror/lang-") || id.includes("@lezer/")) return "vendor-editor-languages";
          if (id.includes("@codemirror") || id.includes("codemirror")) return "vendor-editor-core";
          if (id.includes("@xterm")) return "vendor-terminal";
          return undefined;
        },
      },
    },
  },
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    allowedHosts: devAllowedHosts(),
    proxy: {
      "/api": { target: apiOrigin, ws: true, secure: false },
      "/pi-web-plugins": { target: apiOrigin, secure: false },
      "^/access(?:\\?|$)": { target: apiOrigin, secure: false },
    },
  },
});
