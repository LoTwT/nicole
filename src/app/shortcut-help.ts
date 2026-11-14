/**
 * Escape is not a registered application command: the window handler and the
 * open overlays each compare the browser event key directly. Keeping the
 * handler key and its read-only settings help entry together avoids a second
 * shortcut table.
 */
export const ESCAPE_HELP = {
  eventKey: "Escape",
  displayKey: "Esc",
  label: "关闭最上层浮层",
} as const;
