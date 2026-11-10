import {
  markdown,
  markdownLanguage,
  deleteMarkupBackward,
} from "@codemirror/lang-markdown";
import {
  deleteCharBackward,
  deleteGroupBackward,
  isolateHistory,
} from "@codemirror/commands";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
  ensureSyntaxTree,
  forceParsing,
  syntaxTreeAvailable,
} from "@codemirror/language";
import {
  ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  type Extension,
  type SelectionRange,
} from "@codemirror/state";
import {
  historyField,
  redo as historyRedo,
  selectAll,
  undo as historyUndo,
} from "@codemirror/commands";
import {
  Decoration,
  EditorView,
  RectangleMarker,
  ViewPlugin,
  WidgetType,
  keymap,
  layer,
  runScopeHandlers,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";

import { isMac, type AppPlatform } from "../app/platform";
import { commandRegistry } from "../commands/registry";
import { createCommandKeymap } from "./keymap";
import {
  scrollAnchor,
  scrollTopForAnchor,
  visibleTopHeight,
  type ScrollAnchor,
} from "./scroll";
import type {
  CreateEditorOptions,
  EditorHandle,
  EditorMode,
  EditorRestoreState,
  ImageResolver,
  InsertionTicket,
  PasteImageHandler,
  SavedSelection,
} from "./types";

export type {
  CreateEditorOptions,
  EditorHandle,
  EditorMode,
  EditorRestoreState,
  ImageResolver,
  InsertionTicket,
  PasteImageHandler,
  SavedSelection,
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

  // Keyboard events belong to the checkbox: Space toggles it natively and Tab
  // moves focus. Letting CodeMirror handle the rest would run its keymap
  // against the editor's last caret position, so Enter would split the
  // document while the user is on the task box. Mouse events stay with the
  // editor so clicking the box can be handled by its own listeners.
  override ignoreEvent(event: Event) {
    return event.type.startsWith("key");
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

// Structural Markdown markers that can start a line. Emphasis and link marks
// are intentionally absent: typing before them does not change the block.
const leadingMarkNames = new Set([
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "TaskMarker",
]);

interface LeadingMarkInfo {
  /** First position the caret may occupy without entering hidden markup. */
  start: number;
  /** First position after every leading marker, including visible ones. */
  contentStart: number;
  /** Whether the line starts with a heading, quote, list or task marker. */
  block: boolean;
}

interface LeadingMark {
  to: number;
  hidden: boolean;
}

function mayHaveLeadingMark(
  state: EditorState,
  line: { from: number; to: number },
) {
  let pos = line.from;
  while (
    pos < line.to &&
    (state.sliceDoc(pos, pos + 1) === " " ||
      state.sliceDoc(pos, pos + 1) === "\t")
  ) {
    pos++;
  }
  if (pos >= line.to) return false;
  const first = state.sliceDoc(pos, pos + 1);
  return (
    first === "#" ||
    first === ">" ||
    first === "-" ||
    first === "*" ||
    first === "+" ||
    first === "[" ||
    first === "=" ||
    (first >= "0" && first <= "9")
  );
}

/**
 * Classifies the structural markers at the start of a line. Heading, quote,
 * bullet and task markers are hidden or replaced by widgets, so the caret
 * skips them. An ordered-list number stays visible and can be edited, so it
 * only contributes to `contentStart` (used to tell empty blocks from blocks
 * with content).
 */
function leadingMarkInfo(
  state: EditorState,
  line: { from: number; to: number },
): LeadingMarkInfo {
  const none: LeadingMarkInfo = {
    start: line.from,
    contentStart: line.from,
    block: false,
  };
  if (!mayHaveLeadingMark(state, line)) return none;

  const tree = ensureSyntaxTree(state, line.to, 20) ?? syntaxTree(state);
  const marks = new Map<number, LeadingMark>();
  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.from < line.from || node.from > line.to) return;
      if (!leadingMarkNames.has(node.name)) return;
      let hidden = true;
      if (node.name === "ListMark") {
        const text = state.sliceDoc(node.from, node.to);
        const task = node.node.parent?.getChild("Task") !== null;
        hidden = task || /[-*+]/.test(text);
      }
      if (!marks.has(node.from)) marks.set(node.from, { to: node.to, hidden });
    },
  });

  let pos = line.from;
  let contentStart = line.from;
  let block = false;
  for (;;) {
    while (
      pos < line.to &&
      (state.sliceDoc(pos, pos + 1) === " " ||
        state.sliceDoc(pos, pos + 1) === "\t")
    ) {
      pos++;
    }
    contentStart = pos;
    const mark = marks.get(pos);
    if (mark === undefined) {
      return { start: block ? pos : line.from, contentStart, block };
    }
    block = true;
    if (!mark.hidden) {
      // A visible ordered-list number: the caret may stop before it, but the
      // block still has no content when only the marker and spaces follow.
      let scan = mark.to;
      for (;;) {
        while (
          scan < line.to &&
          (state.sliceDoc(scan, scan + 1) === " " ||
            state.sliceDoc(scan, scan + 1) === "\t")
        ) {
          scan++;
        }
        const next = marks.get(scan);
        if (next === undefined || !next.hidden) {
          return { start: pos, contentStart: scan, block: true };
        }
        scan = next.to;
      }
    }
    pos = mark.to;
    contentStart = pos;
  }
}

const blockNodeNames = new Set([
  "Blockquote",
  "BulletList",
  "OrderedList",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
]);

/**
 * A multi-line quote or list is one block even though every continuation line
 * starts with its own marker. The special block-first-line rules (Enter,
 * Backspace/Ctrl-H, and image placement) belong only to the first line of the
 * outermost syntax block; later lines keep the normal Markdown behavior.
 * Nested blocks inherit the same outer-block check.
 */
function startsBlockAtLine(
  state: EditorState,
  line: { from: number; to: number },
) {
  const tree = ensureSyntaxTree(state, line.to, 20) ?? syntaxTree(state);
  const text = state.sliceDoc(line.from, line.to);
  const firstContent = line.from + (text.length - text.trimStart().length);
  // Iteration is pre-order, so the first matching block node is the outermost
  // one containing this line. Indented headings and quotes start at
  // `firstContent`, not at `line.from`.
  const outermost = { from: -1 };
  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (outermost.from !== -1) return;
      if (!blockNodeNames.has(node.name)) return;
      if (node.from > firstContent || node.to <= line.from) return;
      outermost.from = node.from;
    },
  });
  return outermost.from >= line.from;
}

/** Keeps empty selections out of hidden line-leading markers. */
function clampImmersiveSelection(
  state: EditorState,
  selection: EditorSelection,
): EditorSelection {
  let ranges: SelectionRange[] | null = null;
  for (let index = 0; index < selection.ranges.length; index++) {
    const range = selection.ranges[index]!;
    if (!range.empty) continue;
    const line = state.doc.lineAt(range.head);
    const { start } = leadingMarkInfo(state, line);
    if (range.head >= start) continue;
    ranges ??= selection.ranges.slice();
    ranges[index] = EditorSelection.cursor(
      start,
      range.assoc,
      range.bidiLevel ?? undefined,
      range.goalColumn,
    );
  }
  return ranges === null
    ? selection
    : EditorSelection.create(ranges, selection.mainIndex);
}

function boundaryAt(
  state: EditorState,
  range: SelectionRange,
): { line: { from: number; to: number }; start: number } | null {
  if (!range.empty) return null;
  const line = state.doc.lineAt(range.head);
  const { start } = leadingMarkInfo(state, line);
  if (start === line.from || range.head !== start) return null;
  return { line, start };
}

/**
 * Leftward motions at the first visible character would otherwise be pulled
 * back to the line start by the atomic range and then clamped to the same place
 * again. Move past the whole block instead. Non-empty ranges collapse to their
 * left edge, and other ranges use CodeMirror's normal character motion.
 */
function cursorCharLeftImmersive(view: EditorView): boolean {
  if (view.compositionStarted || view.composing) return false;
  const selection = view.state.selection;
  const ranges = selection.ranges.map((range) => {
    if (!range.empty) return EditorSelection.cursor(range.from);
    const boundary = boundaryAt(view.state, range);
    if (!boundary) return view.moveByChar(range, false);
    if (boundary.line.from === 0) {
      return EditorSelection.cursor(
        boundary.start,
        range.assoc,
        range.bidiLevel ?? undefined,
        range.goalColumn,
      );
    }
    return EditorSelection.cursor(
      boundary.line.from - 1,
      1,
      range.bidiLevel ?? undefined,
      range.goalColumn,
    );
  });
  const next = EditorSelection.create(ranges, selection.mainIndex);
  if (next.eq(selection, true)) return true;
  view.dispatch({
    selection: next,
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

/**
 * Word/group-left from a block boundary should continue from the position a
 * standard caret would have at the line start, where CodeMirror can move to
 * the previous group instead of being pulled back by the atomic range.
 */
function cursorGroupLeftImmersive(view: EditorView): boolean {
  if (view.compositionStarted || view.composing) return false;
  const selection = view.state.selection;
  // Only the boundary needs the special path. Off-boundary selections keep
  // CodeMirror's default cursorSyntaxLeft behavior.
  if (!selection.ranges.some((range) => boundaryAt(view.state, range))) {
    return false;
  }
  const ranges = selection.ranges.map((range) => {
    if (!range.empty) return EditorSelection.cursor(range.from);
    const boundary = boundaryAt(view.state, range);
    if (!boundary) return view.moveByGroup(range, false);
    const fromStart = EditorSelection.cursor(
      boundary.line.from,
      range.assoc,
      range.bidiLevel ?? undefined,
      range.goalColumn,
    );
    return view.moveByGroup(fromStart, false);
  });
  const next = EditorSelection.create(ranges, selection.mainIndex);
  if (next.eq(selection, true)) return true;
  view.dispatch({
    selection: next,
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

/**
 * WKWebView can leave a stale element-level selection in the content DOM after
 * an editor view is rebuilt (for example a tab switch or restore) and a key is
 * handled before the user makes a real click. When the first line is shifted by
 * a structural edit, CodeMirror's observer then reads that stale element offset
 * back as the start of the document. Put the native caret on the text node we
 * actually selected, so the observer cannot overwrite the transaction selection.
 */
function placeNativeCaret(view: EditorView, head: number) {
  const selection = (view.root as Document).getSelection?.() ?? null;
  if (!selection) return;
  const position = view.domAtPos(head);
  selection.collapse(position.node, position.offset);
}

/**
 * At the first visible character, insert an empty plain line above the block
 * and keep the caret before its original text. Empty blocks, mid-line carets,
 * empty selections with several ranges and other modes keep the default Enter
 * behavior.
 */
function insertLineAboveImmersive(view: EditorView): boolean {
  if (view.compositionStarted || view.composing) return false;
  const selection = view.state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) return false;
  const line = view.state.doc.lineAt(selection.main.head);
  const info = leadingMarkInfo(view.state, line);
  if (
    !info.block ||
    selection.main.head !== info.start ||
    line.to <= info.contentStart ||
    !startsBlockAtLine(view.state, line)
  ) {
    return false;
  }
  const head = selection.main.head;
  const next = EditorSelection.cursor(
    head + 1,
    selection.main.assoc,
    selection.main.bidiLevel ?? undefined,
    selection.main.goalColumn,
  );
  view.dispatch({
    changes: { from: line.from, insert: "\n" },
    selection: next,
    scrollIntoView: true,
    userEvent: "input",
  });
  placeNativeCaret(view, next.head);
  return true;
}

/** Delete a whole hidden leading marker as one unit at a block boundary. */
function deleteMarkerImmersive(view: EditorView): boolean {
  if (view.compositionStarted || view.composing) return false;
  const selection = view.state.selection;
  if (selection.ranges.length === 1 && selection.main.empty) {
    const line = view.state.doc.lineAt(selection.main.head);
    const info = leadingMarkInfo(view.state, line);
    if (
      info.block &&
      line.to > info.contentStart &&
      selection.main.head === info.contentStart
    ) {
      if (!startsBlockAtLine(view.state, line)) return false;
      // Ordered task items expose their number and brackets to the parser, so
      // deleteMarkupBackward would remove only one character of the combined
      // prefix. Delete the whole leading marker as one unit instead.
      view.dispatch({
        changes: { from: line.from, to: info.contentStart },
        selection: EditorSelection.cursor(line.from),
        scrollIntoView: true,
        userEvent: "delete.backward",
      });
      return true;
    }
  }
  return false;
}

/** Ctrl-H keeps its existing fallback when no whole marker is being deleted. */
function deleteBackwardImmersive(view: EditorView): boolean {
  if (view.compositionStarted || view.composing) return false;
  const selection = view.state.selection;
  if (selection.ranges.length === 1 && selection.main.empty) {
    const line = view.state.doc.lineAt(selection.main.head);
    if (leadingMarkInfo(view.state, line).block && !startsBlockAtLine(view.state, line)) {
      // Continuation lines keep the baseline Ctrl-H behavior, which is not
      // the whole-marker deletion used on a block's first line.
      return false;
    }
  }
  return (
    deleteMarkerImmersive(view) ||
    deleteMarkupBackward(view) ||
    deleteCharBackward(view)
  );
}

/**
 * Option-Backspace at a block boundary merges with the previous line, which is
 * what the same key does from line.from in live and source modes.
 */
function deleteGroupBackwardImmersive(view: EditorView): boolean {
  if (view.compositionStarted || view.composing) return false;
  const selection = view.state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) {
    return deleteGroupBackward(view);
  }
  const boundary = boundaryAt(view.state, selection.main);
  if (!boundary) return deleteGroupBackward(view);
  if (boundary.line.from === 0) return true;
  view.dispatch({
    changes: { from: boundary.line.from - 1, to: boundary.line.from },
    selection: EditorSelection.cursor(boundary.line.from - 1),
    scrollIntoView: true,
    userEvent: "delete.backward",
  });
  return true;
}

function selectionNeedsParsing(state: EditorState) {
  for (const range of state.selection.ranges) {
    if (!range.empty) continue;
    const line = state.doc.lineAt(range.head);
    if (mayHaveLeadingMark(state, line) && !syntaxTreeAvailable(state, line.to)) {
      return true;
    }
  }
  return false;
}

const parseRetries = new WeakMap<
  EditorView,
  { timer: number | null; attempts: number }
>();

/**
 * The syntax tree is not guaranteed to cover a restored or programmatically
 * selected position. Parse only up to the selected lines in short slices, then
 * apply the selection correction once the tree reaches them.
 */
function scheduleImmersiveParsing(view: EditorView) {
  if (view.dom.isConnected === false) return;
  let retry = parseRetries.get(view);
  if (retry?.timer != null) return;
  if (retry === undefined) {
    retry = { timer: null, attempts: 0 };
    parseRetries.set(view, retry);
  }
  const tick = () => {
    retry!.timer = null;
    if (view.dom.isConnected === false) {
      parseRetries.delete(view);
      return;
    }
    if (view.compositionStarted || view.composing) {
      retry!.timer = window.setTimeout(tick, 20);
      return;
    }
    let upto = 0;
    for (const range of view.state.selection.ranges) {
      if (!range.empty) continue;
      const line = view.state.doc.lineAt(range.head);
      if (
        mayHaveLeadingMark(view.state, line) &&
        !syntaxTreeAvailable(view.state, line.to)
      ) {
        upto = Math.max(upto, line.to);
      }
    }
    if (upto > 0) forceParsing(view, upto, 50);
    const adjusted = clampImmersiveSelection(
      view.state,
      view.state.selection,
    );
    if (adjusted !== view.state.selection) {
      view.dispatch({ selection: adjusted, userEvent: "select" });
    }
    if (selectionNeedsParsing(view.state) && retry!.attempts++ < 80) {
      retry!.timer = window.setTimeout(tick, 20);
    } else {
      parseRetries.delete(view);
    }
  };
  retry.timer = window.setTimeout(tick, 0);
}

/**
 * Immersive-mode selection guard. An update listener corrects keyboard,
 * pointer and programmatic selections after they are applied, and the key
 * bindings add the boundary behavior. None of this touches decorations, so an
 * active IME composition is not disturbed.
 */
function immersiveSelectionGuard(): Extension {
  return [
    EditorView.updateListener.of((update) => {
      if (update.view.compositionStarted || update.view.composing) return;
      if (!update.selectionSet && !update.docChanged) return;
      const adjusted = clampImmersiveSelection(
        update.state,
        update.state.selection,
      );
      if (adjusted !== update.state.selection) {
        update.view.dispatch({ selection: adjusted, userEvent: "select" });
      }
      if (selectionNeedsParsing(update.state)) {
        scheduleImmersiveParsing(update.view);
      }
    }),
    Prec.highest(
      keymap.of([
        { key: "ArrowLeft", run: cursorCharLeftImmersive },
        { mac: "Ctrl-b", run: cursorCharLeftImmersive },
        { key: "Ctrl-ArrowLeft", run: cursorGroupLeftImmersive },
        { key: "Alt-ArrowLeft", run: cursorGroupLeftImmersive },
        { key: "Backspace", run: deleteMarkerImmersive },
        { mac: "Ctrl-h", run: deleteBackwardImmersive },
        { mac: "Alt-Backspace", run: deleteGroupBackwardImmersive },
        { key: "Enter", run: insertLineAboveImmersive },
      ]),
    ),
  ];
}

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

interface CodeBlockChunk {
  /** Start of the first visible line of this chunk. */
  from: number;
  /** End of the last visible line of this chunk. */
  to: number;
  startsBlock: boolean;
  endsBlock: boolean;
}

const CODE_BLOCK_SIDE_MARGIN = 16;

export function collectCodeBlocks(
  view: EditorView,
  tree = syntaxTree(view.state),
): {
  decorations: DecorationSet;
  chunks: readonly CodeBlockChunk[];
} {
  const { state } = view;
  // A node that ends at the parse frontier may still grow as the background
  // parser continues, so its bottom corner must not be rounded yet.
  const treeComplete = tree.length >= state.doc.length;
  const lines: { from: number; decoration: Decoration }[] = [];
  const chunks: CodeBlockChunk[] = [];
  const codeLine = Decoration.line({ class: "cm-nicole-code-line" });

  for (const visible of view.visibleRanges) {
    if (visible.from >= visible.to) continue;
    const visibleFirst = state.doc.lineAt(visible.from).number;
    const visibleLast = state.doc.lineAt(visible.to - 1).number;

    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => {
        if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
        const blockFirst = state.doc.lineAt(node.from).number;
        const blockLast = state.doc.lineAt(
          Math.max(node.from, node.to - 1),
        ).number;
        const first = Math.max(blockFirst, visibleFirst);
        const last = Math.min(blockLast, visibleLast);
        if (last < first) return false;

        for (let number = first; number <= last; number++) {
          const line = state.doc.line(number);
          lines.push({ from: line.from, decoration: codeLine });
        }
        chunks.push({
          from: state.doc.line(first).from,
          to: state.doc.line(last).to,
          startsBlock: first === blockFirst,
          endsBlock:
            last === blockLast && (node.to < tree.length || treeComplete),
        });
        return false;
      },
    });
  }

  lines.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const line of lines) {
    builder.add(line.from, line.from, line.decoration);
  }
  return { decorations: builder.finish(), chunks };
}

const codeBlockPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    chunks: readonly CodeBlockChunk[];
    // Mirrors preview(): a composition must not rebuild the line under the
    // candidate window, so map what is already drawn and refresh afterwards.
    private stale = false;

    constructor(view: EditorView) {
      const built = collectCodeBlocks(view);
      this.decorations = built.decorations;
      this.chunks = built.chunks;
    }

    update(update: ViewUpdate) {
      const treeChanged =
        syntaxTree(update.startState) !== syntaxTree(update.state);
      const rebuild =
        update.docChanged || update.viewportChanged || treeChanged;

      if (update.view.compositionStarted) {
        if (update.docChanged) {
          this.decorations = this.decorations.map(update.changes);
          this.chunks = this.chunks
            .map((chunk) => ({
              ...chunk,
              from: update.changes.mapPos(chunk.from, 1),
              to: update.changes.mapPos(chunk.to, -1),
            }))
            .filter((chunk) => chunk.from <= chunk.to);
        }
        this.stale ||= rebuild;
        return;
      }

      if (this.stale || rebuild) {
        this.stale = false;
        const built = collectCodeBlocks(update.view);
        this.decorations = built.decorations;
        this.chunks = built.chunks;
      }
    }
  },
  { decorations: (value) => value.decorations },
);

// A layer is painted behind the content and, because it is registered after
// CodeMirror's selection layer, behind the selection too. Line backgrounds
// would otherwise cover a selection that crosses a code block.
const codeBlockBackground = layer({
  above: false,
  class: "cm-nicole-code-bg-layer",
  update(update) {
    return (
      update.docChanged ||
      update.viewportChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state)
    );
  },
  markers(view) {
    const chunks = view.plugin(codeBlockPlugin)?.chunks ?? [];
    if (chunks.length === 0) return [];
    const content = view.contentDOM.getBoundingClientRect();
    const scroller = view.scrollDOM.getBoundingClientRect();
    const baseLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
    const baseTop = scroller.top - view.scrollDOM.scrollTop * view.scaleY;
    // lineBlockAt() is relative to the document, before the content's top
    // padding; the layer is positioned against the content box in the viewport.
    const contentTop = content.top + view.documentPadding.top;
    const right = content.right - CODE_BLOCK_SIDE_MARGIN;
    const markers: RectangleMarker[] = [];

    for (const chunk of chunks) {
      const first = view.lineBlockAt(chunk.from);
      const last = view.lineBlockAt(chunk.to);
      // Keep 16px between the text and the outer edge of the background. A
      // blockquote line has its border and gutter before the text, so measuring
      // from the line start also keeps the quote rule outside the background.
      const textLeft =
        view.coordsAtPos(chunk.from, 1)?.left ?? content.left + 32;
      const left = textLeft - CODE_BLOCK_SIDE_MARGIN;
      const className = [
        "cm-nicole-code-bg",
        chunk.startsBlock ? "cm-nicole-code-bg-start" : "",
        chunk.endsBlock ? "cm-nicole-code-bg-end" : "",
      ]
        .filter(Boolean)
        .join(" ");
      markers.push(
        new RectangleMarker(
          className,
          left - baseLeft,
          contentTop + first.top - baseTop,
          Math.max(0, right - left),
          last.bottom - first.top,
        ),
      );
    }
    return markers;
  },
});

interface SelectionClipGeometry {
  left: number;
  right: number;
}

// CodeMirror's selection rectangles span the whole content box, including its
// 32px side padding. Clip the layer to the same 16px inset as the code
// backgrounds so a multi-line selection does not extend past their rounded
// edges. Keep the layer at its natural zero size: sizing it would enlarge the
// scroller. A polygon with a very tall vertical range clips every line without
// giving the element a box.
const selectionLayerClip = ViewPlugin.fromClass(
  class {
    private readonly request = {
      read: (view: EditorView): SelectionClipGeometry | null => {
        const layer =
          view.scrollDOM.querySelector<HTMLElement>(".cm-selectionLayer");
        if (!layer) return null;
        const content = view.contentDOM.getBoundingClientRect();
        const scroller = view.scrollDOM.getBoundingClientRect();
        const baseLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
        if (content.width <= 0) return null;
        return {
          left: content.left - baseLeft + CODE_BLOCK_SIDE_MARGIN,
          right: content.right - baseLeft - CODE_BLOCK_SIDE_MARGIN,
        };
      },
      write: (geometry: SelectionClipGeometry | null, view: EditorView) => {
        if (!geometry) return;
        const layer =
          view.scrollDOM.querySelector<HTMLElement>(".cm-selectionLayer");
        if (!layer) return;
        const left = geometry.left;
        const right = Math.max(left, geometry.right);
        const clip = `polygon(${left}px -1e7px, ${right}px -1e7px, ${right}px 1e7px, ${left}px 1e7px)`;
        if (layer.style.clipPath !== clip) layer.style.clipPath = clip;
      },
    };

    constructor(view: EditorView) {
      view.requestMeasure(this.request);
    }

    update(update: ViewUpdate) {
      if (update.geometryChanged || update.viewportChanged) {
        update.view.requestMeasure(this.request);
      }
    }
  },
);

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
      return [preview(false, resolveImage), immersiveSelectionGuard()];
  }
}

function runtimePlatform(): AppPlatform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  return "linux";
}

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
  // Code blocks are monospace as a whole, including fences, language labels
  // and the indentation of indented code.
  ".cm-nicole-code-line": { fontFamily: "var(--reading-font-mono)" },
  // The background itself is drawn in a layer below the selection layer. This
  // only clears the inline-code style on ordinary spans; search, selection-match
  // and bracket-match highlights keep their own background.
  ".cm-nicole-code-line span:not(.cm-searchMatch):not(.cm-searchMatch-selected):not(.cm-selectionMatch):not(.cm-matchingBracket):not(.cm-nonmatchingBracket)":
    { backgroundColor: "transparent" },
  ".cm-nicole-code-bg": {
    backgroundColor: "var(--reading-code-bg)",
  },
  ".cm-nicole-code-bg-start": {
    borderTopLeftRadius: "var(--radius-control)",
    borderTopRightRadius: "var(--radius-control)",
  },
  ".cm-nicole-code-bg-end": {
    borderBottomLeftRadius: "var(--radius-control)",
    borderBottomRightRadius: "var(--radius-control)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--nicole-caret)",
    borderLeftWidth: "2px",
  },
  // CodeMirror's base theme paints the focused selection layer with
  // `&light.cm-focused > .cm-scroller > .cm-selectionLayer
  // .cm-selectionBackground`. It compiles to five classes: the generated light
  // scope class, `.cm-focused`, and three descendants. A plain `.cm-focused
  // .cm-selectionBackground` rule loses that cascade, which made the dark theme
  // fall back to the base theme's light lavender. This selector compiles to the
  // same five classes with the generated app scope class, and the app theme is
  // installed later, so it wins without !important. The `::selection` part
  // keeps native selections on the same variable.
  "&.cm-editor > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection":
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
    borderColor: "var(--nicole-checkbox-checked-border, var(--text-accent))",
    backgroundColor: "var(--nicole-checkbox-checked-bg, var(--text-accent))",
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
      "1.5px solid var(--nicole-checkbox-mark, var(--surface-canvas))",
    borderBottom:
      "1.5px solid var(--nicole-checkbox-mark, var(--surface-canvas))",
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
      // MyGo drop event supplies the paths, token, and coordinates.
      event.preventDefault();
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

function clampedPosition(value: unknown, docLength: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(docLength, value))
    : 0;
}

function selectionFromJSON(
  selection: SavedSelection | null | undefined,
  docLength: number,
): EditorSelection {
  if (!selection || !Array.isArray(selection.ranges) || selection.ranges.length === 0) {
    return EditorSelection.single(0);
  }
  const ranges = selection.ranges.map((range) =>
    EditorSelection.range(
      clampedPosition(range.anchor, docLength),
      clampedPosition(range.head ?? range.anchor, docLength),
    ),
  );
  const main = Math.min(
    Math.max(0, Number.isInteger(selection.main) ? selection.main : 0),
    ranges.length - 1,
  );
  return EditorSelection.create(ranges, main);
}

export function createEditor(options: CreateEditorOptions): EditorHandle {
  const {
    parent,
    doc,
    mode: initialMode = "live",
    platform = runtimePlatform(),
    commands = [],
    restore,
    resolveImage = defaultResolveImage,
    onPasteImage,
    onChange,
    onCompositionEnd,
    onCompositionStart,
  } = options;

  const modeCompartment = new Compartment();
  let mode = initialMode;

  const enabledCommands = [...commands, ...commandRegistry];

  // An image insertion may arrive while an IME composition is still running.
  // It waits, and its ticket follows edits until the composition ends, so the
  // candidate window is never interrupted and the text lands where the user
  // dropped or pasted it.
  const pendingInsertions: PendingInsertion[] = [];
  const tickets = new Map<number, TicketState>();
  let nextTicketID = 1;
  let insertionScheduled = false;
  let view: EditorView;
  let destroyed = false;
  let scrollRestoreGeneration = 0;
  let stopScrollRestore: (() => void) | null = null;

  const anchorLine = (lineNumber: number) =>
    view.state.doc.line(
      Math.min(Math.max(1, lineNumber), view.state.doc.lines),
    );

  const cancelScrollRestore = () => {
    scrollRestoreGeneration++;
    stopScrollRestore?.();
    stopScrollRestore = null;
  };

  /**
   * Scrolls a line back to an in-line offset. The first assignment paints the
   * position right away, then up to six animation frames correct it against
   * the measured blocks: before the first measurement the top padding is still
   * zero and lines outside the viewport only have estimated heights, and
   * CodeMirror re-anchors estimated positions while it measures. Both would
   * otherwise move the restored line by several lines.
   *
   * The correction yields as soon as the user scrolls or types, the document
   * changes, the view is destroyed, or a newer anchor request arrives. The
   * alternative, mapping the anchor through every transaction, would make the
   * window in which the editor overrides the caret's own scrollIntoView and
   * the user's scroll longer; a new edit or external reload is the better
   * owner of the viewport, and reloads install a fresh anchor anyway.
   */
  const scrollToAnchor = (anchor: ScrollAnchor) => {
    cancelScrollRestore();
    const generation = scrollRestoreGeneration;
    const targetTop = () =>
      scrollTopForAnchor(
        anchor,
        view.documentPadding.top,
        view.lineBlockAt(anchorLine(anchor.line).from).top,
      );
    view.scrollDOM.scrollTop = targetTop();

    const userEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
    const listenOptions = { capture: true, passive: true };
    const onUserInput = () => cancelScrollRestore();
    for (const event of userEvents) {
      view.dom.addEventListener(event, onUserInput, listenOptions);
    }
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      for (const event of userEvents) {
        view.dom.removeEventListener(event, onUserInput, listenOptions);
      }
      if (stopScrollRestore === stop) stopScrollRestore = null;
    };
    stopScrollRestore = stop;

    let frames = 0;
    let stable = 0;
    const settle = () => {
      if (destroyed || generation !== scrollRestoreGeneration) {
        stop();
        return;
      }
      if (frames++ >= 6) {
        stop();
        return;
      }
      const before = view.scrollDOM.scrollTop;
      view.scrollDOM.scrollTop = targetTop();
      stable =
        Math.abs(view.scrollDOM.scrollTop - before) < 0.5 ? stable + 1 : 0;
      if (stable < 2) requestAnimationFrame(settle);
      else stop();
    };
    requestAnimationFrame(settle);
  };

  const createTicketAt = (at: number): InsertionTicket => {
    const ticket: TicketState = { id: nextTicketID++, at };
    tickets.set(ticket.id, ticket);
    return ticket;
  };

  const insertTextAt = (at: number, text: string) => {
    const position = Math.max(0, Math.min(at, view.state.doc.length));
    const line = view.state.doc.lineAt(position);
    // Live and source modes keep the baseline placement: an image at the
    // beginning of a non-empty line gets its own line, otherwise it stays at
    // the cursor.
    if (mode !== "immersive") {
      const insert =
        position === line.from && line.length > 0 ? `${text}\n` : text;
      view.dispatch({
        changes: { from: position, insert },
        selection: { anchor: position + insert.length },
        annotations: isolateHistory.of("full"),
      });
      return;
    }

    const info = leadingMarkInfo(view.state, line);
    // A coordinate anywhere in a block's leading markup is ambiguous: putting
    // the image at that character would split the marker. Only on the block's
    // first line, treat the whole leading range as the block content start and
    // insert above the block; continuation lines keep the marker and place the
    // image after it. Empty blocks still receive the image after the marker.
    const inLeadingMarkup =
      info.block &&
      position <= info.contentStart &&
      line.to > info.contentStart &&
      startsBlockAtLine(view.state, line);
    const ownLine =
      inLeadingMarkup ||
      (!info.block && position === line.from && line.length > 0);
    const from = inLeadingMarkup
      ? line.from
      : info.block && position < info.contentStart
        ? info.contentStart
        : position;
    const insert = ownLine ? `${text}\n` : text;
    const anchor = inLeadingMarkup
      ? info.contentStart + insert.length
      : from + insert.length;
    view.dispatch({
      changes: { from, insert },
      selection: { anchor },
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

  const handleCompositionStart = () => {
    onCompositionStart?.();
  };

  const handleCompositionEnd = () => {
    onCompositionEnd?.();
    if (pendingInsertions.length > 0) scheduleInsertion();
  };

  // External edits are one change over the common prefix and suffix. That is
  // enough for CodeMirror to map the selection and scroll position through an
  // insertion or deletion elsewhere in the document.
  const replaceDocument = (text: string) => {
    const current = view.state.doc.toString();
    if (current === text) return;
    let prefix = 0;
    const limit = Math.min(current.length, text.length);
    while (prefix < limit && current[prefix] === text[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < limit - prefix &&
      current[current.length - 1 - suffix] === text[text.length - 1 - suffix]
    ) {
      suffix++;
    }
    const changes = ChangeSet.of(
      {
        from: prefix,
        to: current.length - suffix,
        insert: text.slice(prefix, text.length - suffix),
      },
      current.length,
    );
    const scrollTop = view.scrollDOM.scrollTop;
    const paddingTop = view.documentPadding.top;
    const block = view.lineBlockAtHeight(
      visibleTopHeight(scrollTop, paddingTop),
    );
    const topLine = view.state.doc.lineAt(block.from);
    const anchor = scrollAnchor(
      scrollTop,
      paddingTop,
      topLine.number,
      block.top,
    );
    const mappedTop = changes.mapPos(topLine.from, 1);
    view.dispatch({ changes });
    // The top line keeps its text across an edit elsewhere, so it is the
    // stable reference for both the selection and the visible area.
    scrollToAnchor({
      line: view.state.doc.lineAt(mappedTop).number,
      offset: anchor.offset,
    });
  };

  let focusedCheckbox: HTMLInputElement | null = null;
  let recoverRemovedCheckbox: () => void = () => {};
  const extensions: Extension[] = [
    basicSetup,
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(highlightStyle),
    codeBlockPlugin,
    codeBlockBackground,
    selectionLayerClip,
    editorTheme,
    createCommandKeymap(enabledCommands, platform),
    imageHandlers(onPasteImage, createTicketAt),
    EditorView.updateListener.of((update) => {
      if (focusedCheckbox !== null && !focusedCheckbox.isConnected) {
        window.setTimeout(recoverRemovedCheckbox, 0);
      }
      if (update.docChanged) {
        // The edit, not the pending restore, owns the viewport now.
        cancelScrollRestore();
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
  ];

  let initialState: EditorState | null = null;
  if (restore?.history != null) {
    try {
      initialState = EditorState.fromJSON(
        {
          doc,
          selection: selectionFromJSON(restore.selection, doc.length).toJSON(),
          history: restore.history,
        },
        { extensions },
        { history: historyField },
      );
    } catch {
      // A history entry from a document that changed on disk should not keep
      // the tab from opening; fall back to the same text without history.
    }
  }
  view = new EditorView({
    parent,
    state:
      initialState ??
      EditorState.create({
        doc,
        selection: restore?.selection
          ? selectionFromJSON(restore.selection, doc.length)
          : undefined,
        extensions,
      }),
  });
  view.contentDOM.addEventListener("compositionstart", handleCompositionStart);
  view.contentDOM.addEventListener("compositionend", handleCompositionEnd);

  // A focused task checkbox owns the keyboard. WebKit can keep its native
  // selection in the contentEditable underneath, so stopping CodeMirror alone
  // is not enough: IME text and native editing commands still target the old
  // caret. Clear that selection when the box takes focus; CodeMirror keeps its
  // own selection in state, so focusing the editor restores the caret.
  const checkboxFocused = () => {
    const active = view.root.activeElement;
    return (
      active instanceof HTMLInputElement &&
      active.classList.contains("cm-nicole-checkbox-input") &&
      view.dom.contains(active)
    );
  };
  // WKWebView performs Shift-Enter and Ctrl-O in its native editor before a
  // normal keymap handler can claim them. Capture these two keys while the
  // caret is at a block boundary, before WebKit inserts its own line break.
  const onBoundaryInsertKey = (event: KeyboardEvent) => {
    if (
      mode !== "immersive" ||
      event.defaultPrevented ||
      checkboxFocused()
    ) {
      return;
    }
    const shiftEnter =
      event.key === "Enter" &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey;
    const ctrlO =
      isMac(platform) &&
      event.key.toLowerCase() === "o" &&
      event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey;
    if ((shiftEnter || ctrlO) && insertLineAboveImmersive(view)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const editorDocument = view.contentDOM.ownerDocument;
  const focusEditor = () => {
    if (destroyed) return;
    view.focus();
  };
  const isTaskCheckbox = (
    target: EventTarget | null,
  ): target is HTMLInputElement =>
    target instanceof HTMLInputElement &&
    target.classList.contains("cm-nicole-checkbox-input");
  let leftCheckbox = false;
  recoverRemovedCheckbox = () => {
    if (destroyed || focusedCheckbox === null || focusedCheckbox.isConnected) {
      return;
    }
    const active = editorDocument.activeElement;
    if (
      active !== null &&
      active !== editorDocument.body &&
      active !== editorDocument.documentElement
    ) {
      focusedCheckbox = null;
      return;
    }
    // A blurred window cannot take focus; the window focus listener retries.
    if (!editorDocument.hasFocus()) return;
    focusedCheckbox = null;
    focusEditor();
  };
  const onCheckboxFocusOut = (event: FocusEvent) => {
    const checkbox = event.target;
    if (!isTaskCheckbox(checkbox)) return;
    leftCheckbox = true;
    window.setTimeout(() => {
      if (
        focusedCheckbox === checkbox &&
        checkbox.isConnected &&
        editorDocument.activeElement !== checkbox
      ) {
        focusedCheckbox = null;
      }
      recoverRemovedCheckbox();
    }, 0);
  };
  const onCheckboxFocusIn = (event: FocusEvent) => {
    if (event.target === view.contentDOM && leftCheckbox) {
      leftCheckbox = false;
      // WebKit focuses a cleared contentEditable at the start and scrolls
      // there before CodeMirror can write its selection back.
      focusEditor();
      return;
    }
    leftCheckbox = false;
    if (!checkboxFocused()) return;
    if (event.target instanceof HTMLInputElement) {
      focusedCheckbox = event.target;
    }
    editorDocument.getSelection()?.removeAllRanges();
  };
  const onCheckboxKeydown = (event: KeyboardEvent) => {
    if (!checkboxFocused()) return;
    // A bare Space toggles the checkbox natively. Any modified Space is an
    // editing/IME/system shortcut, not a task toggle.
    if (event.key === " ") {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        event.preventDefault();
      }
      return;
    }
    const primaryModifier = isMac(platform) ? event.metaKey : event.ctrlKey;
    if (primaryModifier) {
      // Find, find-next, find-previous (with Shift for g) and select-all are
      // editor commands, not menu actions. Give the editor focus, then run the
      // same keymap CodeMirror would have run if the event had targeted the
      // contentEditable.
      const key = event.key.toLowerCase();
      if (
        !event.altKey &&
        (key === "f" || key === "a" || key === "g") &&
        (key === "g" || !event.shiftKey)
      ) {
        event.preventDefault();
        focusEditor();
        runScopeHandlers(view, event, "editor");
      }
      return;
    }
    // Tab and Escape stay native. Everything else is blocked; on macOS the
    // control modifier is not the primary modifier and must not reach CodeMirror.
    if (event.key === "Tab" || event.key === "Escape") return;
    // Do not stop propagation: the window-level composition guard still needs
    // to see the key. Application shortcuts do not run for this event because
    // the target is an INPUT and the event is defaultPrevented.
    event.preventDefault();
  };
  const onCheckboxEditing = (event: Event) => {
    if (!checkboxFocused()) return;
    event.preventDefault();
  };
  // macOS routes the native Select All menu action to selectstart on the page
  // background while keyboard focus is still on the checkbox. The cleared
  // native selection gives that action nothing to select, so run the editor
  // command explicitly. A selectstart after focus leaves the checkbox is left
  // to the browser, so clicking blank page space does not select the document.
  const onSelectStart = (event: Event) => {
    if (!checkboxFocused()) return;
    const target = event.target;
    if (
      target !== editorDocument.body &&
      target !== editorDocument.documentElement
    ) {
      return;
    }
    event.preventDefault();
    focusEditor();
    selectAll(view);
  };
  const checkboxBlockedEvents = ["beforeinput", "paste", "cut"] as const;
  editorDocument.addEventListener("selectstart", onSelectStart, true);
  window.addEventListener("focus", recoverRemovedCheckbox);
  view.contentDOM.addEventListener("focusout", onCheckboxFocusOut, true);
  view.contentDOM.addEventListener("focusin", onCheckboxFocusIn, true);
  view.contentDOM.addEventListener("keydown", onBoundaryInsertKey, true);
  view.contentDOM.addEventListener("keydown", onCheckboxKeydown, true);
  for (const type of checkboxBlockedEvents) {
    view.contentDOM.addEventListener(type, onCheckboxEditing, true);
  }

  // Reconfiguring a compartment is not filtered by the newly installed
  // compartment, and an initial or restored selection is not a transaction at
  // all. Normalize both cases explicitly so entering immersive mode never
  // leaves the caret inside hidden markup. A live composition keeps its
  // selection untouched.
  const normalizeImmersiveSelection = () => {
    if (view.compositionStarted || view.composing) return;
    const adjusted = clampImmersiveSelection(view.state, view.state.selection);
    if (adjusted !== view.state.selection) {
      view.dispatch({ selection: adjusted, userEvent: "select" });
    }
    if (selectionNeedsParsing(view.state)) scheduleImmersiveParsing(view);
  };
  if (mode === "immersive") normalizeImmersiveSelection();

  if (restore?.scrollTopLine != null) {
    scrollToAnchor({
      line: restore.scrollTopLine,
      offset: restore.scrollTopOffset ?? 0,
    });
  }

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
      if (next === "immersive") {
        normalizeImmersiveSelection();
      } else {
        const retry = parseRetries.get(view);
        if (retry?.timer != null) clearTimeout(retry.timer);
        parseRetries.delete(view);
      }
    },
    replaceDocument,
    undo() {
      return !view.compositionStarted && historyUndo(view);
    },
    redo() {
      return !view.compositionStarted && historyRedo(view);
    },
    containsPoint(x, y) {
      const element = document.elementFromPoint(x, y);
      return element !== null && view.dom.contains(element);
    },
    createInsertionTicket(x, y) {
      const at = view.posAtCoords({ x, y });
      if (at === null) return null;
      return createTicketAt(at);
    },
    insertImages,
    getRestoreState() {
      const scrollTop = view.scrollDOM.scrollTop;
      const paddingTop = view.documentPadding.top;
      const block = view.lineBlockAtHeight(
        visibleTopHeight(scrollTop, paddingTop),
      );
      const line = view.state.doc.lineAt(block.from);
      const anchor = scrollAnchor(
        scrollTop,
        paddingTop,
        line.number,
        block.top,
      );
      const stateJSON = view.state.toJSON({ history: historyField });
      return {
        selection: view.state.selection.toJSON() as SavedSelection,
        history: stateJSON.history ?? null,
        scrollTopLine: anchor.line,
        scrollTopOffset: anchor.offset,
      };
    },
    focus() {
      view.focus();
    },
    destroy() {
      destroyed = true;
      editorDocument.removeEventListener("selectstart", onSelectStart, true);
      window.removeEventListener("focus", recoverRemovedCheckbox);
      view.contentDOM.removeEventListener("focusout", onCheckboxFocusOut, true);
      view.contentDOM.removeEventListener("focusin", onCheckboxFocusIn, true);
      view.contentDOM.removeEventListener("keydown", onBoundaryInsertKey, true);
      view.contentDOM.removeEventListener("keydown", onCheckboxKeydown, true);
      for (const type of checkboxBlockedEvents) {
        view.contentDOM.removeEventListener(type, onCheckboxEditing, true);
      }
      const retry = parseRetries.get(view);
      if (retry?.timer != null) clearTimeout(retry.timer);
      parseRetries.delete(view);
      stopScrollRestore?.();
      stopScrollRestore = null;
      pendingInsertions.length = 0;
      tickets.clear();
      view.contentDOM.removeEventListener(
        "compositionstart",
        handleCompositionStart,
      );
      view.contentDOM.removeEventListener("compositionend", handleCompositionEnd);
      view.destroy();
    },
  };
}
