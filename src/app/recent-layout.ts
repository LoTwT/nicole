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
  // Try one visual line, then two, and so on. For each row count, every
  // balanced allocation (row sizes differ by at most one) is tried, starting
  // with the front-loaded one (3+2 before 2+3). A row count is only abandoned
  // after all of its balanced allocations fail, so the next line is not used
  // merely because the first slice left a single item on it.
  for (let rowCount = 1; rowCount <= measured.length; rowCount++) {
    for (const counts of balancedRowCounts(measured.length, rowCount)) {
      const rows: (typeof measured)[] = [];
      let start = 0;
      for (const count of counts) {
        rows.push(measured.slice(start, start + count));
        start += count;
      }
      if (start !== measured.length) {
        continue;
      }
      const fits = rows.every((row) => {
        const occupied = row.reduce((sum, entry) => sum + entry.width, 0);
        return occupied + Math.max(0, row.length - 1) * gapSize <= usable;
      });
      if (fits) {
        return rows.map((row) => row.map((entry) => entry.item));
      }
    }
  }
  return measured.map((entry) => [entry.item]);
}

/**
 * Returns every way to distribute `total` items over `rowCount` rows so that
 * no two rows differ by more than one. Allocations are ordered front-loaded
 * first: rows that get the extra item come as early as possible.
 */
function balancedRowCounts(total: number, rowCount: number): number[][] {
  const base = Math.floor(total / rowCount);
  const extra = total % rowCount;
  const counts = Array.from({ length: rowCount }, () => base);
  const allocations: number[][] = [];
  const positions: number[] = [];

  function choose(start: number, remaining: number) {
    if (remaining === 0) {
      allocations.push(
        counts.map((count, index) =>
          positions.includes(index) ? count + 1 : count,
        ),
      );
      return;
    }
    for (let index = start; index <= rowCount - remaining; index++) {
      positions.push(index);
      choose(index + 1, remaining - 1);
      positions.pop();
    }
  }

  choose(0, extra);
  return allocations;
}
