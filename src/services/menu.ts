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
