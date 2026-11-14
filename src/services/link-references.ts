import { Workspace } from "./mygo";
import type { ReferenceDocument } from "../app/link-references";

export interface ReferenceRenameRequest {
  source: string;
  name: string;
  generation: number;
  documents: ReferenceDocument[];
  updates: ReferenceDocument[];
}

export function readReferenceSnapshot(
  generation: number,
): Promise<{ files: ReferenceDocument[] }> {
  return Workspace.readReferenceSnapshot(generation);
}

export function renameEntryWithReferences(
  request: ReferenceRenameRequest,
): Promise<{ path: string; updatedFiles: string[] }> {
  return Workspace.renameEntryWithReferences(request);
}
