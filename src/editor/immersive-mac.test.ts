import type { EditorView } from "@codemirror/view";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
  { text: "1. 有序内容", contentStart: 3 },
  { text: "- [ ] 任务内容", contentStart: 6 },
] as const;

let parent: HTMLElement;
let destroy: (() => void) | null = null;

function cmdArrowLeft(view: EditorView) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      code: "ArrowLeft",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
  parent.style.height = "600px";
});

afterEach(() => {
  destroy?.();
  destroy = null;
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

  it("keeps Cmd-ArrowLeft inside the line at the boundary", () => {
    const editor = createEditor({ parent, doc, mode: "immersive" });
    destroy = () => editor.destroy();
    const view = editor.view;
    const target = view.state.doc.lineAt(doc.indexOf("- 无序列内容"));
    view.dispatch({ selection: { anchor: target.from + 2 } });

    cmdArrowLeft(view);

    expect(view.state.selection.main.head).toBe(target.from + 2);
  });
});
