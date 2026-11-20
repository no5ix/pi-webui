import { useState } from "react";
import type { PiPackageInfo, PiPackageMutationResponse, PiPackageScope, PiPackagesResponse, PiPackageSetEnabledRequest } from "../../api";
import {
  piPackageBusyMessage,
  piPackageCanUpdate,
  piPackageCanUpdateAll,
  piPackageEmptyNote,
  piPackageEnabledMessage,
  piPackageFilteredNote,
  piPackageGlobalRows,
  piPackageInstallMessage,
  piPackageInstallPath,
  piPackageInstallTargetLabel,
  piPackageListsEmpty,
  piPackageNotLoadedNote,
  piPackageGlobalEmptyStateNote,
  piPackageProjectRows,
  piPackageRemoveMessage,
  piPackageRemoveQuestion,
  piPackageRemoveRequest,
  piPackageRowKey,
  piPackageRowPending,
  piPackageRowTestId,
  piPackageScopeCounts,
  piPackageScopeLabel,
  piPackageScopeNote,
  piPackageSetEnabledRequest,
  piPackageStatus,
  piPackageUpdateAllMessage,
  piPackageUpdateDisabledReason,
  piPackageUpdateMessage,
  piPackageUpdateRequest,
} from "./piPackageSettingsState";
import { NoticeList, SettingsButton, SettingsCard, SettingsConfirmAction, SettingsEmpty, SettingsNotice, SettingsSection, SettingsToggle } from "./SettingsKit";

export interface PackagesSettingsPanelProps {
  readonly packages?: PiPackagesResponse | undefined;
  readonly busy: boolean;
  readonly machineLabel: string;
  readonly projectName: string;
  readonly notice?: string | undefined;
  readonly error?: string | undefined;
  readonly busyMessage?: string | undefined;
  readonly onReload: () => void;
  readonly install: (source: string) => Promise<PiPackageMutationResponse>;
  readonly update: (source: string | undefined) => Promise<PiPackageMutationResponse>;
  readonly remove: (source: string, scope: PiPackageScope) => Promise<PiPackageMutationResponse>;
  readonly setEnabled: (request: PiPackageSetEnabledRequest) => Promise<PiPackageMutationResponse>;
}

/**
 * The Pi Packages page: the packages pi's own settings answer with, and the operations its CLI runs.
 *
 * A package's scope is where it is installed. A global package is installed under the machine's Pi
 * directory and is loaded by every project on it; a project package is installed in the selected
 * project's settings and belongs to that project. The page lists the two scopes apart because an
 * operation on one does not touch the other, and a name that exists in both is two entries.
 *
 * Every operation is pi's own package management on the selected machine — install, update, remove, and
 * the enabled preference — and pi answers with the whole list it read, so the page replaces the list and
 * names the machine that answered. A package a running session has already loaded is not changed by
 * this page: only /reload in that session picks up an install, an update, a removal, or a preference.
 *
 * One operation runs at a time for the whole page, and each row says what it is doing: a second install
 * started while the first is running would be answered by a list that is being replaced. The scope and
 * operation rules live in ./piPackageSettingsState; this component only renders answers.
 */
export function PackagesSettingsPanel(props: PackagesSettingsPanelProps) {
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [source, setSource] = useState("");
  const globalRows = piPackageGlobalRows(props.packages);
  const projectRows = piPackageProjectRows(props.packages);
  const counts = piPackageScopeCounts(props.packages);
  const busyLine = piPackageBusyMessage(busy);
  const locked = props.busy || busyLine !== undefined;

  const run = async (key: string, label: string, request: () => Promise<PiPackageMutationResponse>, message: (response: PiPackageMutationResponse) => string) => {
    setBusy({ [key]: label });
    setNotice(undefined);
    setError(undefined);
    try {
      setNotice(message(await request()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy({});
    }
  };

  const install = () => {
    const trimmed = source.trim();
    if (trimmed.length === 0) {
      setError("Enter a package source, for example npm:opencode-formatters.");
      return;
    }
    void run("install", `Installing ${trimmed}`, () => props.install(trimmed), piPackageInstallMessage);
    setSource("");
  };

  const card = (pkg: PiPackageInfo) => {
    const key = piPackageRowKey(pkg.scope, pkg.source);
    const pending = piPackageRowPending(busy, pkg);
    const status = piPackageStatus(pkg);
    const canUpdate = piPackageCanUpdate(pkg.scope);
    const installPath = piPackageInstallPath(pkg);
    const meta = [
      `scope: ${piPackageScopeLabel(pkg.scope)}`,
      installPath === undefined ? undefined : `installed: ${installPath}`,
    ].filter((entry): entry is string => entry !== undefined);
    const diagnostics = [piPackageFilteredNote(pkg)].filter((entry): entry is string => entry !== undefined);
    return <SettingsCard
      key={key}
      testId={piPackageRowTestId(pkg)}
      title={pkg.source}
      meta={meta}
      diagnostics={diagnostics}
      status={status.label}
      statusTone={status.off ? "off" : "on"}
      off={status.off}
      actions={<>
        <SettingsToggle
          label={status.label}
          checked={pkg.enabled}
          disabled={locked}
          pending={pending}
          title={pkg.enabled ? "Disable this package for future sessions" : "Enable this package for future sessions"}
          onChange={enabled => void run(
            key,
            `${enabled ? "Enabling" : "Disabling"} ${pkg.source}`,
            () => props.setEnabled(piPackageSetEnabledRequest(pkg.source, pkg.scope, enabled)),
            piPackageEnabledMessage,
          )}
        />
        <SettingsButton
          disabled={locked || !canUpdate}
          label="Update"
          pending={pending}
          title={canUpdate ? `Update ${pkg.source} on ${props.machineLabel}` : piPackageUpdateDisabledReason(pkg.scope)}
          onClick={() => void run(
            key,
            `Updating ${pkg.source}`,
            () => props.update(piPackageUpdateRequest(pkg).source),
            piPackageUpdateMessage,
          )}
        />
        <SettingsConfirmAction
          confirmLabel="Remove package"
          disabled={locked}
          label="Remove"
          pending={pending}
          question={piPackageRemoveQuestion(pkg)}
          title={`Remove ${pkg.source} from ${piPackageScopeLabel(pkg.scope)}`}
          onConfirm={() => void run(
            key,
            `Removing ${pkg.source}`,
            () => {
              const removal = piPackageRemoveRequest(pkg.source, pkg.scope);
              return props.remove(removal.source, removal.scope ?? pkg.scope);
            },
            piPackageRemoveMessage,
          )}
        />
      </>}
    />;
  };

  return <>
    <SettingsSection
      actions={<>
        <SettingsButton
          disabled={!piPackageCanUpdateAll(props.packages) || locked}
          label="Update All"
          title="Update every installed package pi can update"
          onClick={() => void run("update-all", "Updating all packages", () => props.update(undefined), piPackageUpdateAllMessage)}
        />
        <SettingsButton disabled={locked} label="Reload" onClick={props.onReload} />
      </>}
      note={`${props.machineLabel} · ${counts.global} global · ${counts.project} project`}
      title="Pi Packages"
    >
      <SettingsNotice tone="security">Packages are code pi loads: extensions, skills, prompts and themes from npm, git or a path on disk. Installing a package, or enabling one that is installed, gives that code the ability to run on the machine pi runs on and to change what a session can do. Install only packages you trust.</SettingsNotice>
      <p className="rw-settings-help">Install, update, remove, enable and disable are pi's own package operations, run on the machine pi runs on. A package a running session has already loaded is not changed by this page: use /reload in a running session to pick up an install, an update, a removal, or an enable.</p>
      <NoticeList busy={busyLine ?? props.busyMessage} notice={[notice, props.notice]} error={[error, props.error]} />
      <form className="rw-settings-inline-form" onSubmit={event => { event.preventDefault(); install(); }}>
        <input aria-label="Package source" disabled={locked} onChange={event => setSource(event.currentTarget.value)} placeholder="npm:opencode-formatters" type="text" value={source} />
        <SettingsButton disabled={locked} label="Install" tone="primary" type="submit" />
        <SettingsButton disabled={locked} label="Clear" onClick={() => { setSource(""); setError(undefined); setNotice(undefined); }} />
      </form>
      <p className="rw-settings-help">{piPackageInstallTargetLabel(props.machineLabel)}</p>
    </SettingsSection>
    <SettingsSection
      note={piPackageScopeNote("project", projectRows.length, props.projectName, props.machineLabel)}
      title="Project packages"
    >
      {projectRows.map(card)}
      {projectRows.length === 0 ? <SettingsEmpty>{props.packages === undefined ? piPackageNotLoadedNote() : piPackageEmptyNote("project", props.projectName)}</SettingsEmpty> : null}
    </SettingsSection>
    <SettingsSection
      note={piPackageScopeNote("user", globalRows.length, props.projectName, props.machineLabel)}
      title="Global packages"
    >
      {globalRows.map(card)}
      {globalRows.length === 0 ? <SettingsEmpty>{piPackageGlobalEmptyStateNote(props.packages, props.projectName)}</SettingsEmpty> : null}
    </SettingsSection>
  </>;
}
