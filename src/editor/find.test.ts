import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorHandle } from "./index";
import { until } from "./test-helpers";

let parent: HTMLElement;
let editor: EditorHandle | null = null;

function mount(doc: string, platform: "macos" | "windows" | "linux" = "macos") {
  editor = createEditor({ parent, doc, mode: "live", platform });
  return editor;
}

function press(
  view: EditorView,
  key: string,
  options: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    code: `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  view.contentDOM.dispatchEvent(event);
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
  vi.restoreAllMocks();
});

describe("find/replace controller", () => {
  it("seeds a one-line selection but leaves a cross-line selection alone", () => {
    const instance = mount("alpha\nbeta\ngamma");
    const view = instance.view;
    const controller = instance.search;

    view.dispatch({ selection: { anchor: 0, head: 5 } });
    controller.open(false);
    expect(controller.snapshot()).toMatchObject({
      open: true,
      replaceVisible: false,
      query: "alpha",
      total: 1,
    });

    controller.close();
    expect(controller.snapshot().open).toBe(false);
    view.dispatch({ selection: { anchor: 0, head: 10 } });
    controller.open(true);
    expect(controller.snapshot()).toMatchObject({
      query: "alpha",
      replaceVisible: true,
    });
  });

  it("counts and wraps forward and backward, including case sensitivity", () => {
    const instance = mount("foo x foo y FOO");
    const controller = instance.search;
    controller.open(false);
    controller.setQuery("foo");

    expect(controller.snapshot()).toMatchObject({
      current: 0,
      total: 3,
      error: null,
    });

    controller.next();
    expect(instance.view.state.selection.main.from).toBe(0);
    expect(controller.snapshot().current).toBe(1);

    controller.next();
    expect(instance.view.state.selection.main.from).toBe(6);
    expect(controller.snapshot().current).toBe(2);

    controller.next();
    expect(instance.view.state.selection.main.from).toBe(12);
    expect(controller.snapshot().current).toBe(3);

    controller.next();
    expect(instance.view.state.selection.main.from).toBe(0);
    expect(controller.snapshot().current).toBe(1);

    controller.previous();
    expect(instance.view.state.selection.main.from).toBe(12);
    expect(controller.snapshot().current).toBe(3);

    controller.setCaseSensitive(true);
    expect(controller.snapshot()).toMatchObject({ current: 0, total: 2 });
    controller.next();
    expect(instance.view.state.selection.main.from).toBe(0);
    expect(controller.snapshot().current).toBe(1);
  });

  it("keeps Chinese and emoji offsets aligned with CodeMirror", () => {
    const instance = mount("中文😀中文");
    const controller = instance.search;
    controller.open(false);
    controller.setQuery("中文");
    expect(controller.snapshot().total).toBe(2);

    controller.next();
    expect(instance.view.state.selection.main.from).toBe(0);
    expect(instance.view.state.selection.main.to).toBe(2);
    controller.next();
    expect(instance.view.state.selection.main.from).toBe(4);
    expect(instance.view.state.selection.main.to).toBe(6);
    controller.next();
    expect(instance.view.state.selection.main.from).toBe(0);

    controller.setQuery("😀");
    expect(controller.snapshot().total).toBe(1);
    controller.next();
    expect(instance.view.state.selection.main.from).toBe(2);
    expect(instance.view.state.selection.main.to).toBe(4);
  });

  it("reports invalid regular expressions without throwing or editing", () => {
    const instance = mount("a+ b");
    const controller = instance.search;
    controller.open(true);
    controller.setRegexp(true);
    controller.setQuery("(");
    controller.setReplacement("x");

    expect(controller.snapshot()).toMatchObject({
      error: "invalid-regexp",
      current: 0,
      total: 0,
    });

    expect(() => controller.next()).not.toThrow();
    expect(() => controller.previous()).not.toThrow();
    expect(controller.replace()).toBe(false);
    expect(controller.replaceAll()).toBe(false);
    expect(instance.view.state.doc.toString()).toBe("a+ b");
    expect(controller.snapshot().error).toBe("invalid-regexp");

    controller.setQuery("");
    expect(controller.snapshot()).toMatchObject({
      error: null,
      current: 0,
      total: 0,
    });
    expect(controller.replaceAll()).toBe(false);
    expect(instance.view.state.doc.toString()).toBe("a+ b");
  });

  it("replaces the current match with capture groups and supports undo", () => {
    const instance = mount("a1 b2\na3");
    const controller = instance.search;
    controller.open(true);
    controller.setRegexp(true);
    controller.setQuery("([a-z])(\\d)");
    controller.setReplacement("$2$1");
    expect(controller.snapshot().total).toBe(3);

    instance.view.dispatch({ selection: { anchor: 0, head: 2 } });
    expect(controller.replace()).toBe(true);
    expect(instance.view.state.doc.toString()).toBe("1a b2\na3");
    expect(instance.view.state.selection.main.from).toBe(3);
    expect(controller.snapshot()).toMatchObject({ current: 1, total: 2 });

    expect(instance.undo()).toBe(true);
    expect(instance.view.state.doc.toString()).toBe("a1 b2\na3");
  });

  it("counts overlapping string matches consistently with navigation", () => {
    const instance = mount("aaa");
    const controller = instance.search;
    controller.open(false);
    controller.setQuery("aa");
    expect(controller.snapshot()).toMatchObject({ current: 0, total: 2 });

    // CodeMirror's string navigation starts inside the current match, so a
    // caret at offset 1 selects the overlapping [1, 3] match.
    instance.view.dispatch({ selection: { anchor: 1 } });
    controller.next();
    expect(instance.view.state.selection.main.from).toBe(1);
    expect(instance.view.state.selection.main.to).toBe(3);
    expect(controller.snapshot()).toMatchObject({ current: 2, total: 2 });
    expect(
      instance.view.contentDOM.querySelectorAll(".cm-searchMatch-selected")
        .length,
    ).toBeGreaterThan(0);

    controller.setReplacement("X");
    expect(controller.replaceAll()).toBe(true);
    expect(instance.view.state.doc.toString()).toBe("Xa");
    expect(instance.undo()).toBe(true);
    expect(instance.view.state.doc.toString()).toBe("aaa");
  });

  it("replaces all matches in one undo step and reports one model change", () => {
    const changes = vi.fn();
    editor = createEditor({
      parent,
      doc: "foo 中 foo 😀 foo",
      mode: "live",
      onChange: changes,
    });
    const instance = editor;
    const controller = instance.search;
    controller.open(true);
    controller.setQuery("foo");
    controller.setReplacement("bar");
    changes.mockClear();

    expect(controller.replaceAll()).toBe(true);
    expect(instance.view.state.doc.toString()).toBe("bar 中 bar 😀 bar");
    expect(changes).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toMatchObject({ current: 0, total: 0 });

    expect(instance.undo()).toBe(true);
    expect(instance.view.state.doc.toString()).toBe("foo 中 foo 😀 foo");
    expect(changes).toHaveBeenCalledTimes(2);

    expect(instance.redo()).toBe(true);
    expect(instance.view.state.doc.toString()).toBe("bar 中 bar 😀 bar");
  });

  it("highlights matches only while open and marks the selected match", async () => {
    const instance = mount("foo x foo");
    const controller = instance.search;
    const view = instance.view;
    controller.open(false);
    controller.setQuery("foo");
    await until(
      () => view.contentDOM.querySelectorAll(".cm-searchMatch").length === 2,
      "two search highlights",
    );
    expect(
      view.contentDOM.querySelectorAll(".cm-searchMatch-selected"),
    ).toHaveLength(0);

    controller.next();
    expect(
      view.contentDOM.querySelectorAll(".cm-searchMatch-selected"),
    ).toHaveLength(1);

    controller.close();
    expect(view.contentDOM.querySelectorAll(".cm-searchMatch")).toHaveLength(0);
  });

  it("maps search highlights during composition and rebuilds afterwards", async () => {
    const instance = mount("foo foo");
    const controller = instance.search;
    const view = instance.view;
    controller.open(false);
    controller.setQuery("foo");
    await until(
      () => view.contentDOM.querySelectorAll(".cm-searchMatch").length === 2,
      "two search highlights before composing",
    );
    const before = [
      ...view.contentDOM.querySelectorAll<HTMLElement>(".cm-searchMatch"),
    ];

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    view.dispatch({
      changes: { from: 0, insert: "foo " },
      selection: { anchor: 4 },
      userEvent: "input.type.compose",
    });
    await until(
      () => view.contentDOM.querySelectorAll(".cm-searchMatch").length === 2,
      "the mapped search highlights",
    );
    const during = [
      ...view.contentDOM.querySelectorAll<HTMLElement>(".cm-searchMatch"),
    ];
    expect(during[0]).toBe(before[0]);
    expect(during[1]).toBe(before[1]);

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    view.dispatch({});
    await until(
      () => view.contentDOM.querySelectorAll(".cm-searchMatch").length === 3,
      "the rebuilt search highlights",
    );
  });

  it("navigates matches in all three editor modes without changing Markdown", async () => {
    for (const mode of ["live", "immersive", "source"] as const) {
      editor?.destroy();
      editor = createEditor({
        parent,
        doc: "# 标题\n\n正文标题\n",
        mode,
      });
      const instance = editor;
      const controller = instance.search;
      controller.open(false);
      controller.setQuery("标题");
      expect(controller.snapshot().total).toBe(2);

      controller.next();
      expect(instance.view.state.selection.main.from).toBe(2);
      expect(instance.view.state.selection.main.to).toBe(4);
      expect(instance.view.state.doc.toString()).toBe("# 标题\n\n正文标题\n");
      await until(
        () =>
          instance.view.contentDOM.querySelectorAll(".cm-searchMatch").length >
          0,
        `the ${mode} search highlight`,
      );

      // Hidden leading markup is still navigable, and navigating it must not
      // rewrite the Markdown source.
      controller.setQuery("#");
      expect(controller.snapshot().total).toBe(1);
      controller.next();
      expect(instance.view.state.selection.main.from).toBe(0);
      expect(instance.view.state.selection.main.to).toBe(1);
      expect(instance.view.state.doc.toString()).toBe("# 标题\n\n正文标题\n");
    }
  });

  it("uses F3 and Shift-F3 on Windows and Ctrl-F for find", () => {
    const instance = mount("foo foo foo", "windows");
    const view = instance.view;
    instance.search.open(false);
    instance.search.setQuery("foo");
    expect(instance.search.snapshot().current).toBe(0);

    const next = new KeyboardEvent("keydown", {
      key: "F3",
      code: "F3",
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(true);
    expect(instance.search.snapshot().current).toBe(1);

    const previous = new KeyboardEvent("keydown", {
      key: "F3",
      code: "F3",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(previous);
    expect(previous.defaultPrevented).toBe(true);
    expect(instance.search.snapshot().current).toBe(3);

    instance.search.close();
    const find = press(view, "f", { ctrlKey: true });
    expect(find.defaultPrevented).toBe(true);
    expect(instance.search.snapshot().open).toBe(true);
  });
});
