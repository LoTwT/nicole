import {
  Recovery,
  type RecoveryCopy,
  type RecoveryItem,
  type RecoveryListing,
} from "./mygo";

export type { RecoveryCopy, RecoveryItem, RecoveryListing };

/**
 * Writes or replaces the copy of one dirty document. Go records the disk hash
 * and returns the copy id. Workspace copies are refused after a folder switch;
 * single-file copies require a current grant.
 */
export function saveRecovery(
  copy: RecoveryCopy,
  generation: number,
): Promise<string> {
  return Recovery.save(copy, generation);
}

/** Removes one copy by id, such as after its document is saved or closed. */
export function deleteRecovery(id: string, generation: number): Promise<void> {
  return Recovery.delete(id, generation);
}

/** Removes exactly the copies the user chose to throw away. */
export function discardRecovery(
  ids: string[],
  generation: number,
): Promise<void> {
  return Recovery.discard(ids, generation);
}

/** Lists the current root's and single-file copies with their disk states. */
export function listRecovery(generation: number): Promise<RecoveryListing> {
  return Recovery.list(generation);
}

/**
 * Re-checks a single-file copy and grants its exact path again. This is the
 * only path authorization that survives a restart.
 */
export function restoreRecoverySingleFile(id: string) {
  return Recovery.restoreSingleFile(id);
}
