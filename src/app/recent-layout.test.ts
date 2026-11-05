import { describe, expect, it } from "vitest";

import { layoutRecentRows } from "./recent-layout";

const widths = [100, 100, 100, 100, 100];

describe("layoutRecentRows", () => {
  it("keeps one through five items on one row when they fit", () => {
    for (let count = 1; count <= 5; count++) {
      const rows = layoutRecentRows(
        Array.from({ length: count }, (_, index) => index),
        widths.slice(0, count),
        600,
        6,
      );
      expect(rows).toEqual([Array.from({ length: count }, (_, index) => index)]);
    }
  });

  it("balances a medium width into 2+2 or 3+2", () => {
    expect(
      layoutRecentRows([1, 2, 3, 4], widths.slice(0, 4), 320, 6).map(
        (row) => row.length,
      ),
    ).toEqual([2, 2]);
    expect(
      layoutRecentRows([1, 2, 3, 4, 5], widths, 320, 6).map(
        (row) => row.length,
      ),
    ).toEqual([3, 2]);
  });

  it("keeps a narrow layout in recent order", () => {
    expect(
      layoutRecentRows([1, 2, 3], widths.slice(0, 3), 220, 6).map(
        (row) => row.length,
      ),
    ).toEqual([2, 1]);
    expect(
      layoutRecentRows([1, 2, 3, 4], widths.slice(0, 4), 220, 6).map(
        (row) => row.length,
      ),
    ).toEqual([2, 2]);
    expect(layoutRecentRows([1, 2, 3, 4, 5], widths, 220, 6)).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
  });

  it("handles a single row and an empty list", () => {
    expect(layoutRecentRows([1], [100], 100, 6)).toEqual([[1]]);
    expect(layoutRecentRows([], [], 420, 6)).toEqual([]);
  });
});
