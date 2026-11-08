import { describe, expect, it } from "vitest";

import {
  scrollAnchor,
  scrollTopForAnchor,
  visibleTopHeight,
} from "./scroll";

describe("scroll geometry", () => {
  it("measures the viewport top from the first line, below the padding", () => {
    // At scrollTop 0 the 48px padding is visible above the first line.
    expect(visibleTopHeight(0, 48)).toBe(0);
    // Starting exactly at the first line's top means the line is visible.
    expect(visibleTopHeight(48, 48)).toBe(1);
    // 636 - 48 = 588, and one pixel keeps a line boundary on the lower line.
    expect(visibleTopHeight(636, 48)).toBe(589);
  });

  it("reports the top visible line with its in-line offset", () => {
    // Line 20 starts at 581.28; 636 - 48 - 581.28 = 6.72 pixels have scrolled
    // past the viewport top.
    const anchor = scrollAnchor(636, 48, 20, 581.28);
    expect(anchor.line).toBe(20);
    expect(anchor.offset).toBeCloseTo(6.72);
  });

  it("keeps a negative offset while the top padding is in view", () => {
    // At scrollTop 0 the first line starts 48px below the viewport top.
    expect(scrollAnchor(0, 48, 1, 0)).toEqual({ line: 1, offset: -48 });
  });

  it("round-trips a scroll position through an anchor", () => {
    const anchor = scrollAnchor(636, 48, 20, 581.28);
    expect(scrollTopForAnchor(anchor, 48, 581.28)).toBeCloseTo(636);
    const padded = scrollAnchor(0, 48, 1, 0);
    expect(scrollTopForAnchor(padded, 48, 0)).toBe(0);
  });

  it("does not scroll above the document", () => {
    expect(scrollTopForAnchor({ line: 1, offset: -20 }, 0, 0)).toBe(0);
  });
});
