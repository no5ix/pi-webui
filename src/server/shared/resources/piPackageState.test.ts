import { describe, expect, it } from "vitest";
import {
  PACKAGE_RESOURCE_TYPES,
  disabledPackageSource,
  enabledPackageSource,
  isDisabledPackageSource,
  isFilteredPackageSource,
  packageSourceForEnabled,
  packageSourceString,
} from "./piPackageState";

/**
 * Pi's own way of configuring a package off.
 *
 * A package is a string in Pi's settings when it supplies everything, and an object when its
 * resources are being selected. Turning a package off is the object with nothing in it: Pi keeps the
 * package installed and configured, and supplies none of it. These tests keep the two forms exactly
 * that, because a half-empty form is a package that still loads something.
 */

describe("the package filter entries", () => {
  it("names the resource types Pi selects a package by", () => {
    expect(PACKAGE_RESOURCE_TYPES).toEqual(["extensions", "skills", "prompts", "themes"]);
  });

  it("writes a disabled package as an entry that autoloads nothing and lists no resource", () => {
    expect(disabledPackageSource("npm:@acme/tools")).toEqual({
      source: "npm:@acme/tools",
      autoload: false,
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    });
  });

  it("writes an enabled package back as the plain string it was", () => {
    expect(enabledPackageSource("npm:@acme/tools")).toBe("npm:@acme/tools");
    expect(packageSourceForEnabled("npm:@acme/tools", true)).toBe("npm:@acme/tools");
    expect(packageSourceForEnabled("npm:@acme/tools", false)).toMatchObject({ source: "npm:@acme/tools", autoload: false });
  });

  it("recognises a disabled entry, and only one that supplies nothing", () => {
    expect(isDisabledPackageSource(disabledPackageSource("npm:@acme/tools"))).toBe(true);
    expect(isDisabledPackageSource("npm:@acme/tools")).toBe(false);
    expect(isDisabledPackageSource({ source: "npm:@acme/tools", autoload: false, extensions: ["./index.ts"], skills: [], prompts: [], themes: [] })).toBe(false);
    expect(isDisabledPackageSource(undefined)).toBe(false);
  });

  it("calls any object entry filtered, which is what the panel shows as an explanation", () => {
    expect(isFilteredPackageSource("npm:@acme/tools")).toBe(false);
    expect(isFilteredPackageSource({ source: "npm:@acme/tools", autoload: true, skills: ["./skills/a"] })).toBe(true);
  });

  it("reads the source back out of both forms, which is the key the panel acts on", () => {
    expect(packageSourceString("npm:@acme/tools")).toBe("npm:@acme/tools");
    expect(packageSourceString({ source: "../project-tools" })).toBe("../project-tools");
    expect(packageSourceString(disabledPackageSource("../project-tools"))).toBe("../project-tools");
  });

  it("round-trips a disable and an enable without leaving a trace of the switch", () => {
    const source = "npm:@acme/tools";

    expect(packageSourceString(packageSourceForEnabled(source, false))).toBe(source);
    expect(isDisabledPackageSource(packageSourceForEnabled(source, false))).toBe(true);
    expect(isDisabledPackageSource(packageSourceForEnabled(source, true))).toBe(false);
  });
});
