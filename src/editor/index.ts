import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  Compartment,
  EditorState,
  Prec,
  RangeSetBuilder,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";

import type {
  CreateEditorOptions,
  EditorCommand,
  EditorHandle,
  EditorMode,
  ImageResolver,
} from "./types";

export type {
  CreateEditorOptions,
  EditorCommand,
  EditorHandle,
  EditorMode,
  ImageResolver,
} from "./types";

class BulletWidget extends WidgetType {
  override eq(other: WidgetType) {
    return other instanceof BulletWidget;
  }

  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-nicole-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }

  override eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-nicole-checkbox";
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        changes: {
          from: this.pos + 1,
          to: this.pos + 2,
          insert: this.checked ? " " : "x",
        },
      });
    });
    return box;
  }

  override ignoreEvent() {
    return false;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  override eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM() {
    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    image.decoding = "async";
    image.className = "cm-nicole-image";
    return image;
  }
}

class HorizontalRuleWidget extends WidgetType {
  override eq(other: WidgetType) {
    return other instanceof HorizontalRuleWidget;
  }

  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-nicole-hr";
    return rule;
  }
}

const hide = Decoration.replace({});

function activeLines(state: EditorState) {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let line = from; line <= to; line++) lines.add(line);
  }
  return lines;
}

function buildDecorations(
  view: EditorView,
  reveal: boolean,
  resolveImage: ImageResolver,
): DecorationSet {
  const { state } = view;
  const active = reveal ? activeLines(state) : new Set<number>();
  const ranges: { from: number; to: number; decoration: Decoration }[] = [];
  const add = (from: number, to: number, decoration: Decoration) =>
    ranges.push({ from, to, decoration });

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const line = state.doc.lineAt(node.from);
        const heading = /^ATXHeading(\d)$/.exec(node.name);

        if (heading) {
          add(
            line.from,
            line.from,
            Decoration.line({ class: `cm-nicole-h${heading[1]}` }),
          );
        }

        if (node.name === "Blockquote") {
          const last = state.doc.lineAt(node.to).number;
          for (let number = line.number; number <= last; number++) {
            add(
              state.doc.line(number).from,
              state.doc.line(number).from,
              Decoration.line({ class: "cm-nicole-quote" }),
            );
          }
        }

        if (active.has(line.number)) return;

        switch (node.name) {
          case "HeaderMark": {
            const end =
              state.doc.sliceString(node.to, node.to + 1) === " "
                ? node.to + 1
                : node.to;
            add(node.from, end, hide);
            break;
          }
          case "EmphasisMark":
          case "CodeMark":
          case "StrikethroughMark":
            if (node.node.parent?.name !== "FencedCode") {
              add(node.from, node.to, hide);
            }
            break;
          case "QuoteMark": {
            const end =
              state.doc.sliceString(node.to, node.to + 1) === " "
                ? node.to + 1
                : node.to;
            add(node.from, end, hide);
            break;
          }
          case "Link": {
            const marks = node.node.getChildren("LinkMark");
            const url = node.node.getChild("URL");
            const [open, close] = marks;
            const last = marks[marks.length - 1];
            if (open && close && last) {
              add(open.from, open.to, hide);
              add(close.from, url ? last.to : close.to, hide);
            }
            return false;
          }
          case "Image": {
            const url = node.node.getChild("URL");
            if (!url) return false;
            const raw = state.doc.sliceString(url.from, url.to);
            const src = resolveImage(raw);
            if (!src) return false;
            const text = state.doc.sliceString(node.from, node.to);
            const alt = /^!\[([^\]]*)\]/.exec(text)?.[1] ?? "";
            add(
              node.from,
              node.to,
              Decoration.replace({ widget: new ImageWidget(src, alt) }),
            );
            return false;
          }
          case "ListMark": {
            const listItem = node.node.parent;
            const task = listItem?.getChild("Task");
            if (task) {
              add(node.from, task.from, hide);
            } else if (
              /[-*+]/.test(state.doc.sliceString(node.from, node.to))
            ) {
              add(
                node.from,
                node.to,
                Decoration.replace({ widget: new BulletWidget() }),
              );
            }
            break;
          }
          case "TaskMarker": {
            const checked = /x/i.test(
              state.doc.sliceString(node.from, node.to),
            );
            add(
              node.from,
              node.to,
              Decoration.replace({
                widget: new CheckboxWidget(checked, node.from),
              }),
            );
            break;
          }
          case "HorizontalRule":
            add(
              node.from,
              node.to,
              Decoration.replace({ widget: new HorizontalRuleWidget() }),
            );
            break;
        }
      },
    });
  }

  ranges.sort(
    (a, b) => a.from - b.from || a.decoration.startSide - b.decoration.startSide,
  );
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    builder.add(range.from, range.to, range.decoration);
  }
  return builder.finish();
}

function preview(reveal: boolean, resolveImage: ImageResolver): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, reveal, resolveImage);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(
            update.view,
            reveal,
            resolveImage,
          );
        }
      }
    },
    { decorations: (value) => value.decorations },
  );

  if (reveal) return plugin;

  // Immersive mode: the cursor skips hidden Markdown markers instead of stepping into them.
  return [
    plugin,
    EditorView.atomicRanges.of(
      (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
    ),
  ];
}

function modeExtension(
  mode: EditorMode,
  resolveImage: ImageResolver,
): Extension {
  switch (mode) {
    case "source":
      return [];
    case "live":
      return preview(true, resolveImage);
    case "immersive":
      return preview(false, resolveImage);
  }
}

function toggleBold(view: EditorView) {
  const { state } = view;
  const range = state.selection.main;
  let node = syntaxTree(state).resolveInner(range.from, 1);

  while (node.parent && node.name !== "StrongEmphasis") {
    node = node.parent;
  }

  if (node.name === "StrongEmphasis") {
    view.dispatch({
      changes: [
        { from: node.from, to: node.from + 2 },
        { from: node.to - 2, to: node.to },
      ],
    });
    return true;
  }

  if (range.empty) {
    view.dispatch({
      changes: { from: range.from, insert: "****" },
      selection: { anchor: range.from + 2 },
    });
    return true;
  }

  view.dispatch({
    changes: [
      { from: range.from, insert: "**" },
      { from: range.to, insert: "**" },
    ],
    selection: { anchor: range.from + 2, head: range.to + 2 },
  });
  return true;
}

const coreCommands: readonly EditorCommand[] = [
  { id: "format.bold", label: "加粗", key: "Mod-b", run: toggleBold },
];

const highlightStyle = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  {
    tag: tags.strikethrough,
    textDecoration: "line-through",
    color: "var(--reading-fg-muted)",
  },
  {
    tag: tags.link,
    color: "var(--reading-link)",
    textDecoration: "underline",
  },
  { tag: tags.url, color: "var(--nicole-syntax-mark)" },
  {
    tag: tags.monospace,
    fontFamily: "var(--reading-font-mono)",
    backgroundColor: "var(--reading-code-bg)",
    borderRadius: "3px",
  },
  { tag: tags.processingInstruction, color: "var(--nicole-syntax-mark)" },
  { tag: tags.heading, fontWeight: "700" },
]);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--reading-fg)",
    backgroundColor: "var(--reading-bg)",
    fontSize: "var(--reading-font-size)",
  },
  ".cm-scroller": {
    fontFamily: "var(--reading-font-body)",
    lineHeight: "var(--reading-line-height)",
    overflow: "auto",
  },
  ".cm-content": {
    width: "100%",
    maxWidth: "var(--reading-measure)",
    minHeight: "100%",
    margin: "0 auto",
    padding: "3rem 2rem 7rem",
    caretColor: "var(--nicole-caret)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--nicole-caret)",
    borderLeftWidth: "2px",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
    {
      backgroundColor: "var(--nicole-selection)",
    },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-gutters": { display: "none" },
  ".cm-nicole-h1": {
    fontSize: "var(--reading-scale-h1)",
    lineHeight: "1.25",
    fontWeight: "700",
    padding: "0.6em 0 0.3em",
  },
  ".cm-nicole-h2": {
    fontSize: "var(--reading-scale-h2)",
    lineHeight: "1.3",
    fontWeight: "700",
    padding: "0.5em 0 0.25em",
  },
  ".cm-nicole-h3": {
    fontSize: "var(--reading-scale-h3)",
    lineHeight: "1.35",
    fontWeight: "700",
    padding: "0.4em 0 0.2em",
  },
  ".cm-nicole-h4, .cm-nicole-h5, .cm-nicole-h6": {
    fontSize: "var(--reading-scale-h4)",
    lineHeight: "1.4",
    fontWeight: "700",
    padding: "0.35em 0 0.15em",
  },
  ".cm-nicole-quote": {
    borderLeft: "3px solid var(--nicole-quote-border)",
    paddingLeft: "1rem",
    color: "var(--reading-fg-muted)",
  },
  ".cm-nicole-bullet": {
    display: "inline-block",
    width: "1em",
    color: "var(--nicole-syntax-mark)",
  },
  ".cm-nicole-checkbox": {
    margin: "0 0.4em 0 0",
    verticalAlign: "-2px",
    cursor: "pointer",
    accentColor: "var(--accent-primary)",
  },
  ".cm-nicole-image": {
    display: "inline-block",
    maxWidth: "100%",
    borderRadius: "6px",
  },
  ".cm-nicole-hr": {
    display: "inline-block",
    width: "100%",
    borderTop: "1px solid var(--reading-rule)",
    verticalAlign: "middle",
  },
});

const defaultResolveImage: ImageResolver = (src) => src;

export function createEditor(options: CreateEditorOptions): EditorHandle {
  const {
    parent,
    doc,
    mode: initialMode = "live",
    commands = [],
    resolveImage = defaultResolveImage,
    onChange,
  } = options;

  const modeCompartment = new Compartment();
  let mode = initialMode;

  const enabledCommands = [...coreCommands, ...commands];
  const bindings = enabledCommands.flatMap((command) =>
    command.key ? [{ key: command.key, run: command.run }] : [],
  );

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(highlightStyle),
        editorTheme,
        // App commands must win over basicSetup's default keymap.
        Prec.high(keymap.of(bindings)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange?.(update.state.doc.toString());
        }),
        modeCompartment.of(modeExtension(mode, resolveImage)),
      ],
    }),
  });

  return {
    get view() {
      return view;
    },
    get mode() {
      return mode;
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      view.dispatch({
        effects: modeCompartment.reconfigure(
          modeExtension(next, resolveImage),
        ),
      });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
