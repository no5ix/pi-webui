import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(fileURLToPath(new URL("../workspace.css", import.meta.url)), "utf8");

const panelSources = [
  "./SettingsKit.tsx",
  "./PiPackagesSettingsPanel.tsx",
  "./SkillsSettingsPanel.tsx",
  "../McpSettingsPanel.tsx",
];

function classesRendered(source: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(source, import.meta.url)), "utf8");
  return [...new Set(text.match(/rw-[a-z][a-z-]*/g) ?? [])];
}

interface Rule { condition: string; selector: string; body: string }

/**
 * Every rule in a stylesheet, with the media condition it sits under.
 *
 * The assertions below are about what a control is sized to, and that answer lives in one rule. Reading
 * rules out of the file, rather than matching a hand-written copy of one, is what keeps them honest: the
 * stylesheet is formatted on one line per rule, and prettier may rewrap it at any time.
 */
function rules(css: string): Rule[] {
  const found: Rule[] = [];
  const conditions: string[] = [];
  let selector = "";
  let cursor = 0;
  while (cursor < css.length) {
    const character = css[cursor] ?? "";
    if (character === "/" && css[cursor + 1] === "*") {
      const end = css.indexOf("*/", cursor + 2);
      cursor = end < 0 ? css.length : end + 2;
      continue;
    }
    if (character === "{") {
      const header = selector.trim();
      selector = "";
      // An at-rule that opens a block carries the rules inside it, and a test asks for them by that
      // condition. A statement at-rule (`@import`) owns nothing and must not be remembered.
      if (header.startsWith("@")) {
        if (header.includes("{")) conditions.push(header.slice(0, header.indexOf("{")).trim());
        else conditions.push(header);
        cursor += 1;
        continue;
      }
      const close = matchingBrace(css, cursor);
      found.push({ condition: conditions[conditions.length - 1] ?? "", selector: header, body: css.slice(cursor + 1, close) });
      cursor = close + 1;
      continue;
    }
    if (character === "}") {
      conditions.pop();
      cursor += 1;
      continue;
    }
    if (character === ";" && conditions.length === 0) {
      selector = "";
      cursor += 1;
      continue;
    }
    selector += character;
    cursor += 1;
  }
  return found;
}

function matchingBrace(css: string, open: number): number {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}" && (depth -= 1) === 0) return index;
  }
  return css.length;
}

/**
 * The declarations a selector receives, joined across every rule that names it exactly.
 *
 * A control can be widened by a phone-width rule and sized by the base rule; the promise a test
 * checks is that some rule states it, so the bodies are read together.
 */
function bodyOf(css: string, selector: string, condition = /.*/): string {
  const wanted = selector.replace(/\s+/g, " ");
  const bodies = rules(css)
    .filter((entry) => condition.test(entry.condition)
      && entry.selector.split(",").some((part) => part.trim().replace(/\s+/g, " ") === wanted))
    .map((entry) => entry.body);
  if (bodies.length === 0) throw new Error(`no rule for \`${selector}\`${condition.source === ".*" ? "" : ` under ${condition.source}`}`);
  return bodies.join(";");
}

const narrow = /max-width:\s*640px/;

describe("settings stylesheet coverage", () => {
  it("styles every class the settings panels render", () => {
    const missing = panelSources.flatMap(classesRendered).filter((name) => !stylesheet.includes(`.${name}`));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("stacks card actions and inline forms on a narrow screen", () => {
    expect(bodyOf(stylesheet, ".rw-settings-card-actions", narrow)).toMatch(/width:\s*100%/);
    expect(bodyOf(stylesheet, ".rw-settings-inline-form", narrow)).toMatch(/align-items:\s*stretch/);
    expect(bodyOf(stylesheet, ".rw-settings-card-actions .rw-settings-toggle", narrow)).toMatch(/min-height:\s*44px/);
  });

  it("keeps every settings control on the coarse-pointer floor", () => {
    expect(bodyOf(stylesheet, ".rw-settings-section-actions button")).toMatch(/min-height:\s*32px/);
    expect(bodyOf(stylesheet, ".rw-settings-card-actions button")).toMatch(/min-height:\s*32px/);
    expect(bodyOf(stylesheet, ".rw-settings-inline-form button")).toMatch(/min-height:\s*32px/);
    expect(bodyOf(stylesheet, ".rw-settings-field input")).toMatch(/min-height:\s*32px/);
    expect(bodyOf(stylesheet, ".rw-settings-field select")).toMatch(/min-height:\s*32px/);
    expect(bodyOf(stylesheet, ".rw-settings-nav button")).toMatch(/min-height:\s*36px/);
  });

  it("keeps the settings navigation usable in a phone-width dialog", () => {
    expect(bodyOf(stylesheet, ".rw-settings-nav", narrow)).toMatch(/flex-direction:\s*row/);
  });

  it("gives a settings switch a touch-sized target, not a raw checkbox", () => {
    expect(bodyOf(stylesheet, ".rw-settings-toggle")).toMatch(/min-height:\s*32px/);
    expect(bodyOf(stylesheet, ".rw-settings-toggle input")).toMatch(/inset:\s*0/);
    expect(bodyOf(stylesheet, ".rw-settings-card-actions .rw-settings-toggle", narrow)).toMatch(/min-height:\s*44px/);
  });
});

describe("phone-sized settings controls", () => {
  function sizedTo44(selector: string): boolean {
    return rules(stylesheet).some((rule) =>
      rule.condition.includes("max-width: 640px")
      && rule.selector.includes(selector)
      && rule.body.includes("min-height: 44px"));
  }

  it("gives every settings control a 44px target on a phone", () => {
    for (const selector of [
      ".rw-settings-nav button",
      ".rw-settings-content .rw-settings-toggle",
      ".rw-settings-content .rw-settings-card-actions .rw-settings-toggle",
      ".rw-settings-content .rw-settings-card-actions button",
      ".rw-settings-content button",
      ".rw-settings-content input:not([type=checkbox])",
      ".rw-settings-content select",
      ".rw-settings-content textarea",
    ]) {
      expect(sizedTo44(selector), `${selector} must reach a 44px touch target on a phone`).toBe(true);
    }
  });
});
