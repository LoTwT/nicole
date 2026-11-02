import {
  SingleFileService,
  type SingleFile,
  type SingleFileSelection,
} from "./mygo";

export type { SingleFile, SingleFileSelection };

/** Shows a native Markdown picker and grants the chosen file. */
export function chooseSingleFile(): Promise<SingleFileSelection> {
  return SingleFileService.chooseSingleFile();
}

/** Grants a file the system opened with Nicole after the user confirms it. */
export function acceptSingleFile(path: string): Promise<SingleFile> {
  return SingleFileService.acceptSingleFile(path);
}

/** Reads a granted single file byte for byte. */
export function readSingleFile(path: string): Promise<string> {
  return SingleFileService.readSingleFile(path);
}

/** Replaces a granted single file atomically. */
export function writeSingleFile(path: string, content: string): Promise<void> {
  return SingleFileService.writeSingleFile(path, content);
}

/** Forgets a single-file grant, for example when its tab closes. */
export function releaseSingleFile(path: string): Promise<void> {
  return SingleFileService.releaseSingleFile(path);
}
