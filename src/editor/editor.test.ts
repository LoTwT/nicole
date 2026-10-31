import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEditor, type EditorHandle, type EditorMode } from "./index";

const doc = `# 标题

正文有**加粗**和*斜体*，还有[链接](https://example.com)。

> 引用

- [ ] 待办
- 普通项
`;

let parent: HTMLElement;
let editor: EditorHandle;

function mount(mode: EditorMode = "live") {
  editor = createEditor({ parent, doc, mode });
  return editor;
}

function renderedText(view: EditorView) {
  return view.contentDOM.textContent ?? "";
}

async function settle() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function pressMod(view: EditorView, key: string, code: string) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code,
      ctrlKey: true,
      metaKey: navigator.platform.startsWith("Mac"),
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
  document.documentElement.classList.remove("dark");
});

describe("createEditor", () => {
  it("switches between live, immersive and source modes on one view", async () => {
    const instance = mount("live");
    const view = instance.view;
    const bold = doc.indexOf("加粗");

    view.dispatch({ selection: { anchor: bold } });
    await settle();

    expect(instance.mode).toBe("live");
    expect(renderedText(view)).toContain("**加粗**");

    instance.setMode("immersive");
    await settle();

    expect(instance.mode).toBe("immersive");
    expect(instance.view).toBe(view);
    expect(renderedText(view)).not.toContain("**加粗**");
    expect(renderedText(view)).toContain("加粗");

    instance.setMode("source");
    await settle();

    expect(instance.mode).toBe("source");
    expect(instance.view).toBe(view);
    expect(renderedText(view)).toContain("**加粗**");
    expect(renderedText(view)).toContain("# 标题");
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("toggles bold with the Mod-b binding in immersive mode", () => {
    const instance = mount("immersive");
    const view = instance.view;
    const anchor = doc.indexOf("普通项");

    view.dispatch({
      selection: { anchor, head: anchor + "普通项".length },
    });
    pressMod(view, "b", "KeyB");

    expect(view.state.doc.toString()).toContain("**普通项**");
  });

  it("runs app commands before basicSetup's default keymap", () => {
    const instance = createEditor({
      parent,
      doc,
      commands: [
        {
          id: "test.insert",
          label: "插入 I",
          key: "Mod-i",
          run: (view) => {
            view.dispatch({ changes: { from: 0, insert: "I" } });
            return true;
          },
        },
      ],
    });
    const view = instance.view;

    pressMod(view, "i", "KeyI");

    expect(view.state.doc.toString()).toBe(`I${doc}`);
  });
});
