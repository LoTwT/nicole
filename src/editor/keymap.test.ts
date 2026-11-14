import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppPlatform } from "../app/platform";
import { getCommand } from "../commands/registry";
import { createCommandKeymap } from "./keymap";
import { setCommandKeybindings } from "../commands/keybinding-settings";

// jsdom reports an empty navigator.platform, which CodeMirror treats as
// non-Mac when it resolves `Mod` at module load. Pin it so `Mod` follows the
// macOS platform this suite declares.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", {
    value: "MacIntel",
    configurable: true,
  });
});

const platform: AppPlatform = "macos";

let parent: HTMLElement;
let view: EditorView | null = null;

function pressMod(target: EditorView, key: string, code: string) {
  target.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code,
      ctrlKey: platform !== "macos",
      metaKey: platform === "macos",
      bubbles: true,
      cancelable: true,
    }),
  );
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
});

afterEach(() => {
  view?.destroy();
  view = null;
  setCommandKeybindings({});
});

describe("createCommandKeymap", () => {
  it("does not let a formatting shortcut mutate a document frozen for reference updates", () => {
    view = new EditorView({ parent, state: EditorState.create({ doc: "hello", extensions: [
      EditorState.readOnly.of(true),
      createCommandKeymap([getCommand("format.italic")!], platform),
    ] }) });
    pressMod(view, "i", "KeyI");
    expect(view.state.doc.toString()).toBe("hello");
  });
  it("does not remove Enter from document editing when file-tree rename is disabled", () => {
    setCommandKeybindings({ "file-tree.rename": "" });
    view = new EditorView({
      parent,
      state: EditorState.create({ doc: "hello", selection: { anchor: 5 }, extensions: [
        keymap.of(defaultKeymap),
        createCommandKeymap([getCommand("file-tree.rename")!], platform),
      ] }),
    });
    runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Enter", code: "Enter" }), "editor");
    expect(view.state.doc.toString()).toBe("hello\n");
  });

  it("keeps a disabled editor key suppressed when the same key belongs only to the file tree", () => {
    setCommandKeybindings({ "format.italic": "", "file-tree.rename": "Mod-i" });
    const fallback = vi.fn(() => true);
    view = new EditorView({
      parent,
      state: EditorState.create({ doc: "hello", extensions: [
        keymap.of([{ key: "Mod-i", run: fallback }]),
        createCommandKeymap([getCommand("format.italic")!, getCommand("file-tree.rename")!], platform),
      ] }),
    });
    pressMod(view, "i", "KeyI");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("leaves disabled shortcut keys to an active IME composition", () => {
    setCommandKeybindings({ "format.italic": "" });
    view = new EditorView({ parent, state: EditorState.create({ doc: "hello", extensions: [
      createCommandKeymap([getCommand("format.italic")!], platform),
    ] }) });
    vi.spyOn(view, "compositionStarted", "get").mockReturnValue(true);
    const handled = runScopeHandlers(view, new KeyboardEvent("keydown", { key: "i", code: "KeyI", metaKey: true }), "editor");
    expect(handled).toBe(false);
  });

  it("wins over a competing Prec.high binding for the same key", () => {
    const competitor = vi.fn(() => true);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "hello",
        extensions: [
          Prec.high(keymap.of([{ key: "Mod-i", run: competitor }])),
          createCommandKeymap([getCommand("format.italic")!], platform),
        ],
      }),
    });
    view.dispatch({ selection: { anchor: 2 } });

    pressMod(view, "i", "KeyI");

    expect(competitor).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("he**llo");
  });
});
