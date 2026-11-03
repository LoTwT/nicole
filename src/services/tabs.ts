import { WorkspaceTabs, type StoredTab, type StoredTabs } from "./mygo";

export type { StoredTab, StoredTabs };

/** Reads the remembered tab layout for the open workspace root. */
export function getWorkspaceTabs(root: string): Promise<StoredTabs> {
  return WorkspaceTabs.get(root);
}

/**
 * Replaces the remembered tab layout for the open workspace root. Go rejects
 * any root that is not the one currently open.
 */
export function saveWorkspaceTabs(
  root: string,
  tabs: StoredTab[],
  active: string,
): Promise<void> {
  return WorkspaceTabs.save(root, tabs, active);
}
