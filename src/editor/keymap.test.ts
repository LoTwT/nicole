import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppPlatform } from "../app/platform";
import { getCommand } from "../commands/registry";
import { createCommandKeymap } from "./keymap";

// CodeMirror resolves its `Mod` binding when the module loads. Pin the host to
// macOS so its keymap matches the platform this suite declares, not the runner.
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
});

describe("createCommandKeymap", () => {
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
