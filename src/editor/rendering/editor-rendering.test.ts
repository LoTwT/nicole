import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type EditorHandle } from "../index";
import { until } from "../test-helpers";

const settleUntil = (predicate: () => boolean) => until(predicate, "rich rendering", 2000);

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: "<svg><text>graph</text></svg>" })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

const editors: EditorHandle[] = [];
function mount(doc: string, mode: "live" | "immersive" | "source" = "live") {
  const parent = document.createElement("div");
  document.body.append(parent);
  const onChange = vi.fn();
  const editor = createEditor({ parent, doc, mode, onChange });
  editors.push(editor);
  return { editor, parent, onChange };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe("rich content in the editor", () => {
  it("renders math in preview modes without changing source or history", async () => {
    const doc = "start\n\n$x^2$\n\n$$\ny^2\n$$\n\nend";
    const { editor, parent, onChange } = mount(doc);
    await settleUntil(() => parent.querySelectorAll(".katex").length === 2);
    expect(editor.view.state.doc.toString()).toBe(doc);
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.undo()).toBe(false);
    editor.setMode("source");
    expect(parent.querySelector(".cm-nicole-rich-inline,.cm-nicole-rich-block")).toBeNull();
    expect(editor.view.state.doc.toString()).toBe(doc);
    editor.setMode("immersive");
    await settleUntil(() => parent.querySelectorAll(".katex").length === 2);
    expect(editor.view.state.doc.toString()).toBe(doc);
  });

  it("renders rich body content after closed Frontmatter without rendering metadata math", async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const doc = '---\ntitle: "$metadata$"\n---\n\nstart\n\n$x^2$\n\n' +
      fence + "mermaid\nflowchart LR\nA-->B\n" + fence +
      "\n\n> [!NOTE] Callout\n> body\n\nend";
    const { editor, parent, onChange } = mount(doc);
    await settleUntil(() => parent.querySelector(".katex") !== null &&
      parent.querySelector("svg") !== null && parent.querySelector(".cm-nicole-callout-label") !== null);
    expect(parent.querySelectorAll(".katex")).toHaveLength(1);
    expect(parent.querySelector(".katex")?.textContent).toContain("x");
    expect(parent.querySelector(".katex")?.textContent).not.toContain("metadata");
    expect(editor.view.state.doc.toString()).toBe(doc);
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.undo()).toBe(false);
  });

  it("reveals source for editing then renders the updated formula and keeps Undo", async () => {
    const doc = "start\n\n$x^2$\n\nend";
    const { editor, parent } = mount(doc);
    await settleUntil(() => parent.querySelector(".katex") !== null);
    parent.querySelector<HTMLButtonElement>(".cm-nicole-rich-edit")!.click();
    expect(parent.querySelector(".katex")).toBeNull();
    expect(editor.view.state.selection.main.head).toBe(doc.indexOf("$") + 1);
    editor.view.dispatch({ changes: { from: doc.indexOf("x"), to: doc.indexOf("x") + 1, insert: "z" } });
    expect(editor.view.state.doc.toString()).toContain("$z^2$");
    editor.view.dispatch({ selection: { anchor: 0 } });
    await settleUntil(() => parent.querySelector(".katex") !== null);
    expect(parent.querySelector(".katex")?.textContent).toContain("z");
    expect(editor.undo()).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(doc);
  });

  it("does not recognize math inside code or frontmatter", async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const doc = "---\ntitle: $x$\n---\n\n" + fence + "text\n$x$\n" + fence + "\n\nend";
    const { editor, parent } = mount(doc);
    editor.view.dispatch({ selection: { anchor: doc.length } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(parent.querySelector(".katex")).toBeNull();
  });

  it("places the block formula edit cursor in its content rather than its opening delimiter", async () => {
    const doc = "start\n\n$$\n  y^2\n$$\n\nend";
    const { editor, parent } = mount(doc);
    await settleUntil(() => parent.querySelector(".katex") !== null);
    parent.querySelector<HTMLButtonElement>(".cm-nicole-rich-edit")!.click();
    expect(editor.view.state.selection.main.head).toBe(doc.indexOf("y"));
    expect(editor.view.state.doc.toString()).toBe(doc);
  });

  it("styles callout lines and reveals its marker on the active line", async () => {
    const doc = "start\n\n> [!NOTE] Title\n> Body\n\nend";
    const { editor, parent } = mount(doc);
    await settleUntil(() => parent.querySelector(".cm-nicole-callout-label") !== null);
    expect(parent.querySelectorAll(".cm-nicole-callout")).toHaveLength(2);
    editor.view.dispatch({ selection: { anchor: doc.indexOf("[!NOTE]") } });
    expect(parent.querySelector(".cm-nicole-callout-label")).toBeNull();
    expect(editor.view.state.doc.toString()).toBe(doc);
  });

  it.each([
    { lead: "> ", opening: "" },
    { lead: "  ", opening: "- 项目\n\n" },
  ])("renders nested math and Mermaid while preserving their container source ($lead)", async ({ lead, opening }) => {
    const fence = String.fromCharCode(96).repeat(3);
    const doc = "start\n\n" + opening + ["$$", "y^2", "$$", "", fence + "mermaid", "flowchart LR", "A-->B", fence]
      .map((line) => lead + line).join("\n") + "\n\nend";
    const { editor, parent, onChange } = mount(doc);
    await settleUntil(() => parent.querySelector(".katex-display") !== null && parent.querySelector("svg") !== null);
    expect(mermaid.render).toHaveBeenLastCalledWith(expect.any(String), "flowchart LR\nA-->B");
    expect(parent.querySelectorAll(".cm-nicole-rich-nested")).toHaveLength(2);
    parent.querySelector<HTMLButtonElement>('[data-rich-kind="math"] .cm-nicole-rich-edit')!.click();
    expect(editor.view.state.selection.main.head).toBe(doc.indexOf("y^2"));
    expect(parent.querySelector('[data-rich-kind="math"]')).toBeNull();
    expect(editor.view.state.doc.toString()).toBe(doc);
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.undo()).toBe(false);
    editor.setMode("source");
    expect(parent.querySelector(".cm-nicole-rich-block")).toBeNull();
    expect(editor.view.state.doc.toString()).toBe(doc);
  });

  it("folds signed callouts transiently and reveals a selected folded body", async () => {
    const doc = "start\n\n> [!NOTE]- Closed\n> body\n\nend";
    const { editor, parent, onChange } = mount(doc);
    const toggle = () => parent.querySelector<HTMLButtonElement>(".cm-nicole-callout-toggle")!;
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(editor.view.contentDOM.textContent).not.toContain("body");
    toggle().click();
    await settleUntil(() => toggle()?.getAttribute("aria-expanded") === "true");
    expect(editor.view.contentDOM.textContent).toContain("body");
    toggle().click();
    await settleUntil(() => toggle()?.getAttribute("aria-expanded") === "false");
    editor.view.dispatch({ selection: { anchor: doc.indexOf("body") + 1 } });
    expect(editor.view.contentDOM.textContent).toContain("body");
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(editor.view.contentDOM.textContent).not.toContain("body");
    toggle().click();
    await settleUntil(() => toggle()?.getAttribute("aria-expanded") === "true");
    editor.setMode("source");
    expect(parent.querySelector(".cm-nicole-callout-toggle")).toBeNull();
    editor.setMode("immersive");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(editor.view.state.doc.toString()).toBe(doc);
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.undo()).toBe(false);
  });

  it("starts plus callouts open and keeps folding guarded during composition and stale clicks", async () => {
    const doc = "start\n\n> [!TIP]+ Open\n> body\n\nend";
    const { editor, parent } = mount(doc);
    const button = parent.querySelector<HTMLButtonElement>(".cm-nicole-callout-toggle")!;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    let composing = true;
    Object.defineProperty(editor.view, "compositionStarted", { configurable: true, get: () => composing });
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(parent.querySelector(".cm-nicole-callout-toggle")?.getAttribute("aria-expanded")).toBe("true");
    composing = false;
    button.click();
    editor.setMode("source");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(parent.querySelector(".cm-nicole-callout-toggle")).toBeNull();
    expect(editor.view.state.doc.toString()).toBe(doc);
  });

  it("keeps the composition DOM stable and refreshes after composition ends", async () => {
    const doc = "start\n\n$x$\n\nend";
    const { editor, parent } = mount(doc);
    await settleUntil(() => parent.querySelector(".katex") !== null);
    const widget = parent.querySelector(".cm-nicole-rich-inline");
    let composing = true;
    Object.defineProperty(editor.view, "compositionStarted", { configurable: true, get: () => composing });
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    editor.view.dispatch({ changes: { from: 1, insert: "字" } });
    expect(parent.querySelector(".cm-nicole-rich-inline")).toBe(widget);
    composing = false;
    editor.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await settleUntil(() => parent.querySelector(".cm-nicole-rich-inline") !== widget);
    expect(editor.view.state.doc.toString()).toBe("s字tart\n\n$x$\n\nend");
  });

  it("preserves the pending composition tail before table and rich previews resume", async () => {
    const doc = "文字\n\n$x$\n\nend";
    const { editor, parent } = mount(doc);
    await settleUntil(() => parent.querySelector(".katex") !== null);
    editor.view.focus();
    editor.view.dispatch({ selection: { anchor: 0, head: 2 } });
    const content = editor.view.contentDOM;
    content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    content.dispatchEvent(new CompositionEvent("compositionupdate", { data: "[", bubbles: true }));
    content.dispatchEvent(new InputEvent("beforeinput", {
      data: "[", inputType: "insertCompositionText", isComposing: true, bubbles: true,
    }));
    const line = content.querySelector(".cm-line")!;
    line.textContent = "[";
    const selection = window.getSelection()!;
    selection.collapse(line.firstChild!, 1);
    content.dispatchEvent(new InputEvent("input", {
      data: "[", inputType: "insertCompositionText", isComposing: true, bubbles: true,
    }));
    expect(editor.view.state.doc.toString()).toBe(doc);
    content.dispatchEvent(new CompositionEvent("compositionend", { data: "[", bubbles: true }));
    await settleUntil(() => editor.view.state.doc.toString() === "[\n\n$x$\n\nend");
    expect(editor.view.state.selection.main.from).toBe(1);
    expect(editor.view.state.selection.main.to).toBe(1);
    expect(parent.querySelector(".katex")).not.toBeNull();
  });

  it("keeps a late composition tail literal across decoration-only refreshes", async () => {
    const doc = "*\n\n$x$\n\nend";
    const { editor, parent } = mount(doc);
    await settleUntil(() => parent.querySelector(".katex") !== null);
    editor.view.focus();
    editor.view.dispatch({ selection: { anchor: 0, head: 1 } });
    const content = editor.view.contentDOM;
    content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    content.dispatchEvent(new CompositionEvent("compositionupdate", { data: "*", bubbles: true }));
    for (const name of ["beforeinput", "input"]) content.dispatchEvent(new InputEvent(name, {
      data: "*", inputType: "insertCompositionText", isComposing: true, bubbles: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    editor.replaceDocument("*\n外部\n\n$x$\n\nend");
    content.dispatchEvent(new CompositionEvent("compositionend", { data: "[", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    content.dispatchEvent(new InputEvent("beforeinput", {
      data: "[", inputType: "insertText", bubbles: true,
    }));
    const text = document.createTreeWalker(content.querySelector(".cm-line")!, NodeFilter.SHOW_TEXT).nextNode()!;
    text.nodeValue = "[";
    window.getSelection()!.collapse(text, 1);
    content.dispatchEvent(new InputEvent("input", { data: "[", inputType: "insertText", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(editor.view.state.doc.toString()).toBe("[\n外部\n\n$x$\n\nend");
    expect(editor.view.state.selection.main.from).toBe(1);
    expect(editor.view.state.selection.main.to).toBe(1);
  });

  it("preserves direct typing immediately after a settled composition", async () => {
    const doc = "文字\n\n$x$\n\nend";
    const { editor, parent } = mount(doc);
    await settleUntil(() => parent.querySelector(".katex") !== null);
    editor.view.focus();
    editor.view.dispatch({ selection: { anchor: 0, head: 2 } });
    const content = editor.view.contentDOM;
    const input = (composing: boolean) => {
      content.dispatchEvent(new InputEvent("beforeinput", {
        data: "*", inputType: "insertText", isComposing: composing, bubbles: true,
      }));
      const text = document.createTreeWalker(content.querySelector(".cm-line")!, NodeFilter.SHOW_TEXT).nextNode()!;
      text.nodeValue = "*";
      window.getSelection()!.collapse(text, 1);
      content.dispatchEvent(new InputEvent("input", {
        data: "*", inputType: "insertText", isComposing: composing, bubbles: true,
      }));
    };
    content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    content.dispatchEvent(new CompositionEvent("compositionupdate", { data: "*", bubbles: true }));
    input(true);
    await settleUntil(() => editor.view.state.doc.toString() === "*\n\n$x$\n\nend");
    content.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    editor.view.dispatch({ changes: { from: 0, to: 1, insert: "文字" }, selection: { anchor: 0, head: 2 } });
    input(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(editor.view.state.doc.toString()).toBe("*文字*\n\n$x$\n\nend");
  });

  it.each(["source", "destroy"] as const)("ignores diagram results after %s", async (stop) => {
    let complete!: (result: { svg: string }) => void;
    mermaid.render.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const fence = String.fromCharCode(96).repeat(3);
    const doc = "start\n\n" + fence + "mermaid\nflowchart LR\nA-->B\n" + fence + "\n\nend";
    const { editor, parent } = mount(doc);
    await settleUntil(() => typeof complete === "function");
    if (stop === "source") editor.setMode("source");
    else editor.destroy();
    complete({ svg: "<svg><text>stale graph</text></svg>" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(parent.querySelector("svg")).toBeNull();
    if (stop === "source") {
      expect(editor.view.state.doc.toString()).toBe(doc);
      expect(parent.querySelector(".cm-editor")).not.toBeNull();
    }
  });

  it("loads a fenced code language and exposes its syntax classes", async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const { parent } = mount(fence + "typescript\nconst value: number = 3;\n" + fence, "source");
    await settleUntil(() => parent.querySelector(".tok-keyword") !== null);
    expect(parent.querySelector(".tok-keyword")?.textContent).toBe("const");
  });
});
