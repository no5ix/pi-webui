import { css, LitElement, html, unsafeCSS } from "lit";
import type { FinishedTurn } from "../turnRunClock";
import { runDuration } from "../runDuration";
import { renderBranchIcon, renderDownIcon, renderUpIcon, uiIconStyle } from "./uiIcons.js";
import { customElement, property } from "lit/decorators.js";
import type { SessionStatus } from "../api";
import { sessionStatusLine } from "../sessionStatusLine.js";
import { formatTokenCount } from "../../../shared/tokenCount";
import { formatCost } from "../utils/format";

/**
 * The session's numbers, in the line at the bottom of the window.
 *
 * The bar carries the facts a reader checks while they work: tokens in and out, how full the context
 * is, the branch, how long the last task took, what the extensions report, the cost. Every one of them
 * is the answer to a question, and a bar that clips one of them with an ellipsis leaves the reader
 * with a fact they cannot read - `29.3% of 262k` is worth nothing if the `ctx` that says what it means
 * is the part that got cut. So the bar wraps: it grows to as many lines as its content needs, keeps
 * every value whole, and never cuts one to keep the line short. The order is the reading order the
 * owner laid out (2026-10-07) and is preserved on every width.
 */
const statusBarStyles = css`${unsafeCSS(uiIconStyle)}
  :host { display: block; color: var(--pi-muted); font: var(--pi-text-xs) var(--pi-font-mono); line-height: 1.3; }
  :host, :host * { -webkit-user-select: none; user-select: none; }
  .bar { box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: baseline; column-gap: var(--pi-space-6); row-gap: var(--pi-space-1); justify-content: flex-start; min-width: 0; min-height: calc(var(--pi-panel-header-height) * 4 / 9); padding: var(--pi-space-1) var(--pi-chat-gutter); border-top: 1px solid var(--pi-border); background: var(--pi-bg); }
  /* Every value keeps its own words: no ellipsis, no clipping, no shrinking into a fragment. A span
     that does not fit starts a line of its own, and a single token longer than the window - a branch
     name - breaks inside itself rather than pushing the bar out of the page. */
  .bar span { flex: 0 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
  .bar .fixed { flex: 0 0 auto; white-space: nowrap; }
  .muted { color: var(--pi-muted); }
  .statuses { flex: 1 1 12ch; display: inline-flex; flex-wrap: wrap; gap: var(--pi-space-4); }
  .cost { margin-inline-start: auto; }
  .branch { color: var(--pi-muted); }
  .run-time { color: var(--pi-muted); }
  .context.filling { color: var(--pi-warning); }
  .context.full { color: var(--pi-danger); }
  /* The share and the window it is a share of are one reading unit: a bar that breaks "ctx 29.3% of"
     from "262k" leaves the reader with a percentage of nothing (owner, 2026-10-07; measured at 360px
     with a long branch name, 2026-11-13). */
  .context { flex: 0 0 auto; white-space: nowrap; }
  @media (max-width: 30rem) { .bar { column-gap: var(--pi-space-4); } .cost { margin-inline-start: 0; } }
`;

@customElement("status-bar")
export class StatusBar extends LitElement {
  @property({ attribute: false }) status?: SessionStatus;
  /** Why the last read produced nothing, when it failed rather than not happening. */
  @property({ attribute: false }) failure?: string;
  /**
   * The last task that finished on this session, as this device measured it. The bar shows it only
   * when the server has no span of its own to offer: the daemon measures the task from the prompt the
   * reader sent to the last entry, which is the whole task, while a device can only measure what it
   * watched.
   */
  @property({ attribute: false }) lastRun?: FinishedTurn;
  override render() {
    const status = this.status;
    const line = sessionStatusLine({ hasStatus: status !== undefined, failure: this.failure });
    if (line.kind === "unread") return html`<div class="bar muted">${line.text}</div>`;
    if (line.kind === "unavailable") {
      return html`<div class="bar muted"><span title=${this.failure ?? ""}>${line.text}</span></div>`;
    }
    if (status === undefined) return html`<div class="bar muted">${"No session status yet"}</div>`;
    const context = status.contextUsage;
    const contextText = context
      ? context.percent == null
        ? `ctx ? of ${formatTokenCount(context.contextWindow)}`
        : `ctx ${context.percent.toFixed(1)}% of ${formatTokenCount(context.contextWindow)}`
      : "ctx unknown";
    const tokens = status.tokens;
    const statuses = (status.extensionUi?.statuses ?? []).map((entry) => entry.text).filter((text) => text !== "");
    const runTime = runTimeOf(status, this.lastRun);
    return html`
      <div class="bar">
        <span class="fixed">${renderUpIcon()} ${formatTokenCount(tokens.input)} tok</span>
        <span class="fixed">${renderDownIcon()} ${formatTokenCount(tokens.output)} tok</span>
        <span class=${`context fixed ${CONTEXT_FILL_CLASS[contextFill(context?.percent)]}`}>${contextText}</span>        ${status.gitBranch === undefined ? null : html`<span class="branch" title=${`Git branch: ${status.gitBranch}`}>${renderBranchIcon()} ${status.gitBranch}</span>`}
        ${runTime === undefined ? null : html`<span class="run-time fixed" title=${runTimeTitle(runTime)}>${runTimeText(runTime)}</span>`}
        ${statuses.length === 0 ? null : html`<span class="statuses" title=${statuses.join(" ")}>${statuses.map((text) => html`<span>${text}</span>`)}</span>`}
        <span class="cost fixed">${formatCost(status.cost)}</span>
      </div>
    `;
  }

  static override styles = statusBarStyles;
}

/**
 * How full the context window reads, as pi's footer colours it (pi 1.1.0 `footer.js`): amber above
 * 70 %, red above 90 %, and plain when pi cannot tell. The share is pi's own: the conversation's
 * tokens against the current model's window, so it reads over 100 % after a switch to a smaller
 * model until pi compacts before the next send (B24; owner, Q28: follow pi).
 */
type ContextFill = "unknown" | "roomy" | "filling" | "full";

/** The colour suffix a fill adds to the bar's `context` class; the span itself is fixed so the reading unit never splits. */
const CONTEXT_FILL_CLASS: Record<ContextFill, string> = { unknown: "", roomy: "", filling: "filling", full: "full" };

function contextFill(percent: number | null | undefined): ContextFill {
  if (percent == null) return "unknown";
  if (percent > 90) return "full";
  return percent > 70 ? "filling" : "roomy";
}

/**
 * Where the "took" number comes from.
 *
 * The server's span is the task: from the prompt the reader sent (the transcript's newest input
 * boundary, which is what a steer moves forward too) to the newest entry. A device's span is only ever
 * what that browser watched, so it is a fallback for a daemon that does not publish the server's - and
 * it says so, because a page that joined a run partway watched less than the task.
 */
export interface RunTime { readonly source: "server" | "device"; readonly durationMs: number; readonly partial?: boolean }

export function runTimeOf(status: SessionStatus, lastRun: FinishedTurn | undefined): RunTime | undefined {
  const measured = status.lastRunDurationMs;
  if (measured !== undefined && Number.isFinite(measured) && measured >= 0) return { source: "server", durationMs: measured };
  if (lastRun === undefined) return undefined;
  return { source: "device", durationMs: lastRun.durationMs, ...(lastRun.partial ? { partial: true } : {}) };
}

/** What the number is, in the bar's own words: the server's is the task, the device's is the last one it watched. */
function runTimeText(runTime: RunTime): string {
  const span = runDuration(runTime.durationMs);
  // The daemon publishes its span only when the session is not working, queued, compacting, asking or
  // running a background task, so "took" is that task. A device's number is always a finished one, and
  // while a new task runs it is the previous task's - so the bar says "last", and a phone that never
  // sees a tooltip is not left reading a stale number as the current one (2026-11-13).
  return runTime.source === "server" ? `took ${span}` : `last took ${span}`;
}

/** What the span says about itself: a partial watch says so rather than claiming the task. */
function runTimeTitle(runTime: RunTime): string {
  const span = runDuration(runTime.durationMs);
  if (runTime.source === "server") return `The last task on this session ran for ${span}, measured by the server from your prompt to the last entry.`;
  return runTime.partial === true
    ? `This device watched ${span} of the last task on this session; it joined while the task was already running.`
    : `The last task on this session ran for ${span} on this device.`;
}
