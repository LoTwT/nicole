import { onFileDrop } from "mygo-runtime";

import { Assets, type SavedImage } from "./mygo";

export type { SavedImage };

/** Saves the system clipboard image below the workspace's assets folder. */
export function pasteImage(
  docPath: string,
  generation: number,
): Promise<SavedImage> {
  return Assets.pasteImage(docPath, generation);
}

/** Copies dropped image files into the workspace's assets folder. */
export function importImages(
  docPath: string,
  generation: number,
  sources: string[],
): Promise<SavedImage[]> {
  return Assets.importImages(docPath, generation, sources);
}

/**
 * Subscribes to files dropped on the window with their local paths. DOM drop
 * events carry no paths, so the editor only reports the position and this
 * event supplies the files. Returns a no-op outside a MyGo window, where
 * there is no drop bridge.
 */
export function onWindowFileDrop(
  handler: (paths: string[]) => void,
): () => void {
  try {
    return onFileDrop((drop) => handler(drop.paths));
  } catch {
    return () => {};
  }
}
