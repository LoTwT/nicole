/**
 * Splits recent folders into centered rows. CSS flex-wrap can center each
 * visual line, but cannot redistribute a trailing 1 item back into earlier
 * lines, so the caller measures pill widths and supplies explicit rows.
 */
export function layoutRecentRows<T>(
  items: readonly T[],
  widths: readonly number[],
  availableWidth: number,
  gap: number,
): T[][] {
  if (items.length === 0) {
    return [];
  }
  const usable = Math.max(0, availableWidth);
  // Use the widest possible combination so every row is guaranteed to fit,
  // not just the first row in recent-order.
  const widestFirst = [...widths].sort((a, b) => b - a);
  let maxPerRow = 0;
  let occupied = -gap;
  for (const width of widestFirst) {
    if (occupied + gap + width > usable) {
      break;
    }
    occupied += gap + width;
    maxPerRow += 1;
  }
  const perRowLimit = Math.max(1, maxPerRow);
  const rowCount = Math.ceil(items.length / perRowLimit);
  const perRow = Math.ceil(items.length / rowCount);
  return Array.from({ length: rowCount }, (_, index) =>
    items.slice(index * perRow, (index + 1) * perRow),
  );
}
