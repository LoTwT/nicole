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
      expect(
        rulesFor(target, true).some(
          (rule) =>
            rule.value === "var(--nicole-selection)" && !rule.important,
        ),
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
  const themeDark = readFileSync(
    "node_modules/@ayingott/theme/src/semantic/dark.css",
    "utf8",
  );

  function block(selector: string) {
    const start = styleCss.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`missing ${selector}`);
    const end = styleCss.indexOf("}", start);
    return styleCss.slice(start, end + 1);
  }

  it("uses lavender-200 on Paper and accent-soft on Ink", () => {
    expect(block(":root")).toMatch(
      /--nicole-selection:\s*var\(--reading-selection,\s*var\(--color-lavender-200\)\)/,
    );
    expect(block(".dark")).toMatch(
      /--nicole-selection:\s*var\(--reading-selection,\s*var\(--accent-soft\)\)/,
    );
    expect(themeColors).toMatch(/--color-lavender-200:\s*#ded4ff;/);
    expect(themeDark).toMatch(/--accent-soft:\s*#2c2644;/);
  });

  it("does not bypass the editor theme with !important", () => {
    expect(styleCss).not.toMatch(
      /(?:\.cm-selectionBackground|::selection)[^{}]*\{[^}]*background[^;}]*!important/,
    );
  });
});
