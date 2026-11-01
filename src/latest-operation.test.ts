import { describe, expect, it } from "vitest";

import { latestOperation } from "./latest-operation";

describe("latestOperation", () => {
  it("keeps only the operation started last", () => {
    const operations = latestOperation();
    const first = operations.start();
    expect(operations.isCurrent(first)).toBe(true);

    const second = operations.start();
    expect(operations.isCurrent(first)).toBe(false);
    expect(operations.isCurrent(second)).toBe(true);
  });

  it("invalidates the current operation when stopped", () => {
    const operations = latestOperation();
    const first = operations.start();
    operations.stop();

    expect(operations.isCurrent(first)).toBe(false);
    expect(operations.isCurrent(0)).toBe(false);

    const second = operations.start();
    expect(operations.isCurrent(first)).toBe(false);
    expect(operations.isCurrent(second)).toBe(true);
  });
});
