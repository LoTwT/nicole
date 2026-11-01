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

/** Runs a handler when Go asks the page to save before the window closes. */
export function onSaveBeforeClose(handler: () => Promise<void>): () => void {
  return events.workspaceSaveBeforeClose.on(() => {
    void handler();
  });
}

/** Tells Go that the page finished its pre-close save. */
export function finishClose(saved: boolean): Promise<void> {
  return Workspace.finishClose(saved);
}
