import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  StateEffect,
  type ChangeSet,
  type EditorState,
  type SelectionRange,
} from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";

import {
  formatImageDestination,
  formatMarkdownDestination,
  parseMarkdownDestination,
} from "../image-url";
import { splitEdgeWhitespace } from "./whitespace";

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

export type PopoverBounds = PopoverAnchor;

/** Clips the editor host to the window viewport, or null if they do not meet. */
export function intersectPopoverBounds(
  host: PopoverBounds,
  viewport: { width: number; height: number },
): PopoverBounds | null {
  const left = Math.max(host.left, 0);
  const top = Math.max(host.top, 0);
  const right = Math.min(host.right, viewport.width);
  const bottom = Math.min(host.bottom, viewport.height);
  if (right <= left || bottom <= top) return null;
  return { left, right, top, bottom };
}

/** The fixed 340px dialog flips above its target when the lower edge is short. */
export function placeLinkImagePopover(
  anchor: PopoverAnchor,
  size: { width: number; height: number },
  bounds: PopoverBounds,
  margin = LINK_IMAGE_POPOVER_MARGIN,
): PopoverPlacement {
  const leftLimit = bounds.left + margin;
  const rightLimit = bounds.right - margin;
  const topLimit = bounds.top + margin;
  const bottomLimit = bounds.bottom - margin;
  const width = Math.min(size.width, Math.max(0, rightLimit - leftLimit));
  const maxLeft = Math.max(leftLimit, rightLimit - width);
  const left = Math.min(Math.max(anchor.left, leftLimit), maxLeft);

  const below = anchor.bottom + LINK_IMAGE_POPOVER_GAP;
  const above = anchor.top - LINK_IMAGE_POPOVER_GAP - size.height;
  let top = below;
  let placement: PopoverPlacement["placement"] = "below";

  if (below + size.height > bottomLimit) {
    if (above >= topLimit) {
      top = above;
      placement = "above";
    } else {
      top = Math.max(topLimit, bottomLimit - size.height);
    }
  }
  if (top < topLimit) top = topLimit;

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
  const urlSource = state.sliceDoc(urlFrom, urlTo).trim();
  return {
    kind: node.name === "Image" ? "image" : "link",
    from: node.from,
    to: node.to,
    textFrom: open.to,
    textTo: close.from,
    urlFrom,
    urlTo,
    text: state.sliceDoc(open.to, close.from),
    url: parseMarkdownDestination(urlSource),
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
  const { leading, trailing, core } = splitEdgeWhitespace(raw);
  return {
    from: range.from,
    to: range.to,
    text: core.replace(/\s*\n\s*/g, " "),
    leading,
    trailing,
  };
}

export interface LinkImageFieldValues {
  text: string;
  url: string;
}

export interface LinkImageEditorSession {
  readonly kind: LinkImageKind;
  readonly isNew: boolean;
  /** One entry per target; batch new links keep their fields separate. */
  readonly fields: readonly LinkImageFieldValues[];
  readonly initialText: string;
  readonly initialUrl: string;
  /** Plain clicks keep the caret in the document until Tab enters the dialog. */
  readonly preserveEditorFocus: boolean;
  readonly canRemove: boolean;
  readonly valid: boolean;
  anchor(): PopoverAnchor | null;
  /** Bounds of the editor host; the dialog must not render outside them. */
  hostBounds(): PopoverBounds | null;
  update(update: ViewUpdate): void;
  complete(values: readonly LinkImageFieldValues[]): boolean;
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

function newSessionTarget(
  draft: NewLinkDraft,
  preserveEditorFocus: boolean,
): SessionTarget {
  return {
    kind: "link",
    isNew: true,
    from: draft.from,
    to: draft.to,
    textFrom: draft.from,
    textTo: draft.to,
    urlFrom: draft.from,
    urlTo: draft.to,
    text: draft.text,
    url: "",
    leading: draft.leading,
    trailing: draft.trailing,
    preserveEditorFocus,
  };
}

function isDraftArray(
  target: InlineTarget | NewLinkDraft | readonly NewLinkDraft[],
): target is readonly NewLinkDraft[] {
  return Array.isArray(target);
}

function sessionTargets(
  target: InlineTarget | NewLinkDraft | readonly NewLinkDraft[],
  preserveEditorFocus: boolean,
): SessionTarget[] {
  if (isDraftArray(target)) {
    return target.map((draft) =>
      newSessionTarget(draft, preserveEditorFocus),
    );
  }
  if ("kind" in target) {
    return [
      {
        ...target,
        isNew: false,
        leading: "",
        trailing: "",
        preserveEditorFocus,
      },
    ];
  }
  return [newSessionTarget(target, preserveEditorFocus)];
}

/**
 * Serializes an edited address value. Images keep the existing path escaping
 * contract; both link and image then pass through the same final Markdown
 * destination legality boundary.
 */
function destinationForTarget(target: SessionTarget, value: string): string {
  const address = parseMarkdownDestination(value);
  return formatMarkdownDestination(
    target.kind === "image" ? formatImageDestination(address) : address,
  );
}

class EditorLinkImageSession implements LinkImageEditorSession {
  private disposed = false;
  private stillValid = true;
  private listeners = new Set<() => void>();
  private targets: SessionTarget[];
  private anchorIndex: number;
  private hostObserver: ResizeObserver | null = null;

  constructor(
    private view: EditorView,
    targets: SessionTarget[],
    anchorIndex: number,
    private onInvalidate: (session: LinkImageEditorSession) => void,
  ) {
    this.targets = targets;
    this.anchorIndex = Math.min(
      Math.max(0, anchorIndex),
      Math.max(0, targets.length - 1),
    );
    // CodeMirror reports its own geometry changes, but a sidebar or fixed
    // outline can resize the host without changing the document viewport.
    if (typeof ResizeObserver !== "undefined") {
      this.hostObserver = new ResizeObserver(() => {
        if (this.valid) this.notifyGeometry();
      });
      this.hostObserver.observe(view.dom);
    }
  }

  get kind() {
    return this.targets[0]?.kind ?? "link";
  }

  get isNew() {
    return this.targets.every((target) => target.isNew);
  }

  get fields(): readonly LinkImageFieldValues[] {
    return this.targets.map((target) => ({
      text: target.text,
      url: target.url,
    }));
  }

  get initialText() {
    return this.targets[0]?.text ?? "";
  }

  get initialUrl() {
    return this.targets[0]?.url ?? "";
  }

  get preserveEditorFocus() {
    return this.targets[0]?.preserveEditorFocus ?? false;
  }

  get canRemove() {
    const target = this.targets[0];
    return (
      this.targets.length === 1 &&
      target !== undefined &&
      !target.isNew &&
      target.kind === "link"
    );
  }

  get valid() {
    return this.stillValid && !this.disposed;
  }

  anchor(): PopoverAnchor | null {
    if (!this.valid || !this.view.dom.isConnected) return null;
    const target = this.targets[this.anchorIndex];
    if (target === undefined) return null;
    const from = this.view.coordsAtPos(target.from, 1);
    const to =
      this.view.coordsAtPos(Math.max(target.from, target.to - 1), -1) ??
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

  hostBounds(): PopoverBounds | null {
    if (!this.valid || !this.view.dom.isConnected) return null;
    const rect = this.view.dom.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    }
    // Layout-less DOMs (jsdom) report zero for every element. Their window
    // still provides a viewport, while a hidden host in a real layout does
    // not; gating on the document's zero layout keeps hidden editors hidden.
    const document = this.view.dom.ownerDocument;
    const window = document.defaultView;
    if (
      document.documentElement.clientWidth === 0 &&
      document.documentElement.clientHeight === 0 &&
      window !== null &&
      window.innerWidth > 0 &&
      window.innerHeight > 0
    ) {
      return {
        left: 0,
        right: window.innerWidth,
        top: 0,
        bottom: window.innerHeight,
      };
    }
    return null;
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyGeometry() {
    for (const listener of [...this.listeners]) listener();
  }

  private overlaps(target: SessionTarget, from: number, to: number): boolean {
    if (target.from === target.to) {
      return from <= target.from && target.from <= to;
    }
    return from < target.to && to > target.from;
  }

  update(update: ViewUpdate) {
    if (!this.valid) return;
    if (update.docChanged) {
      let touched = false;
      update.changes.iterChangedRanges((from, to) => {
        if (this.targets.some((target) => this.overlaps(target, from, to))) {
          touched = true;
        }
      });
      if (touched) {
        this.invalidate();
        return;
      }
      const changes = update.changes;
      // Edits exactly at a boundary are outside the target: an insertion at
      // the start stays before it and an insertion at the end stays after it.
      this.targets = this.targets.map((target) => ({
        ...target,
        from: changes.mapPos(target.from, 1),
        to: changes.mapPos(target.to, -1),
        textFrom: changes.mapPos(target.textFrom, 1),
        textTo: changes.mapPos(target.textTo, -1),
        urlFrom: changes.mapPos(target.urlFrom, 1),
        urlTo: changes.mapPos(target.urlTo, -1),
      }));
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
    this.hostObserver?.disconnect();
    this.hostObserver = null;
  }

  private invalidate() {
    if (!this.valid) return;
    this.finish();
    this.onInvalidate(this);
  }

  complete(values: readonly LinkImageFieldValues[]): boolean {
    if (!this.valid || values.length !== this.targets.length) return false;
    const state = this.view.state;
    const changes: { from: number; to: number; insert: string }[] = [];
    this.targets.forEach((target, index) => {
      const value = values[index]!;
      if (target.isNew) {
        const destination = destinationForTarget(target, value.url);
        const replacement =
          target.leading +
          `[${value.text}](${destination})` +
          target.trailing;
        if (state.sliceDoc(target.from, target.to) !== replacement) {
          changes.push({
            from: target.from,
            to: target.to,
            insert: replacement,
          });
        }
        return;
      }
      if (value.text !== target.text) {
        changes.push({
          from: target.textFrom,
          to: target.textTo,
          insert: value.text,
        });
      }
      if (value.url !== target.url) {
        const url = destinationForTarget(target, value.url);
        if (url !== target.url) {
          changes.push({
            from: target.urlFrom,
            to: target.urlTo,
            insert: url,
          });
        }
      }
    });
    this.finish();
    if (changes.length === 0) return true;

    changes.sort((left, right) => left.from - right.from || left.to - right.to);
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
    const target = this.targets[0]!;
    const state = this.view.state;
    const text = state.sliceDoc(target.textFrom, target.textTo);
    this.finish();
    this.view.dispatch({
      changes: {
        from: target.from,
        to: target.to,
        insert: text,
      },
      selection: { anchor: target.from + text.length },
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
  target: InlineTarget | NewLinkDraft | readonly NewLinkDraft[],
  preserveEditorFocus: boolean,
  onInvalidate: (session: LinkImageEditorSession) => void,
): LinkImageEditorSession {
  return new EditorLinkImageSession(
    view,
    sessionTargets(target, preserveEditorFocus),
    isDraftArray(target) ? view.state.selection.mainIndex : 0,
    onInvalidate,
  );
}
