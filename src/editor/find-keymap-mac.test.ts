import {
  getSearchQuery,
  searchPanelOpen,
} from "@codemirror/search";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorHandle } from "./index";
import { until } from "./test-helpers";

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

  it("keeps a leftover default F3 binding from changing an invalid query", () => {
    editor = createEditor({ parent, doc: "foo", mode: "live" });
    const instance = editor;
    instance.view.dispatch({ selection: { anchor: 0, head: 3 } });
    instance.search.open(true);
    instance.search.setRegexp(true);
    instance.search.setQuery("(");
    instance.search.setReplacement("x");
    expect(instance.search.snapshot()).toMatchObject({
      error: "invalid-regexp",
      query: "(",
    });

    const f3 = new KeyboardEvent("keydown", {
      key: "F3",
      code: "F3",
      bubbles: true,
      cancelable: true,
    });
    instance.view.contentDOM.dispatchEvent(f3);

    expect(f3.defaultPrevented).toBe(true);
    expect(instance.search.snapshot()).toMatchObject({
      error: "invalid-regexp",
      query: "(",
      current: 0,
      total: 0,
    });
    expect(getSearchQuery(instance.view.state).search).toBe("(");
    expect(getSearchQuery(instance.view.state).valid).toBe(false);
    expect(searchPanelOpen(instance.view.state)).toBe(false);
    expect(instance.search.replaceAll()).toBe(false);
    expect(instance.view.state.doc.toString()).toBe("foo");
  });

  it("forwards Alt-Mod-F from a task box and restores the box on close", async () => {
    editor = createEditor({
      parent,
      doc: "- [ ] 待办\n\n正文\n",
      mode: "live",
    });
    const instance = editor;
    instance.view.dispatch({
      selection: { anchor: instance.view.state.doc.length },
    });
    await until(
      () =>
        instance.view.contentDOM.querySelector(".cm-nicole-checkbox-input") !==
        null,
      "the task checkbox",
    );
    const checkbox = instance.view.contentDOM.querySelector<HTMLInputElement>(
      ".cm-nicole-checkbox-input",
    )!;
    checkbox.focus();

    const replace = press("f", { altKey: true });
    expect(replace.defaultPrevented).toBe(true);
    expect(instance.search.snapshot()).toMatchObject({
      open: true,
      replaceVisible: true,
    });
    expect(document.activeElement).toBe(instance.view.contentDOM);

    instance.search.close();
    expect(document.activeElement).toBe(checkbox);
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
