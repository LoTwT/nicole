import {
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { createWorkspaceLinkCompletionSource } from "./link-completion";

function fixture(text: string, source: string | null = "notes/source.md") {
  const position = text.indexOf("|");
  const doc = text.replace("|", "");
  const state = EditorState.create({
    doc,
    selection: { anchor: position },
    extensions: [markdown()],
  });
  const files = [
    "notes/target.md",
    "other name.md",
    "assets/file.png",
    ".hidden/private.md",
    "node_modules/a.md",
    "../outside.md",
  ];
  const complete = createWorkspaceLinkCompletionSource({
    getSource: () => source,
    getFiles: () => files,
  });
  const result = complete(
    new CompletionContext(state, position, false),
  ) as CompletionResult | null;
  return { state, result, files };
}

function apply(text: string, candidate = "notes/target.md") {
  const { state, result } = fixture(text);
  expect(result).not.toBeNull();
  const completion = result!.options.find(
    (option) => option.label === candidate,
  )!;
  const view = new EditorView({ state, parent: document.createElement("div") });
  try {
    if (typeof completion.apply !== "function")
      throw new Error("expected a completion callback");
    completion.apply(
      view,
      completion,
      result!.from,
      result!.to ?? state.selection.main.head,
    );
    return view.state.doc.toString();
  } finally {
    view.destroy();
  }
}

describe("workspace link completion", () => {
  it("completes existing link and image destinations using relative URL paths", () => {
    expect(apply("[label](tar|)")).toBe("[label](target.md)");
    expect(apply("[label](tar|get.md)")).toBe("[label](target.md)");
    expect(apply("![image](|)")).toBe("![image](target.md)");
    expect(apply("[label](<oth|>)", "other name.md")).toBe(
      "[label](<../other%20name.md>)",
    );
    expect(apply("[label](|")).toBe("[label](target.md)");
  });

  it("replaces wiki triggers with standard Markdown and keeps a pretyped closing pair", () => {
    expect(apply("before [[tar|]] after")).toBe(
      "before [target](target.md) after",
    );
    expect(apply("[[ta|rget]]")).toBe("[target](target.md)");
    expect(apply("[[oth|", "other name.md")).toBe(
      "[other name](../other%20name.md)",
    );
  });

  it("offers only the existing authorized Markdown listing", () => {
    expect(
      fixture("[[|").result?.options.map((option) => option.label),
    ).toEqual(["notes/target.md", "other name.md"]);
    expect(fixture("[[|", null).result).toBeNull();
    expect(fixture("[[unknown|").result?.options).toEqual([]);
  });

  it("yields in code, HTML, metadata, escaped and invalid link contexts", () => {
    for (const text of [
      "`[[tar|`",
      "```md\n[[tar|\n```",
      "    [[tar|",
      "<script>\n[[tar|\n</script>",
      "---\nurl: [[tar|\n---",
      "\\[[tar|",
      "\\[label](tar|)",
      "stray ](tar|",
      "![[tar|",
      "[a](https:|)",
    ])
      expect(fixture(text).result, text).toBeNull();
  });

  it("does not apply a stale result after its candidate loses authorization", () => {
    const { state, result, files } = fixture("[[tar|");
    const completion = result!.options[0]!;
    const view = new EditorView({
      state,
      parent: document.createElement("div"),
    });
    try {
      files.splice(0);
      if (typeof completion.apply === "function")
        completion.apply(
          view,
          completion,
          result!.from,
          state.selection.main.head,
        );
      expect(view.state.doc.toString()).toBe("[[tar");
    } finally {
      view.destroy();
    }
  });

  it("does not carry a same-named candidate across a workspace identity change", () => {
    const { state } = fixture("[[tar|");
    let identity = "workspace-1:tab-1";
    const source = createWorkspaceLinkCompletionSource({
      getSource: () => "a.md",
      getFiles: () => ["target.md"],
      getIdentity: () => identity,
    });
    const result = source(
      new CompletionContext(state, state.selection.main.head, false),
    ) as CompletionResult;
    const view = new EditorView({
      state,
      parent: document.createElement("div"),
    });
    try {
      identity = "workspace-2:tab-1";
      const completion = result.options[0]!;
      if (typeof completion.apply === "function")
        completion.apply(
          view,
          completion,
          result.from,
          result.to ?? state.selection.main.head,
        );
      expect(view.state.doc.toString()).toBe("[[tar");
    } finally {
      view.destroy();
    }
  });

  it("yields while the view is composing", () => {
    const { state } = fixture("[[tar|");
    const view = new EditorView({
      state,
      parent: document.createElement("div"),
    });
    try {
      Object.defineProperty(view, "composing", { value: true });
      const complete = createWorkspaceLinkCompletionSource({
        getSource: () => "a.md",
        getFiles: () => ["target.md"],
      });
      expect(
        complete(
          new CompletionContext(state, state.selection.main.head, false, view),
        ),
      ).toBeNull();
    } finally {
      view.destroy();
    }
  });
});
