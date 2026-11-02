import type { FileEntry } from "../services/mygo";

export interface TreeNode extends FileEntry {
  children: TreeNode[] | null;
  expanded: boolean;
  loading: boolean;
}

/** Inline editor state for creating or renaming an entry. */
export interface TreeEditState {
  kind: "create-file" | "create-folder" | "rename";
  /** Folder that receives a new entry, or the entry being renamed. */
  target: string;
  value: string;
}

/** The selected text in the inline editor; renames keep the suffix. */
export function editSelectionRange(edit: TreeEditState): [number, number] {
  if (edit.kind === "create-folder") {
    return [0, edit.value.length];
  }
  const dot = edit.value.lastIndexOf(".");
  return dot > 0 ? [0, dot] : [0, edit.value.length];
}

const collator = new Intl.Collator("zh-Hans-CN", { numeric: true });

/** Sorts folders before files and applies the interface's natural ordering. */
export function sortEntries(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort((left, right) => {
    if (left.isDir !== right.isDir) {
      return left.isDir ? -1 : 1;
    }
    return collator.compare(left.name, right.name);
  });
}

export function toTreeNodes(
  entries: readonly FileEntry[],
  expandedPaths: ReadonlySet<string>,
): TreeNode[] {
  return sortEntries(entries).map((entry) => ({
    ...entry,
    children: null,
    expanded: entry.isDir && expandedPaths.has(entry.path),
    loading: false,
  }));
}

/** Returns the folder that contains a slash-separated workspace path. */
export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

/** Returns the last component of a slash-separated workspace path. */
export function baseName(path: string): string {
  if (path === ".") {
    return "";
  }
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

/** Returns the path with its .md suffix removed, leaving folders alone. */
export function displayName(entry: Pick<FileEntry, "name" | "isDir">): string {
  if (entry.isDir) {
    return entry.name;
  }
  return entry.name.replace(/\.md$/i, "");
}

/** True when path is the same as, or inside, folder. */
export function isInside(folder: string, path: string): boolean {
  if (path === folder) {
    return true;
  }
  return path.startsWith(`${folder}/`);
}

/** The visible nodes in the order the tree keyboard walks them. */
export function flattenVisible(nodes: readonly TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list) {
      result.push(node);
      if (node.isDir && node.expanded && node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return result;
}

/** All folder paths currently expanded, for the settings store. */
export function expandedPaths(nodes: readonly TreeNode[]): string[] {
  const result: string[] = [];
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list) {
      if (!node.isDir || !node.expanded) {
        continue;
      }
      result.push(node.path);
      if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return result.sort();
}

/**
 * Updates one loaded folder's entries while keeping the existing node objects
 * for unchanged entries, so expansion and focus survive a watch refresh.
 */
export function mergeChildren(
  current: readonly TreeNode[],
  entries: readonly FileEntry[],
  expandedSet: ReadonlySet<string>,
): TreeNode[] {
  const byPath = new Map(current.map((node) => [node.path, node]));
  return sortEntries(entries).map((entry) => {
    const existing = byPath.get(entry.path);
    if (existing && existing.isDir === entry.isDir) {
      existing.name = entry.name;
      existing.size = entry.size;
      existing.isMarkdown = entry.isMarkdown;
      return existing;
    }
    return {
      ...entry,
      children: null,
      expanded: entry.isDir && expandedSet.has(entry.path),
      loading: false,
    };
  });
}

export function findNode(
  nodes: readonly TreeNode[],
  path: string,
): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) {
        return found;
      }
    }
  }
  return null;
}
