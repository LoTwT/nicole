import { EditorSelection } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type EditorHandle, type EditorMode } from "../index";
import { editTableAtCursor, tableEditing, tableEditorDialogOpen, TABLE_DIALOG_EVENT } from "./index";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";

const source = "前文\n\n| A | B |\n| --- | :---: |\n| 1 | 2 |\n\n后文";
let host: HTMLElement;
let editor: EditorHandle;
const buttons = (text: string, root: ParentNode = host) => [...root.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.textContent === text);
const click = (text: string) => buttons(text)[0]!.click();
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')!;
const cell = (row: number, column: number) => dialog().querySelector<HTMLInputElement>(`input[data-table-row="${row}"][data-table-column="${column}"]`)!;
const type = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };

function mount(mode: EditorMode = "live") {
  editor = createEditor({ parent: host, doc: source, mode });
  return editor;
}

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); });
afterEach(() => { editor?.destroy(); host.remove(); });

describe("table display and editing", () => {
  it("renders a table without modifying Markdown and reveals source when the caret enters it", () => {
    mount();
    expect(host.querySelector(".cm-nicole-table table")?.textContent).toBe("AB12");
    expect(editor.view.state.doc.toString()).toBe(source);
    click("编辑源码");
    expect(host.querySelector(".cm-nicole-table table")).toBeNull();
    expect(host.querySelector(".cm-content")?.textContent).toContain("| A | B |");
    expect(buttons("编辑表格")).toHaveLength(1);
  });

  it.each(["live", "immersive", "source"] as const)("edits in %s with a single undo and leaves surrounding text intact", (mode) => {
    mount(mode);
    editor.view.dispatch({ selection: EditorSelection.cursor(source.indexOf("A")) });
    expect(editTableAtCursor(editor.view)).toBe(true);
    type(cell(1, 0), "修改");
    expect(editor.view.state.doc.toString()).toBe(source);
    click("应用修改");
    expect(editor.view.state.doc.toString()).toContain("| 修改 | 2 |");
    expect(editor.view.state.doc.toString()).toMatch(/^前文\n\n/);
    expect(editor.view.state.doc.toString()).toMatch(/\n\n后文$/);
    expect(editor.undo()).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(source);
    expect(editor.redo()).toBe(true);
    expect(editor.view.state.doc.toString()).toContain("修改");
    if (mode === "source") expect(host.querySelector(".cm-nicole-table")).toBeNull();
  });

  it("adds/removes rows and columns and changes alignment in the draft", () => {
    mount();
    click("编辑表格");
    cell(1, 0).focus();
    click("下方插入行");
    type(cell(2, 0), "新增行");
    click("右侧插入列");
    type(cell(0, 1), "新增列");
    cell(1, 1).focus();
    const alignment = dialog().querySelector<HTMLSelectElement>('select[aria-label="当前列对齐"]')!;
    alignment.value = "right";
    alignment.dispatchEvent(new Event("change", { bubbles: true }));
    cell(1, 2).focus();
    click("删除当前列");
    cell(1, 0).focus();
    click("删除当前行");
    click("应用修改");
    expect(editor.view.state.doc.toString()).toBe("前文\n\n| A | 新增列 |\n| --- | ---: |\n| 新增行 |  |\n\n后文");
    editor.undo();
    expect(editor.view.state.doc.toString()).toBe(source);
  });

  it("Cancel and Escape discard the draft without moving the source selection, and defer to composition", () => {
    mount();
    const originalSelection = editor.view.state.selection;
    click("编辑表格");
    type(cell(1, 0), "草稿");
    cell(1, 0).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
    expect(dialog()).not.toBeNull();
    expect(editor.view.state.doc.toString()).toBe(source);
    click("取消");
    expect(dialog()).toBeNull();
    expect(editor.view.state.selection.eq(originalSelection, true)).toBe(true);
    click("编辑表格");
    cell(0, 0).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dialog()).toBeNull();
    expect(host.querySelector(".cm-nicole-table table")).not.toBeNull();
    expect(editor.view.state.selection.eq(originalSelection, true)).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(source);
  });

  it("discards a stale draft on external document edits, mode changes and destroy", () => {
    mount();
    click("编辑表格");
    const apply = buttons("应用修改")[0]!;
    type(cell(1, 0), "旧草稿");
    editor.replaceDocument(source + "外部变化");
    expect(dialog()).toBeNull();
    apply.click();
    expect(editor.view.state.doc.toString()).toBe(source + "外部变化");
    click("编辑表格");
    editor.setMode("source");
    expect(dialog()).toBeNull();
    editor.view.dispatch({ selection: { anchor: source.indexOf("A") } });
    expect(editTableAtCursor(editor.view)).toBe(true);
    editor.destroy();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    editor = undefined as unknown as EditorHandle;
  });

  it("a no-op Apply preserves original spacing and creates no undo entry", () => {
    mount();
    click("编辑表格");
    click("应用修改");
    expect(editor.view.state.doc.toString()).toBe(source);
    expect(editor.undo()).toBe(false);
  });

  it.each([
    "> | A | B |\n> |---|---|\n> |1|2|",
    "- | A | B |\n  |---|---|\n  |1|2|",
  ])("keeps container prefixes for nested tables", (table) => {
    const doc = table + "\n\n后文";
    editor = createEditor({ parent: host, doc, mode: "live" });
    editor.view.dispatch({ selection: { anchor: doc.length } });
    expect(host.querySelector(".cm-nicole-table table")).not.toBeNull();
    click("编辑表格");
    type(cell(1, 0), "修改");
    click("应用修改");
    expect(editor.view.state.doc.toString()).toContain(table.startsWith(">") ? "> | 修改 | 2 |" : "  | 修改 | 2 |");
    editor.undo();
    expect(editor.view.state.doc.toString()).toBe(doc);
  });

  it("does not insert raw HTML without the sanitized renderer", () => {
    editor = createEditor({ parent: host, doc: "|<img src=x onerror=alert(1)>|B|\n|---|---|\n|x|y|\n\n末尾", mode: "immersive" });
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    expect(host.querySelector(".cm-nicole-table img")).toBeNull();
    expect(host.querySelector(".cm-nicole-table th")?.textContent).toContain("<img");
  });

  it("keeps large tables in source rather than constructing an unbounded grid or form", () => {
    const rows = "|1|2|\n".repeat(1_001);
    const doc = "|A|B|\n|---|---|\n" + rows + "\n后文";
    editor = createEditor({ parent: host, doc });
    expect(host.querySelector(".cm-nicole-table table")).toBeNull();
    expect(host.textContent).toContain("表格较大，请直接编辑源码");
    editor.view.dispatch({ selection: { anchor: doc.indexOf("A") } });
    expect(editTableAtCursor(editor.view)).toBe(false);
    expect(editor.view.state.doc.toString()).toBe(doc);
  });

  it("keeps structural additions within the cell limit without losing the draft", () => {
    const doc = "|A|\n|---|\n" + "|x|\n".repeat(1_999);
    editor = createEditor({ parent: host, doc });
    expect(editTableAtCursor(editor.view)).toBe(true);
    type(cell(1, 0), "保留草稿");
    const addRow = buttons("下方插入行")[0]!;
    const addColumn = buttons("右侧插入列")[0]!;
    expect(addRow.disabled).toBe(true);
    expect(addColumn.disabled).toBe(true);
    expect(dialog().textContent).toContain("表格已达到可视编辑上限");
    addRow.click();
    addColumn.click();
    expect(dialog().querySelectorAll("input")).toHaveLength(2_000);
    expect(cell(1, 0).value).toBe("保留草稿");
    expect(editor.view.state.doc.toString()).toBe(doc);
    click("应用修改");
    expect(editor.view.state.doc.toString()).toContain("| 保留草稿 |");
    expect(editor.undo()).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(doc);
  });

  it("consumes only the table pipe escape before inline rendering and preserves the source", async () => {
    const table = "| `a\\|b` | `c\\\\\\|d` | e\\|f |\n| --- | --- | --- |\n| x | y | z |";
    const doc = "前文\n\n" + table + "\n\n后文";
    const markdownRenderer = new MarkdownIt();
    const expected = document.createElement("div");
    expected.innerHTML = markdownRenderer.render(table);
    const view = new EditorView({ parent: host, state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), tableEditing("live", {
        renderInline: async (value) => markdownRenderer.renderInline(value),
      })],
    }) });
    try {
      await Promise.resolve();
      expect([...host.querySelectorAll(".cm-nicole-table th")].map((element) => element.innerHTML))
        .toEqual([...expected.querySelectorAll("th")].map((element) => element.innerHTML));
      expect(host.querySelector(".cm-nicole-table code")?.textContent).toBe("a|b");
      view.dispatch({ selection: { anchor: doc.indexOf("`a") } });
      expect(editTableAtCursor(view)).toBe(true);
      expect(cell(0, 0).value).toBe("`a\\|b`");
      click("应用修改");
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
    }
  });

  it("announces dialog ownership, traps focus, and leaves Enter/Esc to the IME until composition ends", () => {
    mount();
    const events: boolean[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent<{ open: boolean }>).detail.open);
    host.addEventListener(TABLE_DIALOG_EVENT, listener);
    click("编辑表格");
    expect(tableEditorDialogOpen(host)).toBe(true);
    const targets = [...dialog().querySelectorAll<HTMLElement>("button:not(:disabled),input,select")];
    targets.at(-1)!.focus();
    targets.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(targets[0]);
    targets[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(targets.at(-1));
    const input = cell(1, 0);
    type(input, "组合完成");
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(tableEditorDialogOpen(host)).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(source);
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(tableEditorDialogOpen(host)).toBe(false);
    expect(editor.view.state.doc.toString()).toContain("组合完成");
    expect(events).toEqual([true, false]);
    host.removeEventListener(TABLE_DIALOG_EVENT, listener);
  });

  it("forwards sanitized DOM link values as Markdown source and blocks middle-click navigation", async () => {
    const opened = vi.fn();
    const view = new EditorView({ parent: host, state: EditorState.create({
      doc: source,
      extensions: [markdown({ base: markdownLanguage }), tableEditing("live", {
        renderInline: async () => '<a href="https://example.com/?q=&amp;copy;\\path">链接</a>',
        onOpenLink: opened,
      })],
    }) });
    await Promise.resolve();
    await Promise.resolve();
    const link = host.querySelector<HTMLAnchorElement>(".cm-nicole-table a")!;
    expect(link).not.toBeNull();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(opened).toHaveBeenCalledWith("https://example.com/?q=&amp;copy;\\\\path");
    const middle = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    link.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(opened).toHaveBeenCalledTimes(1);
    view.destroy();
  });

  it("aborts asynchronous cell rendering when its widget is destroyed", async () => {
    let resolve!: (html: string) => void;
    let signal: AbortSignal | undefined;
    const renderer = vi.fn((_source: string, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return new Promise<string>((done) => { resolve = done; });
    });
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: source, extensions: [markdown({ base: markdownLanguage }), tableEditing("live", { renderInline: renderer })] }) });
    const oldCell = [...host.querySelectorAll(".cm-nicole-table td")].at(-1)!;
    view.destroy();
    expect(signal?.aborted).toBe(true);
    resolve("<strong>迟到内容</strong>");
    await Promise.resolve();
    expect(oldCell.querySelector("strong")).toBeNull();
  });
});
