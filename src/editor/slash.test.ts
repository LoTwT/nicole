import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandStorage } from "../commands/search";
import { createSnippetCommands } from "../commands/snippets";
import type { CommandDefinition } from "../commands/types";
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

function placeholderCommand(): CommandDefinition {
  return {
    id: "test.placeholder",
    label: "placeholder",
    group: "insert",
    scope: "editor",
    inSlashMenu: true,
    run: () => true,
  };
}

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

function mount(
  doc = "",
  loadPinyin = async () => ({
    full: (text: string) => text,
    initials: (text: string) => text,
  }),
  options: {
    commands?: Parameters<typeof createSlashMenu>[0]["commands"];
    onOpen?: () => void;
  } = {},
) {
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
    loadPinyin,
    ...options,
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
  options: { composing?: boolean; keyCode?: number } = {},
) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code,
      keyCode: options.keyCode ?? (options.composing ? 229 : 0),
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

  it("does not trigger inside code, inline code, frontmatter or HTML blocks", () => {
    const cases = [
      { doc: "```\n\n```", position: 4, name: "fenced code" },
      { doc: "    code", position: 4, name: "indented code" },
      { doc: "` code`", position: 2, name: "inline code" },
      {
        doc: "---\ntitle: x\n---\n\nbody",
        position: 4,
        name: "frontmatter",
      },
      { doc: "<div>\nhello\n</div>\n\nbody", position: 6, name: "HTML block" },
      { doc: "```\n", position: 4, name: "unclosed fenced code" },
      { doc: "```js\nfoo\n", position: 10, name: "unclosed fenced code with info" },
      { doc: "<div> ", position: 6, name: "HTML block at document end" },
      { doc: "    foo ", position: 8, name: "indented code at document end" },
    ];
    for (const item of cases) {
      const view = mount(item.doc);
      view.dispatch({ selection: { anchor: item.position } });
      type(view, "/");
      expect(state, item.name).toBeNull();
      controller?.close();
      editor?.destroy();
      editor = null;
      controller = null;
    }

    for (const doc of ["```\ncode\n```\n", "```\na\n```\n"]) {
      const after = mount(doc);
      after.dispatch({ selection: { anchor: after.state.doc.length } });
      type(after, "/");
      expect(state?.trigger).toBe("/");
      controller?.close();
      editor?.destroy();
      editor = null;
      controller = null;
    }
  });

  it("closes when the query contains whitespace", () => {
    const immediate = mount();
    type(immediate, "/");
    type(immediate, " ");
    expect(state).toBeNull();
    expect(immediate.state.doc.toString()).toBe("/ ");

    controller?.close();
    const view = mount("yes ");
    view.dispatch({ selection: { anchor: 4 } });
    type(view, "/");
    type(view, "no");
    type(view, " ");
    expect(state).toBeNull();

    key(view, "Enter", "Enter");
    expect(view.state.doc.toString()).toBe("yes /no \n");
    expect(view.state.doc.toString()).not.toContain("- [ ]");
  });

  it("closes on whitespace even while pinyin loading is pending", async () => {
    let release = (_matcher: {
      full(text: string): string;
      initials(text: string): string;
    }) => {};
    const pending = new Promise<{
      full(text: string): string;
      initials(text: string): string;
    }>((resolve) => {
      release = resolve;
    });
    const view = mount("", () => pending);

    type(view, "/");
    type(view, " ");

    expect(state).toBeNull();
    release({ full: (text) => text, initials: (text) => text });
    await settle();
  });

  it("closes when the cursor moves back into the query", () => {
    const view = mount();
    type(view, "/");
    type(view, "biao");

    view.dispatch({ selection: { anchor: 3 } });

    expect(state).toBeNull();
    expect(view.state.doc.toString()).toBe("/biao");
  });

  it("closes on a non-user document change", () => {
    const view = mount();
    type(view, "/");

    view.dispatch({ changes: { from: 0, insert: "x" } });

    expect(state).toBeNull();
    expect(view.state.doc.toString()).toBe("x/");
  });

  it("closes when the editor loses focus", () => {
    const view = mount();
    type(view, "/");

    view.contentDOM.dispatchEvent(new FocusEvent("blur"));

    expect(state).toBeNull();
    expect(view.state.doc.toString()).toBe("/");
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

  it("resets the selected item when the query changes", () => {
    const view = mount();
    type(view, "/");
    key(view, "ArrowDown", "ArrowDown");
    expect(state?.selectedIndex).toBe(1);

    type(view, "b");

    expect(state?.selectedIndex).toBe(0);
  });

  it("undoes trigger deletion and command execution in one step", async () => {
    const view = mount();
    type(view, "/");
    type(view, "biao");
    await settle();
    const index = state?.items.findIndex(
      (item) => item.id === "format.heading-1",
    );

    controller?.execute(index);
    expect(view.state.doc.toString()).toBe("# ");

    expect(editor?.undo()).toBe(true);
    expect(view.state.doc.toString()).toBe("/biao");
    expect(editor?.undo()).toBe(true);
    expect(view.state.doc.toString()).toBe("");
  });

  it("adds a lazily loaded template and undoes it as one step", async () => {
    let commands = [placeholderCommand()];
    const onOpen = vi.fn();
    const view = mount("", undefined, {
      commands: () => commands,
      onOpen,
    });
    type(view, "/");
    expect(onOpen).toHaveBeenCalledOnce();

    commands = [
      ...commands,
      ...createSnippetCommands([
        { id: "snippet:letter.md", label: "letter", body: "Hi{{cursor}}!" },
      ]),
    ];
    controller?.refreshCommands();
    expect(state?.items.some((item) => item.id === "snippet:letter.md")).toBe(
      true,
    );

    type(view, "letter");
    await settle();
    const index = state?.items.findIndex(
      (item) => item.id === "snippet:letter.md",
    );
    controller?.execute(index);

    expect(view.state.doc.toString()).toBe("Hi!");
    expect(view.state.selection.main.head).toBe(2);
    expect(editor?.undo()).toBe(true);
    expect(view.state.doc.toString()).toBe("/letter");
    expect(editor?.undo()).toBe(true);
    expect(view.state.doc.toString()).toBe("");
  });

  it("refreshes the command list on every open but not during composition", async () => {
    let commands = [placeholderCommand()];
    const onOpen = vi.fn();
    const view = mount("", undefined, {
      commands: () => commands,
      onOpen,
    });
    type(view, "/");
    expect(onOpen).toHaveBeenCalledOnce();

    commands = [
      ...commands,
      ...createSnippetCommands([
        { id: "snippet:letter.md", label: "letter", body: "Hi" },
      ]),
    ];
    composition(view, "compositionstart");
    controller?.refreshCommands();
    expect(state?.items.some((item) => item.id === "snippet:letter.md")).toBe(
      false,
    );

    composition(view, "compositionend");
    await settle();
    expect(state?.items.some((item) => item.id === "snippet:letter.md")).toBe(
      true,
    );

    controller?.close();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    type(view, " ");
    type(view, "/");
    expect(onOpen).toHaveBeenCalledTimes(2);
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

  it("waits for composition to end before closing on whitespace", async () => {
    const view = mount();
    type(view, "/");
    await settle();
    composition(view, "compositionstart");
    type(view, " ", true);

    expect(state).not.toBeNull();

    composition(view, "compositionend");
    await settle();

    expect(state).toBeNull();
    expect(view.state.doc.toString()).toBe("/ ");
  });

  it("does not execute a keyCode 229 event without compositionstart", () => {
    const view = mount();
    type(view, "/");
    type(view, "b");

    key(view, "Enter", "Enter", { keyCode: 229 });

    expect(state).not.toBeNull();
    expect(view.state.doc.toString()).not.toContain("# ");
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
