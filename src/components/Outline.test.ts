import { EditorView } from "@codemirror/view";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Outline from "./Outline.vue";
import { createEditor, type EditorHandle } from "../editor";
import type { HeadingExtraction } from "../editor/headings";

vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", {
    value: "MacIntel",
    configurable: true,
  });
});

const headingMocks = vi.hoisted(() => ({ extract: vi.fn() }));

vi.mock("../editor/headings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../editor/headings")>();
  headingMocks.extract.mockImplementation(actual.extractHeadingsWithStatus);
  return {
    ...actual,
    extractHeadingsWithStatus: (
      ...args: Parameters<typeof actual.extractHeadingsWithStatus>
    ) => headingMocks.extract(...args),
  };
});

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;
let editor: EditorHandle | null = null;
let text: ReturnType<typeof ref<string>> | null = null;
let navigations = 0;

async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

function startDeadKeyComposition(view: EditorView) {
  view.contentDOM.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true }),
  );
  view.contentDOM.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "x",
    }),
  );
}

function mount(
  doc: string,
  fixed = false,
  composeFirst = false,
  beforeMount?: (view: EditorView) => void,
) {
  const parent = document.createElement("div");
  document.body.append(parent);
  host = document.createElement("div");
  document.body.append(host);
  const currentText = ref(doc);
  text = currentText;
  editor = createEditor({
    parent,
    doc,
    onChange: (value) => {
      currentText.value = value;
    },
  });
  const outline = editor;
  if (composeFirst) {
    outline.view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  }
  beforeMount?.(outline.view);
  const Wrapper = defineComponent({
    setup() {
      return () =>
        h(Outline, {
          view: outline.view,
          text: currentText.value,
          fixed,
          onNavigate: () => {
            navigations += 1;
          },
        });
    },
  });
  app = createApp(Wrapper);
  app.mount(host);
  return editor;
}

function headingButtons(): HTMLButtonElement[] {
  return [
    ...host.querySelectorAll<HTMLButtonElement>("[data-outline-heading]"),
  ];
}

function headingTexts(): string[] {
  return headingButtons().map((button) => button.textContent?.trim() ?? "");
}

beforeEach(async () => {
  document.body.innerHTML = "";
  navigations = 0;
  editor = null;
  text = null;
  app = null;
  vi.clearAllMocks();
});

afterEach(() => {
  app?.unmount();
  app = null;
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Outline", () => {
  it("lists H1–H3, omits the article title and indents by level", async () => {
    mount(
      [
        "# 文章标题",
        "",
        "## 第一节",
        "",
        "### 细节",
        "",
        "#### 不显示",
        "",
      ].join("\n"),
    );
    await settle();

    expect(headingTexts()).toEqual(["第一节", "细节"]);
    expect(headingButtons()[0]?.getAttribute("style")).toContain(
      "padding-left: 20px",
    );
    expect(headingButtons()[1]?.getAttribute("style")).toContain(
      "padding-left: 32px",
    );
  });

  it("shows a clear empty state and labels an empty heading", async () => {
    mount("# 文章标题\n");
    await settle();
    expect(host.textContent).toContain("没有标题");

    app?.unmount();
    app = null;
    editor?.destroy();
    editor = null;
    document.body.innerHTML = "";
    mount("# 文章标题\n\n## #\n");
    await settle();
    expect(headingTexts()).toEqual(["空标题"]);
    expect(host.textContent).not.toContain("没有标题");
  });

  it("jumps to the line start with a 24px top margin and returns focus", async () => {
    const doc = "# 文章标题\n\n## 第二节\n\n正文\n";
    const view = (mount(doc) as EditorHandle).view;
    await settle();
    const scroll = vi.spyOn(EditorView, "scrollIntoView");
    const dispatch = vi.spyOn(view, "dispatch");

    headingButtons()[0]!.click();
    await settle();

    const position = doc.indexOf("## 第二节");
    expect(view.state.selection.main.head).toBe(position);
    expect(scroll).toHaveBeenCalledWith(position, {
      y: "start",
      yMargin: 24,
    });
    const effect = scroll.mock.results[0]?.value;
    expect(
      dispatch.mock.calls.some(([spec]) => spec?.effects === effect),
    ).toBe(true);
    expect(document.activeElement).toBe(view.contentDOM);
    expect(navigations).toBe(1);
  });

  it("moves the active section with the visible top line", async () => {
    mount("# 文章\n\n## 第一节\n\n正文\n\n## 第二节\n\n更多\n");
    const view = (editor as EditorHandle).view;
    await settle();
    let topLine = 1;
    vi.spyOn(view, "lineBlockAtHeight").mockImplementation(
      () => ({ from: view.state.doc.line(topLine).from }) as never,
    );

    topLine = 5;
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(headingButtons()[0]?.getAttribute("data-active")).toBe("true");
    expect(headingButtons()[1]?.getAttribute("data-active")).toBeNull();

    topLine = 7;
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(headingButtons()[0]?.getAttribute("data-active")).toBeNull();
    const active = headingButtons()[1]!;
    expect(active.getAttribute("data-active")).toBe("true");
    expect(active.getAttribute("aria-current")).toBe("location");
    expect(active.className).toContain("border-[var(--text-accent)]");
    expect(active.className).not.toContain("border-transparent");
    expect(headingButtons()[0]!.className).toContain("border-transparent");
    expect(headingButtons()[0]!.className).not.toContain(
      "border-[var(--text-accent)]",
    );
  });

  it("updates 300ms after the last document change", async () => {
    vi.useFakeTimers();
    mount("# 文章\n\n## 第一节\n");
    await settle();
    expect(headingTexts()).toEqual(["第一节"]);

    const view = (editor as EditorHandle).view;
    view.dispatch({
      changes: {
        from: view.state.doc.length,
        insert: "\n## 第二节\n",
      },
    });
    await settle();
    expect(headingTexts()).toEqual(["第一节"]);

    await vi.advanceTimersByTimeAsync(299);
    await settle();
    expect(headingTexts()).toEqual(["第一节"]);

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(headingTexts()).toEqual(["第一节", "第二节"]);
  });

  it("ignores old heading positions after an edit until the refresh", async () => {
    vi.useFakeTimers();
    mount("# 文章\n\n## 第一节\n\n正文\n");
    await settle();
    const view = (editor as EditorHandle).view;
    view.dispatch({ selection: { anchor: 0 } });

    view.dispatch({ changes: { from: 0, insert: "\n" } });
    await settle();
    const selectionAfterEdit = view.state.selection.main;
    headingButtons()[0]!.click();
    await settle();

    expect(navigations).toBe(0);
    expect(view.state.selection.main.eq(selectionAfterEdit)).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    await settle();
    const position = view.state.doc.toString().indexOf("## 第一节");
    headingButtons()[0]!.click();
    await settle();
    expect(navigations).toBe(1);
    expect(view.state.selection.main.head).toBe(position);
  });

  it("does not jump below the shortened document before the refresh", async () => {
    vi.useFakeTimers();
    mount("# 文章\n\n## 第一节\n\n正文\n");
    await settle();
    const view = (editor as EditorHandle).view;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "" },
    });
    await settle();
    const selectionAfterEdit = view.state.selection.main;
    expect(() => headingButtons()[0]!.click()).not.toThrow();
    expect(navigations).toBe(0);
    expect(view.state.selection.main.eq(selectionAfterEdit)).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(host.textContent).toContain("没有标题");
  });

  it("recovers after a real CodeMirror dead-key composition ends", async () => {
    vi.useFakeTimers();
    mount("# 文章\n\n## 第一节\n");
    await settle();
    const view = (editor as EditorHandle).view;
    startDeadKeyComposition(view);
    expect(view.compositionStarted).toBe(true);
    expect(view.composing).toBe(false);

    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\n## 第二节\n" },
    });
    await settle();
    expect(headingTexts()).toEqual(["第一节"]);
    const callsBeforeEnd = headingMocks.extract.mock.calls.length;

    // The document change comes first. CodeMirror's own 20ms Safari fallback
    // then ends the composition without a DOM compositionend or another edit.
    await vi.advanceTimersByTimeAsync(19);
    expect(view.compositionStarted).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(view.compositionStarted).toBe(false);
    expect(view.composing).toBe(false);
    expect(headingMocks.extract).toHaveBeenCalledTimes(callsBeforeEnd);

    await vi.advanceTimersByTimeAsync(130);
    await settle();
    expect(headingTexts()).toEqual(["第一节"]);

    await vi.advanceTimersByTimeAsync(149);
    await settle();
    expect(headingTexts()).toEqual(["第一节"]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(headingTexts()).toEqual(["第一节", "第二节"]);
    const callsAfterRefresh = headingMocks.extract.mock.calls.length;

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(headingMocks.extract).toHaveBeenCalledTimes(callsAfterRefresh);
  });

  it("recovers when mounted after the edit but before a real dead-key composition ends", async () => {
    vi.useFakeTimers();
    mount("# 文章\n\n## 第一节\n", false, false, (view) => {
      startDeadKeyComposition(view);
      expect(view.compositionStarted).toBe(true);
      expect(view.composing).toBe(false);
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "\n## 第二节\n" },
      });
    });
    await settle();
    const view = (editor as EditorHandle).view;
    expect(headingTexts()).toEqual([]);
    expect(host.textContent).not.toContain("没有标题");

    await vi.advanceTimersByTimeAsync(20);
    expect(view.compositionStarted).toBe(false);
    expect(view.composing).toBe(false);
    await vi.advanceTimersByTimeAsync(279);
    await settle();
    expect(headingTexts()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(headingTexts()).toEqual(["第一节", "第二节"]);
  });

  it("waits for the composition to end before the first extraction", async () => {
    vi.useFakeTimers();
    mount("# 文章\n\n## 第一节\n", false, true);
    await settle();
    expect(headingTexts()).toEqual([]);
    expect(host.textContent).not.toContain("没有标题");

    // The mount check must not release a real composition just because a
    // timer fired; only its own compositionend may resume extraction.
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(headingMocks.extract).not.toHaveBeenCalled();

    const view = (editor as EditorHandle).view;
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(headingTexts()).toEqual(["第一节"]);
  });

  it("pauses updates during composition and resumes after it ends", async () => {
    vi.useFakeTimers();
    mount("# 文章\n\n## 第一节\n");
    await settle();
    const view = (editor as EditorHandle).view;

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\n## 组合中\n" },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(headingTexts()).toEqual(["第一节"]);

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(headingTexts()).toEqual(["第一节", "组合中"]);
  });

  it("resumes after a cancelled composition with no document change", async () => {
    vi.useFakeTimers();
    mount("# 文章\n\n## 第一节\n");
    await settle();
    const view = (editor as EditorHandle).view;
    const calls = headingMocks.extract.mock.calls.length;

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(headingMocks.extract).toHaveBeenCalledTimes(calls);

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(headingMocks.extract.mock.calls.length).toBeGreaterThan(calls);
    expect(headingTexts()).toEqual(["第一节"]);
  });

  it("marks a partially parsed list and fills it in later", async () => {
    vi.useFakeTimers();
    const doc = "## 前半\n\n## 后半\n";
    headingMocks.extract.mockReturnValueOnce({
      headings: [{ level: 2, text: "前半", position: 0, line: 1 }],
      complete: false,
    } satisfies HeadingExtraction);
    headingMocks.extract.mockReturnValueOnce({
      headings: [
        { level: 2, text: "前半", position: 0, line: 1 },
        { level: 2, text: "后半", position: doc.indexOf("## 后半"), line: 3 },
      ],
      complete: true,
    } satisfies HeadingExtraction);

    mount(doc);
    await settle();
    expect(headingTexts()).toEqual(["前半"]);
    expect(host.textContent).toContain("文档较大，部分标题尚未解析");

    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(headingTexts()).toEqual(["前半", "后半"]);
    expect(host.textContent).not.toContain("文档较大，部分标题尚未解析");
  });

  it("clears the composition-end check when the outline unmounts", async () => {
    vi.useFakeTimers();
    mount("# 文章\n\n## 第一节\n");
    await settle();
    const view = (editor as EditorHandle).view;
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\n## 迟到\n" },
    });
    await settle();
    const during = vi.getTimerCount();
    const calls = headingMocks.extract.mock.calls.length;

    app?.unmount();
    app = null;
    expect(vi.getTimerCount()).toBeLessThan(during);
    await vi.advanceTimersByTimeAsync(1000);
    expect(headingMocks.extract).toHaveBeenCalledTimes(calls);
  });

  it("clears timers and listeners when the outline unmounts", async () => {
    vi.useFakeTimers();
    mount("# 文章\n\n## 第一节\n");
    await settle();
    const view = (editor as EditorHandle).view;
    const lineBlock = vi.spyOn(view, "lineBlockAtHeight");
    const calls = headingMocks.extract.mock.calls.length;

    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\n## 迟到\n" },
    });
    await settle();
    app?.unmount();
    app = null;

    await vi.advanceTimersByTimeAsync(1000);
    expect(headingMocks.extract).toHaveBeenCalledTimes(calls);

    lineBlock.mockClear();
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    expect(lineBlock).not.toHaveBeenCalled();
  });
});
