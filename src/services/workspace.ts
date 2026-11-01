import { Workspace, events, type WorkspaceFolder } from "./mygo";

export type { WorkspaceFolder };

/** Opens the native folder picker and switches the folder in Go. */
export function chooseFolder(): Promise<WorkspaceFolder> {
  return Workspace.chooseFolder();
}

/** Lists the Markdown files of the open folder, as slash-separated relative paths. */
export function listFiles(): Promise<string[]> {
  return Workspace.listFiles();
}

/** Reads a file of the open folder byte for byte. */
export function readFile(path: string): Promise<string> {
  return Workspace.readFile(path);
}

/** Replaces a file of the open folder atomically. */
export function writeFile(
  path: string,
  content: string,
  generation: number,
): Promise<void> {
  return Workspace.writeFile(path, content, generation);
}

/** Runs a handler with the close token when Go asks the page to save before closing. */
export function onSaveBeforeClose(
  handler: (token: number) => Promise<void>,
): () => void {
  return events.workspaceSaveBeforeClose.on((token) => {
    void handler(token);
  });
}

/** Asks whether unsaved edits may be discarded before switching files. */
export function confirmDiscard(): Promise<boolean> {
  return Workspace.confirmDiscard();
}

/** Tells Go that the page finished its pre-close save for one close attempt. */
export function finishClose(token: number, saved: boolean): Promise<void> {
  return Workspace.finishClose(token, saved);
}
