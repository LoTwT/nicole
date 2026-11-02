import type { WorkspaceFileEvent } from "../services/mygo";

export type DocumentWatchResult = "none" | "modified" | "deleted";

export interface WatchClassification {
  document: DocumentWatchResult;
  /** Folders whose loaded listing should be refreshed. */
  refreshPaths: string[];
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

function contains(folder: string, path: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Relates a batch of workspace events to the open workspace document.
 *
 * Image insertion writes a new file through the assets service; Go reports it
 * as a `create` event, which must refresh the tree without pretending the open
 * Markdown document was edited outside Nicole.
 */
export function classifyWatchEvents(
  events: readonly WorkspaceFileEvent[],
  currentPath: string | null,
  isWorkspaceDocument: boolean,
): WatchClassification {
  const refresh = new Set<string>();
  let document: DocumentWatchResult = "none";

  for (const event of events) {
    if (event.op === "hint" || !event.path) {
      continue;
    }
    refresh.add(parentOf(event.path));
    if (event.oldPath) {
      refresh.add(parentOf(event.oldPath));
    }

    if (!isWorkspaceDocument || currentPath === null) {
      continue;
    }

    if (event.isDir) {
      const removedFolder =
        event.op === "remove" ||
        (event.op === "rename" &&
          typeof event.oldPath === "string" &&
          event.oldPath !== event.path);
      if (
        removedFolder &&
        (contains(event.path, currentPath) ||
          (event.oldPath !== undefined && contains(event.oldPath, currentPath)))
      ) {
        document = "deleted";
      }
      continue;
    }

    if (event.op === "remove" && event.path === currentPath) {
      document = "deleted";
      continue;
    }
    if (event.op === "rename") {
      if (event.oldPath === currentPath && event.path !== currentPath) {
        document = "deleted";
        continue;
      }
      if (event.path === currentPath) {
        document = "modified";
        continue;
      }
    }
    if (
      (event.op === "create" || event.op === "write") &&
      event.path === currentPath
    ) {
      document = "modified";
    }
  }

  return {
    document,
    refreshPaths: [...refresh].filter((path) => path !== ""),
  };
}
