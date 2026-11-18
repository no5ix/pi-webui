import { sessionsApi } from "../../api";
import type { DeferredImageRef, SessionModel, SessionModelCatalogEntry, SessionRef, SessionStatus } from "../../../../shared/apiTypes";
import type { ChatLine } from "../../components/shared";
import type { PromptHistoryEntry } from "../../promptHistory";
import { sentPromptOf } from "../../resendMessage";
import { createStore, idleRead, readFailed, useStoreSelect, type ReadState } from "./store";
import { streamRuntime } from "./sessionStream";

/**
 * What the composer's controls read.
 *
 * The models the session offers, the model catalogue with its enabled flags, and
 * the thinking levels the runtime accepts are session reads, not browser state:
 * each is a `ReadState` so an unanswered read says it is unanswered. A model or
 * thinking change answers with the session's new status, and that status is
 * published to the stream store the footer reads.
 */
export interface ComposerState {
  readonly models: ReadState<readonly SessionModel[]>;
  readonly catalog: ReadState<readonly SessionModelCatalogEntry[]>;
  readonly levels: ReadState<readonly string[]>;
}

const empty: ComposerState = { models: idleRead, catalog: idleRead, levels: idleRead };

export const composerStore = createStore<ComposerState>(empty);

export function useComposer(): ComposerState {
  return useStoreSelect(composerStore, (value) => value);
}

const reading = new Map<string, Promise<void>>();

/**
 * The model, catalog, and thinking-level reads are scoped to a session's working
 * directory. A subject whose cwd has not resolved yet must not ask for them: the
 * API rejects an empty cwd, and a request that cannot be answered must not fire.
 */
export function readModelSelection(session: SessionRef, machineId: string): Promise<void> {
  if (session.cwd === "") return Promise.resolve();
  const key = `${machineId}|${session.id}|${session.cwd}`;
  const existing = reading.get(key);
  if (existing !== undefined) return existing;
  composerStore.update((current) => ({
    models: { ...current.models, phase: current.models.value === undefined ? "loading" : current.models.phase },
    catalog: { ...current.catalog, phase: current.catalog.value === undefined ? "loading" : current.catalog.phase },
    levels: { ...current.levels, phase: current.levels.value === undefined ? "loading" : current.levels.phase },
  }));
  const run = Promise.all([
    sessionsApi.models(session, machineId).then(
      (answer) => { composerStore.update((current) => ({ ...current, models: { value: answer.models, phase: "ready", error: undefined } })); },
      (error: unknown) => { composerStore.update((current) => ({ ...current, models: readFailed(error) })); },
    ),
    sessionsApi.modelCatalog(session, machineId).then(
      (answer) => { composerStore.update((current) => ({ ...current, catalog: { value: answer.models, phase: "ready", error: undefined } })); },
      (error: unknown) => { composerStore.update((current) => ({ ...current, catalog: readFailed(error) })); },
    ),
    sessionsApi.thinkingLevels(session, machineId).then(
      (answer) => { composerStore.update((current) => ({ ...current, levels: { value: answer.levels, phase: "ready", error: undefined } })); },
      (error: unknown) => { composerStore.update((current) => ({ ...current, levels: readFailed(error) })); },
    ),
  ]).then(() => undefined);
  reading.set(key, run);
  void run.finally(() => {
    if (reading.get(key) === run) reading.delete(key);
  });
  return run;
}

export async function pickModel(session: SessionRef, provider: string, modelId: string, machineId: string): Promise<SessionStatus> {
  const status = await sessionsApi.setModel(session, provider, modelId, machineId);
  streamRuntime.applyStatus(status);
  return status;
}

export async function toggleModelEnabled(session: SessionRef, provider: string, modelId: string, enabled: boolean, machineId: string): Promise<void> {
  const answer = await sessionsApi.setModelEnabled(session, provider, modelId, enabled, machineId);
  composerStore.update((current) => ({ ...current, catalog: { value: answer.models, phase: "ready", error: undefined } }));
}

export async function pickThinkingLevel(session: SessionRef, level: string, machineId: string): Promise<SessionStatus> {
  const status = await sessionsApi.setThinkingLevel(session, level, machineId);
  streamRuntime.applyStatus(status);
  return status;
}

const promptHistoryLimit = 50;

/** This session's own sent prompts, newest first, as the composer's history control wants them. */
export function sessionPromptsOf(messages: readonly ChatLine[], imagePathFor: (ref: DeferredImageRef) => string | undefined): PromptHistoryEntry[] {
  const prompts: PromptHistoryEntry[] = [];
  const seen = new Set<string>();
  for (let index = messages.length - 1; index >= 0 && prompts.length < promptHistoryLimit; index -= 1) {
    const line = messages[index];
    if (line?.role !== "user" || line.meta?.echo === true) continue;
    const text = textOf(line);
    const images = sentPromptOf(line, imagePathFor)?.images ?? [];
    if (images.length > 0) {
      prompts.push({ text, attachments: { kept: "transcript", images } });
      continue;
    }
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    prompts.push({ text });
  }
  return prompts;
}

function textOf(line: ChatLine): string {
  for (const part of line.parts) {
    if (part.type === "text") return part.text.trim();
  }
  return "";
}
