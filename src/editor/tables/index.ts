import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

import type { EditorMode, ImageResolver } from "../types";
import { cloneMarkdownTable, parseMarkdownTable, serializeMarkdownTable, type MarkdownTable, type TableAlignment } from "./model";

export interface TableEditingOptions {
  renderInline?: (source: string, options?: { resolveImage?: ImageResolver; signal?: AbortSignal }) => Promise<string>;
  resolveImage?: ImageResolver;
  onOpenLink?: (source: string) => void;
}

interface TableRange {
  from: number;
  to: number;
  table: MarkdownTable;
  sourceOnly: boolean;
}

interface TableState {
  decorations: DecorationSet;
  composing: boolean;
}

const tableComposition = StateEffect.define<boolean>();
const controllers = new WeakMap<EditorView, TableController>();
export const TABLE_DIALOG_EVENT = "nicole:table-dialog-change";
const MAX_TABLE_CELLS = 2_000;
const MAX_TABLE_SOURCE_LENGTH = 256 * 1024;

function exceedsCellLimit(columns: number, bodyRows: number): boolean {
  return columns * (bodyRows + 1) > MAX_TABLE_CELLS;
}

/** A bounded form is preferable to mounting thousands of offscreen inputs. */
function sourceOnly(table: MarkdownTable): boolean {
  return table.source.length > MAX_TABLE_SOURCE_LENGTH ||
    exceedsCellLimit(table.headers.length, table.rows.length);
}

export function tableEditorDialogOpen(root: ParentNode = document): boolean {
  return root.querySelector("[data-nicole-table-dialog]") !== null;
}

export function tableRanges(state: EditorState): TableRange[] {
  const ranges: TableRange[] = [];
  const tree = syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (node.name !== "Table") return;
      if (node.to >= tree.length && tree.length < state.doc.length) return false;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      const source = state.sliceDoc(from, to);
      // The existing syntax tree already established the table boundary. Do
      // not parse a second full tree merely to show the large-table fallback.
      const table = source.length > MAX_TABLE_SOURCE_LENGTH
        ? { source, headers: [], rows: [], alignments: [], headerPrefix: "", delimiterPrefix: "", rowPrefixes: [] }
        : parseMarkdownTable(source);
      if (table) ranges.push({ from, to, table, sourceOnly: sourceOnly(table) });
      return false;
    },
  });
  return ranges;
}

function selected(state: EditorState, range: TableRange): boolean {
  return state.selection.ranges.some((selection) => selection.empty
    ? selection.head >= range.from && selection.head < range.to
    : selection.from < range.to && selection.to > range.from);
}

function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", (event) => { event.preventDefault(); action(); });
  return element;
}

class TableWidget extends WidgetType {
  private abort: AbortController | null = null;
  constructor(readonly range: TableRange, readonly options: TableEditingOptions, readonly sourceVisible: boolean) { super(); }
  override eq(other: TableWidget): boolean {
    return this.range.from === other.range.from && this.range.to === other.range.to &&
      this.range.table.source === other.range.table.source && this.sourceVisible === other.sourceVisible;
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-nicole-table";
    wrapper.contentEditable = "false";
    const toolbar = wrapper.appendChild(document.createElement("div"));
    toolbar.className = "cm-nicole-table-toolbar";
    const edit = toolbar.appendChild(button("编辑表格", () => controllers.get(view)?.open(this.range)));
    edit.disabled = this.range.sourceOnly;
    if (this.range.sourceOnly) {
      const notice = toolbar.appendChild(document.createElement("span"));
      notice.textContent = "表格较大，请直接编辑源码";
    }
    if (this.sourceVisible) {
      wrapper.classList.add("cm-nicole-table-source-toolbar");
      return wrapper;
    }
    toolbar.appendChild(button("编辑源码", () => controllers.get(view)?.source(this.range)));
    const scroll = wrapper.appendChild(document.createElement("div"));
    scroll.className = "cm-nicole-table-scroll";
    const table = scroll.appendChild(document.createElement("table"));
    const head = table.createTHead().insertRow();
    const body = table.createTBody();
    this.abort = new AbortController();
    const cell = (row: HTMLTableRowElement, value: string, column: number, heading: boolean, rowIndex: number) => {
      const target = row.appendChild(document.createElement(heading ? "th" : "td"));
      const alignment = this.range.table.alignments[column];
      if (alignment) target.style.textAlign = alignment;
      // GFM consumes the table-level pipe escape before inline parsing,
      // including inside code spans. Keep the editable source unchanged.
      const inlineSource = value.replace(/\\\|/g, "|");
      target.textContent = inlineSource;
      target.addEventListener("dblclick", () => controllers.get(view)?.open(this.range, rowIndex, column));
      if (this.options.renderInline) {
        const signal = this.abort!.signal;
        void this.options.renderInline(inlineSource, { resolveImage: this.options.resolveImage, signal }).then((html) => {
          // Only the shared, sanitized renderer is allowed to return HTML.
          if (!signal.aborted && target.isConnected) {
            target.innerHTML = html;
            view.requestMeasure();
          }
        }).catch(() => { /* Source text remains readable on a renderer failure. */ });
      }
    };
    this.range.table.headers.forEach((value, column) => cell(head, value, column, true, 0));
    this.range.table.rows.forEach((values, rowIndex) => {
      const row = body.insertRow();
      this.range.table.headers.forEach((_, column) => cell(row, values[column] ?? "", column, false, rowIndex + 1));
    });
    wrapper.addEventListener("click", (event) => {
      const link = (event.target as Element).closest("a");
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute("href");
      if (href) {
        // DOM href values have already decoded entities. The app navigation
        // boundary accepts Markdown source, so protect literal entity-looking
        // text and backslashes against an unintended second decode.
        this.options.onOpenLink?.(href.replace(/&/g, "&amp;").replace(/\\/g, "\\\\"));
      }
    });
    wrapper.addEventListener("auxclick", (event) => {
      if ((event.target as Element).closest("a")) event.preventDefault();
    });
    wrapper.addEventListener("mousedown", (event) => {
      if (event.button === 1 && (event.target as Element).closest("a")) event.preventDefault();
    });
    wrapper.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        controllers.get(view)?.source(this.range);
      }
    });
    return wrapper;
  }
  override ignoreEvent(): boolean { return true; }
  override destroy(): void { this.abort?.abort(); this.abort = null; }
}

class TableController {
  private panel: HTMLElement | null = null;
  private session: TableRange | null = null;
  private disposed = false;
  constructor(readonly view: EditorView) { controllers.set(view, this); }

  source(range: TableRange): void {
    this.close();
    if (!this.valid(range)) return;
    this.view.dispatch({ selection: EditorSelection.cursor(range.from), scrollIntoView: true });
    this.view.focus();
  }

  private valid(range: TableRange): boolean {
    return !this.disposed && range.to <= this.view.state.doc.length &&
      this.view.state.sliceDoc(range.from, range.to) === range.table.source;
  }

  close(): void {
    const wasOpen = this.panel !== null;
    this.panel?.remove();
    this.panel = null;
    this.session = null;
    if (wasOpen) this.view.dom.dispatchEvent(new CustomEvent(TABLE_DIALOG_EVENT, { detail: { open: false }, bubbles: true }));
  }

  open(range: TableRange, startRow = 0, startColumn = 0): boolean {
    if (!this.valid(range) || range.sourceOnly || this.view.compositionStarted || this.view.composing) return false;
    this.close();
    this.session = range;
    const draft = cloneMarkdownTable(range.table);
    let selectedRow = startRow;
    let selectedColumn = startColumn;
    let composing = false;
    const overlay = document.createElement("div");
    overlay.className = "cm-nicole-table-overlay";
    const panel = overlay.appendChild(document.createElement("section"));
    panel.className = "cm-nicole-table-editor";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "编辑表格");
    panel.dataset.nicoleTableDialog = "";
    const title = panel.appendChild(document.createElement("h2"));
    title.textContent = "编辑表格";
    const hint = panel.appendChild(document.createElement("p"));
    hint.textContent = "单元格支持 Markdown。Tab 切换单元格，⌘/Ctrl+Enter 应用，Esc 取消。";
    const actions = panel.appendChild(document.createElement("div"));
    actions.className = "cm-nicole-table-actions";
    const grid = panel.appendChild(document.createElement("div"));
    grid.className = "cm-nicole-table-scroll cm-nicole-table-grid";
    const footer = panel.appendChild(document.createElement("div"));
    footer.className = "cm-nicole-table-actions cm-nicole-table-footer";
    const cancel = () => {
      this.close();
      this.view.focus();
    };
    const source = () => this.source(range);
    const apply = () => {
      if (composing || !this.valid(range) || this.session !== range) return;
      const text = serializeMarkdownTable(draft);
      this.close();
      if (text !== range.table.source) {
        this.view.dispatch({
          changes: { from: range.from, to: range.to, insert: text },
          selection: EditorSelection.cursor(range.from + text.length),
          annotations: isolateHistory.of("full"),
          userEvent: "input.table",
          scrollIntoView: true,
        });
      } else {
        this.view.dispatch({ selection: EditorSelection.cursor(range.to), scrollIntoView: true });
      }
      this.view.focus();
    };
    const rebuild = () => {
      grid.replaceChildren();
      actions.replaceChildren();
      selectedColumn = Math.min(selectedColumn, draft.headers.length - 1);
      selectedRow = Math.min(selectedRow, draft.rows.length);
      const addRow = actions.appendChild(button("下方插入行", () => {
        if (exceedsCellLimit(draft.headers.length, draft.rows.length + 1)) return;
        const after = selectedRow;
        draft.rows.splice(after, 0, draft.headers.map(() => ""));
        draft.rowPrefixes.splice(after, 0, draft.rowPrefixes[Math.max(0, after - 1)] ?? draft.delimiterPrefix);
        selectedRow = after + 1;
        rebuild();
      }));
      addRow.disabled = exceedsCellLimit(draft.headers.length, draft.rows.length + 1);
      const deleteRow = actions.appendChild(button("删除当前行", () => {
        if (selectedRow === 0) return;
        draft.rows.splice(selectedRow - 1, 1);
        draft.rowPrefixes.splice(selectedRow - 1, 1);
        selectedRow = Math.max(0, selectedRow - 1);
        rebuild();
      }));
      deleteRow.disabled = selectedRow === 0;
      const addColumn = actions.appendChild(button("右侧插入列", () => {
        if (exceedsCellLimit(draft.headers.length + 1, draft.rows.length)) return;
        const after = selectedColumn + 1;
        draft.headers.splice(after, 0, "");
        draft.alignments.splice(after, 0, null);
        for (const row of draft.rows) {
          while (row.length < after) row.push("");
          row.splice(after, 0, "");
        }
        selectedColumn = after;
        rebuild();
      }));
      addColumn.disabled = exceedsCellLimit(draft.headers.length + 1, draft.rows.length);
      const deleteColumn = actions.appendChild(button("删除当前列", () => {
        if (draft.headers.length === 1) return;
        draft.headers.splice(selectedColumn, 1);
        draft.alignments.splice(selectedColumn, 1);
        for (const row of draft.rows) row.splice(selectedColumn, 1);
        rebuild();
      }));
      deleteColumn.disabled = draft.headers.length === 1;
      const alignment = actions.appendChild(document.createElement("select"));
      alignment.setAttribute("aria-label", "当前列对齐");
      for (const [value, label] of [["", "默认对齐"], ["left", "左对齐"], ["center", "居中"], ["right", "右对齐"]]) {
        const option = alignment.appendChild(document.createElement("option"));
        option.value = value!;
        option.textContent = label!;
      }
      alignment.value = draft.alignments[selectedColumn] ?? "";
      alignment.addEventListener("change", () => { draft.alignments[selectedColumn] = (alignment.value || null) as TableAlignment; });
      if (addRow.disabled || addColumn.disabled) {
        const notice = actions.appendChild(document.createElement("span"));
        notice.setAttribute("role", "status");
        notice.textContent = "表格已达到可视编辑上限，请删除行列或编辑源码后继续添加。";
      }
      const table = grid.appendChild(document.createElement("table"));
      [draft.headers, ...draft.rows].forEach((values, rowIndex) => {
        const row = table.insertRow();
        const label = row.insertCell();
        label.textContent = rowIndex === 0 ? "表头" : String(rowIndex);
        draft.headers.forEach((_, column) => {
          const cell = row.insertCell();
          const input = cell.appendChild(document.createElement("input"));
          input.type = "text";
          input.value = values[column] ?? "";
          input.setAttribute("aria-label", rowIndex === 0 ? `表头，第 ${column + 1} 列` : `第 ${rowIndex} 行，第 ${column + 1} 列`);
          input.dataset.tableRow = String(rowIndex);
          input.dataset.tableColumn = String(column);
          input.addEventListener("focus", () => {
            selectedRow = rowIndex;
            selectedColumn = column;
            deleteRow.disabled = selectedRow === 0;
            alignment.value = draft.alignments[column] ?? "";
          });
          input.addEventListener("input", () => {
            while (values.length <= column) values.push("");
            values[column] = input.value;
          });
        });
      });
      const target = grid.querySelector<HTMLInputElement>(`input[data-table-row="${selectedRow}"][data-table-column="${selectedColumn}"]`);
      target?.focus();
    };
    footer.appendChild(button("编辑源码", source));
    footer.appendChild(button("取消", cancel));
    const applyButton = footer.appendChild(button("应用修改", apply));
    applyButton.className = "cm-nicole-table-apply";
    overlay.addEventListener("compositionstart", () => { composing = true; });
    overlay.addEventListener("compositionend", () => { composing = false; });
    overlay.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (composing || event.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); apply(); }
      if (event.key === "Tab") {
        const targets = [...panel.querySelectorAll<HTMLElement>("button:not(:disabled),input,select")];
        const first = targets[0];
        const last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    overlay.addEventListener("mousedown", (event) => event.stopPropagation());
    this.view.dom.appendChild(overlay);
    this.panel = overlay;
    rebuild();
    this.view.dom.dispatchEvent(new CustomEvent(TABLE_DIALOG_EVENT, { detail: { open: true }, bubbles: true }));
    return true;
  }

  update(update: ViewUpdate): void {
    if (this.session && update.docChanged) this.close();
  }
  destroy(): void {
    this.disposed = true;
    this.close();
    controllers.delete(this.view);
  }
}

/** The registered editor command also makes the form available in source mode. */
export function editTableAtCursor(view: EditorView): boolean {
  const range = tableRanges(view.state).find((candidate) =>
    view.state.selection.main.head >= candidate.from && view.state.selection.main.head <= candidate.to);
  return range ? controllers.get(view)?.open(range) ?? false : false;
}

export function tableEditing(mode: EditorMode, options: TableEditingOptions = {}): Extension {
  const build = (state: EditorState): DecorationSet => {
    if (mode === "source") return Decoration.none;
    const ranges = tableRanges(state).map((range) => selected(state, range) || range.sourceOnly
      ? Decoration.widget({ widget: new TableWidget(range, options, true), block: true, side: -1 }).range(range.from)
      : Decoration.replace({ widget: new TableWidget(range, options, false), block: true }).range(range.from, range.to));
    return Decoration.set(ranges, true);
  };
  const field = StateField.define<TableState>({
    create(state) { return { decorations: build(state), composing: false }; },
    update(value, transaction) {
      let composing = value.composing;
      for (const effect of transaction.effects) if (effect.is(tableComposition)) composing = effect.value;
      if (composing) return { decorations: value.decorations.map(transaction.changes), composing };
      if (transaction.docChanged || transaction.selection || syntaxTree(transaction.state) !== syntaxTree(transaction.startState) ||
          composing !== value.composing) {
        return { decorations: build(transaction.state), composing };
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
  const lifecycle = ViewPlugin.fromClass(class {
    readonly controller: TableController;
    private disposed = false;
    private compositionEndPending = false;
    constructor(readonly view: EditorView) { this.controller = new TableController(view); }
    finishComposition() {
      if (this.compositionEndPending) return;
      this.compositionEndPending = true;
      // A measurement pass first reconciles pending DOM input. Defer the effect
      // until that pass ends so neither an IME tail nor the next input is repainted.
      this.view.requestMeasure({
        key: this,
        read: () => queueMicrotask(() => {
          this.compositionEndPending = false;
          if (this.disposed || this.view.compositionStarted || this.view.composing ||
              !this.view.state.field(field, false)?.composing) return;
          this.view.dispatch({ effects: tableComposition.of(false) });
        }),
      });
    }
    update(update: ViewUpdate) {
      this.controller.update(update);
      if (update.state.field(field).composing && !update.view.compositionStarted && !update.view.composing) {
        this.finishComposition();
      }
    }
    destroy() { this.disposed = true; this.controller.destroy(); }
  }, {
    eventHandlers: {
      compositionstart(_event, view) {
        if (mode !== "source") view.dispatch({ effects: tableComposition.of(true) });
      },
      compositionend() { if (mode !== "source") this.finishComposition(); },
    },
  });
  return [field, lifecycle, tableTheme];
}

const tableTheme = EditorView.baseTheme({
  ".cm-nicole-table": { margin: "0.75em 0", color: "var(--reading-fg)", fontFamily: "var(--reading-font-body)" },
  ".cm-nicole-table-toolbar, .cm-nicole-table-actions": { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", marginBottom: "8px" },
  ".cm-nicole-table button, .cm-nicole-table-editor button, .cm-nicole-table-editor select": { border: "1px solid var(--border-default)", borderRadius: "var(--radius-control)", background: "var(--surface-subtle)", color: "var(--text-primary)", padding: "4px 8px", font: "inherit", fontSize: "12px", cursor: "pointer" },
  ".cm-nicole-table button:focus-visible, .cm-nicole-table-editor :focus-visible": { outline: "2px solid var(--focus-ring-color)", outlineOffset: "2px" },
  ".cm-nicole-table-editor button:disabled": { opacity: "0.45", cursor: "default" },
  ".cm-nicole-table-scroll": { overflow: "auto", maxWidth: "100%" },
  ".cm-nicole-table table, .cm-nicole-table-editor table": { borderCollapse: "collapse", width: "100%", fontSize: "inherit" },
  ".cm-nicole-table td, .cm-nicole-table th": { border: "1px solid var(--reading-table-border, var(--border-default))", padding: "6px 10px", minWidth: "48px", verticalAlign: "top" },
  ".cm-nicole-table th": { background: "var(--reading-table-header-bg, var(--surface-subtle))", fontWeight: "600" },
  ".cm-nicole-table td p, .cm-nicole-table th p": { margin: "0" },
  ".cm-nicole-table-source-toolbar": { marginBottom: "2px" },
  ".cm-nicole-table-overlay": { position: "fixed", inset: "12px", zIndex: "100", display: "flex", alignItems: "center", justifyContent: "center", background: "rgb(0 0 0 / 0.2)", fontFamily: "var(--font-sans)", whiteSpace: "normal" },
  ".cm-nicole-table-editor": { width: "min(760px, 100%)", maxHeight: "100%", overflow: "auto", boxSizing: "border-box", border: "1px solid var(--border-default)", borderRadius: "12px", padding: "18px", background: "var(--surface-panel, var(--surface-canvas))", color: "var(--text-primary)", boxShadow: "0 12px 40px rgb(0 0 0 / 0.2)", fontSize: "13px" },
  ".cm-nicole-table-editor h2": { margin: "0", fontSize: "18px" },
  ".cm-nicole-table-editor p": { margin: "8px 0 14px", color: "var(--text-secondary)", lineHeight: "1.5" },
  ".cm-nicole-table-grid": { maxHeight: "55vh", margin: "10px 0" },
  ".cm-nicole-table-editor td": { padding: "3px", border: "1px solid var(--border-default)", minWidth: "32px" },
  ".cm-nicole-table-editor input": { boxSizing: "border-box", minWidth: "120px", width: "100%", padding: "6px", border: "1px solid var(--border-default)", borderRadius: "4px", color: "var(--text-primary)", background: "var(--surface-canvas)", font: "inherit" },
  ".cm-nicole-table-footer": { justifyContent: "flex-end", marginBottom: "0" },
  ".cm-nicole-table-editor .cm-nicole-table-apply": { color: "var(--accent-contrast)", background: "var(--accent-primary)", borderColor: "var(--accent-primary)" },
});
