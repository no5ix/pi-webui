import { ProjectTrustStore, hasTrustRequiringProjectResources } from "@earendil-works/pi-coding-agent";

/**
 * The project a Settings request is about.
 *
 * A Settings panel names a project by id; only the server can turn that id into a directory, and the
 * same rule has to hold for every resource read from a project - skills, MCP servers, and whatever
 * joins them - so one resolver answers for all of them and the rule is stated once. A request can
 * never read a directory by naming a path, which is what matters most on a remote machine, where the
 * project's folders are that machine's and not this browser's.
 */
export interface SettingsProjectResolver {
  /** The project's directory, or a `SettingsProjectError` the route answers with its own status. */
  requireProjectPath(projectId: string): Promise<string>;
  /** Whether PI WEB trusts the project, which is what lets a project's own config be read at all. */
  isProjectTrusted(projectPath: string): boolean;
}

/** A request PI WEB will not answer: the project it names is not one it can read. */
export class SettingsProjectError extends Error {
  override name = "SettingsProjectError";
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The project store, as this module needs it, so it stays independent of the web process. */
export interface SettingsProjectLookup {
  getProject(projectId: string): Promise<{ realPath: string } | null>;
}

export interface SettingsProjectResolverDependencies {
  projects: SettingsProjectLookup;
  /**
   * The agent directory whose trust store decides the gate - the active profile's, which the caller
   * has resolved by the time it builds this. Trust is a synchronous question inside a request, so a
   * directory the caller has not resolved yet cannot be answered, and the caller resolves it first.
   */
  agentDir: string;
}

/**
 * The resolver a running web process uses: ids resolve through the project store, and trust is
 * pi's own decision for the active profile's agent directory.
 */
export function createSettingsProjectResolver(deps: SettingsProjectResolverDependencies): SettingsProjectResolver {
  return {
    async requireProjectPath(projectId) {
      const trimmed = projectId.trim();
      if (trimmed === "") throw new SettingsProjectError(400, "A project-scope request needs a project");
      const project = await deps.projects.getProject(trimmed);
      if (project === null) throw new SettingsProjectError(404, `Project ${projectId} was not found`);
      return project.realPath;
    },
    isProjectTrusted(projectPath) {
      return piProjectIsTrusted(deps.agentDir, projectPath);
    },
  };
}

/** The resolver for a process with no project store, which is every process that is not the web/API. */
export function unconfiguredSettingsProjectResolver(): SettingsProjectResolver {
  return {
    requireProjectPath(): Promise<string> {
      throw new SettingsProjectError(400, "Project-scoped resource settings are not available in this process");
    },
    isProjectTrusted() {
      return false;
    },
  };
}

/**
 * Whether pi will load a project's own resources, judged the way pi judges it: an explicit decision
 * from pi's trust store for this agent directory, and pi's own default for a project the store has
 * never seen - a project with nothing that needs trust is treated as trusted.
 */
export function piProjectIsTrusted(agentDir: string, projectPath: string): boolean {
  try {
    const decision = new ProjectTrustStore(agentDir).get(projectPath);
    return decision ?? !hasTrustRequiringProjectResources(projectPath);
  } catch {
    return false;
  }
}
