import type { EditorHandle, InsertionTicket } from "./editor";
import { importImages, pasteImage } from "./services/assets";

export interface ImageDrop {
  token: string;
  x: number;
  y: number;
}

export interface ImageInsertionOptions {
  getEditor(): EditorHandle | null;
  getFile(): string | null;
  getGeneration(): number;
  onError?(): void;
}

export interface ImageInsertion {
  /** Handles an image paste ticket created by the editor. */
  handlePaste(ticket: InsertionTicket): void;
  /** Imports a native drop after Go supplied its one-time token. */
  handleDrop(drop: ImageDrop): void;
}

/**
 * Connects editor image events to the Go asset service. Image data and
 * trusted paths stay in Go; this module only passes the document, generation
 * and a drop token, then inserts the returned Markdown if the editor and file
 * are still the ones that started the request.
 */
export function createImageInsertion(
  options: ImageInsertionOptions,
): ImageInsertion {
  const { getEditor, getFile, getGeneration, onError } = options;

  const release = (editor: EditorHandle, ticket: InsertionTicket) => {
    editor.insertImages(ticket, []);
  };

  return {
    handlePaste(ticket) {
      const editor = getEditor();
      const path = getFile();
      if (!editor) {
        return;
      }
      if (path === null) {
        release(editor, ticket);
        return;
      }
      const generation = getGeneration();
      void pasteImage(path, generation).then(
        (images) => {
          if (editor !== getEditor()) return;
          if (path !== getFile() || generation !== getGeneration()) {
            release(editor, ticket);
            return;
          }
          editor.insertImages(
            ticket,
            images.map((image) => image.markdown),
          );
        },
        () => {
          if (editor === getEditor() && path === getFile()) {
            release(editor, ticket);
            onError?.();
          }
        },
      );
    },

    handleDrop(drop) {
      const editor = getEditor();
      if (!editor || !editor.containsPoint(drop.x, drop.y)) {
        return;
      }
      const ticket = editor.createInsertionTicket(drop.x, drop.y);
      if (!ticket) {
        return;
      }
      const path = getFile();
      if (path === null) {
        release(editor, ticket);
        return;
      }
      const generation = getGeneration();
      void importImages(path, generation, drop.token).then(
        (images) => {
          if (editor !== getEditor()) return;
          if (path !== getFile() || generation !== getGeneration()) {
            release(editor, ticket);
            return;
          }
          editor.insertImages(
            ticket,
            images.map((image) => image.markdown),
          );
        },
        () => {
          if (editor === getEditor() && path === getFile()) {
            release(editor, ticket);
            onError?.();
          }
        },
      );
    },
  };
}
