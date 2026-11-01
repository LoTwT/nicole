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
