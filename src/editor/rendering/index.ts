import {
  EditorSelection,
  Facet,
  MapMode,
  StateEffect,
  StateField,
  type Extension,
  type Range,
  type EditorState,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import type { SyntaxNode } from "@lezer/common";
import { syntaxHighlighting, syntaxTree } from "@codemirror/language";
import type { EditorMode } from "../types";
import { frontmatterEnd } from "../markdown-context";
import { renderMath, renderMermaid } from "./engines";
import { calloutHeading } from "./syntax";
import "./rendering.css";

export { mathMarkdown } from "./syntax";

/** The language parsers supply tags; these stable classes share preview colors. */
export const codeLanguageHighlighting = syntaxHighlighting(classHighlighter);
const richMode = Facet.define<EditorMode, EditorMode>({
  combine: (values) => values[0] ?? "source",
});

/** Used by source-only painting layers to leave replaced blocks alone. */
export function richContentReplaces(state: EditorState, from: number, to: number) {
  return state.facet(richMode) !== "source" &&
    !selectionTouches(state, state.doc.lineAt(from).from, to);
}

/** Callout widgets own the marker even when Markdown parses it as a link. */
export function richCalloutMarkerReplaces(state: EditorState, from: number, to: number): boolean {
  if (state.facet(richMode) === "source" || to - from < 3 ||
      state.doc.sliceString(from, from + 2) !== "[!") return false;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
    if (node.name !== "Blockquote") continue;
    const quote = node.getChild("QuoteMark");
    if (!quote) continue;
    const line = state.doc.lineAt(quote.from);
    const start = quote.to + (state.doc.sliceString(quote.to, quote.to + 1) === " " ? 1 : 0);
    const heading = calloutHeading(state.doc.sliceString(start, line.to));
    if (heading && from >= start && to <= start + heading.markerLength &&
        !selectionTouches(state, line.from, line.to)) return true;
  }
  return false;
}

const composingEffect = StateEffect.define<boolean>();
const refreshEffect = StateEffect.define<null>();
const calloutToggle = StateEffect.define<{ from: number; expanded: boolean; sign: "+" | "-" }>();
type CalloutFolds = ReadonlyMap<number, { expanded: boolean; sign: "+" | "-" }>;

interface RichState {
  composing: boolean;
  decorations: DecorationSet;
  folds: CalloutFolds;
}

const widgetControllers = new WeakMap<HTMLElement, AbortController>();

class RichWidget extends WidgetType {
  constructor(
    readonly kind: "math" | "mermaid",
    readonly source: string,
    readonly from: number,
    readonly to: number,
    readonly editAt: number,
    readonly block: boolean,
    readonly containerPrefix = "",
  ) { super(); }

  eq(other: RichWidget) {
    return this.kind === other.kind && this.source === other.source &&
      this.from === other.from && this.to === other.to &&
      this.editAt === other.editAt && this.block === other.block &&
      this.containerPrefix === other.containerPrefix;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement(this.block ? "div" : "span");
    wrapper.className = this.block ? "cm-nicole-rich-block" : "cm-nicole-rich-inline";
    wrapper.setAttribute("data-rich-kind", this.kind);
    if (this.block && this.containerPrefix) {
      wrapper.classList.add("cm-nicole-rich-nested");
      wrapper.style.marginInlineStart = this.containerPrefix.replace(/\t/g, "    ").length + "ch";
      if (this.containerPrefix.includes(">")) wrapper.classList.add("cm-nicole-rich-quote");
      const list = /(?:^|[> \t])([-+*]|\d+[.)])[ \t]*$/.exec(this.containerPrefix);
      if (list) {
        const marker = document.createElement("span");
        marker.className = "cm-nicole-rich-list-mark";
        marker.textContent = /^\d/.test(list[1]!) ? list[1]! : "•";
        marker.setAttribute("aria-hidden", "true");
        wrapper.append(marker);
      }
    }
    const preview = document.createElement(this.block ? "div" : "span");
    preview.className = "cm-nicole-rich-preview";
    preview.textContent = this.source;
    wrapper.append(preview);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cm-nicole-rich-edit";
    edit.textContent = this.kind === "math" ? "编辑公式" : "编辑图表";
    edit.addEventListener("mousedown", (event) => event.preventDefault());
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      if (widgetControllers.get(wrapper)?.signal.aborted) return;
      view.dispatch({
        selection: EditorSelection.cursor(this.editAt),
        scrollIntoView: true,
      });
      view.focus();
    });
    wrapper.append(edit);
    const controller = new AbortController();
    widgetControllers.set(wrapper, controller);
    const target: { preview: HTMLElement | null; view: EditorView | null } = { preview, view };
    controller.signal.addEventListener("abort", () => {
      target.preview = null;
      target.view = null;
    }, { once: true });
    const rendering = this.kind === "math"
      ? renderMath(this.source, this.block, controller.signal)
      : renderMermaid(this.source, controller.signal);
    void rendering.then((html) => {
      if (controller.signal.aborted || !target.preview || !target.view) return;
      target.preview.innerHTML = html;
      target.view.requestMeasure();
    }).catch(() => {
      // Source remains visible when a chunk cannot be loaded or work was
      // cancelled; a destroyed widget never updates another document.
    });
    return wrapper;
  }

  ignoreEvent() { return true; }

  destroy(dom: HTMLElement) {
    widgetControllers.get(dom)?.abort();
    widgetControllers.delete(dom);
  }
}

class CalloutLabel extends WidgetType {
  constructor(readonly label: string) { super(); }
  eq(other: CalloutLabel) { return this.label === other.label; }
  toDOM() {
    const label = document.createElement("span");
    label.className = "cm-nicole-callout-label";
    label.textContent = this.label;
    return label;
  }
}

class CalloutToggle extends WidgetType {
  constructor(
    readonly from: number,
    readonly expanded: boolean,
    readonly sign: "+" | "-",
    readonly label: string,
    readonly showLabel: boolean,
  ) { super(); }
  eq(other: CalloutToggle) {
    return this.from === other.from && this.expanded === other.expanded &&
      this.sign === other.sign && this.label === other.label && this.showLabel === other.showLabel;
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-nicole-callout-toggle" + (this.showLabel ? " cm-nicole-callout-label" : "");
    button.textContent = (this.expanded ? "▾" : "▸") + (this.showLabel ? " " + this.label : "");
    button.setAttribute("aria-expanded", String(this.expanded));
    button.setAttribute("aria-label", (this.expanded ? "折叠" : "展开") + this.label);
    const controller = new AbortController();
    widgetControllers.set(button, controller);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (view.compositionStarted || view.composing) return;
      const doc = view.state.doc;
      view.requestMeasure({
        key: button,
        read: () => queueMicrotask(() => {
          if (controller.signal.aborted || view.state.doc !== doc ||
              view.compositionStarted || view.composing) return;
          view.dispatch({
            effects: calloutToggle.of({ from: this.from, expanded: !this.expanded, sign: this.sign }),
            ...(this.expanded ? { selection: EditorSelection.cursor(this.from) } : {}),
          });
          view.focus();
        }),
      });
    });
    return button;
  }
  ignoreEvent() { return true; }
  destroy(dom: HTMLElement) {
    widgetControllers.get(dom)?.abort();
    widgetControllers.delete(dom);
  }
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) =>
    range.from <= to && range.to >= from,
  );
}

function decorations(state: EditorState, folds: CalloutFolds): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const metadataEnd = frontmatterEnd(state) ?? 0;
  syntaxTree(state).iterate({
    enter(node) {
      // The root starts at zero even when its body follows Frontmatter.
      if (node.name !== "Document" && node.from < metadataEnd) return false;
      if (node.name === "InlineMath" || node.name === "BlockMath") {
        const marks = node.node.getChildren("MathMark");
        const bodies = node.node.getChildren("MathText");
        const block = node.name === "BlockMath";
        const from = block ? state.doc.lineAt(node.from).from : node.from;
        if (
          marks.length !== 2 || !bodies.length ||
          selectionTouches(state, from, node.to)
        ) return false;
        const source = bodies.map((body) => state.doc.sliceString(body.from, body.to)).join("");
        const content = bodies.find((body) => /\S/.test(state.doc.sliceString(body.from, body.to))) ?? bodies[0]!;
        const firstContent = state.doc.sliceString(content.from, content.to).search(/\S/);
        const editAt = block ? content.from + Math.max(0, firstContent) : content.from;
        ranges.push(Decoration.replace({
          block,
          widget: new RichWidget(
            "math",
            source.trim(),
            from, node.to, editAt, block,
            block ? state.doc.sliceString(from, node.from) : "",
          ),
        }).range(from, node.to));
        return false;
      }
      if (node.name === "FencedCode") {
        const info = node.node.getChild("CodeInfo");
        if (!info || state.doc.sliceString(info.from, info.to).trim().toLowerCase() !== "mermaid") return false;
        const marks = node.node.getChildren("CodeMark");
        const firstLine = state.doc.lineAt(node.from);
        const replacementFrom = firstLine.from;
        if (
          marks.length < 2 || selectionTouches(state, replacementFrom, node.to)
        ) return false;
        const bodies = node.node.getChildren("CodeText");
        const source = bodies.map((body) => state.doc.sliceString(body.from, body.to)).join("");
        const editAt = bodies.find((body) => /\S/.test(state.doc.sliceString(body.from, body.to)))?.from ?? marks[0]!.to;
        ranges.push(Decoration.replace({
          block: true,
          widget: new RichWidget(
            "mermaid", source.trim(), replacementFrom, node.to, editAt, true,
            state.doc.sliceString(replacementFrom, node.from),
          ),
        }).range(replacementFrom, node.to));
        return false;
      }
      if (node.name !== "Blockquote") return;
      const quote = node.node.getChild("QuoteMark");
      if (!quote) return;
      const first = state.doc.lineAt(quote.from);
      const markerFrom = quote.to + (state.doc.sliceString(quote.to, quote.to + 1) === " " ? 1 : 0);
      const heading = calloutHeading(state.doc.sliceString(markerFrom, first.to));
      if (!heading) return;
      const saved = folds.get(node.from);
      const expanded = heading.fold === null ||
        (saved?.sign === heading.fold ? saved.expanded : heading.fold === "+");
      const bodySelected = selectionTouches(state, first.to + 1, node.to);
      const folded = !expanded && !bodySelected && first.to < node.to;
      const last = state.doc.lineAt(node.to).number;
      for (let number = first.number; number <= (folded ? first.number : last); number++) {
        ranges.push(Decoration.line({
          class: "cm-nicole-callout cm-nicole-callout-" + heading.type,
        }).range(state.doc.line(number).from));
      }
      const headerSelected = selectionTouches(state, first.from, first.to);
      if (heading.fold !== null) {
        const widget = new CalloutToggle(node.from, !folded, heading.fold, heading.label, !headerSelected);
        ranges.push(headerSelected
          ? Decoration.widget({ widget, side: -1 }).range(markerFrom)
          : Decoration.replace({ widget }).range(markerFrom, markerFrom + heading.markerLength));
      } else if (!headerSelected) {
        ranges.push(Decoration.replace({
          widget: new CalloutLabel(heading.label),
        }).range(markerFrom, markerFrom + heading.markerLength));
      }
      if (folded) {
        ranges.push(Decoration.replace({ block: true }).range(first.to, node.to));
        return false;
      }
    },
  });
  return Decoration.set(ranges, true);
}

/**
 * State-provided decorations may replace whole math/diagram blocks. Keeping
 * them out of viewport plugins avoids changing block layout during layout.
 */
export function createRichRenderingExtensions(
  options: { mode: EditorMode },
): Extension {
  if (options.mode === "source") return [];
  const field = StateField.define<RichState>({
    create: (state) => ({ composing: false, folds: new Map(), decorations: decorations(state, new Map()) }),
    update(value, transaction) {
      let composing = value.composing;
      let refresh = false;
      let folds = value.folds;
      if (transaction.docChanged) {
        const mapped = new Map<number, { expanded: boolean; sign: "+" | "-" }>();
        for (const [from, saved] of folds) {
          const at = transaction.changes.mapPos(from, 1, MapMode.TrackDel);
          if (at !== null) mapped.set(at, saved);
        }
        folds = mapped;
      }
      for (const effect of transaction.effects) {
        if (effect.is(composingEffect)) composing = effect.value;
        if (effect.is(refreshEffect)) refresh = true;
        if (effect.is(calloutToggle)) {
          folds = new Map(folds).set(effect.value.from, effect.value);
          refresh = true;
        }
      }
      if (composing) {
        return {
          composing,
          folds,
          decorations: transaction.docChanged
            ? value.decorations.map(transaction.changes)
            : value.decorations,
        };
      }
      const rebuild = value.composing || refresh || transaction.docChanged ||
        transaction.selection !== undefined ||
        syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
      return {
        composing,
        folds,
        decorations: rebuild ? decorations(transaction.state, folds) : value.decorations,
      };
    },
    provide: (value) => EditorView.decorations.from(value, (state) => state.decorations),
  });
  const lifecycle = ViewPlugin.fromClass(class {
    destroyed = false;
    pending = false;
    constructor(readonly view: EditorView) {}
    finishComposition() {
      if (this.pending) return;
      this.pending = true;
      // Let CodeMirror's measurement pass reconcile pending DOM input before
      // dispatching decorations, including text typed immediately after the IME.
      this.view.requestMeasure({
        key: this,
        read: () => queueMicrotask(() => {
          this.pending = false;
          if (this.destroyed || this.view.compositionStarted || this.view.composing ||
              !this.view.state.field(field, false)?.composing) return;
          this.view.dispatch({ effects: [composingEffect.of(false), refreshEffect.of(null)] });
        }),
      });
    }
    update() {
      if (
        this.view.compositionStarted || this.view.composing ||
        !this.view.state.field(field).composing
      ) return;
      this.finishComposition();
    }
    destroy() { this.destroyed = true; }
  });
  return [
    richMode.of(options.mode),
    field,
    lifecycle,
    EditorView.domEventHandlers({
      compositionstart(_event, view) {
        view.dispatch({ effects: composingEffect.of(true) });
        return false;
      },
      compositionend(_event, view) {
        view.plugin(lifecycle)?.finishComposition();
        return false;
      },
    }),
  ];
}
