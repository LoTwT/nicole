import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSnippetCommands,
  expandSnippet,
  localDateStamp,
} from "./snippets";
import type { CommandTarget } from "./types";

function targetFor(doc: string): CommandTarget {
  let state = EditorState.create({ doc });
  return {
    get state() {
      return state;
    },
    dispatch(...specs: TransactionSpec[]) {
      for (const spec of specs) {
        state = state.update(spec).state;
      }
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("snippet variables", () => {
  it("uses the local calendar day", () => {
    expect(localDateStamp(new Date(2026, 10, 9, 23, 59))).toBe("2026-11-09");
    expect(localDateStamp(new Date(2026, 0, 2, 0, 0))).toBe("2026-01-02");
  });

  it("removes every cursor marker and keeps the first position", () => {
    expect(
      expandSnippet("A{{cursor}}B{{date}}C{{cursor}}D", new Date(2026, 10, 9)),
    ).toEqual({ text: "AB2026-11-09CD", cursor: 1 });
  });

  it("places the caret at the end without a marker", () => {
    expect(expandSnippet("plain {{date}}", new Date(2026, 10, 9))).toEqual({
      text: "plain 2026-11-09",
      cursor: 16,
    });
  });

  it("leaves every other variable and brace text literal", () => {
    expect(
      expandSnippet(
        "{{time}} {{DATE}} {{date:short}} {{cursor {{code()}}",
        new Date(2026, 10, 9),
      ),
    ).toEqual({
      text: "{{time}} {{DATE}} {{date:short}} {{cursor {{code()}}",
      cursor: 52,
    });
  });
});

describe("snippet commands", () => {
  it("uses the registry shape and the template's stable id", () => {
    const [command] = createSnippetCommands([
      { id: "snippet:letter.md", label: "letter", body: "hello" },
    ]);
    expect(command!).toMatchObject({
      id: "snippet:letter.md",
      label: "letter",
      group: "insert",
      scope: "editor",
      inSlashMenu: true,
      requiresWorkspace: true,
      requiresActiveMarkdown: true,
    });
    expect(command!.keys).toBeUndefined();
  });

  it("replaces the selection and expands date at run time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 5, 12, 0));
    const [command] = createSnippetCommands([
      { id: "snippet:note.md", label: "note", body: "{{date}}|{{cursor}}x" },
    ]);
    const target = targetFor("abc");
    target.dispatch({ selection: EditorSelection.range(0, 2) });

    expect(
      command!.run({ view: target, platform: "macos" }),
    ).toBe(true);
    expect(target.state.doc.toString()).toBe("2026-03-05|xc");
    expect(target.state.selection.main.head).toBe(11);
  });

  it("does nothing without an editor", () => {
    const [command] = createSnippetCommands([
      { id: "snippet:note.md", label: "note", body: "x" },
    ]);
    expect(command!.run({ view: null, platform: "macos" })).toBe(false);
  });
});
