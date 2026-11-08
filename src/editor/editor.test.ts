import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function composition(
  view: EditorView,
  type: "compositionstart" | "compositionend",
) {
  view.contentDOM.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
}

function checkboxes(view: EditorView) {
  return view.contentDOM.querySelectorAll<HTMLElement>(".cm-nicole-checkbox");
}

function taskStart() {
  const index = doc.indexOf("- [ ] 待办");
  if (index < 0) throw new Error("fixture is missing the task item");
  return index;
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
    const view = instance.view;

    pressMod(view, "i", "KeyI");

    expect(view.state.doc.toString()).toBe(`I${doc}`);
  });
});

describe("IME composition", () => {
  for (const mode of ["live", "immersive"] as const) {
    it(`keeps ${mode} decorations while composing and rebuilds after it ends`, async () => {
      const instance = mount(mode);
      const view = instance.view;
      await settle();
      const box = checkboxes(view)[0]!;
      expect(box).toBeDefined();
      const insertAt = taskStart();

      composition(view, "compositionstart");
      expect(view.compositionStarted).toBe(true);

      view.dispatch({
        changes: { from: insertAt, insert: "拼" },
        selection: { anchor: insertAt + 1 },
        userEvent: "input.type.compose",
      });
      await settle();

      // With text in front of it the item no longer parses as a task, so the
      // widget surviving means the decorations were not recomputed. It is also
      // the same DOM node, because the widget is only mapped, not rebuilt.
      expect(checkboxes(view)).toHaveLength(1);
      expect(checkboxes(view)[0]).toBe(box);

      composition(view, "compositionend");
      expect(view.compositionStarted).toBe(false);

      // The first update after the composition refreshes the rendering, even
      // when it carries no change of its own.
      view.dispatch({});
      await settle();

      expect(checkboxes(view)).toHaveLength(0);
    });
  }

  it("ignores undo and redo while an IME composition is active", () => {
    const instance = mount("live");
    const view = instance.view;
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });

    composition(view, "compositionstart");
    expect(instance.undo()).toBe(false);
    expect(view.state.doc.toString()).toBe(`${doc}!`);
    composition(view, "compositionend");

    expect(instance.undo()).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);

    composition(view, "compositionstart");
    expect(instance.redo()).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
    composition(view, "compositionend");

    expect(instance.redo()).toBe(true);
    expect(view.state.doc.toString()).toBe(`${doc}!`);
  });

  it("reports both ends of a composition even when it changes nothing", () => {
    document.body.innerHTML = '<div id="probe"></div>';
    const probe = document.querySelector<HTMLElement>("#probe")!;
    const onCompositionStart = vi.fn();
    const onCompositionEnd = vi.fn();
    const instance = createEditor({
      parent: probe,
      doc,
      onCompositionStart,
      onCompositionEnd,
    });
    const view = instance.view;

    composition(view, "compositionstart");
    expect(onCompositionStart).toHaveBeenCalledTimes(1);
    expect(onCompositionEnd).not.toHaveBeenCalled();
    composition(view, "compositionend");
    expect(onCompositionEnd).toHaveBeenCalledTimes(1);

    composition(view, "compositionstart");
    instance.destroy();
    composition(view, "compositionstart");
    composition(view, "compositionend");
    expect(onCompositionStart).toHaveBeenCalledTimes(2);
    expect(onCompositionEnd).toHaveBeenCalledTimes(1);
  });

  it("rebuilds decorations for ordinary typing", async () => {
    const instance = mount("live");
    const view = instance.view;
    await settle();
    expect(checkboxes(view)).toHaveLength(1);

    const insertAt = taskStart();
    view.dispatch({
      changes: { from: insertAt, insert: "拼" },
      selection: { anchor: insertAt + 1 },
      userEvent: "input.type",
    });
    await settle();

    expect(checkboxes(view)).toHaveLength(0);
  });
});

describe("task checkbox", () => {
  it("reuses the widget DOM and toggles the task at its current position", async () => {
    const instance = mount("live");
    const view = instance.view;
    await settle();
    const box = checkboxes(view)[0]!;
    const click = () => {
      box.querySelector("input")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    };

    view.dispatch({
      changes: { from: 0, insert: "前" },
      selection: { anchor: 1 },
    });
    await settle();

    // Typing earlier in the document must not recreate the widget.
    expect(checkboxes(view)[0]).toBe(box);

    click();
    await settle();
    expect(view.state.doc.toString()).toBe(
      `前${doc}`.replace("- [ ] 待办", "- [x] 待办"),
    );
    expect(checkboxes(view)[0]).toBe(box);
    expect(
      checkboxes(view)[0]!.classList.contains("cm-nicole-checkbox-checked"),
    ).toBe(true);

    // The DOM was reused, so this also proves the toggle reads the current
    // document state instead of the state captured when `toDOM` ran.
    click();
    await settle();
    expect(view.state.doc.toString()).toBe(`前${doc}`);
    expect(
      checkboxes(view)[0]!.classList.contains("cm-nicole-checkbox-checked"),
    ).toBe(false);
  });

  it("maps the selection through an external document replacement", () => {
    const instance = createEditor({ parent, doc });
    editor = instance;
    const view = instance.view;
    const target = doc.indexOf("加粗") + 1;
    view.dispatch({ selection: { anchor: target } });

    const next = `新增的前言\n\n${doc}`;
    instance.replaceDocument(next);

    expect(view.state.doc.toString()).toBe(next);
    const mapped = view.state.selection.main.head;
    expect(view.state.sliceDoc(mapped - 1, mapped + 1)).toBe("加粗");
  });

  it("keeps focus on the checkbox when it is toggled", async () => {
    const instance = mount("live");
    const view = instance.view;
    await settle();
    const box = checkboxes(view)[0]!;
    const input = box.querySelector("input")!;
    input.focus();
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await settle();

    expect(view.state.doc.toString()).toContain("- [x] 待办");
    expect(checkboxes(view)[0]).toBe(box);
    expect(box.querySelector("input")).toBe(input);
    expect(input.checked).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});

describe("background restore state", () => {
  it("restores the selection and undo history into a new view", () => {
    const first = createEditor({ parent, doc: "one\ntwo\n" });
    first.view.dispatch({
      changes: { from: 7, insert: "three\n" },
      selection: { anchor: 2, head: 4 },
    });
    const restore = first.getRestoreState();
    first.destroy();

    expect(restore.selection?.ranges[0]).toEqual({ anchor: 2, head: 4 });
    expect(restore.history).not.toBeNull();

    editor = createEditor({
      parent,
      doc: "one\ntwo\nthree\n",
      restore,
    });
    expect(editor.view.state.selection.main.from).toBe(2);
    expect(editor.view.state.selection.main.to).toBe(4);
    expect(editor.undo()).toBe(true);
    expect(editor.view.state.doc.toString()).toBe("one\ntwo\n");
  });

  it("restores multiple selections", () => {
    // Dispatching a fresh multi-selection needs layout that jsdom does not
    // provide; restoring one directly exercises the app's background-tab path.
    editor = createEditor({
      parent,
      doc: "alpha beta gamma",
      restore: {
        selection: {
          ranges: [
            { anchor: 0, head: 5 },
            { anchor: 11, head: 16 },
          ],
          main: 1,
        },
        history: null,
        scrollTopLine: null,
        scrollTopOffset: null,
      },
    });
    expect(editor.view.state.selection.ranges).toHaveLength(2);
    expect(editor.view.state.selection.main.from).toBe(11);
    expect(editor.view.state.selection.main.to).toBe(16);
  });

  it("clamps a stale selection to the current document", () => {
    const first = createEditor({ parent, doc: "alpha beta" });
    first.view.dispatch({ selection: { anchor: 8, head: 10 } });
    const restore = first.getRestoreState();
    first.destroy();

    editor = createEditor({ parent, doc: "short", restore });
    expect(editor.view.state.selection.main.from).toBe(5);
    expect(editor.view.state.selection.main.to).toBe(5);
  });

  it("records and restores the anchor below the document's top padding", async () => {
    const blockAtHeight = vi
      .spyOn(EditorView.prototype, "lineBlockAtHeight")
      .mockImplementation(function (this: EditorView) {
        const line = this.state.doc.line(2);
        return {
          from: line.from,
          to: line.to,
          top: 10,
          bottom: 24,
          height: 14,
        } as never;
      });
    const blockAt = vi
      .spyOn(EditorView.prototype, "lineBlockAt")
      .mockImplementation(function (this: EditorView, pos: number) {
        const line = this.state.doc.lineAt(pos);
        return {
          from: line.from,
          to: line.to,
          top: 10,
          bottom: 24,
          height: 14,
        } as never;
      });
    const padding = vi
      .spyOn(EditorView.prototype, "documentPadding", "get")
      .mockReturnValue({ top: 48, bottom: 112 });

    try {
      editor = createEditor({ parent, doc: "one\ntwo\nthree" });
      editor.view.scrollDOM.scrollTop = 70;
      const restore = editor.getRestoreState();

      // 70 - 48 padding, plus one pixel to stay on the line at the edge.
      expect(blockAtHeight).toHaveBeenCalledWith(23);
      expect(restore.scrollTopLine).toBe(2);
      expect(restore.scrollTopOffset).toBe(12);

      editor.destroy();
      editor = createEditor({
        parent,
        doc: "one\ntwo\nthree",
        restore: {
          selection: null,
          history: null,
          scrollTopLine: restore.scrollTopLine,
          scrollTopOffset: restore.scrollTopOffset,
        },
      });
      expect(editor.view.scrollDOM.scrollTop).toBe(70);
      await settle();
      expect(editor.view.scrollDOM.scrollTop).toBe(70);
    } finally {
      blockAtHeight.mockRestore();
      blockAt.mockRestore();
      padding.mockRestore();
    }
  });

  it("keeps the top line and its offset when the disk text is reloaded", async () => {
    const blockForLine = (view: EditorView, lineNumber: number) => {
      const line = view.state.doc.line(
        Math.min(Math.max(1, lineNumber), view.state.doc.lines),
      );
      const top = (line.number - 1) * 20;
      return {
        from: line.from,
        to: line.to,
        top,
        bottom: top + 20,
        height: 20,
      } as never;
    };
    const blockAtHeight = vi
      .spyOn(EditorView.prototype, "lineBlockAtHeight")
      .mockImplementation(function (this: EditorView, height: number) {
        return blockForLine(this, Math.floor(Math.max(0, height) / 20) + 1);
      });
    const blockAt = vi
      .spyOn(EditorView.prototype, "lineBlockAt")
      .mockImplementation(function (this: EditorView, pos: number) {
        return blockForLine(this, this.state.doc.lineAt(pos).number);
      });
    const padding = vi
      .spyOn(EditorView.prototype, "documentPadding", "get")
      .mockReturnValue({ top: 48, bottom: 112 });

    try {
      editor = createEditor({ parent, doc: "a\nb\nc\nd" });
      editor.view.scrollDOM.scrollTop = 100;
      // Line 3 ("c") is the top line, 12px into it.
      const top = blockForLine(editor.view, 3) as { from: number };
      expect(editor.view.state.doc.lineAt(top.from).text).toBe("c");

      editor.replaceDocument("x\na\nb\nc\nd");
      // One line moved above the anchor, so the same text is line 4 now and
      // the scroll offset follows it.
      expect(editor.view.scrollDOM.scrollTop).toBe(120);
      await settle();
      expect(editor.view.scrollDOM.scrollTop).toBe(120);
    } finally {
      blockAtHeight.mockRestore();
      blockAt.mockRestore();
      padding.mockRestore();
    }
  });
});

describe("scroll restore correction", () => {
  const restoreLine2 = {
    selection: null,
    history: null,
    scrollTopLine: 2,
    scrollTopOffset: 12,
  };

  function stubLayout(
    paddingTop: () => number,
    topForLine: (line: number) => number = () => 10,
  ) {
    const blockAt = vi
      .spyOn(EditorView.prototype, "lineBlockAt")
      .mockImplementation(function (this: EditorView, pos: number) {
        const line = this.state.doc.lineAt(pos);
        const top = topForLine(line.number);
        return {
          from: line.from,
          to: line.to,
          top,
          bottom: top + 14,
          height: 14,
        } as never;
      });
    const blockAtHeight = vi
      .spyOn(EditorView.prototype, "lineBlockAtHeight")
      .mockImplementation(function (this: EditorView) {
        const line = this.state.doc.line(2);
        return {
          from: line.from,
          to: line.to,
          top: 10,
          bottom: 24,
          height: 14,
        } as never;
      });
    const padding = vi
      .spyOn(EditorView.prototype, "documentPadding", "get")
      .mockImplementation(() => ({ top: paddingTop(), bottom: 0 }));
    return {
      restore() {
        blockAt.mockRestore();
        blockAtHeight.mockRestore();
        padding.mockRestore();
      },
    };
  }

  function trackScrollTop(element: HTMLElement, initial: number) {
    let value = initial;
    let writes = 0;
    Object.defineProperty(element, "scrollTop", {
      configurable: true,
      get: () => value,
      set: (next: number) => {
        writes += 1;
        value = next;
      },
    });
    return {
      get value() {
        return value;
      },
      set value(next: number) {
        value = next;
      },
      get writes() {
        return writes;
      },
    };
  }

  it("keeps correcting after the first measurement reveals the padding", async () => {
    let paddingTop = 0;
    const layout = stubLayout(() => paddingTop);
    try {
      editor = createEditor({
        parent,
        doc: "one\ntwo\nthree",
        restore: restoreLine2,
      });
      // Before measuring, the top padding is reported as zero.
      expect(editor.view.scrollDOM.scrollTop).toBe(22);

      paddingTop = 48;
      await settle();
      expect(editor.view.scrollDOM.scrollTop).toBe(70);
      await settle();
      expect(editor.view.scrollDOM.scrollTop).toBe(70);
    } finally {
      layout.restore();
    }
  });

  it("stops correcting after the view is destroyed", async () => {
    let paddingTop = 0;
    let destroyedView = false;
    let readsAfterDestroy = 0;
    const blockAt = vi
      .spyOn(EditorView.prototype, "lineBlockAt")
      .mockImplementation(function (this: EditorView) {
        if (destroyedView) readsAfterDestroy += 1;
        const line = this.state.doc.line(2);
        return {
          from: line.from,
          to: line.to,
          top: 10,
          bottom: 24,
          height: 14,
        } as never;
      });
    const padding = vi
      .spyOn(EditorView.prototype, "documentPadding", "get")
      .mockImplementation(() => ({ top: paddingTop, bottom: 0 }));

    try {
      const instance = createEditor({
        parent,
        doc: "one\ntwo\nthree",
        restore: restoreLine2,
      });
      const scroll = trackScrollTop(instance.view.scrollDOM, 22);
      destroyedView = true;
      instance.destroy();
      paddingTop = 48;
      await settle();
      await settle();

      expect(scroll.writes).toBe(0);
      expect(readsAfterDestroy).toBe(0);
    } finally {
      blockAt.mockRestore();
      padding.mockRestore();
    }
  });

  it("lets a newer anchor request supersede the pending correction", async () => {
    let paddingTop = 0;
    let line2Reads = 0;
    const blockAt = vi
      .spyOn(EditorView.prototype, "lineBlockAt")
      .mockImplementation(function (this: EditorView, pos: number) {
        const line = this.state.doc.lineAt(pos);
        const top = line.number === 2 ? 10 + 40 * line2Reads++ : 100;
        return {
          from: line.from,
          to: line.to,
          top,
          bottom: top + 14,
          height: 14,
        } as never;
      });
    const blockAtHeight = vi
      .spyOn(EditorView.prototype, "lineBlockAtHeight")
      .mockImplementation(function (this: EditorView) {
        const line = this.state.doc.line(2);
        return {
          from: line.from,
          to: line.to,
          top: 10,
          bottom: 24,
          height: 14,
        } as never;
      });
    const padding = vi
      .spyOn(EditorView.prototype, "documentPadding", "get")
      .mockImplementation(() => ({ top: paddingTop, bottom: 0 }));

    try {
      const instance = createEditor({
        parent,
        doc: "a\nb\nc",
        restore: restoreLine2,
      });
      expect(instance.view.scrollDOM.scrollTop).toBe(22);

      instance.replaceDocument("x\na\nb\nc");
      // The same text ("b") is line 3 now; its block starts at 100.
      expect(instance.view.scrollDOM.scrollTop).toBe(112);

      paddingTop = 48;
      const readsBeforeFrames = line2Reads;
      for (let frame = 0; frame < 8; frame += 1) await settle();

      // The new anchor wins even though the old correction would keep running
      // for six frames, and the old line is no longer read.
      expect(instance.view.scrollDOM.scrollTop).toBe(160);
      expect(line2Reads).toBe(readsBeforeFrames);
    } finally {
      blockAt.mockRestore();
      blockAtHeight.mockRestore();
      padding.mockRestore();
    }
  });

  it.each(["wheel", "touchstart", "pointerdown", "keydown"])(
    "stops correcting after a user %s event",
    async (type) => {
      let paddingTop = 0;
      const layout = stubLayout(() => paddingTop);
      try {
        const instance = createEditor({
          parent,
          doc: "one\ntwo\nthree",
          restore: restoreLine2,
        });
        const scroll = trackScrollTop(instance.view.scrollDOM, 22);
        // The listener sits on the editor root in the capture phase; a
        // user event on the content bubbles through it.
        instance.view.dom.dispatchEvent(
          new Event(type, { bubbles: true, cancelable: true }),
        );
        const writesAfterEvent = scroll.writes;
        scroll.value = 1500;
        paddingTop = 48;
        await settle();
        await settle();

        expect(scroll.writes).toBe(writesAfterEvent);
        expect(scroll.value).toBe(1500);
      } finally {
        layout.restore();
      }
    },
  );

  it("stops correcting when the user edits during it", async () => {
    let paddingTop = 0;
    const layout = stubLayout(() => paddingTop);
    try {
      const instance = createEditor({
        parent,
        doc: "one\ntwo\nthree",
        restore: restoreLine2,
      });
      const scroll = trackScrollTop(instance.view.scrollDOM, 22);
      const view = instance.view;
      view.dispatch(view.state.replaceSelection("x"), {
        userEvent: "input.type",
      });
      const writesAfterEdit = scroll.writes;
      scroll.value = 500;
      paddingTop = 48;
      await settle();
      await settle();

      expect(scroll.writes).toBe(writesAfterEdit);
      expect(scroll.value).toBe(500);
    } finally {
      layout.restore();
    }
  });
});
