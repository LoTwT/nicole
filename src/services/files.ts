import { Workspace, type DirectoryListing } from "./mygo";

export type { DirectoryListing };

/** Reads one level of the workspace tree. */
export function listDirectory(path: string): Promise<DirectoryListing> {
  return Workspace.listDirectory(path);
}

/**
 * Creates an empty Markdown file in dir and returns its slash-separated
 * relative path. A name without an extension gets ".md".
 */
export function createFile(
  dir: string,
  name: string,
  generation: number,
): Promise<string> {
  return Workspace.createFile(dir, name, generation);
}

/** Creates a folder in dir and returns its relative path. */
export function createFolder(
  dir: string,
  name: string,
  generation: number,
): Promise<string> {
  return Workspace.createFolder(dir, name, generation);
}

/** Renames a file or folder and returns the new relative path. */
export function renameEntry(
  path: string,
  name: string,
  generation: number,
): Promise<string> {
  return Workspace.renameEntry(path, name, generation);
}

/** Moves a file or folder to the platform's trash. */
export function trashEntry(path: string, generation: number): Promise<void> {
  return Workspace.trashEntry(path, generation);
}

/** Opens a file with the desktop's default application. */
export function openWithDefaultApp(
  path: string,
  generation: number,
): Promise<void> {
  return Workspace.openWithDefaultApp(path, generation);
}

/** Reveals a file or folder in Finder, Explorer or the desktop's file manager. */
export function revealEntry(path: string, generation: number): Promise<void> {
  return Workspace.revealEntry(path, generation);
}
