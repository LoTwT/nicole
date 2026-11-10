// @ts-expect-error The test environment runs on Node, but the project does not
// install Node type declarations for the browser-only TypeScript config.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEditor, type EditorHandle } from "./index";

let parent: HTMLElement;
let editor: EditorHandle;

function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[^.#\s>+~:[\],]+/g) ?? []).length;
  const classes =
    (selector.match(/\.[^.#\s>+~:[\],]+/g) ?? []).length +
    (selector.match(/\[[^\]]+\]/g) ?? []).length +
    (selector.match(/:(?!:)[\w-]+/g) ?? []).length;
  const types = (
    selector
      .replace(/#[^.#\s>+~:[\],]+/g, " ")
      .replace(/\.[^.#\s>+~:[\],]+/g, " ")
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/::?[\w-]+(?:\([^)]*\))?/g, " ")
      .match(/[a-zA-Z][\w-]*/g) ?? []
  ).length;
  return [ids, classes, types];
}

function compare(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

interface Candidate {
  value: string;
  specificity: [number, number, number];
  selector: string;
  important: boolean;
}

interface MatchedRule {
  value: string;
  selector: string;
  important: boolean;
}

function rulesFor(target: Element, pseudoClass = false): MatchedRule[] {
  const matches: MatchedRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!("selectorText" in rule)) continue;
      const cssRule = rule as CSSStyleRule;
      const style = cssRule.style;
      for (const selector of cssRule.selectorText.split(",")) {
        const trimmed = selector.trim();
        if (
          (pseudoClass && !trimmed.includes("::selection")) ||
          (!pseudoClass &&
            (!trimmed.includes(".cm-selectionBackground") ||
              trimmed.includes("::") ||
              !target.matches(trimmed)))
        ) {
          continue;
        }
        const value =
          style.getPropertyValue("background-color") ||
          style.getPropertyValue("background");
        if (!value) continue;
        matches.push({
          value,
          selector: trimmed,
          important:
            style.getPropertyPriority("background-color") === "important" ||
            style.getPropertyPriority("background") === "important",
        });
      }
    }
  }
  return matches;
}

function selectionCandidates(focused: boolean): Candidate[] {
  const host = document.createElement("div");
  host.className = `${editor.view.dom.className}${focused ? " cm-focused" : ""}`;
  host.innerHTML =
    '<div class="cm-scroller">' +
    '<div class="cm-selectionLayer"><div class="cm-selectionBackground"></div></div>' +
    "</div>";
  document.body.append(host);
  try {
    const target = host.querySelector<HTMLElement>(".cm-selectionBackground")!;
    return rulesFor(target).map((rule) => ({
      ...rule,
      specificity: specificity(rule.selector),
    }));
  } finally {
    host.remove();
  }
}

function winningCandidate(focused: boolean): Candidate {
  let winner: Candidate | null = null;
  for (const candidate of selectionCandidates(focused)) {
    // Equal specificity means the later rule wins, so every candidate that is
    // at least as specific as the current winner replaces it.
    if (
      winner === null ||
      compare(candidate.specificity, winner.specificity) >= 0
    ) {
      winner = candidate;
    }
  }
  if (winner === null) throw new Error("no selection rule matched");
  return winner;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
  parent.style.height = "600px";
});

afterEach(() => {
  editor?.destroy();
  document.documentElement.classList.remove("dark");
});

describe("editor selection color", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`outranks CodeMirror's focused base rule in ${theme}`, () => {
      if (theme === "dark") document.documentElement.classList.add("dark");
      editor = createEditor({ parent, doc: "选中的文字\n", mode: "live" });

      const focused = selectionCandidates(true);
      const base = focused.find((candidate) =>
        candidate.value.startsWith("rgb(215, 212, 240"),
      );
      expect(base).toBeDefined();
      const winner = winningCandidate(true);
      expect(winner.value).toBe("var(--nicole-selection)");
      expect(winner.important).toBe(false);
    });

    it(`outranks the unfocused base rule in ${theme}`, () => {
      if (theme === "dark") document.documentElement.classList.add("dark");
      editor = createEditor({ parent, doc: "选中的文字\n", mode: "live" });

      const winner = winningCandidate(false);
      expect(winner.value).toBe("var(--nicole-selection)");
      expect(winner.important).toBe(false);
    });

    it(`keeps the native ::selection fallback in ${theme}`, () => {
      if (theme === "dark") document.documentElement.classList.add("dark");
      editor = createEditor({ parent, doc: "选中的文字\n", mode: "live" });

      const target = editor.view.contentDOM.querySelector(".cm-line")!;
      const native = rulesFor(target, true).filter(
        (rule) =>
          rule.value === "var(--nicole-selection)" && !rule.important,
      );
      expect(
        native.some((rule) => /^\S+ ::selection$/.test(rule.selector.trim())),
      ).toBe(true);
    });
  }
});

describe("selection variables", () => {
  const styleCss = readFileSync("src/style.css", "utf8");
  const themeColors = readFileSync(
    "node_modules/@ayingott/theme/src/foundation/colors.css",
    "utf8",
  );

  interface CascadeRule {
    value: string;
    selector: string;
    specificity: [number, number, number];
    important: boolean;
    order: number;
  }

  function mediaIsActive(conditions: string[]): boolean {
    return conditions.every((condition) => {
      const query = condition.trim().toLowerCase();
      return (
        query === "" ||
        query === "all" ||
        query === "screen" ||
        query.includes("screen")
      );
    });
  }

  function selectionVariableRules(): CascadeRule[] {
    const style = document.createElement("style");
    style.textContent = styleCss.replace(/^@import[^;]+;\s*$/gm, "");
    document.head.append(style);
    try {
      const rules: CascadeRule[] = [];
      let order = 0;
      const visit = (ruleList: CSSRuleList, media: string[]) => {
        for (const rule of Array.from(ruleList)) {
          if ("selectorText" in rule) {
            const cssRule = rule as CSSStyleRule;
            const matchingSelectors = cssRule.selectorText
              .split(",")
              .map((selector) => selector.trim())
              .filter((selector) => document.documentElement.matches(selector));
            const value = cssRule.style.getPropertyValue("--nicole-selection");
            if (matchingSelectors.length > 0 && value) {
              matchingSelectors.sort((a, b) =>
                compare(specificity(a), specificity(b)),
              );
              rules.push({
                value,
                selector: matchingSelectors.at(-1)!,
                specificity: specificity(matchingSelectors.at(-1)!),
                important:
                  cssRule.style.getPropertyPriority("--nicole-selection") ===
                  "important",
                order: order++,
              });
            }
            continue;
          }
          if ("cssRules" in rule) {
            const mediaRule = rule as CSSMediaRule;
            const condition = mediaRule.conditionText ?? "";
            if (mediaIsActive([...media, condition])) {
              visit(mediaRule.cssRules, [...media, condition]);
            }
            order++;
          }
        }
      };
      visit(style.sheet!.cssRules, []);
      return rules.filter((rule) => rule.selector);
    } finally {
      style.remove();
    }
  }

  function winningSelectionRule(): CascadeRule {
    let winner: CascadeRule | null = null;
    for (const rule of selectionVariableRules()) {
      if (
        winner === null ||
        (rule.important !== winner.important
          ? rule.important
          : compare(rule.specificity, winner.specificity) >= 0)
      ) {
        winner = rule;
      }
    }
    if (winner === null) throw new Error("no --nicole-selection rule matched");
    return winner;
  }

  function normalized(value: string) {
    return value.replace(/\s+/g, "");
  }

  it("uses lavender-200 on Paper and lavender-900 on Ink through the cascade", () => {
    document.documentElement.classList.remove("dark");
    const light = winningSelectionRule();
    expect(normalized(light.value)).toBe(
      "var(--reading-selection,var(--color-lavender-200))",
    );
    expect(light.important).toBe(false);

    document.documentElement.classList.add("dark");
    const dark = winningSelectionRule();
    expect(normalized(dark.value)).toBe(
      "var(--reading-selection,var(--color-lavender-900))",
    );
    expect(dark.important).toBe(false);

    expect(themeColors).toMatch(/--color-lavender-200:\s*#ded4ff;/);
    expect(themeColors).toMatch(/--color-lavender-900:\s*#3d345d;/);
  });

  it("does not bypass the editor theme with !important", () => {
    expect(styleCss).not.toMatch(
      /(?:\.cm-selectionBackground|::selection)[^{}]*\{[^}]*background[^;}]*!important/,
    );
  });
});
