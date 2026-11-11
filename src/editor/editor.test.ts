import { syntaxTreeAvailable } from "@codemirror/language";
import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorHandle, type EditorMode } from "./index";
import { until } from "./test-helpers";

// jsdom reports an empty navigator.platform, which CodeMirror treats as
// non-Mac when it resolves `Mod` at module load. Pin it to Windows so the Ctrl
// forwarding cases use one default keymap; mount() without a platform then
// defaults to windows as well. The macOS cases below spell out Meta explicitly.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", {
    value: "Win32",
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

async function settleTimer() {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  await settle();
}

function pressKey(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function mountOn(
  platform: "macos" | "windows" | "linux",
  mode: EditorMode = "live",
) {
  editor = createEditor({ parent, doc, mode, platform });
  return editor;
}

async function waitForTaskBoxes(view: EditorView, count = 1) {
  await until(
    () => checkboxes(view).length === count,
    `${count} task checkbox${count === 1 ? "" : "es"} to render`,
  );
}

async function mountWithTask(
  mode: EditorMode = "live",
  platform?: "macos" | "windows" | "linux",
) {
  const instance = platform === undefined ? mount(mode) : mountOn(platform, mode);
  await waitForTaskBoxes(instance.view);
  return instance;
}

function selectRenderedText(view: EditorView, from = 0, to = 2) {
  const line = view.contentDOM.querySelector(".cm-line")!;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let text: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.data.length >= Math.max(from, to)) {
      text = node;
      break;
    }
  }
  if (!text) throw new Error("expected a text node in the rendered line");
  const range = document.createRange();
  range.setStart(text, Math.min(from, text.data.length));
  range.setEnd(text, Math.min(to, text.data.length));
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
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
    await until(
      () => renderedText(view).includes("**加粗**"),
      "the revealed bold markers",
    );

    expect(instance.mode).toBe("live");
    expect(renderedText(view)).toContain("**加粗**");

    instance.setMode("immersive");
    await until(
      () => !renderedText(view).includes("**加粗**"),
      "the hidden bold markers",
    );

    expect(instance.mode).toBe("immersive");
    expect(instance.view).toBe(view);
    expect(renderedText(view)).not.toContain("**加粗**");
    expect(renderedText(view)).toContain("加粗");

    instance.setMode("source");
    await until(
      () => renderedText(view).includes("# 标题"),
      "the source-mode heading",
    );

    expect(instance.mode).toBe("source");
    expect(instance.view).toBe(view);
    expect(renderedText(view)).toContain("**加粗**");
    expect(renderedText(view)).toContain("# 标题");
    expect(view.state.doc.toString()).toBe(doc);
  }, 15000);
});

describe("IME composition", () => {
  for (const mode of ["live", "immersive"] as const) {
    it(`keeps ${mode} decorations while composing and rebuilds after it ends`, async () => {
      const instance = await mountWithTask(mode);
      const view = instance.view;
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
    const instance = await mountWithTask("live");
    const view = instance.view;
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
    const instance = await mountWithTask("live");
    const view = instance.view;
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
    const instance = await mountWithTask("live");
    const view = instance.view;
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

  for (const mode of ["live", "immersive"] as const) {
    it(`keeps editing keys away from the document while the checkbox has focus (${mode})`, async () => {
      const instance = await mountWithTask(mode, "macos");
      const view = instance.view;
      const input = checkboxes(view)[0]!.querySelector("input")!;
      const at = doc.indexOf("加粗");
      view.dispatch({ selection: { anchor: at } });
      const before = view.state.doc.toString();
      const beforeSelection = view.state.selection.main.toJSON();
      input.focus();

      const blocked: KeyboardEventInit[] = [
        { key: "a", code: "KeyA" },
        { key: "Backspace", code: "Backspace" },
        { key: "Delete", code: "Delete" },
        { key: "Enter", code: "Enter" },
        { key: "ArrowLeft", code: "ArrowLeft" },
        { key: "ArrowRight", code: "ArrowRight" },
        { key: "ArrowUp", code: "ArrowUp" },
        { key: "ArrowDown", code: "ArrowDown" },
        { key: "Backspace", code: "Backspace", altKey: true },
        { key: "A", code: "KeyA", shiftKey: true },
        ...Array.from("abcdefghijklmnopqrstuvwxyz").map((key) => ({
          key,
          code: `Key${key.toUpperCase()}`,
          ctrlKey: true,
        })),
        { key: "k", code: "KeyK", ctrlKey: true, shiftKey: true },
      ];
      const preventedAtTarget: boolean[] = [];
      const observe = (event: KeyboardEvent) => {
        preventedAtTarget.push(event.defaultPrevented);
      };
      input.addEventListener("keydown", observe);
      try {
        for (const init of blocked) {
          const event = pressKey(input, init);
          expect(event.defaultPrevented).toBe(true);
        }
      } finally {
        input.removeEventListener("keydown", observe);
      }
      // A capture listener on the content editor must run before the event
      // reaches the input; a bubble listener would let CodeMirror act first.
      expect(preventedAtTarget).toEqual(blocked.map(() => true));
      await settle();

      expect(view.state.doc.toString()).toBe(before);
      expect(view.state.selection.main.toJSON()).toEqual(beforeSelection);
      expect(document.activeElement).toBe(input);
    });
  }

  it("lets native keys and menu shortcuts through while the checkbox has focus", async () => {
    const instance = await mountWithTask("live", "macos");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();

    const allowed: KeyboardEventInit[] = [
      { key: " ", code: "Space" },
      { key: "Tab", code: "Tab" },
      { key: "Tab", code: "Tab", altKey: true },
      { key: "Escape", code: "Escape" },
      ...["q", "m", "h", "n", ","].map((key) => ({
        key,
        code: key === "," ? "Comma" : `Key${key.toUpperCase()}`,
        metaKey: true,
      })),
    ];
    for (const init of allowed) {
      const event = pressKey(input, init);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(document.activeElement).toBe(input);
  });

  it("blocks every modified Space without toggling the task", async () => {
    const instance = await mountWithTask("live", "macos");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    const before = view.state.doc.toString();
    input.focus();

    const modifiedSpaces: KeyboardEventInit[] = [
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { metaKey: true },
      { ctrlKey: true, shiftKey: true },
      { altKey: true, shiftKey: true },
      { metaKey: true, shiftKey: true },
      { metaKey: true, ctrlKey: true },
    ];
    for (const modifiers of modifiedSpaces) {
      const event = pressKey(input, {
        key: " ",
        code: "Space",
        ...modifiers,
      });
      expect(event.defaultPrevented).toBe(true);
      expect(input.checked).toBe(false);
      expect(document.activeElement).toBe(input);
    }
    await settle();
    expect(view.state.doc.toString()).toBe(before);
  });

  it("does not swallow blocked keys before window-level listeners", async () => {
    const instance = await mountWithTask("live");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();
    const windowKeydown = vi.fn();
    window.addEventListener("keydown", windowKeydown);
    try {
      const event = pressKey(input, { key: "a", code: "KeyA" });
      expect(event.defaultPrevented).toBe(true);
      expect(windowKeydown).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", windowKeydown);
    }
  });

  it("clears a non-collapsed native selection when the checkbox gains focus", async () => {
    const instance = await mountWithTask("live");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    const at = doc.indexOf("加粗");
    view.dispatch({ selection: { anchor: at, head: at + 2 } });
    const selection = selectRenderedText(view);
    expect(selection.rangeCount).toBe(1);
    expect(selection.isCollapsed).toBe(false);

    input.focus();

    expect(selection.rangeCount).toBe(0);
    expect(view.state.selection.main.from).toBe(at);
    expect(view.state.selection.main.to).toBe(at + 2);
    expect(document.activeElement).toBe(input);

    view.focus();
    expect(document.activeElement).not.toBe(input);
    expect(view.state.selection.main.from).toBe(at);
    expect(view.state.selection.main.to).toBe(at + 2);

    // A collapsed native caret must be cleared too; leaving it behind lets
    // WebKit route native editing to the wrong position.
    const collapsed = selectRenderedText(view, 1, 1);
    expect(collapsed.rangeCount).toBe(1);
    input.focus();
    expect(collapsed.rangeCount).toBe(0);
  });

  it("clears a non-collapsed native selection on a checkbox focusin", async () => {
    const instance = await mountWithTask("live");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();

    const selection = selectRenderedText(view);
    expect(selection.rangeCount).toBe(1);
    expect(selection.isCollapsed).toBe(false);

    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(selection.rangeCount).toBe(0);
  });

  it("does not clear a native selection when focus returns to the editor", async () => {
    const instance = await mountWithTask("live");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();
    view.focus();
    expect(view.hasFocus).toBe(true);

    const focus = vi.spyOn(view, "focus");
    const selection = selectRenderedText(view);
    const before = view.state.selection.main.toJSON();
    view.contentDOM.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(selection.rangeCount).toBe(1);
    expect(focus).not.toHaveBeenCalled();
    expect(view.state.selection.main.toJSON()).toEqual(before);
    focus.mockRestore();
  });

  it("repairs focus without changing the editor scroll position", async () => {
    for (const mode of ["live", "immersive"] as const) {
      document.body.innerHTML = '<div id="host"></div>';
      parent = document.querySelector<HTMLElement>("#host")!;
      parent.style.height = "600px";
      const instance = await mountWithTask(mode, "macos");
      const view = instance.view;
      const input = checkboxes(view)[0]!.querySelector("input")!;
      view.scrollDOM.scrollTop = 321;
      input.focus();
      expect(view.scrollDOM.scrollTop).toBe(321);

      const focus = vi
        .spyOn(view, "focus")
        .mockImplementation(() => undefined);
      input.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: view.contentDOM,
        }),
      );
      view.contentDOM.dispatchEvent(
        new FocusEvent("focusin", { bubbles: true, relatedTarget: input }),
      );

      expect(focus).toHaveBeenCalledOnce();
      expect(view.scrollDOM.scrollTop).toBe(321);
      focus.mockRestore();
      instance.destroy();
      editor = undefined as never;
    }
  });

  for (const mode of ["live", "immersive"] as const) {
    it(`returns focus after replaceDocument removes the focused box (${mode})`, async () => {
      const instance = await mountWithTask(mode, "macos");
      const view = instance.view;
      const input = checkboxes(view)[0]!.querySelector("input")!;
      input.focus();
      expect(document.activeElement).toBe(input);

      instance.replaceDocument("只有普通文字\n\n第二段\n");
      await settleTimer();

      expect(document.activeElement).toBe(view.contentDOM);
      expect(view.hasFocus).toBe(true);
      expect(view.state.selection.main.empty).toBe(true);
      expect(view.state.selection.main.head).toBe(0);
    });
  }

  it("does not steal focus from another control", async () => {
    const instance = await mountWithTask("live", "macos");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();

    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    await settleTimer();

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("returns focus after undo removes the focused box", async () => {
    const instance = await mountWithTask("live", "macos");
    const view = instance.view;
    view.dispatch({
      changes: { from: doc.length, insert: "\n- [ ] 新任务\n" },
    });
    await waitForTaskBoxes(view, 2);
    const input = checkboxes(view)[1]!.querySelector("input")!;
    input.focus();

    expect(instance.undo()).toBe(true);
    await settleTimer();

    expect(view.state.doc.toString()).toBe(doc);
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.hasFocus).toBe(true);
  });

  it("recovers a box removed while the window is blurred after it returns", async () => {
    const instance = await mountWithTask("live", "macos");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);

    instance.replaceDocument("只有普通文字\n\n第二段\n");
    await settleTimer();

    expect(document.activeElement).not.toBe(view.contentDOM);

    hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    await settleTimer();

    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.hasFocus).toBe(true);
    hasFocus.mockRestore();
  });

  it("does not take focus back from another control after the box is gone", async () => {
    const instance = await mountWithTask("live", "macos");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();
    const outside = document.createElement("input");
    document.body.append(outside);

    instance.replaceDocument("只有普通文字\n\n第二段\n");
    outside.focus();
    await settleTimer();

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("keeps focus on a connected box across ordinary updates", async () => {
    const instance = await mountWithTask("live", "macos");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();

    view.dispatch({ changes: { from: 0, insert: "前" } });
    await settleTimer();

    expect(document.activeElement).toBe(input);
    expect(checkboxes(view)[0]!.querySelector("input")).toBe(input);

    // The ordinary update must not forget the box: removing it afterwards still
    // returns the keyboard to the editor.
    instance.replaceDocument("只有普通文字\n\n第二段\n");
    await settleTimer();

    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.hasFocus).toBe(true);
  });

  it("blocks native editing events while the checkbox has focus", async () => {
    const instance = await mountWithTask("live");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();

    for (const type of ["beforeinput", "paste", "cut"]) {
      const event =
        type === "beforeinput"
          ? new InputEvent(type, { bubbles: true, cancelable: true })
          : new Event(type, { bubbles: true, cancelable: true });
      const observe = (seen: Event) => {
        expect(seen.defaultPrevented).toBe(true);
      };
      input.addEventListener(type, observe);
      input.dispatchEvent(event);
      input.removeEventListener(type, observe);
      expect(event.defaultPrevented).toBe(true);
    }

    view.focus();
    for (const type of ["beforeinput", "paste", "cut"]) {
      const event =
        type === "beforeinput"
          ? new InputEvent(type, { bubbles: true, cancelable: true })
          : new Event(type, { bubbles: true, cancelable: true });
      view.contentDOM.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("does not take focus or the caret on mousedown", async () => {
    const instance = await mountWithTask("live");
    const view = instance.view;
    const box = checkboxes(view)[0]!;
    const input = box.querySelector("input")!;
    const at = doc.indexOf("加粗");
    view.dispatch({ selection: { anchor: at } });
    view.focus();

    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    box.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(input);
    expect(view.state.selection.main.head).toBe(at);
  });

  it("only owns keys from the checkbox, not other page inputs", async () => {
    const instance = mount("live");
    const view = instance.view;
    await settle();

    const ordinary = document.createElement("input");
    view.contentDOM.append(ordinary);
    ordinary.focus();
    const ordinaryKey = pressKey(ordinary, { key: "a", code: "KeyA" });
    expect(ordinaryKey.defaultPrevented).toBe(false);

    const outside = document.createElement("input");
    outside.className = "cm-nicole-checkbox-input";
    document.body.append(outside);
    outside.focus();
    const outsideKey = pressKey(view.contentDOM, { key: "a", code: "KeyA" });
    expect(outsideKey.defaultPrevented).toBe(false);
    outside.remove();
  });

  it("lets CodeMirror see mouse events but not keyboard events on the widget", async () => {
    let clicks = 0;
    let keyups = 0;
    const instance = await mountWithTask("live");
    const view = instance.view;
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.domEventHandlers({
          click: () => {
            clicks += 1;
            return false;
          },
          keyup: () => {
            keyups += 1;
            return false;
          },
        }),
      ),
    });
    const box = checkboxes(view)[0]!;
    box.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    box.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "a",
        code: "KeyA",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(clicks).toBe(1);
    expect(keyups).toBe(0);
  });

  it("does not run an editor keymap binding for Space on the widget", async () => {
    const runSpace = vi.fn(() => true);
    const instance = createEditor({
      parent,
      doc,
      mode: "live",
      commands: [
        {
          id: "test.space",
          label: "Space",
          group: "insert",
          scope: "editor",
          keys: [{ key: "Space" }],
          run: runSpace,
        },
      ],
    });
    editor = instance;
    const view = instance.view;
    await waitForTaskBoxes(view);
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();

    const event = pressKey(input, { key: " ", code: "Space" });

    expect(event.defaultPrevented).toBe(false);
    expect(runSpace).not.toHaveBeenCalled();
  });

  it("forwards Find from the primary modifier on Windows", async () => {
    const instance = await mountWithTask("live", "windows");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();

    const find = pressKey(input, {
      key: "f",
      code: "KeyF",
      ctrlKey: true,
    });
    expect(find.defaultPrevented).toBe(true);
    expect(instance.search.snapshot().open).toBe(true);
    expect(view.dom.querySelector(".cm-panel input")).toBeNull();
    expect(document.activeElement).toBe(view.contentDOM);

    input.focus();
    const next = pressKey(input, {
      key: "g",
      code: "KeyG",
      ctrlKey: true,
    });
    expect(next.defaultPrevented).toBe(true);
    expect(instance.search.snapshot().open).toBe(true);
  });

  it("forwards Select All from the primary modifier on Windows", async () => {
    const instance = await mountWithTask("live", "windows");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();
    view.dispatch({ selection: { anchor: 0 } });

    const event = pressKey(input, {
      key: "a",
      code: "KeyA",
      ctrlKey: true,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(doc.length);
    expect(document.activeElement).toBe(view.contentDOM);
  });

  it("forwards Meta shortcuts on macOS without handling them twice", async () => {
    const run = vi.fn(() => true);
    const instance = createEditor({
      parent,
      doc,
      mode: "live",
      platform: "macos",
      commands: [
        {
          id: "test.meta",
          label: "Meta",
          group: "insert",
          scope: "editor",
          keys: [{ key: "Meta-f" }, { key: "Meta-g" }, { key: "Meta-a" }],
          run,
        },
      ],
    });
    editor = instance;
    const view = instance.view;
    await waitForTaskBoxes(view);
    const input = checkboxes(view)[0]!.querySelector("input")!;

    for (const [key, code] of [
      ["f", "KeyF"],
      ["g", "KeyG"],
      ["a", "KeyA"],
    ] as const) {
      input.focus();
      const event = pressKey(input, { key, code, metaKey: true });
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(view.contentDOM);
    }
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("forwards find-previous with Shift but no other shifted or Alt shortcut", async () => {
    const runG = vi.fn(() => true);
    const runF = vi.fn(() => true);
    const runA = vi.fn(() => true);
    const runAlt = vi.fn(() => true);
    const instance = createEditor({
      parent,
      doc,
      mode: "live",
      platform: "macos",
      commands: [
        {
          id: "test.shift-g",
          label: "Shift G",
          group: "insert",
          scope: "editor",
          keys: [{ key: "Meta-Shift-g" }],
          run: runG,
        },
        {
          id: "test.shift-f",
          label: "Shift F",
          group: "insert",
          scope: "editor",
          keys: [{ key: "Meta-Shift-f" }],
          run: runF,
        },
        {
          id: "test.shift-a",
          label: "Shift A",
          group: "insert",
          scope: "editor",
          keys: [{ key: "Meta-Shift-a" }],
          run: runA,
        },
        {
          id: "test.alt-g",
          label: "Alt G",
          group: "insert",
          scope: "editor",
          keys: [{ key: "Meta-Alt-g" }],
          run: runAlt,
        },
      ],
    });
    editor = instance;
    const view = instance.view;
    await waitForTaskBoxes(view);
    const input = checkboxes(view)[0]!.querySelector("input")!;

    input.focus();
    const previous = pressKey(input, {
      key: "g",
      code: "KeyG",
      metaKey: true,
      shiftKey: true,
    });
    expect(previous.defaultPrevented).toBe(true);
    expect(runG).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(view.contentDOM);

    for (const [key, code, run] of [
      ["f", "KeyF", runF],
      ["a", "KeyA", runA],
    ] as const) {
      input.focus();
      const event = pressKey(input, {
        key,
        code,
        metaKey: true,
        shiftKey: true,
      });
      expect(event.defaultPrevented).toBe(false);
      expect(run).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
    }

    input.focus();
    const withAlt = pressKey(input, {
      key: "g",
      code: "KeyG",
      metaKey: true,
      altKey: true,
    });
    expect(withAlt.defaultPrevented).toBe(false);
    expect(runAlt).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("uses Ctrl as the primary modifier on Windows and Linux", async () => {
    for (const platform of ["windows", "linux"] as const) {
      document.body.innerHTML = '<div id="host"></div>';
      parent = document.querySelector<HTMLElement>("#host")!;
      parent.style.height = "600px";
      const run = vi.fn(() => true);
      const instance = createEditor({
        parent,
        doc,
        mode: "live",
        platform,
        commands: [
          {
            id: "test.primary",
            label: "Primary",
            group: "insert",
            scope: "editor",
            keys: [{ key: "Ctrl-a" }],
            run,
          },
        ],
      });
      editor = instance;
      const view = instance.view;
      await waitForTaskBoxes(view);
      const input = checkboxes(view)[0]!.querySelector("input")!;
      input.focus();

      const event = pressKey(input, {
        key: "a",
        code: "KeyA",
        ctrlKey: true,
      });

      expect(event.defaultPrevented).toBe(true);
      expect(run).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(view.contentDOM);

      const nextInput = checkboxes(view)[0]!.querySelector("input")!;
      nextInput.focus();
      const previous = pressKey(nextInput, {
        key: "g",
        code: "KeyG",
        ctrlKey: true,
        shiftKey: true,
      });

      expect(previous.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(view.contentDOM);
      instance.destroy();
      editor = undefined as never;
    }
  });

  it("keeps macOS Control shortcuts away from editor commands", async () => {
    const run = vi.fn(() => true);
    const instance = createEditor({
      parent,
      doc,
      mode: "live",
      platform: "macos",
      commands: [
        {
          id: "test.control",
          label: "Control",
          group: "insert",
          scope: "editor",
          keys: [{ key: "Ctrl-a" }],
          run,
        },
      ],
    });
    editor = instance;
    const view = instance.view;
    await waitForTaskBoxes(view);
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();

    const event = pressKey(input, {
      key: "a",
      code: "KeyA",
      ctrlKey: true,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("recovers native Select All while the checkbox has focus", async () => {
    const instance = await mountWithTask("live");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();
    view.dispatch({ selection: { anchor: 0 } });

    const direct = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(direct);

    expect(direct.defaultPrevented).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(doc.length);
    expect(document.activeElement).toBe(view.contentDOM);
  });

  it("ignores selectstart outside the page background while the checkbox has focus", async () => {
    const instance = await mountWithTask("live");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();
    view.dispatch({ selection: { anchor: 4 } });
    const div = document.createElement("div");
    document.body.append(div);

    const event = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
    div.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(view.state.selection.main.to).toBe(4);
    expect(document.activeElement).toBe(input);
    div.remove();
  });

  it("does not turn a body selectstart into Select All after the checkbox lost focus", async () => {
    const instance = await mountWithTask("live");
    const view = instance.view;
    const input = checkboxes(view)[0]!.querySelector("input")!;
    input.focus();
    view.dispatch({ selection: { anchor: 4 } });
    view.focus();
    const before = view.state.selection.main.toJSON();

    const menu = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(menu);

    expect(menu.defaultPrevented).toBe(false);
    expect(view.state.selection.main.toJSON()).toEqual(before);
    expect(document.activeElement).toBe(view.contentDOM);
  });

  it("removes its checkbox, document and window listeners when destroyed", async () => {
    const instance = await mountWithTask("live");
    const input = checkboxes(instance.view)[0]!.querySelector("input")!;
    const remove = vi.spyOn(instance.view.contentDOM, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    input.focus();
    instance.destroy();
    editor = undefined as never;

    for (const type of [
      "focusout",
      "focusin",
      "keydown",
      "beforeinput",
      "paste",
      "cut",
    ]) {
      expect(remove).toHaveBeenCalledWith(type, expect.any(Function), true);
    }
    expect(removeDocument).toHaveBeenCalledWith(
      "selectstart",
      expect.any(Function),
      true,
    );
    expect(removeWindow).toHaveBeenCalledWith("focus", expect.any(Function));
    remove.mockRestore();
    removeDocument.mockRestore();
    removeWindow.mockRestore();
  });
});

describe("preview decorations after a truncated parse", () => {
  for (const mode of ["live", "immersive"] as const) {
    it(`draws preview decorations when a truncated first parse catches up (${mode})`, async () => {
      const realNow = Date.now;
      let calls = 0;
      const clock = vi.spyOn(Date, "now").mockImplementation(() => {
        calls += 1;
        // The first read sets the 20 ms parse deadline; every later read jumps
        // past it so the initial tree stops at the first block.
        return calls === 1 ? realNow() : realNow() + calls * 10_000;
      });
      let instance: EditorHandle;
      try {
        instance = mountOn("macos", mode);
      } finally {
        clock.mockRestore();
      }
      const view = instance.view;

      expect(syntaxTreeAvailable(view.state, view.state.doc.length)).toBe(false);
      expect(checkboxes(view)).toHaveLength(0);
      const selection = view.state.selection.toJSON();
      const text = view.state.doc.toString();
      const scrollTop = view.scrollDOM.scrollTop;
      const scrollRequests: boolean[] = [];
      view.dispatch({
        effects: StateEffect.appendConfig.of(
          EditorView.updateListener.of((update) => {
            scrollRequests.push(
              ...update.transactions.map(
                (transaction) => transaction.scrollIntoView,
              ),
            );
          }),
        ),
      });

      // Only the background parser runs here: no selection or document update
      // may be needed to draw the task box, heading and hidden emphasis marks.
      await until(
        () => syntaxTreeAvailable(view.state, view.state.doc.length),
        "the full syntax tree",
        4000,
      );
      await until(
        () => checkboxes(view).length === 1,
        "the task checkbox",
        4000,
      );

      expect(checkboxes(view)).toHaveLength(1);
      expect(view.contentDOM.querySelector(".cm-nicole-h1")).not.toBeNull();
      expect(renderedText(view)).not.toContain("**加粗**");
      expect(renderedText(view)).toContain("加粗");
      expect(view.state.selection.toJSON()).toEqual(selection);
      expect(view.state.doc.toString()).toBe(text);
      expect(view.scrollDOM.scrollTop).toBe(scrollTop);
      expect(scrollRequests).not.toContain(true);
    }, 15000);
  }
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
