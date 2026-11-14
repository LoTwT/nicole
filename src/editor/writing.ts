import { Facet, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

export interface WritingModeOptions {
  focusMode: boolean;
  typewriterMode: boolean;
}
const modes = Facet.define<WritingModeOptions, WritingModeOptions>({
  combine: (values) => values[0] ?? { focusMode: false, typewriterMode: false },
});

function activeParagraph(view: EditorView) {
  const head = view.state.selection.main.head;
  for (
    let node = syntaxTree(view.state).resolveInner(head, -1);
    node;
    node = node.parent!
  ) {
    if (
      /^(?:Paragraph|ATXHeading\d|SetextHeading\d|FencedCode|CodeBlock|ListItem|Table)$/.test(
        node.name,
      )
    )
      return { from: node.from, to: node.to };
  }
  const line = view.state.doc.lineAt(head);
  return { from: line.from, to: line.to };
}

function focusDecorations(view: EditorView): DecorationSet {
  if (!view.state.facet(modes).focusMode) return Decoration.none;
  const active = activeParagraph(view),
    ranges = [];
  for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from);
    for (;;) {
      const selected = view.state.selection.ranges.some(
        (range) =>
          !range.empty && range.from <= line.to && range.to >= line.from,
      );
      if (!selected && (line.to < active.from || line.from > active.to))
        ranges.push(
          Decoration.line({ class: "cm-nicole-unfocused" }).range(line.from),
        );
      if (line.to >= visible.to || line.number === view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  return Decoration.set(ranges, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    timer: ReturnType<typeof setTimeout> | null = null;
    userScrollUntil = 0;
    constructor(readonly view: EditorView) {
      this.decorations = focusDecorations(view);
    }
    update(update: ViewUpdate) {
      const changed =
        update.startState.facet(modes) !== update.state.facet(modes);
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        changed
      )
        this.decorations = focusDecorations(this.view);
      if (
        !(update.docChanged || update.selectionSet || changed) ||
        !update.state.facet(modes).typewriterMode ||
        this.view.compositionStarted ||
        this.view.composing ||
        Date.now() < this.userScrollUntil
      )
        return;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        if (
          !this.view.hasFocus ||
          this.view.compositionStarted ||
          this.view.composing ||
          Date.now() < this.userScrollUntil ||
          !this.view.state.facet(modes).typewriterMode
        )
          return;
        this.view.dispatch({
          effects: EditorView.scrollIntoView(
            this.view.state.selection.main.head,
            { y: "center" },
          ),
        });
      }, 0);
    }
    pause() {
      this.userScrollUntil = Date.now() + 800;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    }
    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
  {
    decorations: (value) => value.decorations,
    eventHandlers: {
      wheel() {
        this.pause();
      },
      pointerdown() {
        this.pause();
      },
      touchstart() {
        this.pause();
      },
    },
  },
);

const writingTheme = EditorView.theme({
  ".cm-nicole-unfocused": { opacity: "0.38" },
  "&.cm-nicole-typewriter .cm-content": {
    paddingTop: "min(35vh, 300px)",
    paddingBottom: "min(35vh, 300px)",
  },
});

export function writingExtensions(
  value: WritingModeOptions = { focusMode: false, typewriterMode: false },
): Extension {
  return [
    modes.of(value),
    plugin,
    EditorView.editorAttributes.of({
      class: `${value.focusMode ? "cm-nicole-focus" : ""} ${value.typewriterMode ? "cm-nicole-typewriter" : ""}`,
    }),
    writingTheme,
  ];
}
