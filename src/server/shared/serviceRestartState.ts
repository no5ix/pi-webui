import type { PiWebOwnService, PiWebServiceRestartState } from "../../shared/apiTypes.js";


/**
 * Whether a component's restart through this user's installed services would restart the
 * component itself. The services are found by their files, which say nothing about which PI WEB
 * runs under them: a second PI WEB on the same account was offered the first one's restart, and
 * pressing it stopped every session of the first. So the restart follows the service the
 * component's own process reports. A component that reports none (`ownService` undefined: a
 * session daemon that is down, did not answer, or predates the report) is matched only through
 * `installationConfirmed`: the web process runs under a service of the same installed set, which
 * installs the daemon's service with it. A component that answers unknown is not a match.
 */
export function serviceRestartState(installedServices: ReadonlySet<string>, ownService: PiWebOwnService | undefined, installationConfirmed: boolean): PiWebServiceRestartState {
  if (installedServices.size === 0) return "no-service-installed";
  if (ownService === undefined) return installationConfirmed ? "installation-runs-under-service" : "unknown";
  if (ownService.kind === "unknown") return "unknown";
  if (ownService.kind === "none") return "not-under-service-manager";
  return installedServices.has(ownService.name) ? "runs-under-service" : "other-service";
}
