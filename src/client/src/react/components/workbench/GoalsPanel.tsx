import "./goals.css";
import { useEffect, useState, type ReactNode } from "react";
import { isRecord } from "../../../../../shared/unknownValues";
import { callPluginBackend, type PluginBackendScope } from "../../state/pluginBackend";
import { createStore, idleRead, readFailed, useStoreSelect, type ReadState } from "../../state/store";
import { Icon } from "../common/icons";
import { registerShellCommands } from "../../state/shellCommands";

/**
 * The Goals tab.
 *
 * Goals are pi's, stored per workspace, and the Goal plugin's server backend is
 * the only reader: `goals.workspace` answers with what pi-goal has recorded for
 * this folder. Planning is the agent's job — `goal_plan` and `goal_todo` are pi
 * tools — so this tab reads: a goal, its TODOs and their recorded status, and the
 * reason the read is unknown when the plugin did not answer.
 */
export interface GoalsPanelProps {
  scope: PluginBackendScope & { readonly workspacePath: string };
}

interface GoalView {
  readonly label: string;
  readonly status: string;
  readonly timestamps: readonly string[];
  readonly todos: readonly TodoView[];
}

interface TodoView {
  readonly label: string;
  readonly status: string;
  readonly evidence: string | undefined;
}

const goalsStore = createStore<ReadState<readonly GoalView[]>>(idleRead);

export function GoalsPanel(props: GoalsPanelProps): ReactNode {
  const read = useStoreSelect(goalsStore, (value) => value);
  const [directory, setDirectory] = useState<string | undefined>(undefined);

  useEffect(() => {
    const scope = props.scope;
    goalsStore.set({ value: undefined, phase: "loading", error: undefined });
    void callPluginBackend("goal", scope, "goals.workspace", { path: scope.workspacePath }).then(
      (answer) => {
        if (isRecord(answer) && answer["state"] === "failed") {
          goalsStore.set(readFailed(new Error(stringOf(answer["error"]) ?? "The goal backend refused the read.")));
          return;
        }
        if (isRecord(answer)) setDirectory(stringOf(answer["directory"]));
        goalsStore.set({ value: goalsOf(answer), phase: "ready", error: undefined });
      },
      (error: unknown) => { goalsStore.set(readFailed(error)); },
    );
  }, [props.scope.machineId, props.scope.projectId, props.scope.workspaceId, props.scope.workspacePath]);

  useEffect(() => {
    const scope = props.scope;
    const unsubscribe = registerShellCommands([
      {
        id: "goals.refresh",
        title: "Refresh goals",
        group: "Goals",
        run: () => {
          void callPluginBackend("goal", scope, "goals.workspace", { path: scope.workspacePath }).then(
            (answer) => { goalsStore.set({ value: goalsOf(answer), phase: "ready", error: undefined }); },
            (error: unknown) => { goalsStore.set(readFailed(error)); },
          );
        },
      },
    ]);
    return unsubscribe;
  }, [props.scope]);

  if (read.phase === "loading") return <p className="piw-empty">Reading this workspace's goals…</p>;
  if (read.phase === "failed") return <p className="piw-empty">{`Goals did not answer: ${read.error ?? "no reason given"}`}</p>;
  const goals = read.value ?? [];
  if (goals.length === 0) {
    return <p className="piw-empty">{`No goal is recorded for ${directory ?? "this workspace"}. A goal is planned with the agent, not from this panel.`}</p>;
  }

  return (
    <div className="piw-goals" data-testid="goals-panel">
      <div className="piw-goals__list">
        {goals.map((goal, index) => (
          <section className="piw-card" key={`${goal.label}-${String(index)}`}>
            <header className="piw-card__header">
              <span className="piw-card__title" dir="auto">{goal.label}</span>
              <span className={`piw-goals__status piw-goals__status--${goal.status}`}>{goal.status}</span>
            </header>
            <div className="piw-card__body">
              {goal.timestamps.length === 0 ? null : <p className="piw-goals__todo-meta">{goal.timestamps.join(" · ")}</p>}
              {goal.todos.length === 0 ? (
                <p className="piw-goals__todo-meta">No TODO recorded.</p>
              ) : (
                <ul className="piw-goals__todos">
                  {goal.todos.map((todo, todoIndex) => (
                    <li className="piw-goals__todo" key={`${goal.label}-todo-${String(todoIndex)}`}>
                      <Icon label="" name={todoMark(todo.status)} size="small" />
                      <span className="piw-goals__todo-text" dir="auto">{todo.label}</span>
                      <span className="piw-goals__todo-meta">{todo.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}
      </div>
      <p className="piw-workbench__message">A goal is planned and its TODOs are marked by the agent's goal tools; this tab reads what pi-goal recorded.</p>
    </div>
  );
}

function goalsOf(answer: unknown): readonly GoalView[] {
  if (!isRecord(answer)) return [];
  const list = answer["goals"] ?? answer["records"] ?? answer["items"];
  if (!Array.isArray(list)) return [];
  return list.map((entry: unknown) => goalViewOf(entry)).filter((goal): goal is GoalView => goal !== undefined);
}

function goalViewOf(entry: unknown): GoalView | undefined {
  if (!isRecord(entry)) return undefined;
  const label = stringOf(entry["title"]) ?? stringOf(entry["name"]) ?? stringOf(entry["goal"]) ?? stringOf(entry["id"]) ?? "goal";
  const status = stringOf(entry["status"]) ?? stringOf(entry["state"]) ?? "unknown";
  const timestamps = ["createdAt", "updatedAt", "startedAt", "completedAt"]
    .map((key) => stringOf(entry[key]))
    .filter((value): value is string => value !== undefined)
    .map((value) => value.slice(0, 16).replace("T", " "));
  const todosRaw = entry["todos"] ?? entry["items"] ?? entry["checklist"];
  const todos: TodoView[] = Array.isArray(todosRaw) ? todosRaw.map(todoViewOf).filter((todo): todo is TodoView => todo !== undefined) : [];
  return { label, status, timestamps, todos };
}

function todoViewOf(entry: unknown): TodoView | undefined {
  if (!isRecord(entry)) return undefined;
  const label = stringOf(entry["text"]) ?? stringOf(entry["title"]) ?? stringOf(entry["label"]) ?? stringOf(entry["id"]) ?? "todo";
  const status = stringOf(entry["status"]) ?? stringOf(entry["state"]) ?? "pending";
  const evidence = stringOf(entry["evidence"]);
  return { label, status, evidence };
}

function todoMark(status: string): "check" | "play" | "clock" | "circleDot" {
  if (status === "done" || status === "completed") return "check";
  if (status === "running" || status === "in-progress") return "play";
  if (status === "blocked") return "circleDot";
  return "clock";
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
