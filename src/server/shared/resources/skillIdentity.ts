import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, posix, win32, type PlatformPath } from "node:path";

/**
 * The identity of one discovered skill, and the reason PI WEB cannot use a skill name for one.
 *
 * A skill's `name` is front matter: two skills in different places can carry it, and Pi's own loader
 * proves they collide (it keeps one and reports the other as a `collision` diagnostic). A preference
 * written against a name therefore belongs to no particular skill: turning off a machine-wide skill
 * speaks for the project's own skill of the same spelling, and the panel cannot show both.
 *
 * Pi 1.5 offers no stable identifier to build on. Its `Skill` carries `name`, `description`,
 * `filePath`, `baseDir`, `sourceInfo` and `disableModelInvocation` and no id, and the one helper that
 * canonicalizes a resource path (`getResourcePathKey`) is not in the package's export map, so it is
 * not a supported import. This module is therefore the identity: a versioned, opaque key over the
 * canonical resource path, plus the scope that path falls in.
 *
 * Two rules keep that key usable across the two processes that read skills:
 *
 * - It never reads `sourceInfo.source` or `sourceInfo.scope`. Those labels come from how a caller
 *   asked Pi to read the folder, and they differ between a session and a panel read for the same file.
 *   A key built on such a label gives one file two identities in the two places, and the panel and the
 *   session would disagree by construction. The key is a pure function of the skill file and, for a
 *   project-owned skill, the project root.
 * - The display name never enters it. A name is a label the reader sees; identity is which skill a
 *   preference is about. Keeping them apart is the whole point.
 */

/** Which scope a skill file falls in. Pi's own two skill folders, plus everything machine-wide. */
export type SkillResourceScope = "global" | "project";

export interface SkillIdentity {
  /** The opaque, versioned key a preference is written against. Stable across repeated discovery. */
  readonly id: string;
  readonly scope: SkillResourceScope;
  /** The canonical key of the skill file, kept beside the id so a reader can trace a decision. */
  readonly resourceKey: string;
  /** Project scope only: the canonical key of the project that owns the skill. */
  readonly projectKey?: string;
}

export interface SkillIdentityContext {
  /** The project root, when the read is for a project. Nothing can be project-owned without one. */
  projectPath?: string;
}

const IDENTITY_VERSION = "sk1";
const IDENTITY_DIGEST_LENGTH = 20;

/**
 * The identity of the skill at `filePath`, read the way the running session would name it.
 *
 * `projectPath` decides both the scope and, for a project-owned skill, the project that the identity
 * belongs to, so two projects never share an identity for a same-named skill of their own. With no
 * project, nothing can be project-owned and every skill is a machine-wide one.
 */
export function skillIdentity(filePath: string, context: SkillIdentityContext): SkillIdentity {
  const resourceKey = canonicalPathKey(filePath);
  const projectKey = context.projectPath === undefined ? undefined : canonicalPathKey(context.projectPath);
  const scope = projectKey === undefined
    ? "global"
    : isPathWithinKey(projectKey, resourceKey) ? "project" : "global";
  if (scope === "project" && projectKey !== undefined) {
    return {
      id: identityId("p", `${projectKey}\u0000${resourceKey}`),
      scope,
      resourceKey,
      projectKey,
    };
  }
  return { id: identityId("g", resourceKey), scope: "global", resourceKey };
}

/** The key a cache entry is stored under, spelled the way identities are, so two spellings share it. */
export function skillScopeCacheKey(agentDir: string, projectPath: string): string {
  return `${canonicalPathKey(agentDir)}\u0000${canonicalPathKey(projectPath)}`;
}

/**
 * The canonical key of a path: symlinks resolved, absolute, case-folded where the filesystem is.
 *
 * Pi's loader dedupes skills by exactly this kind of key, so a skill reached through a symlink is one
 * skill here and one skill there. Case is folded on the case-insensitive platforms: macOS APFS is
 * case-insensitive and case-preserving, and `realpathSync` keeps the caller's spelling, so a configured
 * path written `/Users/Lynx/skills` beside the same folder reached as `/Users/lynx/skills` would
 * otherwise be two skills with two identities and two switches. A path that cannot be resolved (a file
 * Pi was told about and never wrote) keeps its given spelling, which is the only answer available, and
 * stays deterministic.
 */
export function canonicalPathKey(path: string): string {
  const pathApi = platformPathApi();
  const resolved = pathApi.resolve(tryRealpath(path));
  return caseInsensitivePlatform() ? resolved.toLowerCase() : resolved;
}

/** The platforms whose default filesystems do not distinguish case, so a path spelling is not an identity. */
function caseInsensitivePlatform(): boolean {
  return process.platform === "win32" || process.platform === "darwin";
}

function tryRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function platformPathApi(): PlatformPath {
  return process.platform === "win32" ? win32 : posix;
}

function isPathWithinKey(parentKey: string, childKey: string): boolean {
  if (childKey === parentKey) return true;
  const separator = platformPathApi().sep;
  return childKey.startsWith(parentKey.endsWith(separator) ? parentKey : `${parentKey}${separator}`);
}

function identityId(scopeLetter: string, material: string): string {
  const digest = createHash("sha256").update(material).digest("hex").slice(0, IDENTITY_DIGEST_LENGTH);
  return `${IDENTITY_VERSION}:${scopeLetter}:${digest}`;
}

/** True for a key this module produced, so a saved entry is told from a legacy name without guessing. */
export function isSkillIdentityKey(value: string): boolean {
  return value.startsWith(`${IDENTITY_VERSION}:`);
}

/** Where a skill file belongs, decided from the file's own location. */
export type SkillOwnership =
  | { kind: "global" }
  | { kind: "project"; projectPath: string }
  | { kind: "location-only"; reason: string };

/**
 * Which scope a skill file belongs to, from where the file is.
 *
 * Pi loads project skills from `<root>/.pi/skills` and `.agents/skills` folders on the way up.
 * The two user-level directories are exceptions to that ancestor rule: `<home>/.agents/skills`
 * and `<agentDir>/skills` are global even when a project sits below the home directory. Checking
 * those locations first prevents a user skill from acquiring the identity of whichever repository
 * happened to discover it.
 *
 * A skill configured by absolute path answers `location-only`: the file's location says nothing about
 * projects. A session, which knows its own working directory, can treat such a file as its own when it
 * lies inside it; a panel that is not looking at a session cannot, and leaves it machine-wide.
 */
export function skillOwnership(filePath: string, agentDir: string): SkillOwnership {
  const fileKey = canonicalPathKey(filePath);
  const agentKey = canonicalPathKey(agentDir);
  const sharedGlobalSkillsKey = canonicalPathKey(join(homedir(), ".agents", "skills"));
  if (isPathWithinKey(agentKey, fileKey) || isPathWithinKey(sharedGlobalSkillsKey, fileKey)) return { kind: "global" };
  const normalized = fileKey.replaceAll("\\", "/");
  const marker = /^(.*)\/(?:\.pi|\.agents)\/skills(?:\/|$)/.exec(normalized);
  const owner = marker?.[1];
  if (owner !== undefined && owner !== "") return { kind: "project", projectPath: owner };
  return { kind: "location-only", reason: "The skill is configured by path, so its folder names no project." };
}

/**
 * The identity of one skill file, from the file's location and the scope the caller is reading for.
 *
 * `sessionCwd` is known to a session and unknown to a panel that is not looking at one, and it is the
 * only thing that can place a skill configured by absolute path into a project. Passing it on the
 * session side and omitting it on the panel side is the one accepted identity asymmetry: both sides
 * agree on every skill Pi discovers from a Pi skill folder, and a panel cannot claim a preference for
 * a project it is not showing.
 */
export function skillPreferenceIdentityFor(agentDir: string, sessionCwd?: string): (filePath: string) => SkillIdentity {
  return (filePath) => {
    const owner = skillOwnership(filePath, agentDir);
    if (owner.kind === "project") return skillIdentity(filePath, { projectPath: owner.projectPath });
    if (owner.kind === "global") return skillIdentity(filePath, {});
    if (sessionCwd !== undefined && (filePath === sessionCwd || filePath.startsWith(`${sessionCwd.replace(/\/+$/, "")}/`))) {
      return skillIdentity(filePath, { projectPath: sessionCwd });
    }
    return skillIdentity(filePath, {});
  };
}

/**
 * Whether a file belongs to one of the user's global Pi skill directories.
 *
 * The Settings panel uses this provenance to label both Pi's own agent directory and the shared
 * Agent Skills directory as user-level skills, independently of the source label Pi reports.
 */
export function isGlobalAgentSkillPath(filePath: string, agentDir: string): boolean {
  const fileKey = canonicalPathKey(filePath);
  return isPathWithinKey(canonicalPathKey(agentDir), fileKey)
    || isPathWithinKey(canonicalPathKey(join(homedir(), ".agents", "skills")), fileKey);
}
