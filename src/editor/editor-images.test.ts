import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorHandle } from "./index";

const doc = "# 标题\n\n正文\n";

let parent: HTMLElement;
let editor: EditorHandle | null = null;

function mount(options: Parameters<typeof createEditor>[0] = { parent, doc }) {
  editor = createEditor(options);
  return editor;
}

async function settle() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function pasteEvent(items: Array<{ kind: string; type: string }>) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { items, files: [], types: items.map((item) => item.type), getData: () => "" },
  });
  return event;
}

function dropEvent(types: string[], clientX = 0, clientY = 0) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [new File(["image"], "photo.png", { type: "image/png" })],
      types,
    },
  });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  return event;
}

function composition(
  view: EditorView,
  type: "compositionstart" | "compositionend",
) {
  view.contentDOM.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
  parent.style.height = "600px";
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("image insertion", () => {
  it("reports an image paste at the selection and blocks the default paste", () => {
    const onPasteImage = vi.fn();
    const instance = mount({ parent, doc, onPasteImage });
    const view = instance.view;
    view.dispatch({ selection: { anchor: 3 } });

    const event = pasteEvent([{ kind: "file", type: "image/png" }]);
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onPasteImage).toHaveBeenCalledWith(3);
  });

  it("leaves text-only paste to the editor", () => {
    const onPasteImage = vi.fn();
    const instance = mount({ parent, doc, onPasteImage });

    const event = pasteEvent([{ kind: "string", type: "text/plain" }]);
    instance.view.contentDOM.dispatchEvent(event);

    expect(onPasteImage).not.toHaveBeenCalled();
  });

  it("reports file drops at the cursor", () => {
    const onDropFiles = vi.fn();
    const instance = mount({ parent, doc, onDropFiles });
    const view = instance.view;
    view.dispatch({ selection: { anchor: 4 } });
    vi.spyOn(view, "posAtCoords").mockReturnValue(null);

    const event = dropEvent(["Files"]);
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onDropFiles).toHaveBeenCalledWith(4);
  });

  it("inserts Markdown as one undo step", () => {
    const instance = mount();
    const view = instance.view;

    instance.insertImages(0, ["![](a.png)", "![](b.png)"]);

    expect(view.state.doc.toString()).toBe("![](a.png)\n![](b.png)\n" + doc);
    undo(view);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("keeps image insertion separate from typing before it", async () => {
    const instance = mount();
    const view = instance.view;

    view.dispatch({ changes: { from: 0, insert: "输入" }, selection: { anchor: 2 } });
    instance.insertImages(2, ["![](a.png)"]);

    undo(view);
    expect(view.state.doc.toString()).toBe("输入" + doc);
    await settle();
  });

  it("waits for an IME composition before inserting", async () => {
    const instance = mount();
    const view = instance.view;
    composition(view, "compositionstart");

    instance.insertImages(0, ["![](a.png)"]);
    expect(view.state.doc.toString()).toBe(doc);

    composition(view, "compositionend");
    await settle();

    expect(view.state.doc.toString()).toBe("![](a.png)\n" + doc);
  });

  it("does nothing for an empty insertion", () => {
    const instance = mount();
    const view = instance.view;

    instance.insertImages(0, []);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
