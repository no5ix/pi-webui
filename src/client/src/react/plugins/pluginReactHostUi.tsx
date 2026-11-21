import type { ReactNode } from "react";
import {
  PluginReactButton,
  PluginReactCard,
  PluginReactCloseIcon,
  PluginReactDisclosureIcon,
  PluginReactEmpty,
  PluginReactExpandableRow,
  PluginReactField,
  PluginReactMessageField,
  PluginReactNotice,
  PluginReactOutput,
  PluginReactSection,
  PluginReactToggle,
} from "./pluginReactKit";
import { COARSE_OR_MOBILE_MEDIA_QUERY, DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY, MOBILE_NAVIGATION_MEDIA_QUERY, SHORT_VIEWPORT_MEDIA_QUERY } from "../../breakpoints";
import { writeClipboardText } from "../../clipboard";
import { describeError } from "../../notice";
import { readNamespacedString, setNamespacedQueryKey } from "../../namespacedQueryArgs";
import { renderWorkspaceMarkdownHtml } from "../../formatting/workspaceMarkdown";
import type { PluginConfirmRequest, PluginDialogHandle, PluginReactComponent, PluginReactDialog, PluginReactHostUi } from "../../../../plugin-api";

/** What a React host must supply: the two surfaces a plugin cannot open by itself. */
export interface PluginReactHostUiDeps {
  /** Present a React dialog. The host owns focus, Escape, the backdrop and the back gesture. */
  readonly showDialog: (dialog: PluginReactDialog) => PluginDialogHandle;
  /** Ask the reader to confirm, on the app's own dialog. Resolves true only for the confirming key. */
  readonly confirm: (request: PluginConfirmRequest) => Promise<boolean>;
}

/**
 * The host's React surface, as the plugin contract names it.
 *
 * The components are the host's own (`pluginReactKit.tsx`), so a plugin's panel and PI WEB's built-in
 * panels wear the same focus rings, the same notice that reaches a screen reader, and the theme the
 * reader chose. The answers — the clipboard's fallback chain, the words a failure is described with,
 * the breakpoint strings that define phone behaviour, the sanitized markdown — are the same functions
 * the built-in surfaces call, handed over rather than copied.
 */
export function createPluginReactHostUi(deps: PluginReactHostUiDeps): PluginReactHostUi {
  return {
    Button: asHostComponent(PluginReactButton),
    Toggle: asHostComponent(PluginReactToggle),
    Section: asHostComponent(PluginReactSection),
    Card: asHostComponent(PluginReactCard),
    Empty: asHostComponent(PluginReactEmpty),
    Notice: asHostComponent(PluginReactNotice),
    Field: asHostComponent(PluginReactField),
    Output: asHostComponent(PluginReactOutput),
    MessageField: asHostComponent(PluginReactMessageField),
    ExpandableRow: asHostComponent(PluginReactExpandableRow),
    DisclosureIcon: asHostComponent(PluginReactDisclosureIcon),
    CloseIcon: asHostComponent(PluginReactCloseIcon),
    showDialog: deps.showDialog,
    confirm: deps.confirm,
    markdownHtml: (markdown) => renderWorkspaceMarkdownHtml(markdown),
    breakpoints: {
      coarseOrMobile: COARSE_OR_MOBILE_MEDIA_QUERY,
      mobileNavigation: MOBILE_NAVIGATION_MEDIA_QUERY,
      desktopSideBySide: DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY,
      shortViewport: SHORT_VIEWPORT_MEDIA_QUERY,
    },
    copyText: (text) => writeClipboardText(text),
    describeError,
    coarsePointer: matchMediaCoarse(),
    query: {
      read: (namespace, key) => readNamespacedString(namespace, key),
      write: (namespace, key, value, options) => setNamespacedQueryKey(namespace, key, value, options),
    },
  };
}

/**
 * The React half of the seam, beside `asReactNode`.
 *
 * A component the host hands a plugin is React-typed on one side and structurally typed on the other,
 * and function types are contravariant in their parameters, so the two signatures do not line up on
 * their own. This is where that equivalence is spent — one place, one assertion, so the contract stays
 * free of React while the components a plugin composes stay React's own.
 */
function asHostComponent<P>(component: (props: P) => ReactNode): PluginReactComponent<P> {
  return component as PluginReactComponent<P>;
}

function matchMediaCoarse(): boolean {
  return typeof window === "object" && window.matchMedia("(pointer: coarse)").matches;
}
