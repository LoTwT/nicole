import type { EditorView } from "@codemirror/view";

export type EditorMode = "live" | "immersive" | "source";

export interface EditorCommand {
  /** Stable identifier shared by menus, keymaps and the command palette. */
  id: string;
  label: string;
  /** CodeMirror key binding, for example `Mod-b`. */
  key?: string;
  run: (view: EditorView) => boolean;
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
  /** App-level commands. Core editing commands such as bold are always available. */
  commands?: readonly EditorCommand[];
  resolveImage?: ImageResolver;
  onPasteImage?: PasteImageHandler;
  onChange?: (doc: string) => void;
}

export interface EditorHandle {
  readonly view: EditorView;
  readonly mode: EditorMode;
  setMode(mode: EditorMode): void;
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
  focus(): void;
  destroy(): void;
}
