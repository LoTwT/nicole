import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  StateEffect,
  type ChangeSet,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
} from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";

/** Asks the editor to show the link dialog for the current selection. */
export const openLinkEditorEffect = StateEffect.define<null>();

export type LinkImageKind = "link" | "image";

export const LINK_IMAGE_POPOVER_WIDTH = 340;
export const LINK_IMAGE_POPOVER_MARGIN = 8;
const LINK_IMAGE_POPOVER_GAP = 4;

export interface PopoverAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PopoverPlacement {
  left: number;
  top: number;
  placement: "above" | "below";
}

/** The fixed 340px dialog flips above its target when the lower edge is short. */
export function placeLinkImagePopover(
  anchor: PopoverAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = LINK_IMAGE_POPOVER_MARGIN,
): PopoverPlacement {
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const left = Math.min(Math.max(anchor.left, margin), maxLeft);

  const below = anchor.bottom + LINK_IMAGE_POPOVER_GAP;
  const above = anchor.top - LINK_IMAGE_POPOVER_GAP - size.height;
  let top = below;
  let placement: PopoverPlacement["placement"] = "below";

  if (below + size.height > viewport.height - margin) {
    if (above >= margin) {
      top = above;
      placement = "above";
    } else {
      top = Math.max(margin, viewport.height - size.height - margin);
    }
  }
  if (top < margin) top = margin;

  return { left, top, placement };
}

export interface InlineLinkTarget {
  kind: "link";
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  urlFrom: number;
  urlTo: number;
  text: string;
  url: string;
}

export interface ImageTarget {
  kind: "image";
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  urlFrom: number;
  urlTo: number;
  text: string;
  url: string;
}

export type InlineTarget = InlineLinkTarget | ImageTarget;

function inlineTarget(
  state: EditorState,
  node: { name: string; from: number; to: number; node: any },
): InlineTarget | null {
  if (node.name !== "Link" && node.name !== "Image") return null;
  const marks = node.node.getChildren("LinkMark");
  const [open, close, parenOpen, parenClose] = marks;
  if (!open || !close || !parenOpen || !parenClose) return null;
  if (
    state.sliceDoc(parenOpen.from, parenOpen.to) !== "(" ||
    state.sliceDoc(parenClose.from, parenClose.to) !== ")"
  ) {
    return null;
  }
  const url = node.node.getChild("URL");
  const urlFrom = url ? url.from : parenOpen.to;
  const urlTo = url ? url.to : parenClose.from;
  return {
    kind: node.name === "Image" ? "image" : "link",
    from: node.from,
    to: node.to,
    textFrom: open.to,
    textTo: close.from,
    urlFrom,
    urlTo,
    text: state.sliceDoc(open.to, close.from),
    url: state.sliceDoc(urlFrom, urlTo).trim(),
  };
}

function targetAtBias(
  state: EditorState,
  position: number,
  bias: -1 | 1,
): InlineTarget | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 20) ?? syntaxTree(state);
  let node = tree.resolveInner(position, bias);
  for (;;) {
    const target = inlineTarget(state, node);
    if (target) return target;
    if (!node.parent) return null;
    node = node.parent;
  }
}

/** Finds an inline link or image at a document position. */
export function inlineTargetAt(
  state: EditorState,
  position: number,
): InlineTarget | null {
  return targetAtBias(state, position, 1) ?? targetAtBias(state, position, -1);
}

export function inlineTargetInSelection(
  state: EditorState,
  range: SelectionRange,
): InlineTarget | null {
  const start = inlineTargetAt(state, range.from);
  if (
    start &&
    range.from >= start.from &&
    range.to <= start.to &&
    (range.empty ? range.head > start.from && range.head < start.to : true)
  ) {
    return start;
  }
  if (!range.empty) {
    const end = inlineTargetAt(state, Math.max(range.from, range.to - 1));
    if (end && range.from >= end.from && range.to <= end.to) return end;
  }
  return null;
}

export interface NewLinkDraft {
  from: number;
  to: number;
  text: string;
  leading: string;
  trailing: string;
}

/** Resolves Mod-K/slash: edit a link, otherwise draft a new one. */
export function linkEditorTarget(
  state: EditorState,
): InlineLinkTarget | NewLinkDraft {
  const range = state.selection.main;
  const existing = inlineTargetInSelection(state, range);
  if (existing?.kind === "link") return existing;
  // Inserting a new link inside image syntax would split it. A collapsed
  // caret inside an image continues after the image instead.
  if (existing?.kind === "image" && range.empty) {
    return newLinkDraft(state, EditorSelection.cursor(existing.to));
  }
  return newLinkDraft(state);
}

export function newLinkDraft(
  state: EditorState,
  range = state.selection.main,
): NewLinkDraft {
  const raw = state.sliceDoc(range.from, range.to);
  const leading = /^[ \t]*/.exec(raw)?.[0] ?? "";
  const trailing = /[ \t]*$/.exec(raw)?.[0] ?? "";
  const text = raw
    .slice(leading.length, raw.length - trailing.length)
    .replace(/\s*\n\s*/g, " ");
  return { from: range.from, to: range.to, text, leading, trailing };
}

export interface LinkImageEditorSession {
  readonly kind: LinkImageKind;
  readonly isNew: boolean;
  readonly initialText: string;
  readonly initialUrl: string;
  /** Plain clicks keep the caret in the document until Tab enters the dialog. */
  readonly preserveEditorFocus: boolean;
  readonly canRemove: boolean;
  readonly valid: boolean;
  anchor(): PopoverAnchor | null;
  update(update: ViewUpdate): void;
  complete(text: string, url: string): boolean;
  remove(): boolean;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

interface SessionTarget {
  kind: LinkImageKind;
  isNew: boolean;
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  urlFrom: number;
  urlTo: number;
  text: string;
  url: string;
  leading: string;
  trailing: string;
  preserveEditorFocus: boolean;
}

function sessionTarget(
  target: InlineTarget | NewLinkDraft,
  preserveEditorFocus: boolean,
): SessionTarget {
  if ("kind" in target) {
    return {
      ...target,
      isNew: false,
      leading: "",
      trailing: "",
      preserveEditorFocus,
    };
  }
  return {
    kind: "link",
    isNew: true,
    from: target.from,
    to: target.to,
    textFrom: target.from,
    textTo: target.to,
    urlFrom: target.from,
    urlTo: target.to,
    text: target.text,
    url: "",
    leading: target.leading,
    trailing: target.trailing,
    preserveEditorFocus,
  };
}

class EditorLinkImageSession implements LinkImageEditorSession {
  private disposed = false;
  private stillValid = true;
  private listeners = new Set<() => void>();
  private target: SessionTarget;

  constructor(
    private view: EditorView,
    target: SessionTarget,
    private onInvalidate: (session: LinkImageEditorSession) => void,
  ) {
    this.target = target;
  }

  get kind() {
    return this.target.kind;
  }

  get isNew() {
    return this.target.isNew;
  }

  get initialText() {
    return this.target.text;
  }

  get initialUrl() {
    return this.target.url;
  }

  get preserveEditorFocus() {
    return this.target.preserveEditorFocus;
  }

  get canRemove() {
    return !this.target.isNew && this.target.kind === "link";
  }

  get valid() {
    return this.stillValid && !this.disposed;
  }

  anchor(): PopoverAnchor | null {
    if (!this.valid || !this.view.dom.isConnected) return null;
    const from = this.view.coordsAtPos(this.target.from, 1);
    const to =
      this.view.coordsAtPos(Math.max(this.target.from, this.target.to - 1), -1) ??
      from;
    if (from === null && to === null) return null;
    const first = from ?? to!;
    const second = to ?? from!;
    return {
      left: Math.min(first.left, second.left),
      right: Math.max(first.right, second.right),
      top: Math.min(first.top, second.top),
      bottom: Math.max(first.bottom, second.bottom),
    };
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyGeometry() {
    for (const listener of [...this.listeners]) listener();
  }

  private overlaps(from: number, to: number): boolean {
    if (this.target.from === this.target.to) {
      return from <= this.target.from && this.target.from <= to;
    }
    return from < this.target.to && to > this.target.from;
  }

  update(update: ViewUpdate) {
    if (!this.valid) return;
    if (update.docChanged) {
      let touched = false;
      update.changes.iterChangedRanges((from, to) => {
        if (this.overlaps(from, to)) touched = true;
      });
      if (touched) {
        this.invalidate();
        return;
      }
      const changes = update.changes;
      // Edits exactly at a boundary are outside the target: an insertion at
      // the start stays before it and an insertion at the end stays after it.
      this.target = {
        ...this.target,
        from: changes.mapPos(this.target.from, 1),
        to: changes.mapPos(this.target.to, -1),
        textFrom: changes.mapPos(this.target.textFrom, 1),
        textTo: changes.mapPos(this.target.textTo, -1),
        urlFrom: changes.mapPos(this.target.urlFrom, 1),
        urlTo: changes.mapPos(this.target.urlTo, -1),
      };
    }
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged
    ) {
      this.notifyGeometry();
    }
  }

  private finish() {
    this.disposed = true;
    this.stillValid = false;
    this.listeners.clear();
  }

  private invalidate() {
    if (!this.valid) return;
    this.stillValid = false;
    this.disposed = true;
    this.listeners.clear();
    this.onInvalidate(this);
  }

  complete(text: string, url: string): boolean {
    if (!this.valid) return false;
    const state = this.view.state;
    if (this.target.isNew) {
      const replacement =
        this.target.leading +
        `[${text}](${url})` +
        this.target.trailing;
      if (
        state.sliceDoc(this.target.from, this.target.to) === replacement
      ) {
        this.finish();
        return true;
      }
      this.finish();
      this.view.dispatch({
        changes: { from: this.target.from, to: this.target.to, insert: replacement },
        selection: { anchor: this.target.from + replacement.length },
        userEvent: "input.format",
        annotations: isolateHistory.of("full"),
      });
      return true;
    }

    const changes: ChangeSpec[] = [];
    if (text !== this.target.text) {
      changes.push({
        from: this.target.textFrom,
        to: this.target.textTo,
        insert: text,
      });
    }
    if (url !== this.target.url) {
      changes.push({
        from: this.target.urlFrom,
        to: this.target.urlTo,
        insert: url,
      });
    }
    this.finish();
    if (changes.length === 0) return true;

    const changeSet = state.changes(changes);
    this.view.dispatch({
      changes: changeSet,
      selection: state.selection.map(changeSet, 1),
      userEvent: "input.format",
      annotations: isolateHistory.of("full"),
    });
    return true;
  }

  remove(): boolean {
    if (!this.valid || !this.canRemove) return false;
    const state = this.view.state;
    const text = state.sliceDoc(this.target.textFrom, this.target.textTo);
    this.finish();
    this.view.dispatch({
      changes: {
        from: this.target.from,
        to: this.target.to,
        insert: text,
      },
      selection: { anchor: this.target.from + text.length },
      userEvent: "input.format",
      annotations: isolateHistory.of("full"),
    });
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.finish();
  }
}

export function createLinkImageEditorSession(
  view: EditorView,
  target: InlineTarget | NewLinkDraft,
  preserveEditorFocus: boolean,
  onInvalidate: (session: LinkImageEditorSession) => void,
): LinkImageEditorSession {
  return new EditorLinkImageSession(
    view,
    sessionTarget(target, preserveEditorFocus),
    onInvalidate,
  );
}
