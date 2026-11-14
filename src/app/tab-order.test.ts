import { describe, expect, it } from "vitest";
import { reorderTabs } from "./tab-order";

describe("tab order", () => {
  const tabs = [{ id: 1, kind: "markdown" }, { id: 2, kind: "settings" }, { id: 3, kind: "markdown" }];

  it("moves a tab around settings without changing the original models", () => {
    const next = reorderTabs(tabs, 3, 1, false);
    expect(next.map((tab) => tab.id)).toEqual([3, 1, 2]);
    expect(next[0]).toBe(tabs[2]);
    expect(tabs.map((tab) => tab.id)).toEqual([1, 2, 3]);
    expect(reorderTabs(next, 3, 2, true).map((tab) => tab.id)).toEqual([1, 2, 3]);
  });

  it("leaves stale or identical drag targets unchanged", () => {
    expect(reorderTabs(tabs, 4, 1, false)).toBe(tabs);
    expect(reorderTabs(tabs, 1, 4, false)).toBe(tabs);
    expect(reorderTabs(tabs, 1, 1, true)).toBe(tabs);
  });
});
