import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEditor,
  type LinkImageEditorSession,
} from "./index";
import {
  createLinkImageEditorSession,
  inlineTargetAt,
  newLinkDraft,
  openLinkEditorEffect,
  placeLinkImagePopover,
} from "./link-editor";
import { resolveLocalImagePath } from "../image-url";

const parents: HTMLElement[] = [];

function parent(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  parents.push(element);
  return element;
}

function parsed(doc: string) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  });
}

afterEach(() => {
  for (const element of parents.splice(0)) element.remove();
});

function openSession(
  doc: string,
  position: number,
  mode: "live" | "immersive" | "source" = "live",
) {
  let session: LinkImageEditorSession | null = null;
  const editor = createEditor({
    parent: parent(),
    doc,
    mode,
    platform: "macos",
    onEditLinkImage: (next) => {
      session = next;
    },
  });
  editor.view.dispatch({
    selection: { anchor: position },
    effects: openLinkEditorEffect.of(null),
  });
  return { editor, session: () => session };
}

describe("link and image targets", () => {
  it("reads inline link text, url and title without losing the title position", () => {
    const doc = 'a [文字](url "标题") b\n';
    const target = inlineTargetAt(parsed(doc), doc.indexOf("文字"));
    expect(target?.kind).toBe("link");
    expect(target?.text).toBe("文字");
    expect(target?.url).toBe("url");
  });

  it("accepts an empty URL and an empty image path", () => {
    const doc = "[]() ![]( )\n";
    const link = inlineTargetAt(parsed(doc), doc.indexOf("]") - 1);
    expect(link?.url).toBe("");
    const image = inlineTargetAt(parsed(doc), doc.indexOf("!") + 3);
    expect(image?.kind).toBe("image");
    expect(image?.url).toBe("");
  });
});

describe("link and image editor sessions", () => {
  it("maps an existing link through edits before it and writes only on complete", () => {
    const doc = "before [文字](url) after\n";
    const { editor, session } = openSession(doc, doc.indexOf("文字") + 1);
    const first = session()!;
    expect(first.kind).toBe("link");
    expect(first.initialText).toBe("文字");
    expect(first.initialUrl).toBe("url");
    expect(editor.view.state.doc.toString()).toBe(doc);

    editor.view.dispatch({ changes: { from: 0, insert: "X " } });
    expect(editor.view.state.doc.toString()).toBe(`X ${doc}`);
    expect(first.valid).toBe(true);
    expect(first.complete([{ text: "新", url: "新地址" }])).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(
      "X before [新](新地址) after\n",
    );
    editor.undo();
    expect(editor.view.state.doc.toString()).toBe("X before [文字](url) after\n");
    editor.destroy();
  });

  it("keeps edits exactly at the target boundaries outside the link", () => {
    const doc = "before [文字](url) after\n";
    const linkFrom = doc.indexOf("[");
    const linkTo = doc.indexOf(")") + 1;
    const { editor, session } = openSession(doc, doc.indexOf("文字") + 1);
    const first = session()!;
    editor.view.dispatch({ changes: { from: linkFrom, insert: "X" } });
    editor.view.dispatch({ changes: { from: linkTo + 1, insert: "Y" } });
    expect(first.valid).toBe(true);
    first.complete([{ text: "新", url: "新地址" }]);
    expect(editor.view.state.doc.toString()).toBe(
      "before X[新](新地址)Y after\n",
    );
    editor.destroy();
  });

  it("invalidates when an edit touches the target and never writes elsewhere", () => {
    const doc = "before [文字](url) after\n";
    const { editor, session } = openSession(doc, doc.indexOf("文字") + 1);
    const first = session()!;
    editor.view.dispatch({
      changes: { from: doc.indexOf("文字"), insert: "Y" },
    });
    expect(session()).toBeNull();
    expect(first.valid).toBe(false);
    expect(first.complete([{ text: "新", url: "新地址" }])).toBe(false);
    expect(editor.view.state.doc.toString()).toBe(
      "before [Y文字](url) after\n",
    );
    editor.destroy();
  });

  it("removes link syntax but keeps the text as one undo step", () => {
    const doc = "before [文字](url) after\n";
    const { editor, session } = openSession(doc, doc.indexOf("文字") + 1);
    expect(session()!.canRemove).toBe(true);
    expect(session()!.remove()).toBe(true);
    expect(editor.view.state.doc.toString()).toBe("before 文字 after\n");
    editor.undo();
    expect(editor.view.state.doc.toString()).toBe(doc);
    editor.destroy();
  });

  it("keeps a new link draft out of the document and history until complete", () => {
    const doc = "before\n";
    const { editor, session } = openSession(doc, doc.length);
    const first = session()!;
    expect(first.isNew).toBe(true);
    expect(first.initialText).toBe("");
    expect(editor.view.state.doc.toString()).toBe(doc);

    first.dispose();
    expect(editor.view.state.doc.toString()).toBe(doc);

    editor.view.dispatch({ effects: openLinkEditorEffect.of(null) });
    const second = session()!;
    expect(second).not.toBe(first);
    expect(second.complete([{ text: "文字", url: "url" }])).toBe(true);
    expect(editor.view.state.doc.toString()).toBe("before\n[文字](url)");
    editor.undo();
    expect(editor.view.state.doc.toString()).toBe(doc);
    editor.destroy();
  });

  it("maps a new draft through earlier edits and invalidates one at its caret", () => {
    const doc = "before\n";
    const { editor, session } = openSession(doc, doc.length);
    const first = session()!;
    editor.view.dispatch({ changes: { from: 0, insert: "X " } });
    expect(first.valid).toBe(true);
    first.complete([{ text: "文字", url: "url" }]);
    expect(editor.view.state.doc.toString()).toBe("X before\n[文字](url)");

    editor.view.dispatch({ effects: openLinkEditorEffect.of(null) });
    const second = session()!;
    const at = editor.view.state.doc.length;
    editor.view.dispatch({ changes: { from: at, insert: "Y" } });
    expect(second.valid).toBe(false);
    expect(second.complete([{ text: "新", url: "new" }])).toBe(false);
    expect(editor.view.state.doc.toString()).toContain("Y");
    editor.destroy();
  });

  it("edits a new link with Unicode edge whitespace outside the markers", () => {
    let session: LinkImageEditorSession | null = null;
    const editor = createEditor({
      parent: parent(),
      doc: "\u3000文字\u3000",
      mode: "immersive",
      platform: "macos",
      onEditLinkImage: (next) => {
        session = next;
      },
    });
    editor.view.dispatch({
      selection: { anchor: 0, head: 4 },
      effects: openLinkEditorEffect.of(null),
    });
    expect(session).not.toBeNull();
    session!.complete([{ text: "链接", url: "target" }]);
    expect(editor.view.state.doc.toString()).toBe("\u3000[链接](target)\u3000");
    editor.destroy();
  });

  it("edits an image and keeps the rest of the syntax intact", () => {
    const doc = 'before ![图](a.png) after\n';
    const editor = createEditor({
      parent: parent(),
      doc,
      mode: "immersive",
      platform: "macos",
    });
    const target = inlineTargetAt(editor.view.state, doc.indexOf("图"))!;
    expect(target.kind).toBe("image");
    const first = createLinkImageEditorSession(
      editor.view,
      target,
      false,
      () => {},
    );
    expect(first.initialText).toBe("图");
    expect(first.initialUrl).toBe("a.png");
    expect(
      first.complete([{ text: "新图", url: "assets/图 1.png" }]),
    ).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(
      "before ![新图](assets/%E5%9B%BE%201.png) after\n",
    );
    const updated = inlineTargetAt(
      editor.view.state,
      editor.view.state.doc.toString().indexOf("新图"),
    );
    expect(updated?.kind).toBe("image");
    expect(resolveLocalImagePath(updated!.url, "a.md")).toBe(
      "assets/图 1.png",
    );
    editor.destroy();
  });
});

describe("batch drafts and whitespace", () => {
  it("keeps Unicode edge whitespace outside a new link draft", () => {
    const state = EditorState.create({
      doc: "\u3000文字\u3000",
      selection: EditorSelection.range(0, 4),
      extensions: [markdown({ base: markdownLanguage })],
    });
    expect(newLinkDraft(state)).toMatchObject({
      text: "文字",
      leading: "\u3000",
      trailing: "\u3000",
    });
  });

});

describe("popover placement", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 340, height: 160 };

  it("places below when there is room", () => {
    expect(
      placeLinkImagePopover(
        { left: 100, right: 160, top: 100, bottom: 120 },
        size,
        viewport,
      ),
    ).toEqual({ left: 100, top: 124, placement: "below" });
  });

  it("flips above near the lower edge", () => {
    expect(
      placeLinkImagePopover(
        { left: 100, right: 160, top: 700, bottom: 720 },
        size,
        viewport,
      ),
    ).toEqual({ left: 100, top: 536, placement: "above" });
  });

  it("keeps an 8px margin at both window edges", () => {
    expect(
      placeLinkImagePopover(
        { left: -20, right: 20, top: 100, bottom: 120 },
        size,
        viewport,
      ).left,
    ).toBe(8);
    expect(
      placeLinkImagePopover(
        { left: 980, right: 1020, top: 100, bottom: 120 },
        size,
        viewport,
      ).left,
    ).toBe(652);
  });
});
