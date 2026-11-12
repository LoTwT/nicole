import {
  Workspace,
  events,
  type FolderPick,
  type WorkspaceFolder,
  type WorkspaceSnippet,
  type WorkspaceSnippets,
} from "./mygo";

export type { FolderPick, WorkspaceFolder, WorkspaceSnippet, WorkspaceSnippets };

/** Opens the native folder picker and switches the folder in Go. */
export function chooseFolder(): Promise<WorkspaceFolder> {
  return Workspace.chooseFolder();
}

/** Picks a folder without switching; the page confirms before opening it. */
export function pickFolder(): Promise<FolderPick> {
  return Workspace.pickFolder();
}

/** Opens the single folder of a native drop named by its one-time Go token. */
export function openDroppedFolder(token: string): Promise<WorkspaceFolder> {
  return Workspace.openDroppedFolder(token);
}

/** Closes the workspace and returns the app to the start page. */
export function closeWorkspace(): Promise<void> {
  return Workspace.closeWorkspace();
}

/**
 * Switches to a folder the user just picked, a recent folder, or the folder
 * of a system-provided file. Go refuses any other path.
 */
export function openFolder(path: string): Promise<WorkspaceFolder> {
  return Workspace.openFolder(path);
}

/** Lists the Markdown files of the open folder, as slash-separated relative paths. */
export function listFiles(): Promise<string[]> {
  return Workspace.listFiles();
}

/**
 * Reads the fixed `.nicole/snippets/` snapshot for the open root. Only the
 * generation is sent; Go chooses the folder and returns bounded templates.
 */
export function listSnippets(generation: number): Promise<WorkspaceSnippets> {
  return Workspace.listSnippets(generation);
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
