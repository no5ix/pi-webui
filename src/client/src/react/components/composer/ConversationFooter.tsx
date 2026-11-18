import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionStatus } from "../../../../../shared/apiTypes";
import { useComposer, readModelSelection, pickModel, pickThinkingLevel, toggleModelEnabled } from "../../state/composerStore";
import { Icon } from "../common/icons";
import { ContextMenu } from "../common/ContextMenu";
import { Dialog } from "../common/Dialog";
import "./composer.css";

/**
 * The bar under the composer.
 *
 * Every value on it is the session's own: the model and thinking level the
 * status carries, the context the machine reports using, the branch it is on.
 * A control that has no answer says so rather than showing a dash.
 */
export interface ConversationFooterProps {
  machineId: string;
  sessionId: string | undefined;
  cwd: string | undefined;
  projectName: string | undefined;
  status: SessionStatus | undefined;
}

export function ConversationFooter(props: ConversationFooterProps): ReactNode {
  const composer = useComposer();
  const [modelOpen, setModelOpen] = useState(false);
  const [thinkingAnchor, setThinkingAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const status = props.status;
  const session = props.sessionId === undefined || props.cwd === undefined ? undefined : { id: props.sessionId, cwd: props.cwd };

  useEffect(() => {
    if (session === undefined) return;
    void readModelSelection(session, props.machineId);
  }, [props.machineId, session?.id, session?.cwd]);

  useEffect(() => {
    const openModels = (): void => { setModelOpen(true); };
    window.addEventListener("pi-web-open-model-picker", openModels);
    return () => { window.removeEventListener("pi-web-open-model-picker", openModels); };
  }, []);

  const modelLabel = status?.model === undefined ? "model unknown" : modelText(status.model);
  const thinking = status?.thinkingLevel;
  const usage = status?.contextUsage;

  const catalog = composer.catalog.value ?? [];
  const filtered = useMemo(
    () => (query === "" ? catalog : catalog.filter((entry) => `${entry.provider}/${entry.id}`.toLowerCase().includes(query.toLowerCase()))),
    [catalog, query],
  );

  return (
    <div className="piw-footer" data-testid="conversation-footer">
      {props.projectName === undefined ? null : (
        <span className="piw-chip">
          <Icon label="" name="folder" size="small" />
          {props.projectName}
        </span>
      )}
      <button className="piw-chip" onClick={() => { setModelOpen(true); }} type="button">
        <Icon label="" name="sparkles" size="small" />
        <span className="piw-footer__model">{modelLabel}</span>
      </button>
      <button
        className="piw-chip"
        onClick={(event) => { setThinkingAnchor(event.currentTarget); }}
        type="button"
      >
        <Icon label="" name="sliders" size="small" />
        <span>{thinking ?? "thinking unknown"}</span>
      </button>
      <span className="piw-footer__spacer" />
      {status?.gitBranch === undefined ? null : (
        <span className="piw-chip">
          <Icon label="" name="gitBranch" size="small" />
          {status.gitBranch}
        </span>
      )}
      <ContextMeter usage={usage} />

      <Dialog onClose={() => { setModelOpen(false); }} open={modelOpen} size="wide" title="Choose the model">
        <label className="piw-field">
          <span className="piw-label">Search models</span>
          <input className="piw-input" onChange={(event) => { setQuery(event.target.value); }} placeholder="provider/model" type="search" value={query} />
        </label>
        {composer.catalog.phase === "loading" ? <p className="piw-empty">Reading the model catalogue…</p> : null}
        {composer.catalog.phase === "failed" ? <p className="piw-empty">The model catalogue did not answer: {composer.catalog.error ?? "no reason given"}</p> : null}
        {composer.catalog.phase === "ready" && filtered.length === 0 ? <p className="piw-empty">No model matches “{query}”.</p> : null}
        <ul className="piw-footer__list">
          {filtered.map((entry) => {
            const model = status?.model;
            const active = model?.provider === entry.provider && model.id === entry.id;
            return (
              <li key={`${entry.provider}/${entry.id}`}>
                <div className={active ? "piw-row piw-row--selected" : "piw-row"}>
                  <button
                    className="piw-footer__pick"
                    disabled={session === undefined}
                    onClick={() => {
                      if (session === undefined) return;
                      void pickModel(session, entry.provider, entry.id, props.machineId).then(() => { setModelOpen(false); });
                    }}
                    type="button"
                  >
                    <span className="piw-row__title piw-mono">{`${entry.provider}/${entry.id}`}</span>
                    {entry.contextWindow === undefined ? null : <span className="piw-row__meta">{`${String(entry.contextWindow)} ctx`}</span>}
                  </button>
                  <button
                    className="piw-footer__toggle"
                    disabled={session === undefined}
                    onClick={() => {
                      if (session === undefined) return;
                      void toggleModelEnabled(session, entry.provider, entry.id, !entry.enabled, props.machineId);
                    }}
                    type="button"
                  >
                    {entry.enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </Dialog>

      <ContextMenu
        anchor={thinkingAnchor}
        items={(composer.levels.value ?? []).map((level) => ({
          label: level === thinking ? `${level} (current)` : level,
          onSelect: () => {
            if (session === undefined) return;
            void pickThinkingLevel(session, level, props.machineId).catch(() => undefined);
          },
        }))}
        onClose={() => { setThinkingAnchor(null); }}
        open={thinkingAnchor !== null}
      />
    </div>
  );
}

function ContextMeter({ usage }: { usage: SessionStatus["contextUsage"] }): ReactNode {
  if (usage === undefined) {
    return (
      <span className="piw-chip" title="The session has not reported its context usage">
        context unknown
      </span>
    );
  }
  if (usage.percent === null || usage.tokens === null) {
    return (
      <span className="piw-chip" title="The session reports a context window but has not counted it yet">
        {`${String(usage.contextWindow)} ctx`}
      </span>
    );
  }
  const percent = Math.min(Math.max(Math.round(usage.percent), 0), 100);
  return (
    <span className="piw-meter" title={`${String(usage.tokens)} of ${String(usage.contextWindow)} tokens`}>
      <span aria-hidden="true" className="piw-meter__track">
        <span className="piw-meter__fill" style={{ width: `${String(percent)}%` }} />
      </span>
      <span>{`${String(percent)}%`}</span>
    </span>
  );
}

function modelText(model: NonNullable<SessionStatus["model"]>): string {
  const id = model.id ?? model.name ?? "";
  if (model.provider === undefined || model.provider === "") return id === "" ? "model unknown" : id;
  return `${model.provider}/${id}`;
}

