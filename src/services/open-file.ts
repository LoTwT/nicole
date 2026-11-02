import { OpenedFiles, events } from "./mygo";

/** Runs a handler when the system opened one or more files. */
export function onOpenFile(handler: () => void): () => void {
  return events.appOpenFile.on(() => handler());
}

/** Takes files that arrived before the page subscribed, such as the launch file. */
export function takePendingOpenedFiles(): Promise<string[]> {
  return OpenedFiles.takePendingOpenedFiles();
}
