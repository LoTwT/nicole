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
  const gapSize = Math.max(0, gap);
  const measured = items.map((item, index) => ({
    item,
    width: Math.max(0, widths[index] ?? 0),
  }));
  // Try one visual line, then two, and so on. The first row count whose
  // actual slices fit wins; this avoids both the widest-item overestimate and
  // a trailing 1 when the real widths can make 3+2.
  for (let rowCount = 1; rowCount <= measured.length; rowCount++) {
    const perRow = Math.ceil(measured.length / rowCount);
    const rows: (typeof measured)[] = [];
    for (let start = 0; start < measured.length; start += perRow) {
      rows.push(measured.slice(start, start + perRow));
    }
    const fits = rows.every((row) => {
      const occupied = row.reduce((sum, entry) => sum + entry.width, 0);
      return occupied + Math.max(0, row.length - 1) * gapSize <= usable;
    });
    if (fits) {
      return rows.map((row) => row.map((entry) => entry.item));
    }
  }
  return measured.map((entry) => [entry.item]);
}
