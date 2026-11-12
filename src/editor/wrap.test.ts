import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { afterEach, describe, expect, it } from "vitest";

import { createEditor, type LinkImageEditorSession } from "./index";
import { planWrapInput } from "./wrap";

const parents: HTMLElement[] = [];

function stateFor(doc: string, selection?: { anchor: number; head: number }) {
  return EditorState.create({
    doc,
    selection: selection
      ? EditorSelection.single(selection.anchor, selection.head)
      : undefined,
    extensions: [
      markdown({ base: markdownLanguage }),
      EditorState.allowMultipleSelections.of(true),
    ],
  });
}

function applyPlan(
  state: EditorState,
  character: "*" | "`" | "~" | "[",
) {
  const plan = planWrapInput(state, character);
  expect(plan).not.toBeNull();
  return state.update({
    changes: plan!.changes,
    selection: plan!.selection,
  }).state;
}

function parent(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  parents.push(element);
  return element;
}

function typeDirect(view: EditorView, character: string): boolean {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: character,
      code:
        character === "`"
          ? "Backquote"
          : character === "["
            ? "BracketLeft"
            : character === "~"
              ? "Backquote"
              : "Digit8",
      shiftKey: character === "*" || character === "~",
      bubbles: true,
      cancelable: true,
    }),
  );
  const range = view.state.selection.main;
  return view.state.facet(EditorView.inputHandler).some((handler) =>
    handler(view, range.from, range.to, character, () =>
      view.state.update({
        changes: { from: range.from, to: range.to, insert: character },
        selection: { anchor: range.from + character.length },
      }),
    ),
  );
}

function inputHandlerOnly(view: EditorView, character: string): boolean {
  const range = view.state.selection.main;
  return view.state.facet(EditorView.inputHandler).some((handler) =>
    handler(view, range.from, range.to, character, () =>
      view.state.update({
        changes: { from: range.from, to: range.to, insert: character },
        selection: { anchor: range.from + character.length },
      }),
    ),
  );
}

afterEach(() => {
  for (const element of parents.splice(0)) element.remove();
});

describe("selection wrapping", () => {
  it("wraps a single selection with emphasis and keeps the text selected", () => {
    const state = stateFor("什么样的工具", { anchor: 0, head: 6 });
    const next = applyPlan(state, "*");
    expect(next.doc.toString()).toBe("*什么样的工具*");
    expect(next.selection.main.from).toBe(1);
    expect(next.selection.main.to).toBe(7);
  });

  it("adds a second emphasis layer when * is typed again", () => {
    const first = applyPlan(stateFor("什么样的工具", { anchor: 0, head: 6 }), "*");
    const second = applyPlan(first, "*");
    expect(second.doc.toString()).toBe("**什么样的工具**");
    expect(second.selection.main.from).toBe(2);
    expect(second.selection.main.to).toBe(8);
  });

  it("keeps surrounding spaces outside the markers", () => {
    const next = applyPlan(stateFor(" 文字 ", { anchor: 0, head: 4 }), "*");
    expect(next.doc.toString()).toBe(" *文字* ");
    expect(next.selection.main.from).toBe(2);
    expect(next.selection.main.to).toBe(4);
  });

  it("keeps Unicode edge whitespace outside the markers", () => {
    const next = applyPlan(
      stateFor("\u3000文字\u3000", { anchor: 0, head: 4 }),
      "*",
    );
    expect(next.doc.toString()).toBe("\u3000*文字*\u3000");
    expect(next.selection.main.from).toBe(2);
    expect(next.selection.main.to).toBe(4);
  });

  it("wraps with one tilde as strikethrough and ignores a repeat", () => {
    const once = applyPlan(stateFor("已经废弃的写法", { anchor: 0, head: 7 }), "~");
    expect(once.doc.toString()).toBe("~~已经废弃的写法~~");
    const again = planWrapInput(once, "~");
    expect(again?.noop).toBe(true);
    expect(again?.changes.empty).toBe(true);
  });

  it("replaces a multi-line selection instead of wrapping", () => {
    const next = applyPlan(stateFor("第一行\n第二行", { anchor: 0, head: 7 }), "*");
    expect(next.doc.toString()).toBe("*");
  });

  it("replaces selections inside code, inline code, frontmatter and HTML", () => {
    const cases: [string, number, number][] = [
      ["```\n文字\n```\n", 4, 6],
      ["`文字`\n", 1, 3],
      ["---\na: 文字\n---\n", 7, 9],
      ["<div>\n文字\n</div>\n", 6, 8],
    ];
    for (const [doc, from, to] of cases) {
      const next = applyPlan(stateFor(doc, { anchor: from, head: to }), "*");
      expect(next.doc.toString()).toBe(doc.slice(0, from) + "*" + doc.slice(to));
    }
  });

  it("never creates a link from [ inside a code block", () => {
    const doc = "```\n文字\n```\n";
    const next = applyPlan(stateFor(doc, { anchor: 4, head: 6 }), "[");
    expect(next.doc.toString()).toBe("```\n[\n```\n");
  });

  it("replaces when any selection crosses a line or contains only whitespace", () => {
    const multiline = applyPlan(
      stateFor("ab\ncd", { anchor: 1, head: 4 }),
      "[",
    );
    expect(multiline.doc.toString()).toBe("a[d");
    const blank = applyPlan(stateFor("   ", { anchor: 0, head: 3 }), "*");
    expect(blank.doc.toString()).toBe("*");
  });

  it("handles a mixed multi-cursor input without pairing brackets", () => {
    const state = EditorState.create({
      doc: "abcdef",
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.cursor(5),
      ]),
      extensions: [
        markdown({ base: markdownLanguage }),
        EditorState.allowMultipleSelections.of(true),
      ],
    });
    const next = applyPlan(state, "[");
    expect(next.doc.toString()).toBe("[de[f");
    expect(next.selection.ranges.map((range) => range.head)).toEqual([1, 4]);
  });

  it("returns null for an all-empty selection so closeBrackets keeps ownership", () => {
    const state = stateFor("ab", { anchor: 1, head: 1 });
    expect(planWrapInput(state, "[")).toBeNull();
    expect(planWrapInput(state, "*")).toBeNull();
  });

  it("keeps Unicode edge whitespace outside single and batch link drafts", () => {
    const single = planWrapInput(
      stateFor("\u3000文字\u3000", { anchor: 0, head: 4 }),
      "[",
    )!;
    expect(single.linkDrafts).toEqual([
      { from: 0, to: 4, text: "文字", leading: "\u3000", trailing: "\u3000" },
    ]);

    const multiState = EditorState.create({
      doc: "\u3000甲\u3000 \u3000乙\u3000",
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(4, 7),
      ]),
      extensions: [
        markdown({ base: markdownLanguage }),
        EditorState.allowMultipleSelections.of(true),
      ],
    });
    const batch = planWrapInput(multiState, "[")!;
    expect(batch.linkDrafts.map((draft) => draft.text)).toEqual(["甲", "乙"]);
    expect(batch.linkDrafts.map((draft) => draft.leading)).toEqual([
      "\u3000",
      "\u3000",
    ]);
    expect(batch.linkDrafts.map((draft) => draft.trailing)).toEqual([
      "\u3000",
      "\u3000",
    ]);
  });

  it("wraps a selection as a link and puts the caret inside the empty URL", () => {
    const next = applyPlan(stateFor("文字", { anchor: 0, head: 2 }), "[");
    expect(next.doc.toString()).toBe("[文字]()");
    expect(next.selection.main.head).toBe(5);
  });
});

describe("direct input integration", () => {
  it("undoes a whole wrapping step and layers two emphasis inputs", () => {
    const editor = createEditor({
      parent: parent(),
      doc: "文字",
      mode: "live",
      platform: "macos",
    });
    const view = editor.view;
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    view.focus();

    expect(typeDirect(view, "*")).toBe(true);
    expect(view.state.doc.toString()).toBe("*文字*");
    editor.undo();
    expect(view.state.doc.toString()).toBe("文字");

    view.dispatch({ selection: { anchor: 0, head: 2 } });
    expect(typeDirect(view, "*")).toBe(true);
    expect(typeDirect(view, "*")).toBe(true);
    expect(view.state.doc.toString()).toBe("**文字**");
    editor.undo();
    expect(view.state.doc.toString()).toBe("*文字*");
    editor.destroy();
  });

  it("replaces a non-empty selection with a literal bracket, not a pair", () => {
    const editor = createEditor({
      parent: parent(),
      doc: "文字",
      mode: "live",
      platform: "macos",
    });
    const view = editor.view;
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    view.focus();
    expect(typeDirect(view, "(")).toBe(true);
    expect(view.state.doc.toString()).toBe("(");
    expect(view.state.selection.main.head).toBe(1);

    view.dispatch({ changes: { from: 0, to: 1, insert: "文字" } });
    view.dispatch({ selection: { anchor: 2 } });
    expect(typeDirect(view, "(")).toBe(true);
    expect(view.state.doc.toString()).toBe("文字()");
    editor.destroy();
  });

  it("leaves an all-empty [ to closeBrackets", () => {
    const editor = createEditor({
      parent: parent(),
      doc: "",
      mode: "live",
      platform: "macos",
    });
    const view = editor.view;
    view.focus();
    expect(typeDirect(view, "[")).toBe(true);
    expect(view.state.doc.toString()).toBe("[]");
    editor.destroy();
  });

  it("does not wrap paste or IME input even with a non-empty selection", () => {
    const editor = createEditor({
      parent: parent(),
      doc: "文字",
      mode: "live",
      platform: "macos",
    });
    const view = editor.view;
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    view.focus();
    expect(typeDirect(view, "*")).toBe(true);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "文字" } });
    view.dispatch({ selection: { anchor: 0, head: 2 } });

    const range = view.state.selection.main;
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, range.from, range.to, "*", () => view.state.update({})));
    expect(handled).toBe(false);

    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "`",
        code: "Backquote",
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    );
    const ime = view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, 0, 2, "·", () => view.state.update({})));
    expect(ime).toBe(false);
    expect(view.state.doc.toString()).toBe("文字");
    editor.destroy();
  });

  it("opens an immersive [ draft without touching the document", () => {
    let session: LinkImageEditorSession | null = null;
    const editor = createEditor({
      parent: parent(),
      doc: "文字",
      mode: "immersive",
      platform: "macos",
      onEditLinkImage: (next) => {
        session = next;
      },
    });
    const view = editor.view;
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    view.focus();
    expect(typeDirect(view, "[")).toBe(true);
    expect(view.state.doc.toString()).toBe("文字");
    expect(session).not.toBeNull();
    expect(session!.kind).toBe("link");
    expect(session!.isNew).toBe(true);
    session!.dispose();
    expect(view.state.doc.toString()).toBe("文字");
    editor.destroy();
  });

  it("layers consecutive backticks and invalidates the continuation after selection changes", () => {
    const editor = createEditor({
      parent: parent(),
      doc: "文字",
      mode: "live",
      platform: "macos",
    });
    const view = editor.view;
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    view.focus();
    expect(typeDirect(view, "`")).toBe(true);
    expect(view.state.doc.toString()).toBe("`文字`");
    expect(typeDirect(view, "`")).toBe(true);
    expect(view.state.doc.toString()).toBe("``文字``");
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(4);

    view.dispatch({ selection: { anchor: 4 } });
    view.dispatch({ selection: { anchor: 2, head: 4 } });
    expect(typeDirect(view, "`")).toBe(true);
    expect(view.state.doc.toString()).toBe("`````");
    editor.destroy();
  });

  it("keeps every immersive multi-selection link draft virtual until one commit", () => {
    let session: LinkImageEditorSession | null = null;
    const editor = createEditor({
      parent: parent(),
      doc: "甲 乙",
      mode: "immersive",
      platform: "macos",
      onEditLinkImage: (next) => {
        session = next;
      },
    });
    const view = editor.view;
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 1),
        EditorSelection.range(2, 3),
      ]),
    });
    view.focus();
    expect(typeDirect(view, "[")).toBe(true);
    expect(view.state.doc.toString()).toBe("甲 乙");
    expect(session).not.toBeNull();
    expect(session!.fields).toEqual([
      { text: "甲", url: "" },
      { text: "乙", url: "" },
    ]);
    expect(
      session!.complete([
        { text: "甲", url: "a" },
        { text: "乙", url: "b" },
      ]),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe("[甲](a) [乙](b)");
    editor.undo();
    expect(view.state.doc.toString()).toBe("甲 乙");
    expect(session!.valid).toBe(false);
    editor.destroy();
  });

  it("cancels the whole immersive batch when one target changes", () => {
    let session: LinkImageEditorSession | null = null;
    const editor = createEditor({
      parent: parent(),
      doc: "甲 乙",
      mode: "immersive",
      platform: "macos",
      onEditLinkImage: (next) => {
        session = next;
      },
    });
    const view = editor.view;
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 1),
        EditorSelection.range(2, 3),
      ]),
    });
    view.focus();
    expect(typeDirect(view, "[")).toBe(true);
    const opened = session!;
    view.dispatch({ changes: { from: 0, to: 1, insert: "X" } });
    expect(session).toBeNull();
    expect(opened.valid).toBe(false);
    expect(
      opened.complete([
        { text: "甲", url: "a" },
        { text: "乙", url: "b" },
      ]),
    ).toBe(false);
    expect(view.state.doc.toString()).toBe("X 乙");
    editor.destroy();
  });

  it("replaces a non-direct bracket input literally instead of letting closeBrackets wrap", () => {
    const editor = createEditor({
      parent: parent(),
      doc: "文字",
      mode: "live",
      platform: "macos",
    });
    const view = editor.view;
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    view.focus();
    expect(inputHandlerOnly(view, "[")).toBe(true);
    expect(view.state.doc.toString()).toBe("[");
    editor.destroy();
  });

  it("leaves a literal bracket from real DOM replacement input", async () => {
    const editor = createEditor({
      parent: parent(),
      doc: "文字",
      mode: "source",
      platform: "macos",
    });
    const view = editor.view;
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    view.focus();
    const line = view.contentDOM.querySelector(".cm-line")!;
    const text = line.firstChild!;
    view.contentDOM.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertReplacementText",
        data: "[",
        bubbles: true,
        cancelable: true,
      }),
    );
    text.nodeValue = "[";
    document.getSelection()!.collapse(text, 1);
    view.contentDOM.dispatchEvent(
      new InputEvent("input", {
        inputType: "insertReplacementText",
        data: "[",
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(view.state.doc.toString()).toBe("[");
    editor.destroy();
  });

  it("turns a live [ into a link with the caret in the URL", () => {
    const editor = createEditor({
      parent: parent(),
      doc: "文字",
      mode: "live",
      platform: "macos",
    });
    const view = editor.view;
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    view.focus();
    expect(typeDirect(view, "[")).toBe(true);
    expect(view.state.doc.toString()).toBe("[文字]()");
    expect(view.state.selection.main.head).toBe(5);
    editor.destroy();
  });
});
