import { Settings, type AppSettings } from "./mygo";

export type { AppSettings };

export type ThemeSetting = "system" | "light" | "dark";
export type EditorModeSetting = "live" | "immersive" | "source";

/** Reads the global settings; defaults are "system", "live", 252 px and no recent folders. */
export function getSettings(): Promise<AppSettings> {
  return Settings.get();
}

/**
 * Moves the theme saved in localStorage before settings existed into the
 * settings file. Callers remove the legacy value after this succeeds.
 */
export function migrateLegacyTheme(legacy: string): Promise<AppSettings> {
  return Settings.migrateLegacyTheme(legacy);
}

/** Saves the theme and makes native menus and dialogs follow it. */
export function setTheme(theme: ThemeSetting): Promise<void> {
  return Settings.setTheme(theme);
}

/** Saves the global editor mode; Go rejects unknown values. */
export function setEditorMode(mode: EditorModeSetting): Promise<void> {
  return Settings.setEditorMode(mode);
}

/** Remembers whether the wide-layout outline is open. */
export function setOutlineVisible(visible: boolean): Promise<void> {
  return Settings.setOutlineVisible(visible);
}

/** Remembers the global fixed formatting toolbar switch. */
export function setFormatToolbarVisible(visible: boolean): Promise<void> {
  return Settings.setFormatToolbarVisible(visible);
}

/** Saves the interface, reading and code font names; empty keeps the defaults. */
export function setFonts(
  uiFont: string,
  readingFont: string,
  codeFont: string,
): Promise<void> {
  return Settings.setFonts(uiFont, readingFont, codeFont);
}

/** Remembers whether the file tree includes non-Markdown files. */
export function setShowAllFiles(visible: boolean): Promise<void> {
  return Settings.setShowAllFiles(visible);
}

/** Remembers the tree and tab label .md suffix preference. */
export function setHideMarkdownExtension(hidden: boolean): Promise<void> {
  return Settings.setHideMarkdownExtension(hidden);
}

/** Switches the slash menu for one editor mode. */
export function setSlashEnabled(
  mode: EditorModeSetting,
  enabled: boolean,
): Promise<void> {
  return Settings.setSlashEnabled(mode, enabled);
}

/** Saves the sidebar width; Go clamps it to 200–400 px. */
export function setSidebarWidth(width: number): Promise<void> {
  return Settings.setSidebarWidth(width);
}

/** Saves which folders are expanded under a workspace root. */
export function setExpandedFolders(
  root: string,
  folders: string[],
): Promise<void> {
  return Settings.setExpandedFolders(root, folders);
}

/**
 * Re-adds the current workspace root to the recent list. Go rejects any
 * other folder, so the page cannot use this call to authorize a new root.
 */
export function addRecentFolder(folder: string): Promise<void> {
  return Settings.addRecentFolder(folder);
}

/** Removes a folder from the recent folders. */
export function removeRecentFolder(folder: string): Promise<void> {
  return Settings.removeRecentFolder(folder);
}
