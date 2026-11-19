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
  /**
   * The session this browser has a prompt upload in flight for. It lives in the
   * store, not the composer component, because the shell's other surfaces - the
   * footer, a plugin's runtime context - have to answer the same question.
   */
  readonly sendingSessionId: string | undefined;
}

const empty: ComposerState = { models: idleRead, catalog: idleRead, levels: idleRead, sendingSessionId: undefined };

export const composerStore = createStore<ComposerState>(empty);

export function useComposer(): ComposerState {
  return useStoreSelect(composerStore, (value) => value);
}


/**
 * The hosted prompt editor, reached through the shell rather than through a
 * component tree: a plugin's `insertText`, the palette's prompt actions, and the
 * focus the shell is asked to give all need the live editor, and none of them
 * owns it.
 */
export interface PromptEditorHandle {
  insertText: (text: string) => void;
  getText: () => string;
  getSelection: () => { start: number; end: number; text: string } | null;
  focus: () => void;
  submit: () => Promise<unknown>;
}

let promptEditor: PromptEditorHandle | undefined;

export function setPromptEditorHandle(handle: PromptEditorHandle | undefined): void {
  promptEditor = handle;
}

/** Put text in the composer, the way a plugin card offers a reply without sending it. */
export function insertComposerText(text: string): void {
  const handle = promptEditorHandle();
  if (handle === undefined) return;
  handle.insertText(text);
}

/** Send what the composer holds, as the Send control does. */
export function submitComposerDraft(): Promise<unknown> {
  const handle = promptEditorHandle();
  if (handle === undefined) return Promise.resolve("no-composer");
  return handle.submit();
}

/**
 * The handle for the hosted prompt editor, built with property reads and calls
 * (no cast): the element owns the draft, the caret and the outbox, and React only
 * asks it to write, focus, and send.
 */
export function composerHandleFor(element: HTMLElement): PromptEditorHandle {
  const readDraft = (): string => {
    const draft: unknown = Reflect.get(element, "draft");
    return typeof draft === "string" ? draft : "";
  };
  return {
    insertText: (text: string) => {
      const current = readDraft();
      Reflect.set(element, "draft", current === "" ? text : `${current} ${text}`);
    },
    getText: readDraft,
    getSelection: () => null,
    focus: () => { call(element, "focusInput"); },
    submit: () => {
      const submitPrompt: unknown = Reflect.get(element, "submitPrompt");
      if (typeof submitPrompt !== "function") return Promise.resolve("no-composer");
      const outcome: unknown = submitPrompt.call(element);
      return Promise.resolve(outcome);
    },
  };
}

function call(element: HTMLElement, name: string): void {
  const method: unknown = Reflect.get(element, name);
  if (typeof method === "function") method.call(element);
}

export function promptEditorHandle(): PromptEditorHandle | undefined {
  return promptEditor;
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
    ...current,
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
