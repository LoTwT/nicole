import { describe, expect, it } from "vitest";
import { interpolateScroll } from "./scroll-synchronization";

describe("source-aligned scroll positions", () => {
  it("interpolates rendered blocks that have different heights from their source", () => {
    const positions = [{ source: 1, target: 0 }, { source: 10, target: 300 }, { source: 20, target: 900 }];
    expect(interpolateScroll(positions, 15)).toBe(600);
    expect(interpolateScroll(positions.map((anchor) => ({ source: anchor.target, target: anchor.source })), 600)).toBe(15);
    expect(interpolateScroll(positions, 0)).toBe(0);
    expect(interpolateScroll(positions, 100)).toBe(900);
  });
});
