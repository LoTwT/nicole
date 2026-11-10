import { undo, undoDepth } from "@codemirror/commands";
import { syntaxTreeAvailable } from "@codemirror/language";
import { EditorSelection, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEditor,
  type CreateEditorOptions,
  type EditorHandle,
  type EditorMode,
} from "./index";
import { until } from "./test-helpers";

const doc = `# 一级标题

> 引用内容

- 无序列内容

1. 有序内容

- [ ] 任务内容
- [x] 完成任务

正文内容
`;

const lines = {
  heading: { text: "# 一级标题", start: 2 },
  quote: { text: "> 引用内容", start: 2 },
  bullet: { text: "- 无序列内容", start: 2 },
  ordered: { text: "1. 有序内容", start: 0 },
  task: { text: "- [ ] 任务内容", start: 6 },
} as const;

let parent: HTMLElement;
let editor: EditorHandle;

function mount(
  mode: EditorMode = "immersive",
  text = doc,
  options: Partial<CreateEditorOptions> = {},
) {
  editor = createEditor({ parent, doc: text, mode, ...options });
  return editor;
}

function lineOf(text: string, source = doc) {
  const index = source.indexOf(text);
  if (index < 0) throw new Error(`fixture is missing ${text}`);
  return editor.view.state.doc.lineAt(index);
}

function key(
  view: EditorView,
  keyName: string,
  options: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: keyName,
    code: keyName,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

function composition(view: EditorView, type: "compositionstart" | "compositionend") {
  view.contentDOM.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
}

function longDocumentForTest(linesCount: number) {
  let text = "# 大文档\n\n";
  for (let index = 0; index < linesCount; index++) {
    text += `第${index}段正文内容，用来拉长文档。\n\n`;
  }
  text += "- 恢复列表\n";
  return text;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
  parent.style.height = "600px";
});

afterEach(() => {
  editor?.destroy();
  vi.restoreAllMocks();
});

describe("immersive mode line-start boundaries", () => {
  for (const [name, line] of Object.entries(lines)) {
    it(`keeps a line-start selection after the ${name} marker`, () => {
      mount();
      const target = lineOf(line.text);

      editor.view.dispatch({ selection: { anchor: target.from } });

      expect(editor.view.state.selection.main.head).toBe(
        target.from + line.start,
      );
    });

    it(`keeps Home after the ${name} marker`, () => {
      mount();
      const target = lineOf(line.text);
      editor.view.dispatch({ selection: { anchor: target.to } });

      key(editor.view, "Home");

      expect(editor.view.state.selection.main.head).toBe(
        target.from + line.start,
      );
    });
  }

  it("moves left from the first visible character to the previous line end", () => {
    mount();
    const bullet = lineOf(lines.bullet.text);
    editor.view.dispatch({
      selection: { anchor: bullet.from + lines.bullet.start },
    });

    key(editor.view, "ArrowLeft");

    expect(editor.view.state.selection.main.head).toBe(bullet.from - 1);
  });

  it("stays put when left is pressed on the first document line", () => {
    mount();
    const heading = lineOf(lines.heading.text);
    editor.view.dispatch({
      selection: { anchor: heading.from + lines.heading.start },
    });

    key(editor.view, "ArrowLeft");

    expect(editor.view.state.selection.main.head).toBe(
      heading.from + lines.heading.start,
    );
  });

  it("collapses a non-empty selection to its left edge with left arrow", () => {
    mount();
    const bullet = lineOf(lines.bullet.text);
    editor.view.dispatch({
      selection: { anchor: bullet.to, head: bullet.from + 4 },
    });

    key(editor.view, "ArrowLeft");

    expect(editor.view.state.selection.main.empty).toBe(true);
    expect(editor.view.state.selection.main.head).toBe(bullet.from + 4);
  });

  it("moves every empty cursor out of a block with left arrow", () => {
    mount("immersive", "上一行\n\n- 无序列内容\n- 第二项\n");
    const first = editor.view.state.doc.line(3);
    const second = editor.view.state.doc.line(4);
    editor.view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(first.from + 2),
        EditorSelection.cursor(second.from + 2),
      ]),
    });

    key(editor.view, "ArrowLeft");

    expect(editor.view.state.selection.ranges.map((range) => range.head)).toEqual(
      [first.from - 1, second.from - 1],
    );
  });

  it("keeps the standard left arrow on indented lines without markers", () => {
    mount("immersive", "    缩进正文\n");
    editor.view.dispatch({ selection: { anchor: 6 } });

    key(editor.view, "ArrowLeft");

    expect(editor.view.state.selection.main.head).toBe(5);
  });

  it("skips a tab after a list marker", () => {
    mount("immersive", "-\t项目\n");
    editor.view.dispatch({ selection: { anchor: 0 } });

    expect(editor.view.state.selection.main.head).toBe(2);
  });

  it("skips spaces and a tab after a list marker", () => {
    mount("immersive", "- \t项目\n");
    editor.view.dispatch({ selection: { anchor: 0 } });

    expect(editor.view.state.selection.main.head).toBe(3);
  });

  it("does not clamp tab-indented code blocks", () => {
    mount("immersive", "\t- 项目\n");
    editor.view.dispatch({ selection: { anchor: 0 } });

    expect(editor.view.state.selection.main.head).toBe(0);
  });

  it("handles nested quote and list markers", () => {
    mount("immersive", "> - 引用列表\n");
    editor.view.dispatch({ selection: { anchor: 0 } });

    expect(editor.view.state.selection.main.head).toBe(4);
  });

  it("handles an indented nested list", () => {
    mount("immersive", "  - 项目\n");
    editor.view.dispatch({ selection: { anchor: 0 } });

    expect(editor.view.state.selection.main.head).toBe(4);
  });

  it("does not treat plain or code lines as blocks", () => {
    mount("immersive", "-abc\n#标题\n    code\n```\n- 代码\n```\n");
    for (const line of [1, 2, 3, 5]) {
      const target = editor.view.state.doc.line(line);
      editor.view.dispatch({ selection: { anchor: target.from } });
      expect(editor.view.state.selection.main.head).toBe(target.from);
    }
  });

  it("leaves Shift selection unchanged", () => {
    mount();
    const bullet = lineOf(lines.bullet.text);
    const contentStart = bullet.from + lines.bullet.start;
    editor.view.dispatch({ selection: { anchor: contentStart } });

    key(editor.view, "ArrowLeft", { shiftKey: true });

    expect(editor.view.state.selection.main.anchor).toBe(contentStart);
    expect(editor.view.state.selection.main.head).toBe(contentStart - 1);
  });

  it("ignores invalid selections that arrive during composition", () => {
    mount();
    const bullet = lineOf(lines.bullet.text);
    composition(editor.view, "compositionstart");

    editor.view.dispatch({ selection: { anchor: bullet.from } });

    expect(editor.view.state.selection.main.head).toBe(bullet.from);
    composition(editor.view, "compositionend");
  });

  it("does not correct selections during IME composition", () => {
    mount("live");
    const heading = lineOf(lines.heading.text);
    editor.view.dispatch({ selection: { anchor: heading.from } });
    composition(editor.view, "compositionstart");

    editor.setMode("immersive");

    expect(editor.view.state.selection.main.head).toBe(heading.from);
    composition(editor.view, "compositionend");
  });

  it("corrects a selection after a document change creates a block", async () => {
    mount("immersive", "text\n");
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(editor.view.state.selection.main.head).toBe(0);

    editor.view.dispatch({ changes: { from: 0, insert: "- " } });

    await until(
      () => editor.view.state.selection.main.head === 2,
      "the corrected selection",
    );
    expect(editor.view.state.selection.main.head).toBe(2);
  });

  it("normalizes the selection when immersive mode is entered", () => {
    mount("live");
    const heading = lineOf(lines.heading.text);
    editor.view.dispatch({ selection: { anchor: heading.from } });

    editor.setMode("immersive");

    expect(editor.view.state.selection.main.head).toBe(
      heading.from + lines.heading.start,
    );
  });

  it("normalizes a restored selection when the editor is created", () => {
    editor = createEditor({
      parent,
      doc,
      mode: "immersive",
      restore: {
        selection: { ranges: [{ anchor: 0 }], main: 0 },
        history: null,
        scrollTopLine: null,
        scrollTopOffset: null,
      },
    });
    const heading = lineOf(lines.heading.text);

    expect(editor.view.state.selection.main.head).toBe(
      heading.from + lines.heading.start,
    );
  });

  for (const mode of ["live", "source"] as const) {
    it(`does not clamp line starts in ${mode} mode`, () => {
      mount(mode);
      const heading = lineOf(lines.heading.text);

      editor.view.dispatch({ selection: { anchor: heading.from } });

      expect(editor.view.state.selection.main.head).toBe(heading.from);
    });
  }
});

describe("immersive mode Enter at the first visible character", () => {
  for (const [name, line] of Object.entries(lines)) {
    it(`inserts an empty line above the ${name} block`, () => {
      mount("immersive", `${line.text}\n`);
      const target = editor.view.state.doc.line(1);
      editor.view.dispatch({
        selection: { anchor: target.from + line.start },
      });

      key(editor.view, "Enter");

      expect(editor.view.state.doc.toString()).toBe(`\n${line.text}\n`);
      expect(editor.view.state.selection.main.head).toBe(line.start + 1);
    });
  }

  for (const [name, text, start] of [
    ["ordered task", "1. [ ] 甲\n", 0],
    ["indented heading", "  # 甲\n", 4],
    ["indented quote", "  > 甲\n", 4],
  ] as const) {
    it(`inserts an empty line above an ${name} first line`, () => {
      mount("immersive", text);
      const target = editor.view.state.doc.line(1);
      editor.view.dispatch({ selection: { anchor: target.from + start } });

      key(editor.view, "Enter");

      expect(editor.view.state.doc.toString()).toBe(`\n${text}`);
    });
  }

  it("inserts an empty line above a non-first block", () => {
    mount("immersive", "上一段\n\n- 无序列内容\n");
    const target = editor.view.state.doc.line(3);
    editor.view.dispatch({ selection: { anchor: target.from } });

    key(editor.view, "Enter");

    expect(editor.view.state.doc.toString()).toBe(
      "上一段\n\n\n- 无序列内容\n",
    );
    expect(editor.view.state.selection.main.head).toBe(
      target.from + lines.bullet.start + 1,
    );
  });

  it("inserts an empty line above a nested block", () => {
    mount("immersive", "> - 引用列表\n");
    editor.view.dispatch({ selection: { anchor: 0 } });

    key(editor.view, "Enter");

    expect(editor.view.state.doc.toString()).toBe("\n> - 引用列表\n");
    expect(editor.view.state.selection.main.head).toBe(5);
  });

  for (const [name, empty] of [
    ["heading", "# "],
    ["quote", "> "],
    ["bullet", "- "],
    ["ordered", "1. "],
    ["task", "- [ ] "],
  ] as const) {
    it(`keeps Enter unchanged on an empty ${name} block`, () => {
      mount("immersive", `${empty}\n`);
      const target = editor.view.state.doc.line(1);
      editor.view.dispatch({ selection: { anchor: target.from } });
      key(editor.view, "Enter");
      const expected = {
        heading: "# \n\n",
        quote: ">\n> \n",
        bullet: "\n",
        ordered: "\n1. \n",
        task: "\n",
      }[name];

      expect(editor.view.state.doc.toString()).toBe(expected);
    });
  }

  it("keeps Enter unchanged in the middle of a block", () => {
    mount("immersive", "# 标题文本\n");
    const target = editor.view.state.doc.line(1);
    editor.view.dispatch({ selection: { anchor: target.from + 4 } });
    key(editor.view, "Enter");
    const immersive = editor.view.state.doc.toString();

    editor.destroy();
    mount("live", "# 标题文本\n");
    editor.view.dispatch({ selection: { anchor: target.from + 4 } });
    key(editor.view, "Enter");

    expect(immersive).toBe(editor.view.state.doc.toString());
  });

  for (const [name, expected] of [
    ["heading", "一级标题"],
    ["quote", "引用内容"],
    ["bullet", "无序列内容"],
    ["task", "任务内容"],
  ] as const) {
    it(`keeps Backspace deleting the whole ${name} marker`, () => {
      mount();
      const line = lines[name];
      const target = lineOf(line.text);
      editor.view.dispatch({ selection: { anchor: target.from + line.start } });

      key(editor.view, "Backspace");

      expect(editor.view.state.doc.line(target.number).text).toBe(expected);
    });
  }
});

describe("immersive mode long-document corrections", () => {
  function longDocument(linesCount: number) {
    let text = "# 大文档\n\n";
    for (let index = 0; index < linesCount; index++) {
      text += `第${index}段正文内容，用来拉长文档。\n\n`;
    }
    text += "- 恢复列表\n";
    return text;
  }

  it("corrects a restored selection after the syntax tree reaches it", async () => {
    const text = longDocument(900);
    const offset = text.lastIndexOf("- 恢复列表");
    editor = createEditor({
      parent,
      doc: text,
      mode: "immersive",
      restore: {
        selection: { ranges: [{ anchor: offset }], main: 0 },
        history: null,
        scrollTopLine: null,
        scrollTopOffset: null,
      },
    });
    const target = editor.view.state.doc.lineAt(offset);

    await until(
      () => editor.view.state.selection.main.head === target.from + 2,
      "the corrected selection",
    );
    expect(editor.view.state.selection.main.head).toBe(target.from + 2);
  });

  it("corrects a far programmatic selection", async () => {
    const text = longDocument(900);
    const offset = text.lastIndexOf("- 恢复列表");
    mount("immersive", text);
    const target = editor.view.state.doc.lineAt(offset);

    editor.view.dispatch({ selection: { anchor: offset } });

    await until(
      () => editor.view.state.selection.main.head === target.from + 2,
      "the corrected selection",
    );
    expect(editor.view.state.selection.main.head).toBe(target.from + 2);
  });

  it("corrects a far selection in a 1.5 MB document", async () => {
    const text = longDocument(55000);
    const offset = text.lastIndexOf("- 恢复列表");
    mount("immersive", text);
    const target = editor.view.state.doc.lineAt(offset);

    editor.view.dispatch({ selection: { anchor: offset } });

    await until(
      () => editor.view.state.selection.main.head === target.from + 2,
      "the corrected selection",
      10000,
    );
    expect(editor.view.state.selection.main.head).toBe(target.from + 2);
  }, 15000);

  it("keeps the scroll position and does not request scrolling for a fix", async () => {
    mount("immersive", `# 标题\n\n${"正文\n".repeat(80)}`);
    const heading = editor.view.state.doc.line(1);
    editor.view.scrollDOM.scrollTop = 120;
    const transactions: boolean[] = [];
    const observer = EditorView.updateListener.of((update) => {
      if (update.selectionSet) {
        transactions.push(...update.transactions.map((tr) => tr.scrollIntoView));
      }
    });
    editor.view.dispatch({ effects: StateEffect.appendConfig.of(observer) });
    editor.view.dispatch({ selection: { anchor: heading.from } });

    await until(
      () => editor.view.state.selection.main.head === 2,
      "the corrected selection",
    );
    expect(editor.view.scrollDOM.scrollTop).toBe(120);
    expect(transactions).not.toContain(true);
  });

  it("preserves a vertical movement goal column through a list line", () => {
    mount("immersive", "0123456789\n- 无序列内容abcd\nxyz\n");
    const first = editor.view.state.doc.line(1);
    editor.view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(first.from + 1, 0, undefined, 1),
      ]),
    });
    const list = editor.view.state.doc.line(2);

    editor.view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(list.from, 0, undefined, 1),
      ]),
    });

    expect(editor.view.state.selection.main.head).toBe(list.from + 2);
    expect(editor.view.state.selection.main.goalColumn).toBe(1);
  });
});

describe("immersive mode second-round regressions", () => {
  it("requests scrolling and keeps one undo step per Enter above a block", () => {
    mount("immersive", "前一段\n\n# 标题文本\n");
    const target = editor.view.state.doc.line(3);
    editor.view.dispatch({ selection: { anchor: target.from + 2 } });
    const scrollRequests: boolean[] = [];
    editor.view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            scrollRequests.push(
              ...update.transactions.map((transaction) => transaction.scrollIntoView),
            );
          }
        }),
      ),
    });

    key(editor.view, "Enter");
    key(editor.view, "Enter");

    expect(scrollRequests).toEqual([true, true]);
    const afterTwo = editor.view.state.doc.toString();
    undo(editor.view);
    expect(editor.view.state.doc.toString()).toBe("前一段\n\n\n# 标题文本\n");
    undo(editor.view);
    expect(editor.view.state.doc.toString()).toBe("前一段\n\n# 标题文本\n");
    expect(afterTwo).toBe("前一段\n\n\n\n# 标题文本\n");
  });

  it("does not run the custom Enter during composition", () => {
    mount("immersive", "# 标题文本\n");
    editor.view.dispatch({ selection: { anchor: 2 } });
    composition(editor.view, "compositionstart");

    key(editor.view, "Enter");

    // The custom command is skipped during composition; CodeMirror's default
    // Enter remains available to the IME.
    expect(editor.view.state.doc.toString()).toBe("# \n标题文本\n");
    composition(editor.view, "compositionend");
  });

  it("leaves multi-cursor Enter to the editor", () => {
    mount("immersive", "# 甲\n# 乙\n");
    const first = editor.view.state.doc.line(1);
    const second = editor.view.state.doc.line(2);
    editor.view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(first.from + 2),
        EditorSelection.cursor(second.from + 2),
      ]),
    });

    key(editor.view, "Enter");

    expect(editor.view.state.doc.toString()).toBe("# \n甲\n# \n乙\n");
  });

  for (const modifiers of [{ ctrlKey: true }, { altKey: true }]) {
    it(`moves group-left from a boundary with ${modifiers.ctrlKey ? "Ctrl" : "Alt"}-ArrowLeft`, () => {
      mount("immersive", "上一段\n\n- 文本\n");
      const target = editor.view.state.doc.line(3);
      editor.view.dispatch({ selection: { anchor: target.from + 2 } });

      key(editor.view, "ArrowLeft", modifiers);

      expect(editor.view.state.selection.main.head).toBe(0);
    });
  }

  it("collapses a non-empty selection to its left edge with Alt-ArrowLeft", async () => {
    mount("immersive", "上一段\n\n- 文本\n");
    const view = editor.view;
    await until(
      () => syntaxTreeAvailable(view.state, view.state.doc.length),
      "the syntax tree to cover the list",
    );
    const target = view.state.doc.line(3);
    view.dispatch({
      selection: { anchor: target.to, head: target.from + 2 },
    });

    key(view, "ArrowLeft", { altKey: true });

    expect(editor.view.state.selection.main.empty).toBe(true);
    expect(editor.view.state.selection.main.head).toBe(target.from + 2);
  });

  for (const [name, eventInit, platform] of [
    ["Shift-Enter", { shiftKey: true }, undefined],
    ["Ctrl-O", { ctrlKey: true }, "macos" as const],
  ] as const) {
    it(`inserts a blank line above a block with ${name} at the boundary`, () => {
      mount("immersive", "上一段\n\n- 文本\n", { platform });
      const target = editor.view.state.doc.line(3);
      editor.view.dispatch({ selection: { anchor: target.from + 2 } });

      key(editor.view, name === "Ctrl-O" ? "o" : "Enter", eventInit);

      expect(editor.view.state.doc.toString()).toBe("上一段\n\n\n- 文本\n");
      expect(editor.view.state.selection.main.head).toBe(target.from + 3);
    });
  }

  for (const mode of ["live", "source"] as const) {
    it(`keeps the ${mode} Shift-Enter behavior`, () => {
      mount(mode, "# 标题文本\n");
      const target = editor.view.state.doc.line(1);
      editor.view.dispatch({ selection: { anchor: target.from + 2 } });

      const event = key(editor.view, "Enter", { shiftKey: true });

      expect(editor.view.state.doc.toString()).toBe("# \n标题文本\n");
      expect(event.defaultPrevented).toBe(true);
    });

    it(`does not capture Ctrl-O in ${mode} mode`, () => {
      mount(mode, "# 标题文本\n", { platform: "macos" });
      const target = editor.view.state.doc.line(1);
      editor.view.dispatch({ selection: { anchor: target.from + 2 } });
      const seen: string[] = [];
      const onKey = (event: KeyboardEvent) => seen.push(event.key);
      window.addEventListener("keydown", onKey);

      const event = key(editor.view, "o", { ctrlKey: true });
      window.removeEventListener("keydown", onKey);

      expect(editor.view.state.doc.toString()).toBe("# 标题文本\n");
      expect(seen).toContain("o");
      expect(event.defaultPrevented).toBe(false);
    });
  }

  for (const platform of ["linux", "windows"] as const) {
    it(`leaves Ctrl-O to the application on ${platform}`, () => {
      mount("immersive", "# 标题文本\n", { platform });
      const target = editor.view.state.doc.line(1);
      editor.view.dispatch({ selection: { anchor: target.from + 2 } });
      const seen: string[] = [];
      const onKey = (event: KeyboardEvent) => seen.push(event.key);
      window.addEventListener("keydown", onKey);

      const event = key(editor.view, "o", { ctrlKey: true });
      window.removeEventListener("keydown", onKey);

      expect(editor.view.state.doc.toString()).toBe("# 标题文本\n");
      expect(seen).toContain("o");
      expect(event.defaultPrevented).toBe(false);
    });
  }

  it("prevents the native default when the capture handler inserts a line", () => {
    mount("immersive", "上一段\n\n- 文本\n");
    const target = editor.view.state.doc.line(3);
    editor.view.dispatch({ selection: { anchor: target.from + 2 } });

    const event = key(editor.view, "Enter", { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(editor.view.state.doc.toString()).toBe("上一段\n\n\n- 文本\n");
  });

  for (const [name, eventInit, platform] of [
    ["Shift-Enter", { shiftKey: true }, undefined],
    ["Ctrl-O", { ctrlKey: true }, "macos" as const],
  ] as const) {
    it(`keeps checkbox focus authoritative for ${name}`, () => {
      mount("immersive", "- [ ] 文本\n\n正文\n", { platform });
      const line = editor.view.state.doc.line(1);
      const checkbox =
        editor.view.contentDOM.querySelector<HTMLInputElement>(
          "input.cm-nicole-checkbox-input",
        );
      if (!checkbox) throw new Error("checkbox was not rendered");
      editor.view.dispatch({ selection: { anchor: line.from + 6 } });
      checkbox.focus();

      key(editor.view, name === "Ctrl-O" ? "o" : "Enter", eventInit);

      expect(editor.view.state.doc.toString()).toBe("- [ ] 文本\n\n正文\n");
      expect(editor.view.contentDOM.contains(document.activeElement)).toBe(true);
    });
  }

  for (const pair of ["()", "[]", "{}", "\"\"", "''"]) {
    it(`deletes a matching ${pair} pair with Backspace`, () => {
      mount("immersive", `前${pair}后\n`);
      editor.view.dispatch({ selection: { anchor: 2 } });

      key(editor.view, "Backspace");

      expect(editor.view.state.doc.toString()).toBe("前后\n");
      expect(editor.view.state.selection.main.head).toBe(1);
    });
  }

  for (const [name, text, lineNumber, offset, expected] of [
    [
      "an indented continuation list item",
      "- 甲\n  - 乙\n",
      2,
      4,
      "- 甲\n  乙\n",
    ],
    [
      "a loose continuation list item",
      "- 甲\n\n- 乙\n",
      3,
      2,
      "- 甲\n\n  乙\n",
    ],
    [
      "a list inside a continuation quote",
      "> 甲\n> - 乙\n",
      2,
      4,
      "> 甲\n> 乙\n",
    ],
  ] as const) {
    it(`uses baseline Backspace deletion on ${name}`, () => {
      mount("immersive", text);
      const line = editor.view.state.doc.line(lineNumber);
      editor.view.dispatch({ selection: { anchor: line.from + offset } });

      key(editor.view, "Backspace");

      expect(editor.view.state.doc.toString()).toBe(expected);
    });
  }

  it("keeps syntax-left motion for a mid-line Alt-ArrowLeft on Linux", () => {
    mount(
      "immersive",
      "前缀 **粗体** 中间 [链接](http://a.b) 后缀 `code` 尾巴 foo(bar, baz)\n",
      { platform: "linux" },
    );
    const target = editor.view.state.doc.line(1);
    editor.view.dispatch({ selection: { anchor: target.to } });

    for (let index = 0; index < 5; index++) {
      key(editor.view, "ArrowLeft", { altKey: true });
    }

    expect(editor.view.state.selection.main.head).toBe(17);
  });

  for (const [name, text, lineNumber, offset, expected] of [
    [
      "a continuation quote line",
      "> 甲\n> 乙\n",
      2,
      2,
      "> 甲\n>\n> 乙\n",
    ],
    [
      "a continuation list item",
      "- 甲\n- 乙\n",
      2,
      2,
      "- 甲\n-\n- 乙\n",
    ],
    [
      "a nested list inside a quote",
      "> 甲\n> - 乙\n",
      2,
      4,
      "> 甲\n> -\n> - 乙\n",
    ],
    [
      "a nested list inside a list",
      "- 甲\n  - 乙\n",
      2,
      4,
      "- 甲\n  -\n  - 乙\n",
    ],
  ] as const) {
    it(`keeps the baseline Enter behavior on ${name}`, () => {
      mount("immersive", text);
      const line = editor.view.state.doc.line(lineNumber);
      editor.view.dispatch({ selection: { anchor: line.from + offset } });

      key(editor.view, "Enter");

      expect(editor.view.state.doc.toString()).toBe(expected);
    });
  }

  it("places the native caret after inserting above a block", () => {
    mount("immersive", "# 标题文本\n");
    const target = editor.view.state.doc.line(1);
    editor.view.dispatch({ selection: { anchor: target.from + 2 } });
    const collapse = vi.fn();
    const selection = vi
      .spyOn(document, "getSelection")
      .mockReturnValue({ collapse } as unknown as Selection);

    key(editor.view, "Enter");

    const expected = editor.view.domAtPos(target.from + 3);
    expect(collapse).toHaveBeenCalledTimes(1);
    expect(collapse).toHaveBeenCalledWith(expected.node, expected.offset);
    selection.mockRestore();
  });

  it("requests scrolling when left leaves a block boundary", () => {
    mount("immersive", "上一段\n\n- 文本\n");
    const target = editor.view.state.doc.line(3);
    editor.view.dispatch({ selection: { anchor: target.from + 2 } });
    const requests: boolean[] = [];
    editor.view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            requests.push(
              ...update.transactions.map((transaction) => transaction.scrollIntoView),
            );
          }
        }),
      ),
    });

    key(editor.view, "ArrowLeft");

    expect(requests).toContain(true);
  });

  it("keeps an ordered task marker hidden at the line start", () => {
    mount("immersive", "1. [ ] 甲\n");
    const line = editor.view.state.doc.line(1);
    editor.view.dispatch({ selection: { anchor: line.from } });

    expect(editor.view.state.selection.main.head).toBe(7);
  });

  it("deletes an ordered task marker as one unit with Backspace", () => {
    mount("immersive", "1. [ ] 甲\n");
    editor.view.dispatch({ selection: { anchor: 7 } });

    key(editor.view, "Backspace");

    expect(editor.view.state.doc.toString()).toBe("甲\n");
  });

  for (const text of ["* 文本", "+ 文本", "12. 文本"]) {
    it(`recognizes the ${JSON.stringify(text)} prefix`, () => {
      mount("immersive", `${text}\n`);
      const line = editor.view.state.doc.line(1);
      editor.view.dispatch({ selection: { anchor: line.from } });
      const expectedStart = /^\d/.test(text) ? 0 : 2;
      expect(editor.view.state.selection.main.head).toBe(expectedStart);

      key(editor.view, "Enter");

      expect(editor.view.state.doc.toString()).toBe(`\n${text}\n`);
    });
  }


  it("schedules a restored selection on creation in a 1.5 MB document", async () => {
    const text = longDocumentForTest(55000);
    const offset = text.lastIndexOf("- 恢复列表");
    editor = createEditor({
      parent,
      doc: text,
      mode: "immersive",
      restore: {
        selection: { ranges: [{ anchor: offset }], main: 0 },
        history: null,
        scrollTopLine: null,
        scrollTopOffset: null,
      },
    });
    const target = editor.view.state.doc.lineAt(offset);
    expect(editor.view.state.selection.main.head).toBe(offset);

    await until(
      () => editor.view.state.selection.main.head === target.from + 2,
      "the corrected selection",
      10000,
    );
    expect(editor.view.state.selection.main.head).toBe(target.from + 2);
  }, 15000);

  it("waits for composition before applying a far selection correction", async () => {
    const text = longDocumentForTest(10000);
    const offset = text.lastIndexOf("- 恢复列表");
    mount("immersive", text);
    const target = editor.view.state.doc.lineAt(offset);
    editor.view.dispatch({ selection: { anchor: offset } });
    composition(editor.view, "compositionstart");

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(editor.view.state.selection.main.head).toBe(offset);

    composition(editor.view, "compositionend");
    await until(
      () => editor.view.state.selection.main.head === target.from + 2,
      "the corrected selection",
      10000,
    );
    expect(editor.view.state.selection.main.head).toBe(target.from + 2);
  }, 15000);

  it("clears a pending parse timer when switching modes", () => {
    const text = longDocumentForTest(55000);
    const offset = text.lastIndexOf("- 恢复列表");
    mount("immersive", text);
    const setTimer = vi.spyOn(window, "setTimeout");
    editor.view.dispatch({ selection: { anchor: offset } });
    const parseTimers = setTimer.mock.calls.flatMap((call, index) => {
      if (call[1] !== 0) return [];
      return [setTimer.mock.results[index]?.value as number];
    });
    const clearTimer = vi.spyOn(window, "clearTimeout");

    editor.setMode("live");

    expect(parseTimers.length).toBeGreaterThan(0);
    expect(
      clearTimer.mock.calls.some(([timer]) => parseTimers.includes(timer as number)),
    ).toBe(true);
  });

  it("clears a pending parse timer when destroyed", () => {
    const text = longDocumentForTest(55000);
    const offset = text.lastIndexOf("- 恢复列表");
    mount("immersive", text);
    const setTimer = vi.spyOn(window, "setTimeout");
    editor.view.dispatch({ selection: { anchor: offset } });
    const parseTimers = setTimer.mock.calls.flatMap((call, index) => {
      if (call[1] !== 0) return [];
      return [setTimer.mock.results[index]?.value as number];
    });
    const clearTimer = vi.spyOn(window, "clearTimeout");

    editor.destroy();

    expect(parseTimers.length).toBeGreaterThan(0);
    expect(
      clearTimer.mock.calls.some(([timer]) => parseTimers.includes(timer as number)),
    ).toBe(true);
  });

  it("does not scroll, change the document or add history while correcting", async () => {
    const text = longDocumentForTest(55000);
    const offset = text.lastIndexOf("- 恢复列表");
    mount("immersive", text);
    const target = editor.view.state.doc.lineAt(offset);
    const changed: boolean[] = [];
    const scrolled: boolean[] = [];
    editor.view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changed.push(true);
          scrolled.push(
            ...update.transactions.map((transaction) => transaction.scrollIntoView),
          );
        }),
      ),
    });
    editor.view.dispatch({ selection: { anchor: offset } });
    editor.view.scrollDOM.scrollTop = 17;
    const undoBefore = undoDepth(editor.view.state);
    const scrollBefore = editor.view.scrollDOM.scrollTop;

    await until(
      () => editor.view.state.selection.main.head === target.from + 2,
      "the corrected selection",
      10000,
    );

    expect(changed).toEqual([]);
    expect(scrolled).not.toContain(true);
    expect(editor.view.scrollDOM.scrollTop).toBe(scrollBefore);
    expect(undoDepth(editor.view.state)).toBe(undoBefore);
  });

  it("does not block the event loop while correcting a far selection", async () => {
    const text = longDocumentForTest(220000);
    const offset = text.lastIndexOf("- 恢复列表");
    mount("immersive", text);
    const started = performance.now();

    editor.view.dispatch({ selection: { anchor: offset } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(performance.now() - started).toBeLessThan(400);
  }, 15000);

});
