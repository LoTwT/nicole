import { NativeMenu, type NativeMenuItem, type NativeMenuRequest } from "./mygo";

export type { NativeMenuItem, NativeMenuRequest };

/**
 * Shows a native context menu at (x, y) in CSS pixels from the page's top-left
 * corner. Resolves to the chosen item's ID, or "" when the menu is dismissed.
 */
export function popupNativeMenu(
  request: NativeMenuRequest,
): Promise<string> {
  return NativeMenu.popupNativeMenu(request);
}

/**
 * Copies the registry-formatted shortcut onto the native Settings item. Go
 * owns no key table; the page is the only source.
 */
export function setSettingsAccelerator(accelerator: string): Promise<void> {
  return NativeMenu.setSettingsAccelerator(accelerator);
}
