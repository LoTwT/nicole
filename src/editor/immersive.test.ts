import { cursorLineBoundaryBackward } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEditor, type EditorHandle, type EditorMode } from "./index";

const doc = `# 一级标题

> 引用内容

- 无序列内容

1. 有序内容

- [ ] 任务内容
- [x] 完成任务

正文内容
`;

const lines = {
  heading: { text: "# 一级标题", contentStart: 2 },
  quote: { text: "> 引用内容", contentStart: 2 },
  bullet: { text: "- 无序列内容", contentStart: 2 },
  ordered: { text: "1. 有序内容", contentStart: 3 },
  task: { text: "- [ ] 任务内容", contentStart: 6 },
} as const;

let parent: HTMLElement;
let editor: EditorHandle;

function mount(mode: EditorMode = "immersive", text = doc) {
  editor = createEditor({ parent, doc: text, mode });
  return editor;
}

function lineOf(text: string) {
  const index = doc.indexOf(text);
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

function head(lineNumber: number) {
  return editor.view.state.selection.main.head -
    editor.view.state.doc.line(lineNumber).from;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
  parent.style.height = "600px";
});

afterEach(() => {
  editor?.destroy();
});

describe("immersive mode line-start boundaries", () => {
  for (const [name, line] of Object.entries(lines)) {
    it(`keeps a line-start selection after the ${name} marker`, () => {
      mount();
      const target = lineOf(line.text);

      editor.view.dispatch({ selection: { anchor: target.from } });

      expect(editor.view.state.selection.main.head).toBe(
        target.from + line.contentStart,
      );
    });

    it(`keeps Home after the ${name} marker`, () => {
      mount();
      const target = lineOf(line.text);
      editor.view.dispatch({ selection: { anchor: target.to } });

      key(editor.view, "Home");

      expect(head(target.number)).toBe(line.contentStart);
    });

    it(`clamps a pointer selection before the ${name} marker`, () => {
      mount();
      const target = lineOf(line.text);

      editor.view.dispatch({
        selection: { anchor: target.from },
        userEvent: "select.pointer",
      });

      expect(editor.view.state.selection.main.head).toBe(
        target.from + line.contentStart,
      );
    });
  }

  it("moves left from the first visible character to the previous line end", () => {
    mount();
    const bullet = lineOf(lines.bullet.text);
    editor.view.dispatch({
      selection: { anchor: bullet.from + lines.bullet.contentStart },
    });

    key(editor.view, "ArrowLeft");

    expect(editor.view.state.selection.main.head).toBe(bullet.from - 1);
  });

  it("stays put when left is pressed on the first document line", () => {
    mount();
    const heading = lineOf(lines.heading.text);
    editor.view.dispatch({
      selection: { anchor: heading.from + lines.heading.contentStart },
    });

    key(editor.view, "ArrowLeft");

    expect(editor.view.state.selection.main.head).toBe(
      heading.from + lines.heading.contentStart,
    );
  });

  it("keeps the standard left arrow on indented lines without markers", () => {
    mount("immersive", "    缩进正文\n");
    editor.view.dispatch({ selection: { anchor: 6 } });

    key(editor.view, "ArrowLeft");

    expect(editor.view.state.selection.main.head).toBe(5);
  });

  it("leaves Shift selection unchanged", () => {
    mount();
    const bullet = lineOf(lines.bullet.text);
    const contentStart = bullet.from + lines.bullet.contentStart;
    editor.view.dispatch({ selection: { anchor: contentStart } });

    key(editor.view, "ArrowLeft", { shiftKey: true });

    // Non-empty selections keep the standard atomic-range behavior: the
    // selection reaches the visible space after the bullet widget, not the
    // hidden marker. The guard must not move either endpoint.
    expect(editor.view.state.selection.main.anchor).toBe(contentStart);
    expect(editor.view.state.selection.main.head).toBe(contentStart - 1);
  });

  it("normalizes the selection when immersive mode is entered", () => {
    mount("live");
    const heading = lineOf(lines.heading.text);
    editor.view.dispatch({ selection: { anchor: heading.from } });

    editor.setMode("immersive");

    expect(editor.view.state.selection.main.head).toBe(
      heading.from + lines.heading.contentStart,
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
      heading.from + lines.heading.contentStart,
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

describe("immersive mode editing at the first visible character", () => {
  it("splits the line after the hidden heading marker on Enter", () => {
    mount();
    const heading = lineOf(lines.heading.text);
    editor.view.dispatch({
      selection: { anchor: heading.from + lines.heading.contentStart },
    });

    key(editor.view, "Enter");

    expect(editor.view.state.doc.toString()).toBe(
      `# \n一级标题\n\n> 引用内容\n\n- 无序列内容\n\n1. 有序内容\n\n- [ ] 任务内容\n- [x] 完成任务\n\n正文内容\n`,
    );
  });

  it("deletes the hidden heading marker on Backspace", () => {
    mount();
    const heading = lineOf(lines.heading.text);
    editor.view.dispatch({
      selection: { anchor: heading.from + lines.heading.contentStart },
    });

    key(editor.view, "Backspace");

    expect(editor.view.state.doc.toString()).toBe(
      `一级标题\n\n> 引用内容\n\n- 无序列内容\n\n1. 有序内容\n\n- [ ] 任务内容\n- [x] 完成任务\n\n正文内容\n`,
    );
  });

  for (const [name, expected] of [
    ["quote", ">\n> 引用内容"],
    ["bullet", "-\n- 无序列内容"],
    ["ordered", "1.\n2. 有序内容"],
    ["task", "- [ ]\n- [ ] 任务内容"],
  ] as const) {
    it(`splits after the ${name} marker on Enter`, () => {
      const line = lines[name];
      const text = `${line.text}\n\n正文内容\n`;
      mount("immersive", text);
      const target = editor.view.state.doc.line(1);
      editor.view.dispatch({
        selection: { anchor: target.from + line.contentStart },
      });

      key(editor.view, "Enter");

      expect(editor.view.state.doc.line(1).text).toBe(expected.split("\n")[0]);
      expect(editor.view.state.doc.line(2).text).toBe(expected.split("\n")[1]);
    });
  }

  it("keeps a plain line start when Home is used outside immersive mode", () => {
    mount("live");
    const target = lineOf(lines.bullet.text);
    editor.view.dispatch({ selection: { anchor: target.to } });

    expect(cursorLineBoundaryBackward(editor.view)).toBe(true);

    expect(editor.view.state.selection.main.head).toBe(target.from);
  });

  for (const [name, expected] of [
    ["heading", "# 你好一级标题"],
    ["quote", "> 你好引用内容"],
    ["bullet", "- 你好无序列内容"],
    ["ordered", "1. 你好有序内容"],
    ["task", "- [ ] 你好任务内容"],
  ] as const) {
    it(`keeps the ${name} structure when text is typed at the boundary`, () => {
      mount();
      const line = lines[name];
      const target = lineOf(line.text);
      const start = target.from + line.contentStart;

      editor.view.dispatch({
        changes: { from: start, insert: "你好" },
        selection: { anchor: start + 2 },
      });

      expect(editor.view.state.doc.line(target.number).text).toBe(expected);
    });
  }

  for (const [name, expected] of [
    ["heading", "一级标题"],
    ["quote", "引用内容"],
    ["bullet", "无序列内容"],
    ["ordered", "有序内容"],
    ["task", "任务内容"],
  ] as const) {
    it(`records the Backspace result after the ${name} marker`, () => {
      mount();
      const line = lines[name];
      const target = lineOf(line.text);
      editor.view.dispatch({
        selection: { anchor: target.from + line.contentStart },
      });

      key(editor.view, "Backspace");

      expect(editor.view.state.doc.line(target.number).text).toBe(expected);
    });
  }
});
