import { useState } from "react";
import type { PiSkillInfo, PiSkillSetEnabledResponse, PiSkillsResponse } from "../../api";
import {
  piSkillBusyMessage,
  piSkillDiagnosticsLines,
  piSkillDirectoryLines,
  piSkillDuplicateNameNote,
  piSkillDuplicateNames,
  piSkillGlobalEmptyNote,
  piSkillGlobalRows,
  piSkillMutationMessage,
  piSkillNoProjectNote,
  piSkillNotLoadedNote,
  piSkillOriginLabel,
  piSkillOwnerPackageNote,
  piSkillPreferenceLabel,
  piSkillProjectEmptyNote,
  piSkillProjectRows,
  piSkillPromotedNote,
  piSkillRowBlockedByPackage,
  piSkillRowTestId,
  piSkillScopeNote,
  piSkillSetEnabledRequest,
  piSkillShadowedNote,
  piSkillStatus,
  piSkillUnreadableLines,
  piSkillValidationNote,
} from "./piSkillsSettingsState";
import { NoticeList, SettingsButton, SettingsCard, SettingsEmpty, SettingsNotice, SettingsProjectSelect, SettingsSection, SettingsToggle, type SettingsProjectScope } from "./SettingsKit";

export interface SkillsSettingsPanelProps {
  readonly skills?: PiSkillsResponse | undefined;
  readonly busy: boolean;
  readonly projectScope: SettingsProjectScope;
  readonly projectName: string;
  readonly machineLabel: string;
  readonly notice?: string | undefined;
  readonly error?: string | undefined;
  readonly busyMessage?: string | undefined;
  readonly onReload: () => void;
  readonly setEnabled: (skill: PiSkillInfo, enabled: boolean) => Promise<PiSkillSetEnabledResponse>;
}

/**
 * The Skills page: the skills pi's discovery answers with, at both scopes.
 *
 * A skill's scope is the directory that produced it. A skill discovered under a project's `.pi/skills`
 * belongs to that project, and one discovered in the user's skills directory belongs to the machine and
 * is available everywhere; a package's and an extension's skills belong to the code that shipped them
 * and answer to that code's own settings, not to this page. So the page lists them in sections that
 * name the scope, and writes a preference only where pi keeps one.
 *
 * The page is answered for one machine and one project, and that project is chosen here — it is not the
 * session in the middle column, because a skill's scope is a directory on disk. Enabling and disabling
 * is a preference, never a move: the file stays, and pi reads the preference when it discovers.
 *
 * The row states and scope rules live in ./piSkillsSettingsState; this component only renders answers.
 */
export function SkillsSettingsPanel(props: SkillsSettingsPanelProps) {
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const skills = props.skills?.skills ?? [];
  const globalRows = piSkillGlobalRows(skills);
  const projectRows = piSkillProjectRows(skills);
  const duplicates = piSkillDuplicateNames(skills);
  const diagnostics = props.skills === undefined ? [] : piSkillDiagnosticsLines(props.skills.diagnostics);
  const unreadable = props.skills === undefined ? [] : piSkillUnreadableLines(props.skills.unreadablePaths ?? []);
  const directories = props.skills === undefined ? [] : piSkillDirectoryLines(props.skills.scopes);
  const busyLine = piSkillBusyMessage(busy);
  const locked = props.busy || busyLine !== undefined;

  const setEnabled = async (skill: PiSkillInfo, enabled: boolean) => {
    setBusy({ [skill.id]: `${enabled ? "Enabling" : "Disabling"} ${skill.name}` });
    setNotice(undefined);
    setError(undefined);
    try {
      setNotice(piSkillMutationMessage(await props.setEnabled(skill, enabled), enabled));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy({});
    }
  };

  const card = (skill: PiSkillInfo) => {
    const status = piSkillStatus(skill);
    const writeBlocked = piSkillRowBlockedByPackage(skill);
    const meta = [
      skill.description,
      `source: ${piSkillOriginLabel(skill.origin)}`,
      skill.source === undefined ? undefined : `pi source: ${skill.source}`,
      `scope: ${skill.scope}`,
      `file: ${skill.filePath}`,
      `directory: ${skill.baseDir}`,
      piSkillOwnerPackageNote(skill),
      piSkillPreferenceLabel(skill),
    ].filter((entry): entry is string => entry !== undefined);
    const diagnostics = [
      piSkillValidationNote(skill),
      piSkillShadowedNote(skill),
      piSkillPromotedNote(skill),
      piSkillDuplicateNameNote(skill, duplicates),
    ].filter((entry): entry is string => entry !== undefined);
    return <SettingsCard
      key={piSkillRowTestId(skill)}
      testId={piSkillRowTestId(skill)}
      title={skill.name}
      meta={meta}
      diagnostics={diagnostics}
      status={status.label}
      statusTone={status.off ? "off" : "on"}
      off={status.off}
      actions={<SettingsToggle
        label={status.label}
        checked={skill.enabled}
        disabled={locked || writeBlocked}
        pending={busy[skill.id] !== undefined}
        title={writeBlocked ? `${skill.name} is ${piSkillOwnerPackageNote(skill) ?? "managed by the package that owns it"}: enable it in the package settings, not in the skill settings` : skill.enabled ? "Disable this skill" : "Enable this skill"}
        onChange={enabled => void setEnabled(skill, enabled)}
      />}
    />;
  };

  return <>
    <SettingsSection
      actions={<SettingsButton disabled={locked} label="Reload" onClick={props.onReload} />}
      note={`${props.machineLabel} · ${props.projectScope.projectId === undefined ? "no project: global skills only" : `project ${props.projectName}`}`}

      title="Skills"
    >
      <SettingsNotice tone="security">Skills are instructions pi is told to follow, and a skill can tell pi to run commands and edit files. Enabling a skill makes it available to every session that opens this project, so enable only skills whose instructions you have read.</SettingsNotice>
      <p className="rw-settings-help">A project skill is discovered under this project's .pi/skills and belongs to this project. A global skill is discovered under the machine's skills directory and is available to every project on it. Enabling or disabling writes a preference and never moves a file; a skill shipped by a package or an extension answers to that package's own settings, so this page cannot turn it. A running session keeps the skills it read when it started — use /reload in a running session to pick up a change.</p>
      {directories.map(line => <p className="rw-settings-help" key={line}>{line}</p>)}
      <NoticeList busy={busyLine ?? props.busyMessage} notice={[notice, props.notice]} error={[error, props.error, ...diagnostics, ...unreadable]} />
    </SettingsSection>
    <SettingsProjectSelect
      scope={props.projectScope}
      label="Skills project"
      note={props.projectScope.projectId === undefined ? "No project selected: only the global skills on this machine are listed, and no project skills are loaded." : undefined}
    />
    <SettingsSection
      note={piSkillScopeNote("project", projectRows.length, props.projectName, props.machineLabel)}
      title="Project skills"
    >
      {projectRows.map(card)}
      {projectRows.length === 0 ? <SettingsEmpty>{props.skills === undefined ? piSkillNotLoadedNote() : props.projectScope.projectId === undefined ? piSkillNoProjectNote() : piSkillProjectEmptyNote()}</SettingsEmpty> : null}
    </SettingsSection>
    <SettingsSection
      note={piSkillScopeNote("global", globalRows.length, props.projectName, props.machineLabel)}
      title="Global skills"
    >
      {globalRows.map(card)}
      {globalRows.length === 0 ? <SettingsEmpty>{props.skills === undefined ? piSkillNotLoadedNote() : piSkillGlobalEmptyNote(props.projectScope.projectId === undefined ? undefined : props.projectName)}</SettingsEmpty> : null}
    </SettingsSection>
  </>;
}
