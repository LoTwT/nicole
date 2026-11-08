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

function atLeast(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}

interface Candidate {
  value: string;
  specificity: [number, number, number];
  selector: string;
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
    const candidates: Candidate[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!("selectorText" in rule)) continue;
        const cssRule = rule as CSSStyleRule;
        const style = cssRule.style;
        for (const selector of cssRule.selectorText.split(",")) {
          const trimmed = selector.trim();
          if (
            !trimmed.includes(".cm-selectionBackground") ||
            trimmed.includes("::") ||
            !target.matches(trimmed)
          ) {
            continue;
          }
          const value =
            style.getPropertyValue("background-color") ||
            style.getPropertyValue("background");
          if (!value) continue;
          candidates.push({
            value,
            specificity: specificity(trimmed),
            selector: trimmed,
          });
        }
      }
    }
    return candidates;
  } finally {
    host.remove();
  }
}

function winningCandidate(focused: boolean): Candidate {
  let winner: Candidate | null = null;
  for (const candidate of selectionCandidates(focused)) {
    // Equal specificity means the later rule wins, so every candidate that is
    // at least as specific as the current winner replaces it.
    if (winner === null || !atLeast(winner.specificity, candidate.specificity)) {
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
      expect(winningCandidate(true).value).toBe("var(--nicole-selection)");
    });

    it(`outranks the unfocused base rule in ${theme}`, () => {
      if (theme === "dark") document.documentElement.classList.add("dark");
      editor = createEditor({ parent, doc: "选中的文字\n", mode: "live" });

      expect(winningCandidate(false).value).toBe("var(--nicole-selection)");
    });
  }

  it("does not rebuild the editor when the theme class changes", () => {
    editor = createEditor({ parent, doc: "选中的文字\n", mode: "live" });
    const view = editor.view;

    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("dark");

    expect(editor.view).toBe(view);
  });
});
