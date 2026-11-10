import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorHandle } from "./index";

// jsdom reports an empty navigator.platform, which CodeMirror treats as
// non-Mac when it resolves `Mod` at module load. Pin it so `Mod` follows the
// macOS platform these tests declare.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", {
    value: "MacIntel",
    configurable: true,
  });
});

const doc = `# 标题

正文有**加粗**和*斜体*，还有[链接](https://example.com)。

> 引用

- [ ] 待办
- 普通项
`;

let parent: HTMLElement;
let editor: EditorHandle;

function pressMod(view: EditorView, key: string, code: string) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code,
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
  editor?.destroy();
});

describe("editor command keymap on macOS", () => {
  it("toggles bold with the Mod-b binding in immersive mode", () => {
    editor = createEditor({ parent, doc, mode: "immersive", platform: "macos" });
    const view = editor.view;
    const anchor = doc.indexOf("普通项");

    view.dispatch({
      selection: { anchor, head: anchor + "普通项".length },
    });
    pressMod(view, "b", "KeyB");

    expect(view.state.doc.toString()).toContain("**普通项**");
  });

  it("runs app commands before basicSetup's default keymap", () => {
    editor = createEditor({
      parent,
      doc,
      platform: "macos",
      commands: [
        {
          id: "test.insert",
          label: "插入 I",
          group: "insert",
          scope: "editor",
          keys: [{ key: "Mod-i" }],
          run: ({ view }) => {
            view?.dispatch({ changes: { from: 0, insert: "I" } });
            return true;
          },
        },
      ],
    });
    const view = editor.view;

    pressMod(view, "i", "KeyI");

    expect(view.state.doc.toString()).toBe(`I${doc}`);
  });
});
