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
export function acceptSingleFile(
  path: string,
  offerId: string,
): Promise<SingleFile> {
  return SingleFileService.acceptSingleFile(path, offerId);
}

/** Forgets a system-opened file the user chose not to open. */
export function dismissOfferedFile(
  path: string,
  offerId: string,
): Promise<void> {
  return SingleFileService.dismissOfferedFile(path, offerId);
}

/** Reads a granted single file byte for byte. */
export function readSingleFile(path: string): Promise<string> {
  return SingleFileService.readSingleFile(path);
}

/** Replaces a granted single file atomically. */
export function writeSingleFile(path: string, content: string): Promise<void> {
  return SingleFileService.writeSingleFile(path, content);
}

/** Reveals a granted single file in Finder, Explorer or the file manager. */
export function revealSingleFile(path: string): Promise<void> {
  return SingleFileService.revealSingleFile(path);
}

/** Forgets a single-file grant, for example when its tab closes. */
export function releaseSingleFile(path: string): Promise<void> {
  return SingleFileService.releaseSingleFile(path);
}
