import type { PackageSource } from "@earendil-works/pi-coding-agent";

/**
 * Pi's own package filter, read and written in its own shape.
 *
 * A `packages` entry is either a plain source string, which loads everything the package ships, or
 * an object that filters it: `autoload: false` means "load none of these types unless a pattern
 * names them", and a resource list of `[]` means "none of this type". That is the whole mechanism,
 * and it is native: the package stays installed, stays configured, and stays in the file, and
 * `DefaultPackageManager` loads none of its extensions, skills, prompt templates or themes.
 *
 * PI WEB's disable switch therefore writes the one entry that means "nothing loads", and enabling
 * restores the plain string form, which is pi's own shape for "autoload everything". Nothing here
 * uninstalls a package, deletes an entry, or keeps a second registry of what is installed.
 */
export const PACKAGE_RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"] as const;

/** True when a configured entry's filter loads none of the package's resources. */
export function isDisabledPackageSource(entry: PackageSource | undefined): boolean {
  if (entry === undefined || typeof entry === "string") return false;
  if (entry.autoload !== false) return false;
  return PACKAGE_RESOURCE_TYPES.every((type) => isEmptyList(entry[type]));
}

/** True when a configured entry is pi's filtered (object) form, whatever it filters to. */
export function isFilteredPackageSource(entry: PackageSource | undefined): boolean {
  return typeof entry === "object";
}

/** The entry that keeps a package installed and configured while none of its resources load. */
export function disabledPackageSource(source: string): PackageSource {
  return {
    source,
    autoload: false,
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };
}

/** The entry that loads everything the package ships: pi's own plain-string form. */
export function enabledPackageSource(source: string): PackageSource {
  return source;
}

/**
 * Which entry a scope should hold for one source once the switch is moved.
 *
 * Enabling returns the plain form, because that is the shape pi writes for a package with no
 * filter. A package that was filtered by hand - one extension of a pack, say - is therefore not
 * what the switch means: the card says enabling restores the package's own resources.
 */
export function packageSourceForEnabled(source: string, enabled: boolean): PackageSource {
  return enabled ? enabledPackageSource(source) : disabledPackageSource(source);
}

/** The source string of either entry form, for matching a listing against the stored entries. */
export function packageSourceString(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function isEmptyList(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}
