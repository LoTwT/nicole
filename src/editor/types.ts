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
 * Called when an image is on the clipboard and the editor is about to paste
 * it. `at` is the document position to insert at; the caller saves the image
 * and calls insertImages. Returning nothing prevents the default paste.
 */
export type PasteImageHandler = (at: number) => void;

/**
 * Called when files are dropped inside the editor. `at` is the drop position;
 * the caller saves the images and calls insertImages. The DOM gives no local
 * paths, so the app receives them from MyGo's window file-drop event.
 */
export type DropFilesHandler = (at: number) => void;

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
   * Inserts Markdown snippets at `at` as one undo step. During an IME
   * composition the insertion waits, so it cannot interrupt the candidate
   * window.
   */
  insertImages(at: number, markdown: readonly string[]): void;
  focus(): void;
  destroy(): void;
}
