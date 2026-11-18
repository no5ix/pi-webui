import { useEffect, useState, type ReactNode } from "react";
import type { Machine } from "../../../../../shared/apiTypes";
import { machinesApi } from "../../../api/clients";
import { LitBoundary } from "./LitBoundary";
import { closeLayer, useLayerKey } from "../../state/panels";
import { setThemePreference, useThemeState } from "../../state/theme";
import { usePluginThemes } from "../../plugins/pluginBridge";
import type { QualifiedContributionId } from "../../../plugins/types";

/**
 * The settings surface.
 *
 * Settings are the app's own element — the sections, the readouts, and the
 * actions only it knows how to take. The React shell supplies what it is asked
 * for: the machine being described, the machines the reader can reach, the theme
 * list (native plus plugin themes) with the theme this browser picked marked as
 * picked, and the callbacks the shell can honour — pick a theme, follow the
 * system, open a page, close.
 */
export interface SettingsOverlayProps {
  machineId: string;
}

export function SettingsOverlay(props: SettingsOverlayProps): ReactNode {
  const layer = useLayerKey();
  const section = layer === "settings" ? "settings" : layer.replace("settings:", "");
  const theme = useThemeState();
  const pluginThemes = usePluginThemes();
  const [machines, setMachines] = useState<readonly Machine[]>([]);

  useEffect(() => {
    void machinesApi.machines().then((answer) => { setMachines(answer); }, () => { setMachines([]); });
  }, []);

  const extensions = pluginThemes.themes.map((entry) => ({ id: entry.id, label: entry.id, isDark: true, pinned: false }));

  if (layer !== "settings" && !layer.startsWith("settings:")) return null;

  return (
    <LitBoundary
      onElement={(element) => {
        assign(element, "section", section);
        assign(element, "machine", props.machineId);
        assign(element, "machines", machines);
        assign(element, "themes", { builtin: theme.preference.themeId, extensions, installed: [] });
        assign(element, "selectedThemeId", theme.preference.themeId);
        assign(element, "activeThemeId", theme.paintedId ?? theme.preference.themeId);
        assign(element, "followSystemTheme", theme.preference.auto);
        assign(element, "onSelectTheme", (themeId: string) => {
          const qualified = qualifiedThemeId(themeId);
          if (qualified !== undefined) setThemePreference({ ...theme.preference, themeId: qualified });
        });
        assign(element, "onToggleFollowSystem", (auto: boolean) => { setThemePreference({ ...theme.preference, auto }); });
        assign(element, "onClose", closeLayer);
        assign(element, "onOpenExtensionWidget", (id: string) => { openApp(`settings?widget=${encodeURIComponent(id)}`); });
        assign(element, "onOpenExtensionPage", (id: string) => { openApp(`settings?page=${encodeURIComponent(id)}`); });
        assign(element, "onOpenGlobalPage", (id: string) => { openApp(`settings?page=${encodeURIComponent(id)}`); });
        assign(element, "onOpenUrl", (href: string) => {
          window.open(href, "_blank", "noopener,noreferrer");
        });
      }}
      tag="settings-dialog"
    />
  );
}

function qualifiedThemeId(value: string): QualifiedContributionId | undefined {
  const split = value.indexOf(":");
  if (split <= 0 || split === value.length - 1) return undefined;
  return `${value.slice(0, split)}:${value.slice(split + 1)}`;
}

function openApp(path: string): void {
  window.location.assign(new URL(path, document.baseURI).href);
}

function assign(element: HTMLElement, name: string, value: unknown): void {
  Reflect.set(element, name, value);
}
