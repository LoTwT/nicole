/** Shows the home folder as ~ and leaves other absolute paths alone. */
export function displayPath(path: string, homeDir: string): string {
  if (homeDir === "") {
    return path;
  }
  const normalizedHome = homeDir.replace(/[\\/]+$/, "");
  if (path === normalizedHome) {
    return "~";
  }
  const prefix = `${normalizedHome}/`;
  if (path.startsWith(prefix)) {
    return `~/${path.slice(prefix.length)}`;
  }
  return path;
}

export function absoluteBaseName(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const index = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return index === -1 ? clean : clean.slice(index + 1);
}

export function absoluteParent(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const index = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (index <= 0) {
    return clean.startsWith("/") ? "/" : clean;
  }
  return clean.slice(0, index);
}

/** Whether an absolute file path is inside a workspace root. */
export function isInFolder(root: string, path: string): boolean {
  if (root === "") {
    return false;
  }
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  if (path === normalizedRoot) {
    return true;
  }
  return path.startsWith(`${normalizedRoot}/`) || path.startsWith(`${normalizedRoot}\\`);
}

/** Converts a workspace-root child to a slash-separated relative path. */
export function relativePath(root: string, path: string): string {
  if (!isInFolder(root, path)) {
    return path;
  }
  return path
    .slice(root.replace(/[\\/]+$/, "").length)
    .replace(/^[\\/]+/, "")
    .replace(/\\/g, "/");
}
