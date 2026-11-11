import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorHandle } from "./index";

// CodeMirror resolves `Mod` from navigator.platform when its keymap runs.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", {
    value: "MacIntel",
    configurable: true,
  });
});

let parent: HTMLElement;
let editor: EditorHandle | null = null;

function press(
  key: string,
  options: { altKey?: boolean; shiftKey?: boolean; keyCode?: number } = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    code: `Key${key.toUpperCase()}`,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  if (options.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", { value: options.keyCode });
  }
  editor!.view.contentDOM.dispatchEvent(event);
  return event;
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

describe("find shortcuts on macOS", () => {
  it("opens Nicole's panel from the registry without a CodeMirror panel", () => {
    editor = createEditor({ parent, doc: "one two", mode: "live" });
    const instance = editor;

    const find = press("f");
    expect(find.defaultPrevented).toBe(true);
    expect(instance.search.snapshot()).toMatchObject({
      open: true,
      replaceVisible: false,
    });
    expect(instance.view.dom.querySelector(".cm-panel input")).toBeNull();

    const replace = press("f", { altKey: true });
    expect(replace.defaultPrevented).toBe(true);
    expect(instance.search.snapshot().replaceVisible).toBe(true);
  });

  it("keeps Mod-g and Shift-Mod-g navigation", () => {
    editor = createEditor({ parent, doc: "o o o", mode: "live" });
    const instance = editor;
    instance.search.open(false);
    instance.search.setQuery("o");
    expect(instance.search.snapshot().current).toBe(0);

    const next = press("g");
    expect(next.defaultPrevented).toBe(true);
    expect(instance.search.snapshot().current).toBe(1);
    const nextFrom = instance.view.state.selection.main.from;

    const previous = press("G", { shiftKey: true, keyCode: 71 });
    expect(previous.defaultPrevented).toBe(true);
    expect(instance.view.state.selection.main.from).not.toBe(nextFrom);
    expect(instance.search.snapshot().current).toBe(3);
  });
});
