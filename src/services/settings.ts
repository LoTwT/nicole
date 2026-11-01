import { Settings, type AppSettings } from "./mygo";

export type { AppSettings };

export type ThemeSetting = "system" | "light" | "dark";

/** Reads the global settings; defaults are "system", 252 px and no recent folders. */
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

/** Puts a folder first in the recent folders, keeping at most ten. */
export function addRecentFolder(folder: string): Promise<void> {
  return Settings.addRecentFolder(folder);
}

/** Removes a folder from the recent folders. */
export function removeRecentFolder(folder: string): Promise<void> {
  return Settings.removeRecentFolder(folder);
}
