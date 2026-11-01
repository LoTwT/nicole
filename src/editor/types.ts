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

/**
 * Called after the editor intercepted files dropped inside it. The paths and
 * the one-time token arrive through the MyGo file-drop event; the event's
 * coordinates create the insertion ticket through createInsertionTicket.
 */
export type DropFilesHandler = () => void;

export interface CreateEditorOptions {
  parent: HTMLElement;
  doc: string;
  mode?: EditorMode;
  /** App-level commands. Core editing commands such as bold are always available. */
  commands?: readonly EditorCommand[];
  resolveImage?: ImageResolver;
  onPasteImage?: PasteImageHandler;
  onDropFiles?: DropFilesHandler;
  onChange?: (doc: string) => void;
}

export interface EditorHandle {
  readonly view: EditorView;
  readonly mode: EditorMode;
  setMode(mode: EditorMode): void;
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
