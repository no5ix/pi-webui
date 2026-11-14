import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { loadSkillsFromDir, type ResourceDiagnostic, type Skill } from "@earendil-works/pi-coding-agent";
import { canonicalPathKey, type SkillIdentity } from "./skillIdentity.js";

/**
 * The skills Pi's own loader shadowed by name, recovered from Pi's report of it.
 *
 * Pi's loader keeps one skill per name and says nothing more about the rest, so a caller that only
 * reads the loaded list can never see the second `nestjs-code-audit`, cannot show it, and cannot state
 * a preference for it. Pi does report what it dropped: each name collision is a diagnostic carrying
 * the loser's path. That is the supported source, and the loser is re-read with Pi's public
 * `loadSkillsFromDir`.
 *
 * Both sides of PI WEB need the same answer - the panel to list the skill, the session runtime to
 * decide what the reader asked for - so the recovery lives here, once, and the two cannot disagree
 * about which skills exist.
 *
 * It reads no skill Pi chose to keep, and it reads no file that is not there: the point is to know
 * which skill Pi shadowed, not to load resources Pi never looked at.
 */
export interface ShadowedSkill {
  skill: Skill;
  identity: SkillIdentity;
}

/** Every skill a `skill` name collision dropped, re-read at the path the collision named. */
export function recoverShadowedSkills(
  diagnostics: readonly ResourceDiagnostic[],
  loadedSkills: readonly Skill[],
  identityFor: (filePath: string) => SkillIdentity,
): ShadowedSkill[] {
  const knownKeys = new Set(loadedSkills.map((skill) => canonicalPathKey(skill.filePath)));
  const recovered: ShadowedSkill[] = [];
  for (const loserPath of collisionLoserPaths(diagnostics)) {
    if (knownKeys.has(canonicalPathKey(loserPath))) continue;
    const skill = readSkillFile(loserPath);
    if (skill === undefined) continue;
    knownKeys.add(canonicalPathKey(skill.filePath));
    recovered.push({ skill, identity: identityFor(skill.filePath) });
  }
  return recovered;
}

function collisionLoserPaths(diagnostics: readonly ResourceDiagnostic[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.collision?.resourceType !== "skill") continue;
    if (diagnostic.type !== "collision") continue;
    const loserPath = diagnostic.collision.loserPath;
    if (loserPath === "" || seen.has(loserPath)) continue;
    seen.add(loserPath);
    paths.push(loserPath);
  }
  return paths;
}

/**
 * One skill file, through Pi's directory loader.
 *
 * Pi's scanner treats a directory holding a `SKILL.md` as that skill's root and a loose `.md` child as
 * one skill among siblings, so the file's own directory is the smallest thing that can be handed to
 * it. The result is then matched back to the path the collision named, so a sibling the collision
 * never mentioned is never added to anybody's list.
 */
function readSkillFile(filePath: string): Skill | undefined {
  if (!existsSync(filePath)) return undefined;
  const wanted = canonicalPathKey(filePath);
  const result = loadSkillsFromDir({ dir: dirname(filePath), source: "skills" });
  return result.skills.find((skill) => canonicalPathKey(skill.filePath) === wanted);
}
