import { markdownLanguage } from "@codemirror/lang-markdown";
import {
  openSearchPanel,
  search,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectCodeBlocks,
  createEditor,
  type EditorHandle,
  type EditorMode,
} from "./index";

const doc = `行内 \`inline\` 代码

\`\`\`js
const a = 1;

const b = 2;
\`\`\`

    indented
    code
`;

let parent: HTMLElement;
let editor: EditorHandle;

async function settle() {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => resolve()),
  );
}

async function delay(milliseconds: number) {
  await new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

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

// jsdom does not resolve CSS variables, so inspect the winning rule instead of
// getComputedStyle(). This still checks the cascade that decides the paint.
function winningProperty(element: Element, property: string): string | null {
  type Winner = {
    value: string;
    specificity: [number, number, number];
    order: number;
    important: boolean;
  };
  const result: { winner: Winner | null } = { winner: null };
  let order = 0;

  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if ("selectorText" in rule) {
        const cssRule = rule as CSSStyleRule;
        for (const selector of cssRule.selectorText.split(",")) {
          const trimmed = selector.trim();
          if (!element.matches(trimmed)) continue;
          const value =
            cssRule.style.getPropertyValue(property) ||
            (property === "background-color"
              ? cssRule.style.getPropertyValue("background")
              : "");
          if (!value) continue;
          const candidate: Winner = {
            value,
            specificity: specificity(trimmed),
            order,
            important:
              cssRule.style.getPropertyPriority(property) === "important" ||
              (property === "background-color" &&
                cssRule.style.getPropertyPriority("background") ===
                  "important"),
          };
          const winner = result.winner;
          if (
            winner === null ||
            (candidate.important && !winner.important) ||
            (candidate.important === winner.important &&
              (compare(candidate.specificity, winner.specificity) > 0 ||
                (compare(candidate.specificity, winner.specificity) === 0 &&
                  candidate.order >= winner.order)))
          ) {
            result.winner = candidate;
          }
        }
      } else if ("cssRules" in rule) {
        visit((rule as CSSGroupingRule).cssRules);
      }
      order++;
    }
  };

  const sheets = new Set<CSSStyleSheet>([
    ...Array.from(document.styleSheets),
    ...Array.from(document.adoptedStyleSheets ?? []),
  ]);
  for (const sheet of sheets) {
    visit(sheet.cssRules);
  }
  return result.winner?.value ?? null;
}

function winningBackground(element: Element): string | null {
  return winningProperty(element, "background-color");
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
  parent.style.height = "600px";
});

afterEach(() => {
  editor?.destroy();
});

describe.each(["live", "immersive", "source"] as EditorMode[])(
  "code block background in %s mode",
  (mode) => {
    it("draws one block-sized background for fenced and indented code", async () => {
      editor = createEditor({ parent, doc, mode });
      const view = editor.view;
      await settle();

      const codeLines = [
        ...view.contentDOM.querySelectorAll(".cm-nicole-code-line"),
      ];
      expect(codeLines).toHaveLength(7);
      expect(codeLines.some((line) => line.textContent?.includes("inline"))).toBe(
        false,
      );

      const backgrounds = [
        ...view.scrollDOM.querySelectorAll<HTMLElement>(".cm-nicole-code-bg"),
      ];
      expect(backgrounds).toHaveLength(2);
      for (const background of backgrounds) {
        expect(background.classList).toContain("cm-nicole-code-bg-start");
        expect(background.classList).toContain("cm-nicole-code-bg-end");
        expect(Number.parseFloat(background.style.height)).toBeGreaterThan(0);
      }
      // Five fenced lines share one rectangle, so the empty line inside the
      // block cannot leave a gap between per-line backgrounds.
      expect(Number.parseFloat(backgrounds[0]!.style.height)).toBeGreaterThan(
        Number.parseFloat(backgrounds[1]!.style.height),
      );
    });
  },
);

it("keeps the code background below the selection layer", async () => {
  editor = createEditor({ parent, doc, mode: "live" });
  const view = editor.view;
  await settle();

  const background = view.scrollDOM.querySelector<HTMLElement>(
    ".cm-nicole-code-bg-layer",
  )!;
  const selection = view.scrollDOM.querySelector<HTMLElement>(
    ".cm-selectionLayer",
  )!;
  expect(Number(background.style.zIndex)).toBeLessThan(
    Number(selection.style.zIndex),
  );
});

it("uses the reading mono font for every code line", async () => {
  editor = createEditor({ parent, doc, mode: "live" });
  const view = editor.view;
  await settle();

  const lines = [
    ...view.contentDOM.querySelectorAll<HTMLElement>(".cm-nicole-code-line"),
  ];
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(winningProperty(line, "font-family")).toBe(
      "var(--reading-font-mono)",
    );
  }
});

it("decorates only code lines inside the visible ranges", async () => {
  const outsideDoc =
    "```js\n" +
    "code\n".repeat(40) +
    "```\n" +
    "段落。\n\n".repeat(2000) +
    "```js\noutside\n```\n";
  editor = createEditor({ parent, doc: outsideDoc, mode: "live" });
  const view = editor.view;
  await settle();

  const outside = outsideDoc.indexOf("outside");
  expect(outside).toBeGreaterThan(view.visibleRanges.at(-1)!.to);
  const codeLines = [
    ...view.contentDOM.querySelectorAll(".cm-nicole-code-line"),
  ];
  expect(codeLines.length).toBeGreaterThan(0);
  expect(codeLines.some((line) => line.textContent?.includes("outside"))).toBe(
    false,
  );
  expect(view.scrollDOM.querySelectorAll(".cm-nicole-code-bg")).toHaveLength(1);
});

it("adds code lines only after the tree reaches their visible range", async () => {
  const treeDoc =
    "```ts\nline one\nline two\nline three\n```\n" +
    "尾部。\n\n".repeat(200);
  editor = createEditor({ parent, doc: treeDoc, mode: "live" });
  const view = editor.view;
  await settle();

  const emptyTree = markdownLanguage.parser.parse("");
  const before = collectCodeBlocks(view, emptyTree);
  expect(before.chunks).toHaveLength(0);
  expect(before.decorations.size).toBe(0);

  const full = collectCodeBlocks(view);
  expect(full.chunks).toHaveLength(1);
  expect(full.chunks[0]!.startsBlock).toBe(true);
  expect(full.chunks[0]!.endsBlock).toBe(true);

  const truncatedTree = markdownLanguage.parser.parse(treeDoc.slice(0, 20));
  const partial = collectCodeBlocks(view, truncatedTree);
  expect(partial.chunks).toHaveLength(1);
  expect(partial.chunks[0]!.startsBlock).toBe(true);
  expect(partial.chunks[0]!.endsBlock).toBe(false);
});

it("adds code backgrounds after parsing reaches the visible block", async () => {
  const paragraphs = Array.from(
    { length: 20000 },
    (_, index) => `第${index}段正文内容，用来拉长文档。`,
  );
  const code = "```ts\nconst late = 1;\n// 结尾代码\n```\n";
  const largeDoc = `# 大文档\n\n${paragraphs.join("\n\n")}\n\n${code}`;
  const codeStart = largeDoc.lastIndexOf("```ts");

  editor = createEditor({ parent, doc: largeDoc, mode: "live" });
  const view = editor.view;
  view.dispatch({
    selection: { anchor: codeStart },
    effects: EditorView.scrollIntoView(codeStart, { y: "center" }),
  });

  expect(
    view.visibleRanges.some(
      (range) => range.from <= codeStart && codeStart < range.to,
    ),
  ).toBe(true);
  expect(view.contentDOM.querySelectorAll(".cm-nicole-code-line")).toHaveLength(
    0,
  );

  const started = Date.now();
  while (
    view.contentDOM.querySelectorAll(".cm-nicole-code-line").length === 0 &&
    Date.now() - started < 5000
  ) {
    await delay(20);
  }
  expect(view.contentDOM.querySelectorAll(".cm-nicole-code-line")).toHaveLength(
    4,
  );

  await settle();
  await settle();
  const background = view.scrollDOM.querySelector<HTMLElement>(
    ".cm-nicole-code-bg",
  )!;
  expect(background.classList).toContain("cm-nicole-code-bg-start");
  expect(background.classList).toContain("cm-nicole-code-bg-end");
});

it("maps code decorations during composition and rebuilds afterwards", async () => {
  const indentedDoc = "正文\n\n    indented\n    code\n\n尾部\n";
  editor = createEditor({ parent, doc: indentedDoc, mode: "live" });
  const view = editor.view;
  await settle();
  expect(view.contentDOM.querySelectorAll(".cm-nicole-code-line")).toHaveLength(
    2,
  );
  expect(view.scrollDOM.querySelectorAll(".cm-nicole-code-bg")).toHaveLength(1);

  view.contentDOM.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true }),
  );
  expect(view.compositionStarted).toBe(true);
  view.dispatch({
    changes: { from: indentedDoc.indexOf("    indented"), insert: "x" },
    userEvent: "input.type.compose",
  });
  await settle();

  // The indented block no longer exists after the edit, but a composition must
  // not rebuild decorations; the mapped ones stay until composition ends.
  expect(view.contentDOM.querySelectorAll(".cm-nicole-code-line")).toHaveLength(
    2,
  );
  expect(view.scrollDOM.querySelectorAll(".cm-nicole-code-bg")).toHaveLength(1);

  view.contentDOM.dispatchEvent(
    new CompositionEvent("compositionend", { bubbles: true }),
  );
  view.dispatch({});
  await settle();

  expect(view.contentDOM.querySelectorAll(".cm-nicole-code-line")).toHaveLength(
    0,
  );
  expect(view.scrollDOM.querySelectorAll(".cm-nicole-code-bg")).toHaveLength(0);
});

it("keeps inline code and search highlights painted inside code blocks", async () => {
  const highlightDoc = [
    "| 列 | 值 |",
    "| --- | --- |",
    "| 行内 | `table-inline` |",
    "",
    "```ts",
    "const foo = 1;",
    "const foo2 = 2;",
    "```",
    "",
    "相邻 `near-inline` 代码 foo",
  ].join("\n");
  editor = createEditor({ parent, doc: highlightDoc, mode: "live" });
  const view = editor.view;
  view.dispatch({ effects: StateEffect.appendConfig.of(search()) });
  view.dispatch({
    effects: setSearchQuery.of(new SearchQuery({ search: "foo" })),
  });
  openSearchPanel(view);
  await settle();
  await settle();

  const monospace = [...view.contentDOM.querySelectorAll<HTMLElement>("span")];
  const inline = monospace.filter(
    (span) =>
      (span.textContent === "table-inline" ||
        span.textContent === "near-inline") &&
      !span.closest(".cm-nicole-code-line"),
  );
  expect(inline.map((span) => span.textContent)).toEqual([
    "table-inline",
    "near-inline",
  ]);
  for (const span of inline) {
    expect(winningBackground(span)).toBe("var(--reading-code-bg)");
  }

  const inCodeBlock = monospace.filter(
    (span) =>
      span.closest(".cm-nicole-code-line") &&
      !span.closest(".cm-searchMatch") &&
      !span.closest(".cm-selectionMatch") &&
      !span.closest(".cm-matchingBracket"),
  );
  expect(inCodeBlock.length).toBeGreaterThan(0);
  for (const span of inCodeBlock) {
    expect(winningBackground(span)).toBe("transparent");
  }

  const matches = [
    ...view.contentDOM.querySelectorAll<HTMLElement>(".cm-searchMatch"),
  ];
  expect(matches.length).toBeGreaterThan(0);
  for (const match of matches) {
    expect(winningBackground(match)).not.toBe("transparent");
    expect(winningBackground(match)).not.toBe("var(--reading-code-bg)");
  }
});
