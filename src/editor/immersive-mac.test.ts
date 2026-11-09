import type { EditorView } from "@codemirror/view";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CodeMirror decides which modifier it calls "Mod" at module load time. Set the
// platform before importing the editor so the macOS Cmd-ArrowLeft binding is
// the one under test.
Object.defineProperty(navigator, "platform", {
  value: "MacIntel",
  configurable: true,
});

const { createEditor } = await import("./index");

const doc = `# 一级标题

> 引用内容

- 无序列内容

1. 有序内容

- [ ] 任务内容

正文内容
`;

const lines = [
  { text: "# 一级标题", contentStart: 2 },
  { text: "> 引用内容", contentStart: 2 },
  { text: "- 无序列内容", contentStart: 2 },
  { text: "1. 有序内容", contentStart: 0 },
  { text: "- [ ] 任务内容", contentStart: 6 },
] as const;

let parent: HTMLElement;
let destroy: (() => void) | null = null;

function press(
  view: EditorView,
  key: string,
  modifiers: KeyboardEventInit = {},
) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    }),
  );
}

function cmdArrowLeft(view: EditorView) {
  press(view, "ArrowLeft", { metaKey: true });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
  parent.style.height = "600px";
});

afterEach(() => {
  destroy?.();
  destroy = null;
  vi.restoreAllMocks();
});

describe("immersive mode on macOS", () => {
  for (const line of lines) {
    it(`clamps Cmd-ArrowLeft before the ${JSON.stringify(line.text)} marker`, () => {
      const editor = createEditor({ parent, doc, mode: "immersive" });
      destroy = () => editor.destroy();
      const view = editor.view;
      const target = view.state.doc.lineAt(doc.indexOf(line.text));
      view.dispatch({ selection: { anchor: target.to } });

      cmdArrowLeft(view);

      expect(view.state.selection.main.head).toBe(
        target.from + line.contentStart,
      );
    });
  }

  it("moves Ctrl-B past a hidden bullet at the boundary", () => {
    const editor = createEditor({
      parent,
      doc: "上一段\n\n- 无序列内容\n",
      mode: "immersive",
    });
    destroy = () => editor.destroy();
    const view = editor.view;
    const target = view.state.doc.line(3);
    view.dispatch({ selection: { anchor: target.from } });

    press(view, "b", { ctrlKey: true });

    expect(view.state.selection.main.head).toBe(target.from - 1);
  });

  it("moves Alt-ArrowLeft past the whole block at the boundary", () => {
    const editor = createEditor({
      parent,
      doc: "上一段\n\n- 无序列内容\n",
      mode: "immersive",
    });
    destroy = () => editor.destroy();
    const view = editor.view;
    const target = view.state.doc.line(3);
    view.dispatch({ selection: { anchor: target.from } });

    press(view, "ArrowLeft", { altKey: true });

    expect(view.state.selection.main.head).toBe(0);
  });

  it("makes Ctrl-H delete the whole marker like Backspace", () => {
    const editor = createEditor({
      parent,
      doc: "- 无序列内容\n",
      mode: "immersive",
    });
    destroy = () => editor.destroy();
    const view = editor.view;

    press(view, "h", { ctrlKey: true });

    expect(view.state.doc.line(1).text).toBe("无序列内容");
    expect(view.state.selection.main.head).toBe(0);
  });

  it("merges the previous line on Alt-Backspace at the boundary", () => {
    const editor = createEditor({
      parent,
      doc: "上一行\n1. 有序文本\n",
      mode: "immersive",
    });
    destroy = () => editor.destroy();
    const view = editor.view;
    const target = view.state.doc.line(2);
    view.dispatch({ selection: { anchor: target.from } });

    press(view, "Backspace", { altKey: true });

    expect(view.state.doc.toString()).toBe("上一行1. 有序文本\n");
    expect(view.state.selection.main.head).toBe(3);
  });

  it("keeps syntax-left motion for a mid-line Ctrl-ArrowLeft", () => {
    const editor = createEditor({
      parent,
      doc: "前缀 **粗体** 中间 [链接](http://a.b) 后缀 `code` 尾巴 foo(bar, baz)\n",
      mode: "immersive",
      platform: "macos",
    });
    destroy = () => editor.destroy();
    const view = editor.view;
    const target = view.state.doc.line(1);
    view.dispatch({ selection: { anchor: target.to } });

    for (let index = 0; index < 5; index++) {
      press(view, "ArrowLeft", { ctrlKey: true });
    }

    expect(view.state.selection.main.head).toBe(17);
  });

  it("keeps Cmd-ArrowLeft inside the line at the boundary", () => {
    const editor = createEditor({ parent, doc, mode: "immersive" });
    destroy = () => editor.destroy();
    const view = editor.view;
    const target = view.state.doc.lineAt(doc.indexOf("- 无序列内容"));
    view.dispatch({ selection: { anchor: target.from + 2 } });

    cmdArrowLeft(view);

    expect(view.state.selection.main.head).toBe(target.from + 2);
  });

  it("moves Ctrl-ArrowLeft past the block at the boundary", () => {
    const editor = createEditor({
      parent,
      doc: "上一段\n\n- 无序列内容\n",
      mode: "immersive",
    });
    destroy = () => editor.destroy();
    const view = editor.view;
    const target = view.state.doc.line(3);
    view.dispatch({ selection: { anchor: target.from + 2 } });

    press(view, "ArrowLeft", { ctrlKey: true });

    expect(view.state.selection.main.head).toBe(0);
  });

  for (const [name, eventInit] of [
    ["Shift-Enter", { shiftKey: true }],
    ["Ctrl-O", { ctrlKey: true }],
  ] as const) {
    it(`keeps the block intact with ${name} after Cmd-ArrowLeft`, () => {
      const editor = createEditor({
        parent,
        doc: "前一段\n\n- 无序文本\n",
        mode: "immersive",
        platform: "macos",
      });
      destroy = () => editor.destroy();
      const view = editor.view;
      const target = view.state.doc.line(3);
      view.dispatch({ selection: { anchor: target.to } });
      cmdArrowLeft(view);

      press(view, name === "Ctrl-O" ? "o" : "Enter", eventInit);

      expect(view.state.doc.toString()).toBe("前一段\n\n\n- 无序文本\n");
    });
  }

  for (const [name, text, lineNumber, offset, expected] of [
    [
      "an indented continuation list item",
      "- 甲\n  - 乙\n",
      2,
      4,
      "- 甲\n  -乙\n",
    ],
    [
      "a loose continuation list item",
      "- 甲\n\n- 乙\n",
      3,
      2,
      "- 甲\n\n-乙\n",
    ],
    [
      "a list inside a continuation quote",
      "> 甲\n> - 乙\n",
      2,
      4,
      "> 甲\n> -乙\n",
    ],
  ] as const) {
    it(`uses baseline Ctrl-H deletion on ${name}`, () => {
      const editor = createEditor({
        parent,
        doc: text,
        mode: "immersive",
        platform: "macos",
      });
      destroy = () => editor.destroy();
      const view = editor.view;
      const line = view.state.doc.line(lineNumber);
      view.dispatch({ selection: { anchor: line.from + offset } });

      press(view, "h", { ctrlKey: true });

      expect(view.state.doc.toString()).toBe(expected);
    });
  }

  it("leaves Alt-Backspace unchanged on the first document line", () => {
    const editor = createEditor({
      parent,
      doc: "- 文本\n",
      mode: "immersive",
    });
    destroy = () => editor.destroy();
    const view = editor.view;
    view.dispatch({ selection: { anchor: 2 } });
    const dispatch = vi.spyOn(view, "dispatch");

    press(view, "Backspace", { altKey: true });

    expect(dispatch).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("- 文本\n");
    expect(view.state.selection.main.head).toBe(2);
  });

  it("merges the previous line on Alt-Backspace at a hidden boundary", () => {
    const editor = createEditor({
      parent,
      doc: "上一行\n\n- 文本\n",
      mode: "immersive",
    });
    destroy = () => editor.destroy();
    const view = editor.view;
    const target = view.state.doc.line(3);
    view.dispatch({ selection: { anchor: target.from + 2 } });

    press(view, "Backspace", { altKey: true });

    expect(view.state.doc.toString()).toBe("上一行\n- 文本\n");
    expect(view.state.selection.main.head).toBe(target.from + 1);
  });

  it("deletes an ordered task marker as one unit with Ctrl-H", () => {
    const editor = createEditor({
      parent,
      doc: "1. [ ] 甲\n",
      mode: "immersive",
    });
    destroy = () => editor.destroy();
    const view = editor.view;
    view.dispatch({ selection: { anchor: 7 } });

    press(view, "h", { ctrlKey: true });

    expect(view.state.doc.toString()).toBe("甲\n");
  });

});
