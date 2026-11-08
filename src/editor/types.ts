import type { EditorView } from "@codemirror/view";

import type { AppPlatform } from "../app/platform";
import type { CommandDefinition } from "../commands/types";

export type EditorMode = "live" | "immersive" | "source";

/** JSON form of EditorSelection, kept here so callers need no CodeMirror type. */
export interface SavedSelection {
  ranges: readonly { anchor: number; head?: number }[];
  main: number;
}

/**
 * Everything a background tab keeps besides its text. Selection and history
 * are CodeMirror's JSON forms; the scroll position is the top visible line and
 * the signed pixel offset inside that line. The offset is measured from the
 * line's top, so the document's top padding makes it negative for the first
 * lines at the top of the document.
 */
export interface EditorRestoreState {
  selection: SavedSelection | null;
  history: unknown;
  scrollTopLine: number | null;
  scrollTopOffset: number | null;
}

/** Resolves a Markdown image URL for rendering; return null to keep the source visible. */
export type ImageResolver = (src: string) => string | null;

/**
 * A position that the editor keeps mapped while the document changes. Obtain
 * one from createInsertionTicket or onPasteImage and pass it to insertImages.
 */
export interface InsertionTicket {
  readonly id: number;
}

/**
 * Called when an image is on the clipboard and the editor is about to paste
 * it. The ticket tracks the insertion position until insertImages is called.
 */
export type PasteImageHandler = (ticket: InsertionTicket) => void;

export interface CreateEditorOptions {
  parent: HTMLElement;
  doc: string;
  mode?: EditorMode;
  platform?: AppPlatform;
  /**
   * Additional commands for this editor. The shared command registry is
   * always included, so editor commands only need to be defined there.
   */
  commands?: readonly CommandDefinition[];
  /** Restores a background tab's selection, scroll position and undo history. */
  restore?: EditorRestoreState;
  resolveImage?: ImageResolver;
  onPasteImage?: PasteImageHandler;
  onChange?: (doc: string) => void;
  /**
   * Called when an IME composition ends, including a cancellation that
   * leaves no document change. Not called when the view is destroyed during
   * the composition; work deferred during a composition must also treat the
   * view going away or losing focus as its end.
   */
  onCompositionEnd?: () => void;
}

export interface EditorHandle {
  readonly view: EditorView;
  readonly mode: EditorMode;
  setMode(mode: EditorMode): void;
  /**
   * Applies text loaded from disk as one change. The selection maps through
   * the change, and the visible top line stays at the top when it survives.
   */
  replaceDocument(text: string): void;
  /** Applies the editor's history unless an IME composition is active. */
  undo(): boolean;
  /** Applies the editor's history unless an IME composition is active. */
  redo(): boolean;
  /**
   * Reports whether the viewport point is inside the editor. Native drops
   * carry coordinates; this keeps a drop outside the editor from becoming an
   * insertion at a clamped document position.
   */
  containsPoint(x: number, y: number): boolean;
  /**
   * Creates a ticket at the document position under the given viewport
   * coordinates. Returns null when the point is outside the editor.
   */
  createInsertionTicket(x: number, y: number): InsertionTicket | null;
  /**
   * Inserts Markdown snippets at the ticket's current position as one undo
   * step. During an IME composition the insertion waits, so it cannot
   * interrupt the candidate window. An empty list releases the ticket.
   */
  insertImages(ticket: InsertionTicket, markdown: readonly string[]): void;
  /**
   * Captures what a background tab keeps: selection, top visible line with
   * its pixel offset, and the serialized undo history.
   */
  getRestoreState(): EditorRestoreState;
  focus(): void;
  destroy(): void;
}
