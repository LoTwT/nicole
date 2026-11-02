import { Assets, events, type AssetDrop, type SavedImage } from "./mygo";

export type { AssetDrop, SavedImage };

/** Saves clipboard images below the workspace's assets folder. */
export function pasteImage(
  docPath: string,
  generation: number,
): Promise<SavedImage[]> {
  return Assets.pasteImage(docPath, generation);
}

/** Copies the images of a native drop selected by dropToken into assets/. */
export function importImages(
  docPath: string,
  generation: number,
  dropToken: string,
): Promise<SavedImage[]> {
  return Assets.importImages(docPath, generation, dropToken);
}

/**
 * Subscribes to native file drops. The event carries a one-time token and the
 * drop position; the paths stay in Go. Returns a no-op outside a MyGo window,
 * where there is no native drop bridge.
 */
export function onWindowFileDrop(
  handler: (drop: AssetDrop) => void,
): () => void {
  try {
    return events.assetsFileDrop.on(handler);
  } catch {
    return () => {};
  }
}
