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

export interface CreateEditorOptions {
  parent: HTMLElement;
  doc: string;
  mode?: EditorMode;
  /** App-level commands. Core editing commands such as bold are always available. */
  commands?: readonly EditorCommand[];
  resolveImage?: ImageResolver;
  onChange?: (doc: string) => void;
}

export interface EditorHandle {
  readonly view: EditorView;
  readonly mode: EditorMode;
  setMode(mode: EditorMode): void;
  focus(): void;
  destroy(): void;
}
