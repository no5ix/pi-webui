import { installPromptCapture } from "./installPromptCapture";

/**
 * The browser entry point.
 *
 * PI WEB's presentation layer is React. The Lit tree is not a second app: it is
 * kept importable as the compatibility surface that plugin UI is written
 * against (plugin contributions are Custom Elements), and as the parity
 * reference a reviewer can open with `?ui=legacy` while the React migration is
 * being checked against the previous screen. The React tree loads the Lit
 * element definitions it hosts, so a page never carries two rendering trees at
 * once.
 */
type FrontendFlavor = "react" | "legacy";

const frontendStorageKey = "pi-web-frontend";

export function requestedFrontend(search: string, stored: string | null): FrontendFlavor {
  const fromUrl = new URLSearchParams(search).get("ui");
  if (fromUrl === "legacy" || fromUrl === "react") return fromUrl;
  if (stored === "legacy" || stored === "react") return stored;
  return "react";
}

function frontendStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function mountLegacy(root: HTMLElement): void {
  const app = document.createElement("pi-web-app");
  root.append(app);
  import("./main").catch((error: unknown) => {
    reportBootFailure(root, error);
  });
}

function mountReact(root: HTMLElement): void {
  import("./react/plugins/coreElements")
    .then(() => import("./react/main"))
    .then((module) => {
      module.mountReactApp(root);
    })
    .catch((error: unknown) => {
      reportBootFailure(root, error);
    });
}

function reportBootFailure(root: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const panel = document.createElement("pre");
  panel.className = "pi-boot-failure";
  panel.textContent = `PI WEB failed to start: ${message}`;
  root.replaceChildren(panel);
}

export function boot(document_: Document = document): void {
  const root = document_.getElementById("pi-web-root");
  if (root === null) return;
  installPromptCapture.start(window);
  const flavor = requestedFrontend(window.location.search, frontendStorage()?.getItem(frontendStorageKey) ?? null);
  const url = new URLSearchParams(window.location.search).get("ui");
  if (url !== null) frontendStorage()?.setItem(frontendStorageKey, flavor);
  if (flavor === "legacy") {
    mountLegacy(root);
    return;
  }
  mountReact(root);
}

declare global {
  interface HTMLElementTagNameMap {
    "pi-web-app": HTMLElement;
  }
}

boot();
