import {
  OpenedFiles,
  events,
  type PendingOpenedFile,
} from "./mygo";

export type { PendingOpenedFile };

/** Runs a handler when the system opened one or more files. */
export function onOpenFile(handler: () => void): () => void {
  return events.appOpenFile.on(() => handler());
}

/** Takes files that arrived before the page subscribed, such as the launch file. */
export function takePendingOpenedFiles(): Promise<string[]> {
  return OpenedFiles.takePendingOpenedFiles();
}

/** Takes pending files together with the exact offer occurrence for cleanup. */
export function takePendingOpenedEntries(): Promise<PendingOpenedFile[]> {
  return OpenedFiles.takePendingOpenedFilesWithOffers();
}
