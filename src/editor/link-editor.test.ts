import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEditor,
  type LinkImageEditorSession,
} from "./index";
import {
  createLinkImageEditorSession,
  inlineTargetAt,
  intersectPopoverBounds,
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

function titleSources(doc: string): string[] {
  const titles: string[] = [];
  markdownLanguage.parser.parse(doc).iterate({
    enter: (node) => {
      if (node.name === "LinkTitle") {
        titles.push(doc.slice(node.from, node.to));
      }
    },
  });
  return titles;
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

  it("keeps unedited destinations intact when only alt text changes", () => {
    for (const destination of [
      "<assets/a.png>",
      "<https://example.com/a.png>",
      "assets/a%2Fb.png",
      "assets/%3Cpic%3E.png",
      "<assets/%3Cpic%3E.png>",
    ]) {
      const doc = `![图](${destination})`;
      const editor = createEditor({
        parent: parent(),
        doc,
        mode: "source",
        platform: "macos",
      });
      const target = inlineTargetAt(editor.view.state, doc.indexOf("图"))!;
      const first = createLinkImageEditorSession(
        editor.view,
        target,
        false,
        () => {},
      );
      const semantic = destination.startsWith("<")
        ? destination.slice(1, -1)
        : destination;
      expect(first.initialUrl).toBe(semantic);
      expect(first.fields).toEqual([{ text: "图", url: semantic }]);
      expect(first.complete([{ text: "新图", url: semantic }])).toBe(true);
      expect(editor.view.state.doc.toString()).toBe(`![新图](${destination})`);
      const updated = inlineTargetAt(
        editor.view.state,
        editor.view.state.doc.toString().indexOf("新图"),
      );
      expect(updated?.kind).toBe("image");
      expect(updated?.url).toBe(semantic);
      editor.destroy();
    }
  });

  it("preserves a title and serializes a genuinely edited image address", () => {
    const doc = '![图](<assets/old.png> "标题")';
    const editor = createEditor({
      parent: parent(),
      doc,
      mode: "source",
      platform: "macos",
    });
    const target = inlineTargetAt(editor.view.state, doc.indexOf("图"))!;
    const first = createLinkImageEditorSession(
      editor.view,
      target,
      false,
      () => {},
    );
    expect(first.initialUrl).toBe("assets/old.png");
    expect(
      first.complete([{ text: "新图", url: "assets/新 图(1).png" }]),
    ).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(
      '![新图](assets/%E6%96%B0%20%E5%9B%BE%281%29.png "标题")',
    );
    const updated = inlineTargetAt(
      editor.view.state,
      editor.view.state.doc.toString().indexOf("新图"),
    );
    expect(updated?.url).toBe(
      "assets/%E6%96%B0%20%E5%9B%BE%281%29.png",
    );
    expect(resolveLocalImagePath(updated!.url, "a.md")).toBe(
      "assets/新 图(1).png",
    );
    editor.destroy();
  });

  it("writes a changed angle-wrapped remote image URL without encoding it", () => {
    const doc = "![图](<https://example.com/a.png>)";
    const editor = createEditor({
      parent: parent(),
      doc,
      mode: "source",
      platform: "macos",
    });
    const target = inlineTargetAt(editor.view.state, doc.indexOf("图"))!;
    const first = createLinkImageEditorSession(
      editor.view,
      target,
      false,
      () => {},
    );
    expect(
      first.complete([{ text: "图", url: "https://example.com/b.png" }]),
    ).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(
      "![图](https://example.com/b.png)",
    );
    editor.destroy();
  });

  it("uses the viewport only in a layout-less DOM and hides a zero-size laid-out host", () => {
    const doc = "[文字](url)";
    const editor = createEditor({
      parent: parent(),
      doc,
      mode: "source",
      platform: "macos",
    });
    const target = inlineTargetAt(editor.view.state, doc.indexOf("文字"))!;
    const session = createLinkImageEditorSession(
      editor.view,
      target,
      false,
      () => {},
    );
    const zero = {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    } as DOMRect;
    const rect = vi
      .spyOn(editor.view.dom, "getBoundingClientRect")
      .mockReturnValue(zero);
    try {
      expect(session.hostBounds()).toEqual({
        left: 0,
        right: window.innerWidth,
        top: 0,
        bottom: window.innerHeight,
      });
      Object.defineProperty(document.documentElement, "clientWidth", {
        configurable: true,
        value: 1024,
      });
      Object.defineProperty(document.documentElement, "clientHeight", {
        configurable: true,
        value: 768,
      });
      expect(session.hostBounds()).toBeNull();
    } finally {
      Reflect.deleteProperty(document.documentElement, "clientWidth");
      Reflect.deleteProperty(document.documentElement, "clientHeight");
      rect.mockRestore();
      session.dispose();
      editor.destroy();
    }
  });

  it("keeps a link's angle wrapper when its address is genuinely edited", () => {
    const doc = "[文字](<a b>)";
    const editor = createEditor({
      parent: parent(),
      doc,
      mode: "source",
      platform: "macos",
    });
    const target = inlineTargetAt(editor.view.state, doc.indexOf("文字"))!;
    const first = createLinkImageEditorSession(
      editor.view,
      target,
      false,
      () => {},
    );
    expect(first.initialUrl).toBe("a b");
    expect(first.complete([{ text: "文字", url: "a c" }])).toBe(true);
    expect(editor.view.state.doc.toString()).toBe("[文字](<a c>)");
    editor.destroy();
  });

  it("parses an explicit empty destination with a title", () => {
    for (const doc of ['[图](<> "标题")', '![图](<> "标题")']) {
      const target = inlineTargetAt(parsed(doc), doc.indexOf("图"));
      expect(target?.url).toBe("");
      expect(target?.hasTitle).toBe(true);
      expect(titleSources(doc)).toEqual(['"标题"']);
    }
  });

  it("keeps titles attached when clearing existing link and image addresses", () => {
    for (const [doc, expected, kind] of [
      ['[图](https://example.com/a.png "标题")', '[图](<> "标题")', "link"],
      ['[图](<https://example.com/a).png> "标题")', '[图](<> "标题")', "link"],
      ['![图](https://example.com/a.png "标题")', '![图](<> "标题")', "image"],
      ['![图](<assets/a.png> "标题")', '![图](<> "标题")', "image"],
    ] as const) {
      const editor = createEditor({
        parent: parent(),
        doc,
        mode: "source",
        platform: "macos",
      });
      const target = inlineTargetAt(editor.view.state, doc.indexOf("图"))!;
      const first = createLinkImageEditorSession(
        editor.view,
        target,
        false,
        () => {},
      );
      expect(first.complete([{ text: target.text, url: "" }])).toBe(true);
      const output = editor.view.state.doc.toString();
      expect(output).toBe(expected);
      expect(titleSources(output)).toEqual(['"标题"']);
      const updated = inlineTargetAt(editor.view.state, output.indexOf("图"));
      expect(updated?.kind).toBe(kind);
      expect(updated?.url).toBe("");
      expect(updated?.to).toBe(output.length);
      expect(updated?.hasTitle).toBe(true);
      expect(target.hasTitle).toBe(true);
      editor.destroy();
    }
  });

  it("keeps an omitted empty destination when there is no title", () => {
    for (const [doc, expected, kind] of [
      ["[图](https://example.com/a.png)", "[图]()", "link"],
      ["![图](https://example.com/a.png)", "![图]()", "image"],
    ] as const) {
      const editor = createEditor({
        parent: parent(),
        doc,
        mode: "source",
        platform: "macos",
      });
      const target = inlineTargetAt(editor.view.state, doc.indexOf("图"))!;
      const first = createLinkImageEditorSession(
        editor.view,
        target,
        false,
        () => {},
      );
      expect(first.complete([{ text: target.text, url: "" }])).toBe(true);
      const output = editor.view.state.doc.toString();
      expect(output).toBe(expected);
      expect(titleSources(output)).toEqual([]);
      const updated = inlineTargetAt(editor.view.state, output.indexOf("图"));
      expect(updated?.url).toBe("");
      expect(updated?.kind).toBe(kind);
      expect(updated?.hasTitle).toBe(false);
      editor.destroy();
    }
  });

  it("keeps an edited remote image destination and its title parseable", () => {
    for (const [doc, address] of [
      [
        '![图](<https://example.com/a).png> "标题")',
        "https://example.com/b).png",
      ],
      [
        '![图](https://example.com/a.png "标题")',
        "https://example.com/图 1.png?x=1#top",
      ],
    ] as const) {
      const editor = createEditor({
        parent: parent(),
        doc,
        mode: "source",
        platform: "macos",
      });
      const target = inlineTargetAt(editor.view.state, doc.indexOf("图"))!;
      const first = createLinkImageEditorSession(
        editor.view,
        target,
        false,
        () => {},
      );
      expect(first.complete([{ text: target.text, url: address }])).toBe(true);
      const updated = inlineTargetAt(
        editor.view.state,
        editor.view.state.doc.toString().indexOf("图"),
      );
      expect(updated?.kind).toBe("image");
      expect(updated?.url).toBe(address);
      expect(updated?.to).toBe(editor.view.state.doc.length);
      expect(editor.view.state.doc.toString()).toContain(' "标题")');
      editor.destroy();
    }
  });

  it("uses the same legal destination boundary for a changed link address", () => {
    const doc = '[文字](https://example.com/a.png "标题")';
    const address = "https://example.com/图 1.png?x=1#top";
    const editor = createEditor({
      parent: parent(),
      doc,
      mode: "source",
      platform: "macos",
    });
    const target = inlineTargetAt(editor.view.state, doc.indexOf("文字"))!;
    const first = createLinkImageEditorSession(
      editor.view,
      target,
      false,
      () => {},
    );
    expect(first.complete([{ text: target.text, url: address }])).toBe(true);
    const updated = inlineTargetAt(
      editor.view.state,
      editor.view.state.doc.toString().indexOf("文字"),
    );
    expect(updated?.kind).toBe("link");
    expect(updated?.url).toBe(address);
    expect(updated?.to).toBe(editor.view.state.doc.length);
    expect(editor.view.state.doc.toString()).toContain(' "标题")');
    editor.destroy();
  });

  it("keeps an angle-wrapped link destination on text-only completion", () => {
    const doc = "[文字](<https://example.com/a b>)";
    const editor = createEditor({
      parent: parent(),
      doc,
      mode: "source",
      platform: "macos",
    });
    const target = inlineTargetAt(editor.view.state, doc.indexOf("文字"))!;
    const first = createLinkImageEditorSession(
      editor.view,
      target,
      false,
      () => {},
    );
    expect(first.initialUrl).toBe("https://example.com/a b");
    expect(
      first.complete([
        { text: "新文字", url: "https://example.com/a b" },
      ]),
    ).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(
      "[新文字](<https://example.com/a b>)",
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
  const bounds = { left: 0, right: 1000, top: 0, bottom: 800 };
  const size = { width: 340, height: 160 };

  it("places below when there is room", () => {
    expect(
      placeLinkImagePopover(
        { left: 100, right: 160, top: 100, bottom: 120 },
        size,
        bounds,
      ),
    ).toEqual({ left: 100, top: 124, placement: "below" });
  });

  it("flips above near the lower edge", () => {
    expect(
      placeLinkImagePopover(
        { left: 100, right: 160, top: 700, bottom: 720 },
        size,
        bounds,
      ),
    ).toEqual({ left: 100, top: 536, placement: "above" });
  });

  it("keeps an 8px margin at both outer edges", () => {
    expect(
      placeLinkImagePopover(
        { left: -20, right: 20, top: 100, bottom: 120 },
        size,
        bounds,
      ).left,
    ).toBe(8);
    expect(
      placeLinkImagePopover(
        { left: 980, right: 1020, top: 100, bottom: 120 },
        size,
        bounds,
      ).left,
    ).toBe(652);
  });

  it("clips the host to the window viewport before placing", () => {
    const host = { left: -100, right: 1200, top: -20, bottom: 900 };
    const clipped = intersectPopoverBounds(host, {
      width: 1000,
      height: 800,
    });
    expect(clipped).toEqual({ left: 0, right: 1000, top: 0, bottom: 800 });
    expect(
      intersectPopoverBounds(
        { left: 1000, right: 1200, top: 0, bottom: 800 },
        { width: 1000, height: 800 },
      ),
    ).toBeNull();
  });

  it("clamps beside a fixed outline and within a small host", () => {
    const host = { left: 252, right: 980, top: 60, bottom: 700 };
    const placement = placeLinkImagePopover(
      { left: 950, right: 960, top: 100, bottom: 120 },
      size,
      host,
    );
    expect(placement.left + size.width).toBeLessThanOrEqual(host.right - 8);

    const small = { left: 300, right: 420, top: 80, bottom: 180 };
    const narrow = placeLinkImagePopover(
      { left: 410, right: 420, top: 120, bottom: 140 },
      size,
      small,
    );
    expect(narrow.left).toBe(small.left + 8);
    const narrowWidth = Math.min(size.width, small.right - small.left - 16);
    expect(narrow.left + narrowWidth).toBe(small.right - 8);
    expect(narrow.top).toBe(small.top + 8);
  });
});
