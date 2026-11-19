import { piWebApi, projectsApi, sessionsApi, trustApi } from "../../api/clients";
import { projectFolderAccess } from "../../plugins/projectFolderAccess";
import type { MachineCreateInput, PluginProjectCreateInput, PluginRuntimeContext } from "../../plugins/types";
import type { QualifiedContributionId } from "../../plugins/ids";
import type { Workspace } from "../../../../shared/apiTypes";
import type { AppState } from "../../appState";
import { pluginAppState } from "./appStateProjection";
import { pluginStore } from "./pluginBridge";
import { openSignIn, openSignOut } from "./authFlows";
import { pushToast } from "../components/common/Toasts";
import { unhostedPluginSurfaceMessage } from "./pluginSurfaces";
import { boardRuntime } from "../state/board";
import { promptEditorHandle } from "../state/composerStore";
import { readTree } from "../state/filesStore";
import { addMachine, machinesStore, readMachines, recheckMachine, removeMachine, renameMachine } from "../state/machinesStore";
import { openLayer, selectWorkbenchTabByName, setMainView, setPanelCollapsed, setWorkbenchTab } from "../state/panels";
import { addProject, projectsStore, readProjects } from "../state/projectsStore";
import { selectedScope, selection } from "../state/selection";
import { deleteWorkspace as removeWorkspace, reloadSession, archiveSession, startSessionForSelection, stopSessionWork, selectedSessionRef, selectedWorkspace } from "../state/sessionActions";
import { requestTerminalOpen } from "../state/terminalRuntime";

/**
 * The context a plugin acts through, built from the React shell.
 *
 * Every contribution - a settings section, a panel, a renderer, an action - is
 * handed this object, so it *is* the host's surface: what a plugin may read
 * (`state`, the projected app state) and what it may do (open a layer, start a
 * session, add a project, move the workbench). Each method reaches the same store
 * or API client the shell's own control uses, so a plugin's button and the
 * shell's button cannot drift apart.
 *
 * A method that needs something the shell does not have - no session open, no
 * workspace chosen - says so to the reader through a toast instead of calling the
 * machine with an empty scope.
 */
/** The id a contribution was registered with locally, inside its plugin's scope. */
function localContributionIdOf(qualified: QualifiedContributionId): string {
  const split = qualified.indexOf(":");
  return split < 0 ? qualified : qualified.slice(split + 1);
}

export function pluginRuntimeContext(): PluginRuntimeContext {
  const machineId = selection.get().machineId;
  const machineName = machinesStore.get().machines.find((machine) => machine.id === machineId)?.name;

  return {
    state: pluginAppState(),
    prompt: {
      insertText: (text: string) => { promptEditorHandle()?.insertText(text); },
      getText: () => promptEditorHandle()?.getText() ?? "",
      getSelection: () => promptEditorHandle()?.getSelection() ?? null,
    },
    openActionPalette: () => { openLayer("palette"); },
    focusPrompt: () => { promptEditorHandle()?.focus(); },
    addProject: () => { openLayer("new-project"); },
    createProject: (input: PluginProjectCreateInput) => addProject({ path: input.path, ...(input.create === undefined ? {} : { create: input.create }), ...(input.trust === undefined ? {} : { trust: input.trust }) }, machineId),
    createMachine: async (input: MachineCreateInput) => {
      try {
        await addMachine({ name: input.name, baseUrl: input.baseUrl, ...(input.token === undefined ? {} : { token: input.token }) });
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    projectDirectories: (query: string, signal: AbortSignal) => projectsApi.projectDirectories(query, machineId, { signal }),
    projectTrust: (path: string) => trustApi.projectTrust(path, machineId),
    projectFolders: () => projectFolderAccess({
      machine: { id: machineId, name: machineName },
      projects: projectsApi,
      trust: trustApi,
      create: (boundMachineId: string, input: PluginProjectCreateInput) => addProject({ path: input.path, ...(input.create === undefined ? {} : { create: input.create }), ...(input.trust === undefined ? {} : { trust: input.trust }) }, boundMachineId),
      listedProjects: () => projectsStore.get().projects,
    }),
    removeMachine: async (id: string) => { await removeMachine(id); },
    refreshMachine: async (id: string) => { await recheckMachine(id); },
    openMachine: (id: string) => {
      const machine = machinesStore.get().machines.find((entry) => entry.id === id);
      if (machine === undefined) {
        pushToast({ body: "That machine is not in the roster any more.", title: "Open machine", tone: "warning" });
        return;
      }
      window.open(machine.baseUrl, "_blank", "noopener");
    },
    renameMachine: (id: string) => {
      const machine = machinesStore.get().machines.find((entry) => entry.id === id);
      openLayer(`rename-machine:${id}`);
      if (machine === undefined) return;
      void renameMachine(machine.id, machine.name);
    },
    configureAuth: () => { openSignIn(); },
    logoutAuth: () => { openSignOut(); },
    openThemePicker: () => { openLayer("settings"); },
    openModelPicker: () => { window.dispatchEvent(new CustomEvent("pi-web-open-model-picker")); return Promise.resolve(); },
    openThinkingLevelPicker: () => { window.dispatchEvent(new CustomEvent("pi-web-open-thinking-picker")); return Promise.resolve(); },
    selectMainView: (view: AppState["mainView"]) => {
      if (view === "chat") {
        setMainView("chat");
        return;
      }
      if (view === "navigation") {
        setPanelCollapsed("navigation", false);
        setMainView("chat");
        return;
      }
      pushToast({ body: unhostedPluginSurfaceMessage, title: "Page", tone: "info" });
    },
    selectWorkspaceTool: (tool: QualifiedContributionId) => {
      if (selectWorkbenchTabByName(localContributionIdOf(tool))) return;
      pushToast({ body: unhostedPluginSurfaceMessage, title: "Workspace panel", tone: "info" });
    },
    openTerminal: (options?: { terminalId?: string | undefined }) => {
      setWorkbenchTab("terminal");
      requestTerminalOpen(options?.terminalId);
    },
    refreshFiles: async () => {
      const scope = selectedScope();
      if (scope === undefined) return;
      await readTree(scope);
    },
    refreshWorkspacePanels: () => {
      pluginStore.update((current) => ({ ...current, version: current.version + 1 }));
    },
    refreshAppData: async () => {
      await Promise.all([
        readMachines().catch(() => undefined),
        readProjects(machineId).catch(() => undefined),
        boardRuntime.read({ force: true }).catch(() => undefined),
      ]);
    },
    checkForPiWebUpdates: async () => {
      try {
        const status = await piWebApi.checkForUpdates(machineId);
        const updateAvailable = status.release.updateAvailable;
        pushToast({
          body: updateAvailable ? `PI WEB ${status.release.latestVersion ?? ""} is available on this machine.` : "This PI WEB is up to date.",
          title: "Updates",
          tone: updateAvailable ? "info" : "success",
        });
      } catch (error) {
        pushToast({ body: error instanceof Error ? error.message : String(error), title: "Updates", tone: "error" });
      }
    },
    reloadPage: () => { window.location.reload(); },
    deleteWorkspace: async (workspace?: Workspace) => {
      const target = workspace ?? selectedWorkspace();
      if (target === undefined) {
        pushToast({ body: "No workspace is chosen, so there is nothing to remove.", title: "Remove workspace", tone: "warning" });
        return;
      }
      if (target.removal === undefined) {
        pushToast({ body: "This machine does not offer to remove this workspace.", title: "Remove workspace", tone: "warning" });
        return;
      }
      await removeWorkspace(target.projectId, target.id, target.removal.precondition, machineId);
    },
    startSession: async () => {
      const refusal = await startSessionForSelection();
      if (refusal !== undefined) pushToast({ body: refusal, title: "New session", tone: "warning" });
    },
    archiveSession: async () => {
      const session = selectedSessionRef();
      if (session === undefined) {
        pushToast({ body: "No session is open to archive.", title: "Archive", tone: "warning" });
        return;
      }
      await archiveSession(session, machineId);
    },
    reloadSession: async () => {
      const session = selectedSessionRef();
      if (session === undefined) {
        pushToast({ body: "No session is open to reload.", title: "Reload session", tone: "warning" });
        return;
      }
      await reloadSession(session, machineId);
    },
    deleteCachedNewSession: async () => {
      const session = selectedSessionRef();
      if (session === undefined) return;
      await sessionsApi.stop(session, machineId).catch(() => undefined);
    },
    stopActiveWork: async () => {
      const session = selectedSessionRef();
      if (session === undefined) {
        pushToast({ body: "No session is open, so there is nothing to stop.", title: "Stop", tone: "warning" });
        return;
      }
      await stopSessionWork(session, machineId);
    },
  };
}
