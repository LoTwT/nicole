import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { isolateHistory } from "@codemirror/commands";
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
  DropFilesHandler,
  EditorCommand,
  EditorHandle,
  EditorMode,
  ImageResolver,
  InsertionTicket,
  PasteImageHandler,
} from "./types";

export type {
  CreateEditorOptions,
  DropFilesHandler,
  EditorCommand,
  EditorHandle,
  EditorMode,
  ImageResolver,
  InsertionTicket,
  PasteImageHandler,
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
  constructor(readonly checked: boolean) {
    super();
  }

  override eq(other: CheckboxWidget) {
    // Position is intentionally not part of the comparison: typing earlier in
    // the document would otherwise recreate every task box after the edit.
    return other.checked === this.checked;
  }

  // Updating the existing DOM instead of letting CodeMirror recreate it keeps
  // focus on the checkbox when it is toggled from the keyboard.
  override updateDOM(dom: HTMLElement) {
    const input = dom.querySelector<HTMLInputElement>(
      ".cm-nicole-checkbox-input",
    );
    if (!input) return false;
    dom.classList.toggle("cm-nicole-checkbox-checked", this.checked);
    input.checked = this.checked;
    return true;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = this.checked
      ? "cm-nicole-checkbox cm-nicole-checkbox-checked"
      : "cm-nicole-checkbox";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-nicole-checkbox-input";
    input.setAttribute("aria-label", "切换任务完成状态");

    const mark = document.createElement("span");
    mark.className = "cm-nicole-checkbox-mark";
    mark.setAttribute("aria-hidden", "true");
    box.append(input, mark);

    // The box is drawn with CSS, so the native control only handles the click
    // and keyboard activation. Preventing mousedown keeps the caret and the
    // current selection in place while the task is toggled.
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", () => {
      // Don't cancel the click: the browser then toggles `checked` itself and
      // `updateDOM` keeps it in sync. Read the state from the document below,
      // because a reused DOM still closes over the old widget instance.
      const pos = view.posAtDOM(box);
      const checked = /x/i.test(view.state.sliceDoc(pos + 1, pos + 2));
      view.dispatch({
        changes: {
          from: pos + 1,
          to: pos + 2,
          insert: checked ? " " : "x",
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
              Decoration.replace({ widget: new CheckboxWidget(checked) }),
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
      // Set when an update during a composition skipped the rebuild, so the
      // first later update refreshes the decorations even when it carries no
      // document, viewport or selection change of its own.
      private stale = false;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, reveal, resolveImage);
      }

      update(update: ViewUpdate) {
        const rebuild =
          update.docChanged || update.viewportChanged || update.selectionSet;

        if (update.view.compositionStarted) {
          // Replacing the DOM under an active IME composition makes WKWebView
          // drop the candidate window, so live preview and immersive mode keep
          // the current decorations until the composition ends. The mapped set
          // follows the edits without re-evaluating the syntax tree.
          // `compositionStarted` also covers the interval before the first
          // composition change, where `composing` is still false.
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes);
          }
          this.stale ||= rebuild;
          return;
        }

        if (this.stale || rebuild) {
          this.stale = false;
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
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    position: "relative",
    width: "1em",
    height: "1em",
    margin: "0 0.4em 0 0",
    verticalAlign: "-0.15em",
    border:
      "1.5px solid var(--nicole-checkbox-border, var(--border-strong))",
    borderRadius: "3px",
    backgroundColor: "var(--nicole-checkbox-bg, var(--surface-panel))",
    cursor: "pointer",
  },
  ".cm-nicole-checkbox-checked": {
    borderColor: "var(--nicole-checkbox-checked-border, var(--accent-primary))",
    backgroundColor: "var(--nicole-checkbox-checked-bg, var(--accent-primary))",
  },
  ".cm-nicole-checkbox-input": {
    appearance: "none",
    WebkitAppearance: "none",
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    margin: "0",
    padding: "0",
    border: "0",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  ".cm-nicole-checkbox-input:focus-visible": {
    outline: "2px solid var(--nicole-checkbox-focus, var(--reading-focus))",
    outlineOffset: "2px",
    borderRadius: "4px",
  },
  ".cm-nicole-checkbox-mark": {
    display: "none",
    boxSizing: "border-box",
    width: "0.3em",
    height: "0.55em",
    borderRight:
      "1.5px solid var(--nicole-checkbox-mark, var(--accent-contrast))",
    borderBottom:
      "1.5px solid var(--nicole-checkbox-mark, var(--accent-contrast))",
    transform: "translateY(-0.08em) rotate(45deg)",
  },
  ".cm-nicole-checkbox-checked .cm-nicole-checkbox-mark": {
    display: "block",
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

function clipboardHasImage(data: DataTransfer | null): boolean {
  if (!data) return false;
  for (let index = 0; index < data.items.length; index++) {
    const item = data.items[index];
    if (item?.kind === "file" && item.type.startsWith("image/")) return true;
  }
  return [...data.files].some((file) => file.type.startsWith("image/"));
}

function transferHasFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  return data.files.length > 0 || [...data.types].includes("Files");
}

function imageHandlers(
  onPasteImage: PasteImageHandler | undefined,
  onDropFiles: DropFilesHandler | undefined,
  createTicketAt: (at: number) => InsertionTicket,
): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (!onPasteImage || !clipboardHasImage(event.clipboardData)) return false;
      event.preventDefault();
      onPasteImage(createTicketAt(view.state.selection.main.head));
      return true;
    },
    drop(event) {
      if (!transferHasFiles(event.dataTransfer)) return false;
      // The browser would otherwise navigate to the dropped file. The native
      // MyGo drop event supplies the paths and the coordinates for the
      // insertion ticket.
      event.preventDefault();
      onDropFiles?.();
      return true;
    },
  });
}

interface PendingInsertion {
  ticketId: number;
  text: string;
}

interface TicketState {
  id: number;
  at: number;
}

export function createEditor(options: CreateEditorOptions): EditorHandle {
  const {
    parent,
    doc,
    mode: initialMode = "live",
    commands = [],
    resolveImage = defaultResolveImage,
    onPasteImage,
    onDropFiles,
    onChange,
  } = options;

  const modeCompartment = new Compartment();
  let mode = initialMode;

  const enabledCommands = [...coreCommands, ...commands];
  const bindings = enabledCommands.flatMap((command) =>
    command.key ? [{ key: command.key, run: command.run }] : [],
  );

  // An image insertion may arrive while an IME composition is still running.
  // It waits, and its ticket follows edits until the composition ends, so the
  // candidate window is never interrupted and the text lands where the user
  // dropped or pasted it.
  const pendingInsertions: PendingInsertion[] = [];
  const tickets = new Map<number, TicketState>();
  let nextTicketID = 1;
  let insertionScheduled = false;
  let view: EditorView;

  const createTicketAt = (at: number): InsertionTicket => {
    const ticket: TicketState = { id: nextTicketID++, at };
    tickets.set(ticket.id, ticket);
    return ticket;
  };

  const insertTextAt = (at: number, text: string) => {
    const position = Math.max(0, Math.min(at, view.state.doc.length));
    const line = view.state.doc.lineAt(position);
    // Starting at the beginning of a non-empty line would glue the image to
    // the existing text (and break a heading); give it its own line instead.
    const insert = position === line.from && line.length > 0 ? `${text}\n` : text;
    view.dispatch({
      changes: { from: position, insert },
      selection: { anchor: position + insert.length },
      // Keep every image insertion its own undo step, even when it follows
      // typing closely.
      annotations: isolateHistory.of("full"),
    });
  };

  const flushPendingInsertions = () => {
    insertionScheduled = false;
    if (view.compositionStarted || view.composing) return;
    while (pendingInsertions.length > 0) {
      const pending = pendingInsertions.shift()!;
      const ticket = tickets.get(pending.ticketId);
      if (!ticket) continue;
      insertTextAt(ticket.at, pending.text);
      tickets.delete(ticket.id);
    }
  };

  const scheduleInsertion = () => {
    if (insertionScheduled) return;
    insertionScheduled = true;
    queueMicrotask(flushPendingInsertions);
  };

  const insertImages = (ticket: InsertionTicket, markdown: readonly string[]) => {
    const current = tickets.get(ticket.id);
    if (!current) return;
    const text = markdown.filter((item) => item !== "").join("\n");
    if (text === "") {
      tickets.delete(ticket.id);
      return;
    }
    if (view.compositionStarted || view.composing) {
      pendingInsertions.push({ ticketId: ticket.id, text });
      return;
    }
    insertTextAt(current.at, text);
    tickets.delete(ticket.id);
  };

  const onCompositionEnd = () => {
    if (pendingInsertions.length > 0) scheduleInsertion();
  };

  view = new EditorView({
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
        imageHandlers(onPasteImage, onDropFiles, createTicketAt),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            for (const ticket of tickets.values()) {
              ticket.at = update.changes.mapPos(ticket.at, 1);
            }
            onChange?.(update.state.doc.toString());
          }
          if (
            pendingInsertions.length > 0 &&
            !update.view.compositionStarted &&
            !update.view.composing
          ) {
            scheduleInsertion();
          }
        }),
        modeCompartment.of(modeExtension(mode, resolveImage)),
      ],
    }),
  });
  view.contentDOM.addEventListener("compositionend", onCompositionEnd);

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
    createInsertionTicket(x, y) {
      const at = view.posAtCoords({ x, y });
      if (at === null) return null;
      return createTicketAt(at);
    },
    insertImages,
    focus() {
      view.focus();
    },
    destroy() {
      pendingInsertions.length = 0;
      tickets.clear();
      view.contentDOM.removeEventListener("compositionend", onCompositionEnd);
      view.destroy();
    },
  };
}
