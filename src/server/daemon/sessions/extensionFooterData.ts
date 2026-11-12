import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { gitBranch } from "./gitBranch.js";

/**
 * The `footerData` pi hands a `setFooter` factory (pi-insertion-points.md slice 5): the git branch,
 * the extensions' statuses and how many providers have models. pi's `FooterDataProvider` is not
 * exported (the package's `exports` map blocks the deep import), so its answers are mirrored in
 * `gitBranch.ts`. The branch is read again at each call instead of watched: a footer is drawn when
 * it asks or once its drawing is a second old (standingWidgets.ts), so a branch change shows at its
 * next drawing and `onBranchChange` has nothing to report.
 */
export function extensionFooterData(source: {
  readonly cwd: string;
  readonly statuses: () => ReadonlyMap<string, string>;
  readonly providerCount: () => number;
}): ReadonlyFooterDataProvider {
  return {
    getGitBranch: () => gitBranch(source.cwd),
    getExtensionStatuses: source.statuses,
    getAvailableProviderCount: source.providerCount,
    onBranchChange: () => unsubscribeNothing,
  };
}

const unsubscribeNothing = (): void => undefined;
