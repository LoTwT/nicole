import { OpenedFiles, events } from "./mygo";

/** Runs a handler with the absolute path of a file the system opened. */
export function onOpenFile(handler: (path: string) => void): () => void {
  return events.appOpenFile.on(handler);
}

/** Takes files that arrived before the page subscribed, such as the launch file. */
export function takePendingOpenedFiles(): Promise<string[]> {
  return OpenedFiles.takePendingOpenedFiles();
}
