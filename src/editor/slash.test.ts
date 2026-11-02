import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CommandStorage } from "../commands/search";
import { createEditor, type EditorHandle } from "./index";
import {
  createSlashMenu,
  placeSlashMenu,
  type SlashMenuController,
  type SlashMenuSnapshot,
} from "./slash";

let parent: HTMLElement;
let editor: EditorHandle | null = null;
let controller: SlashMenuController | null = null;
let state: SlashMenuSnapshot = null;
let storage: CommandStorage;

function fakeStorage(): CommandStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(doc = "") {
  controller?.destroy();
  editor?.destroy();
  editor = createEditor({ parent, doc, platform: "macos" });
  controller = createSlashMenu({
    view: editor.view,
    platform: "macos",
    storage,
    onChange: (next) => {
      state = next;
    },
    loadPinyin: async () => ({
      full: (text) => text,
      initials: (text) => text,
    }),
  });
  return editor.view;
}

function type(view: EditorView, text: string, compose = false) {
  const range = view.state.selection.main;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    userEvent: compose ? "input.type.compose" : "input.type",
  });
}

function key(
  view: EditorView,
  key: string,
  code = key,
  options: { composing?: boolean } = {},
) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code,
      keyCode: options.composing ? 229 : 0,
      isComposing: options.composing ?? false,
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
  state = null;
  storage = fakeStorage();
});

afterEach(() => {
  controller?.destroy();
  controller = null;
  editor?.destroy();
  editor = null;
});

describe("slash trigger", () => {
  it("opens at the line start and after a space", async () => {
    const view = mount();
    type(view, "/");
    expect(state?.trigger).toBe("/");
    expect(state?.query).toBe("");

    controller?.close();
    const second = mount("hello");
    second.dispatch({ selection: { anchor: 5 } });
    type(second, " ");
    type(second, "/");
    expect(state?.trigger).toBe("/");
    expect(state?.query).toBe("");
    await settle();
  });

  it("does not open inside a sentence or when replacing a selection", () => {
    const view = mount("hello");
    view.dispatch({ selection: { anchor: 5 } });
    type(view, "/");
    expect(state).toBeNull();

    view.dispatch({ selection: { anchor: 0, head: 6 } });
    type(view, "/");
    expect(state).toBeNull();
    expect(view.state.doc.toString()).toBe("/");
  });

  it("ignores a slash inserted by paste or another programmatic edit", () => {
    const view = mount();
    view.dispatch({
      changes: { from: 0, insert: "/" },
      selection: { anchor: 1 },
      userEvent: "input.paste",
    });
    expect(state).toBeNull();
  });

  it("opens for the ideographic comma at valid positions only", () => {
    const lineStart = mount("一\n");
    lineStart.dispatch({ selection: { anchor: 2 } });
    type(lineStart, "、");
    expect(state?.trigger).toBe("、");

    controller?.close();
    const sentence = mount("中文");
    sentence.dispatch({ selection: { anchor: 2 } });
    type(sentence, "、");
    expect(state).toBeNull();
  });

  it("closes when the cursor leaves the trigger without deleting text", () => {
    const view = mount();
    type(view, "/");
    type(view, "b");
    expect(state?.query).toBe("b");

    view.dispatch({ selection: { anchor: 0 } });

    expect(state).toBeNull();
    expect(view.state.doc.toString()).toBe("/b");
  });

  it("keeps the query when Escape closes the menu", () => {
    const view = mount();
    type(view, "/");
    type(view, "biao");

    key(view, "Escape");

    expect(state).toBeNull();
    expect(view.state.doc.toString()).toBe("/biao");
  });
});

describe("slash search and execution", () => {
  it("matches pinyin keywords and executes the selected command", async () => {
    const view = mount();
    type(view, "/");
    type(view, "biao");
    await settle();

    const index = state?.items.findIndex(
      (item) => item.id === "format.heading-1",
    );
    expect(index).toBeGreaterThanOrEqual(0);

    controller?.execute(index);

    expect(state).toBeNull();
    expect(view.state.doc.toString()).toBe("# ");
  });

  it("executes with Enter and records the command as recent", async () => {
    const view = mount();
    type(view, "/");
    type(view, "biao");
    await settle();
    const index = state?.items.findIndex(
      (item) => item.id === "format.heading-1",
    );
    if (index !== undefined) controller?.highlight(index);

    key(view, "Enter", "Enter");

    expect(view.state.doc.toString()).toBe("# ");

    type(view, "/");
    expect(state?.items[0]?.id).toBe("format.heading-1");
  });

  it("moves the selection with arrow keys", () => {
    const view = mount();
    type(view, "/");
    expect(state?.selectedIndex).toBe(0);

    key(view, "ArrowDown", "ArrowDown");
    expect(state?.selectedIndex).toBe(1);
    key(view, "ArrowUp", "ArrowUp");
    expect(state?.selectedIndex).toBe(0);
  });

  it("closes without a match and keeps typing in the document", async () => {
    const view = mount();
    type(view, "/");
    type(view, "zzz");
    await settle();

    expect(state).toBeNull();
    type(view, "a");
    expect(state).toBeNull();
    expect(view.state.doc.toString()).toBe("/zzza");
  });
});

describe("slash IME handling", () => {
  it("leaves keys to the IME during composition", async () => {
    const view = mount();
    type(view, "、");
    await settle();
    composition(view, "compositionstart");
    type(view, "b", true);

    const selected = state?.selectedIndex;
    key(view, "Enter", "Process", { composing: true });
    key(view, "ArrowDown", "Process", { composing: true });
    key(view, "Escape", "Process", { composing: true });

    expect(state).not.toBeNull();
    expect(state?.selectedIndex).toBe(selected);
    expect(view.state.doc.toString()).not.toContain("# ");
    composition(view, "compositionend");
  });

  it("waits for composition to end before closing on no match", async () => {
    const view = mount();
    type(view, "/");
    await settle();
    composition(view, "compositionstart");
    type(view, "zzz", true);

    expect(state).not.toBeNull();

    composition(view, "compositionend");
    await settle();

    expect(state).toBeNull();
    expect(view.state.doc.toString()).toBe("/zzz");
  });
});

describe("slash menu positioning", () => {
  const viewport = { width: 800, height: 600 };
  const menu = { width: 260, height: 200 };

  it("opens below the cursor with the window margin", () => {
    expect(
      placeSlashMenu({ left: 100, top: 100, bottom: 120 }, menu, viewport),
    ).toEqual({ left: 100, top: 124, placement: "below" });
  });

  it("flips above when there is no room below", () => {
    expect(
      placeSlashMenu({ left: 100, top: 500, bottom: 520 }, menu, viewport),
    ).toEqual({ left: 100, top: 296, placement: "above" });
  });

  it("keeps the menu inside the window", () => {
    expect(
      placeSlashMenu({ left: 700, top: 100, bottom: 120 }, menu, viewport),
    ).toEqual({ left: 532, top: 124, placement: "below" });
    expect(
      placeSlashMenu({ left: 0, top: 10, bottom: 20 }, menu, {
        width: 200,
        height: 120,
      }),
    ).toEqual({ left: 8, top: 8, placement: "below" });
  });
});
