import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEditor, type EditorHandle } from "../editor";

let parent: HTMLElement;
let editor: EditorHandle;

function mount(doc: string) {
  editor = createEditor({ parent, doc, platform: "macos" });
  return editor;
}

function press(
  view: EditorView,
  key: string,
  code: string,
  options: { shift?: boolean } = {},
) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code,
      ctrlKey: true,
      metaKey: navigator.platform.startsWith("Mac"),
      shiftKey: options.shift ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function composition(view: EditorView, type: "compositionstart" | "compositionend") {
  view.contentDOM.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
  parent.style.height = "600px";
});

afterEach(() => {
  editor?.destroy();
});

describe("format commands", () => {
  it("toggles bold, italic, strikethrough and inline code", () => {
    const view = mount("hello").view;
    view.dispatch({ selection: { anchor: 0, head: 5 } });

    press(view, "b", "KeyB");
    expect(view.state.doc.toString()).toBe("**hello**");
    press(view, "b", "KeyB");
    expect(view.state.doc.toString()).toBe("hello");

    view.dispatch({ selection: { anchor: 0, head: 5 } });
    press(view, "i", "KeyI");
    expect(view.state.doc.toString()).toBe("*hello*");
    press(view, "i", "KeyI");
    expect(view.state.doc.toString()).toBe("hello");

    view.dispatch({ selection: { anchor: 0, head: 5 } });
    press(view, "x", "KeyX", { shift: true });
    expect(view.state.doc.toString()).toBe("~~hello~~");
    press(view, "x", "KeyX", { shift: true });
    expect(view.state.doc.toString()).toBe("hello");

    view.dispatch({ selection: { anchor: 0, head: 5 } });
    press(view, "e", "KeyE");
    expect(view.state.doc.toString()).toBe("`hello`");
    press(view, "e", "KeyE");
    expect(view.state.doc.toString()).toBe("hello");
  });

  it("applies and removes headings with the same shortcut", () => {
    const view = mount("标题").view;
    view.dispatch({ selection: { anchor: 0 } });

    press(view, "1", "Digit1");
    expect(view.state.doc.toString()).toBe("# 标题");
    press(view, "1", "Digit1");
    expect(view.state.doc.toString()).toBe("标题");

    press(view, "2", "Digit2");
    expect(view.state.doc.toString()).toBe("## 标题");
    press(view, "2", "Digit2");
    expect(view.state.doc.toString()).toBe("标题");
  });

  it("toggles list, task and quote prefixes on every selected line", () => {
    const view = mount("一\n二").view;

    view.dispatch({ selection: { anchor: 0, head: 3 } });
    press(view, "7", "Digit7", { shift: true });
    expect(view.state.doc.toString()).toBe("1. 一\n2. 二");
    press(view, "7", "Digit7", { shift: true });
    expect(view.state.doc.toString()).toBe("一\n二");

    press(view, "8", "Digit8", { shift: true });
    expect(view.state.doc.toString()).toBe("- 一\n- 二");
    press(view, "8", "Digit8", { shift: true });
    expect(view.state.doc.toString()).toBe("一\n二");

    press(view, "9", "Digit9", { shift: true });
    expect(view.state.doc.toString()).toBe("- [ ] 一\n- [ ] 二");
    press(view, "9", "Digit9", { shift: true });
    expect(view.state.doc.toString()).toBe("一\n二");

    press(view, ".", "Period", { shift: true });
    expect(view.state.doc.toString()).toBe("> 一\n> 二");
    press(view, ".", "Period", { shift: true });
    expect(view.state.doc.toString()).toBe("一\n二");
  });

  it("wraps and unwraps the current line as a fenced code block", () => {
    const view = mount("代码").view;
    view.dispatch({ selection: { anchor: 2 } });

    press(view, "c", "KeyC", { shift: true });
    expect(view.state.doc.toString()).toBe("```\n代码\n```");
    press(view, "c", "KeyC", { shift: true });
    expect(view.state.doc.toString()).toBe("代码");
  });

  it("keeps lines before and after when unwrapping a code block", () => {
    const view = mount("a\nhello\nb").view;
    view.dispatch({ selection: { anchor: 2 } });

    press(view, "c", "KeyC", { shift: true });
    expect(view.state.doc.toString()).toBe("a\n```\nhello\n```\nb");
    press(view, "c", "KeyC", { shift: true });
    expect(view.state.doc.toString()).toBe("a\nhello\nb");
  });

  it("unwraps code blocks at document edges without joining lines", () => {
    const start = mount("```\nhello\n```\nb").view;
    start.dispatch({ selection: { anchor: 4 } });
    press(start, "c", "KeyC", { shift: true });
    expect(start.state.doc.toString()).toBe("hello\nb");

    const end = mount("a\n```\nhello\n```").view;
    end.dispatch({ selection: { anchor: 8 } });
    press(end, "c", "KeyC", { shift: true });
    expect(end.state.doc.toString()).toBe("a\nhello");
  });

  it("keeps formatting as its own undo step", () => {
    const view = mount("").view;
    view.dispatch({
      changes: { from: 0, insert: "hello" },
      selection: { anchor: 5 },
      userEvent: "input.type",
    });

    press(view, "b", "KeyB");
    expect(view.state.doc.toString()).toBe("hello****");

    expect(editor.undo()).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
    expect(editor.undo()).toBe(true);
    expect(view.state.doc.toString()).toBe("");
  });

  it("inserts an empty fenced block with room for a language", () => {
    const view = mount("").view;
    press(view, "c", "KeyC", { shift: true });
    expect(view.state.doc.toString()).toBe("```\n\n```");
    expect(view.state.selection.main.head).toBe(3);
    press(view, "c", "KeyC", { shift: true });
    expect(view.state.doc.toString()).toBe("");
  });

  it("wins over basicSetup's Mod-i binding", () => {
    const view = mount("hello").view;
    view.dispatch({ selection: { anchor: 2 } });

    press(view, "i", "KeyI");
    expect(view.state.doc.toString()).toBe("he**llo");
  });

  it("does not run formatting while an IME composition is active", () => {
    const view = mount("标题").view;
    view.dispatch({ selection: { anchor: 0 } });
    composition(view, "compositionstart");

    press(view, "1", "Digit1");

    expect(view.state.doc.toString()).toBe("标题");
    composition(view, "compositionend");
  });
});
