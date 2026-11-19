import { useEffect, useMemo } from "react";
import type { MachinePins } from "../../api/clients";
import { pinnedSessionSet } from "../components/navigation/navigationModel";
import { openSignIn, openSignOut } from "../plugins/authFlows";
import { pushToast } from "../components/common/Toasts";
import { useBoard, type BoardSnapshot } from "./board";
import { openLayer, togglePanel } from "./panels";
import { usePins } from "./navStore";
import { useSelection, type Selection } from "./selection";
import { registerShellCommands, type ShellCommand } from "./shellCommands";
import {
  archiveSession,
  archiveSessionWithDescendants,
  closeProject,
  continueSessionInNewSession,
  copySessionPath,
  detachSessionParent,
  reloadSession,
  selectedSessionRef,
  selectedWorkspace,
  startSessionForSelection,
  stopSessionWork,
  toggleSessionPin,
} from "./sessionActions";
import { projectsStore } from "./projectsStore";

/**
 * The shell's own commands: the session, project and view operations a reader
 * reaches for with ⌘K.
 *
 * Each one calls the same operation the menu row beside it calls, and a command
 * that has nothing to act on says why in its own words, so the palette never
 * lists a control that would answer nothing.
 *
 * The keywords are what the filter matches beyond the title: a reader types
 * "kill" and finds Stop, types "archive tree" and finds the descendant archive.
 */
export interface SessionCommandFacts {
  readonly machineId: string;
  readonly selection: Selection;
  readonly pinned: boolean;
  readonly streaming: boolean;
  readonly hasSession: boolean;
  readonly hasProject: boolean;
  readonly hasWorkspace: boolean;
}

export function useSessionCommands(): void {
  const selection = useSelection();
  const board = useBoard();
  const pins = usePins();
  const facts = useMemo(() => commandFacts(selection, board, pins.value), [selection, board, pins.value]);
  const commands = useMemo(() => sessionCommands(facts), [facts]);
  useEffect(() => registerShellCommands(commands), [commands]);
}

/** The live facts the command list reads: what is open, what is running, what is pinned. */
export function commandFacts(selection: Selection, board: BoardSnapshot, pins: MachinePins | undefined): SessionCommandFacts {
  const session = selectedSessionRef();
  const pinnedIds = pinnedSessionSet(pins, selection.projectId);
  const status = session === undefined ? undefined : board.statuses.get(session.id);
  return {
    machineId: selection.machineId,
    selection,
    pinned: session === undefined ? false : pinnedIds.has(session.id),
    streaming: status?.isStreaming === true,
    hasSession: session !== undefined,
    hasProject: selection.projectId !== undefined,
    hasWorkspace: selectedWorkspace() !== undefined,
  };
}

export function sessionCommands(facts: SessionCommandFacts): readonly ShellCommand[] {
  const machineId = facts.machineId;
  const noSession = "No session is open.";
  const sessionRef = () => selectedSessionRef();
  const onSession = (run: (ref: NonNullable<ReturnType<typeof sessionRef>>) => Promise<void>) => () => {
    const ref = sessionRef();
    if (ref === undefined) {
      pushToast({ body: noSession, title: "Session", tone: "warning" });
      return;
    }
    void run(ref).catch((error: unknown) => {
      pushToast({ body: error instanceof Error ? error.message : String(error), title: "Session", tone: "error" });
    });
  };

  return [
    {
      id: "session.new",
      title: "New session",
      group: "Session",
      keywords: ["new", "start", "create", "session", "chat"],
      run: () => {
        void startSessionForSelection().then((refusal) => {
          if (refusal !== undefined) pushToast({ body: refusal, title: "New session", tone: "warning" });
        });
      },
    },
    {
      id: "session.rename",
      title: "Rename session",
      group: "Session",
      keywords: ["rename", "name", "title", "session"],
      disabled: facts.hasSession ? undefined : noSession,
      run: () => { openLayer("rename-session"); },
    },
    {
      id: "session.pin",
      title: facts.pinned ? "Unpin session" : "Pin session",
      group: "Session",
      keywords: ["pin", "unpin", "keep", "session"],
      disabled: facts.hasSession ? undefined : noSession,
      run: onSession(async (ref) => { await toggleSessionPin(ref.id, !facts.pinned, machineId); }),
    },
    {
      id: "session.archive",
      title: "Archive session",
      group: "Session",
      keywords: ["archive", "close", "finish", "session"],
      disabled: facts.hasSession ? undefined : noSession,
      run: onSession(async (ref) => { await archiveSession(ref, machineId); }),
    },
    {
      id: "session.archiveTree",
      title: "Archive session with children",
      group: "Session",
      keywords: ["archive", "tree", "descendants", "children", "session"],
      disabled: facts.hasSession ? undefined : noSession,
      run: onSession(async (ref) => { await archiveSessionWithDescendants(ref, machineId); }),
    },
    {
      id: "session.continue",
      title: "Continue in a new session",
      group: "Session",
      keywords: ["continue", "fork", "branch", "resume", "session"],
      disabled: facts.hasSession ? undefined : noSession,
      run: onSession(async (ref) => { await continueSessionInNewSession(ref, machineId); }),
    },
    {
      id: "session.detach",
      title: "Detach parent",
      group: "Session",
      keywords: ["detach", "parent", "unbind", "session"],
      disabled: facts.hasSession ? undefined : noSession,
      run: onSession(async (ref) => { await detachSessionParent(ref, machineId); }),
    },
    {
      id: "session.reload",
      title: "Reload session",
      group: "Session",
      keywords: ["reload", "refresh", "restart", "session"],
      disabled: facts.hasSession ? undefined : noSession,
      run: onSession(async (ref) => { await reloadSession(ref, machineId); }),
    },
    {
      id: "session.stop",
      title: "Stop the running turn",
      group: "Session",
      keywords: ["stop", "abort", "kill", "interrupt", "session"],
      disabled: facts.streaming ? undefined : "Nothing is running in this session.",
      run: onSession(async (ref) => { await stopSessionWork(ref, machineId); }),
    },
    {
      id: "session.copyPath",
      title: "Copy session path",
      group: "Session",
      keywords: ["copy", "path", "cwd", "folder", "session"],
      disabled: facts.hasSession ? undefined : noSession,
      run: () => {
        const ref = sessionRef();
        if (ref === undefined) {
          pushToast({ body: noSession, title: "Copy path", tone: "warning" });
          return;
        }
        void copySessionPath(ref).then(
          () => { pushToast({ body: ref.cwd, title: "Copied", tone: "success" }); },
          (error: unknown) => { pushToast({ body: error instanceof Error ? error.message : String(error), title: "Copy path", tone: "error" }); },
        );
      },
    },
    {
      id: "project.new",
      title: "Add project",
      group: "Project",
      keywords: ["add", "new", "open", "project", "folder"],
      run: () => { openLayer("new-project"); },
    },
    {
      id: "project.close",
      title: "Close project",
      group: "Project",
      keywords: ["close", "remove", "project"],
      disabled: facts.hasProject ? undefined : "No project is open.",
      run: () => {
        const projectId = facts.selection.projectId;
        if (projectId === undefined) return;
        const project = projectsStore.get().projects.find((entry) => entry.id === projectId);
        if (project === undefined) {
          pushToast({ body: "That project is not in the list any more.", title: "Close project", tone: "warning" });
          return;
        }
        void closeProject(project, machineId).catch((error: unknown) => {
          pushToast({ body: error instanceof Error ? error.message : String(error), title: "Close project", tone: "error" });
        });
      },
    },
    {
      id: "workspace.remove",
      title: "Remove workspace",
      group: "Project",
      keywords: ["remove", "delete", "workspace"],
      disabled: facts.hasWorkspace ? undefined : "No workspace is chosen.",
      run: () => { openLayer("remove-workspace"); },
    },
    {
      id: "view.settings",
      title: "Open settings",
      group: "View",
      keywords: ["settings", "preferences", "theme", "config"],
      run: () => { openLayer("settings"); },
    },
    {
      id: "view.switcher",
      title: "Switch machine, project, or session",
      group: "View",
      keywords: ["switch", "quick", "jump", "machine", "project", "session"],
      run: () => { openLayer("switcher"); },
    },
    {
      id: "view.model",
      title: "Choose the model",
      group: "View",
      keywords: ["model", "provider", "switch model"],
      run: () => { window.dispatchEvent(new CustomEvent("pi-web-open-model-picker")); },
    },
    {
      id: "view.thinking",
      title: "Choose the thinking level",
      group: "View",
      keywords: ["thinking", "effort", "reasoning"],
      run: () => { window.dispatchEvent(new CustomEvent("pi-web-open-thinking-picker")); },
    },
    {
      id: "view.navigation",
      title: facts.selection.workspaceId === undefined ? "Show navigation" : "Toggle navigation",
      group: "View",
      keywords: ["navigation", "rail", "sidebar", "show", "hide"],
      run: () => { togglePanel("navigation"); },
    },
    {
      id: "view.workbench",
      title: "Toggle workbench",
      group: "View",
      keywords: ["workbench", "panel", "show", "hide"],
      run: () => { togglePanel("workspace"); },
    },
    {
      id: "auth.signIn",
      title: "Sign in to this machine",
      group: "Account",
      keywords: ["sign in", "login", "auth", "provider", "token"],
      run: () => { openSignIn(); },
    },
    {
      id: "auth.providers",
      title: "Manage auth providers",
      group: "Account",
      keywords: ["providers", "logout", "sign out", "auth", "account"],
      run: () => { openSignOut(); },
    },
  ];
}
