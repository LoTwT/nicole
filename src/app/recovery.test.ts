import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECOVERY_FIRST_DELAY_MS,
  RECOVERY_INTERVAL_MS,
  createRecoveryTimers,
  formatRecoveryTime,
} from "./recovery";

afterEach(() => {
  vi.useRealTimers();
});

describe("createRecoveryTimers", () => {
  it("starts two seconds after becoming dirty and is not reset by edits", () => {
    vi.useFakeTimers();
    const due = vi.fn(() => true);
    const timers = createRecoveryTimers(due);

    timers.start(1);
    vi.advanceTimersByTime(RECOVERY_FIRST_DELAY_MS - 1);
    timers.start(1);
    timers.start(1);
    expect(due).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(due).toHaveBeenCalledWith(1);

    vi.advanceTimersByTime(RECOVERY_INTERVAL_MS);
    expect(due).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(RECOVERY_INTERVAL_MS);
    expect(due).toHaveBeenCalledTimes(3);
    timers.stopAll();
    vi.advanceTimersByTime(RECOVERY_INTERVAL_MS * 3);
    expect(due).toHaveBeenCalledTimes(3);
  });

  it("stops when the callback returns false", () => {
    vi.useFakeTimers();
    const due = vi.fn(() => false);
    const timers = createRecoveryTimers(due);
    timers.start(2);
    vi.advanceTimersByTime(RECOVERY_FIRST_DELAY_MS);
    expect(due).toHaveBeenCalledOnce();
    expect(timers.isRunning(2)).toBe(false);
    vi.advanceTimersByTime(RECOVERY_INTERVAL_MS * 2);
    expect(due).toHaveBeenCalledOnce();
  });
});

describe("formatRecoveryTime", () => {
  const now = new Date(2026, 10, 3, 15, 0, 0);

  it("uses 今天 and 昨天 in local time", () => {
    expect(formatRecoveryTime(new Date(2026, 10, 3, 23, 41).toISOString(), now)).toBe(
      "今天 23:41",
    );
    expect(formatRecoveryTime(new Date(2026, 10, 2, 9, 12).toISOString(), now)).toBe(
      "昨天 09:12",
    );
  });

  it("uses month and day for older copies", () => {
    expect(formatRecoveryTime(new Date(2026, 10, 1, 9, 12).toISOString(), now)).toBe(
      "11月1日 09:12",
    );
  });

  it("leaves an invalid timestamp unchanged", () => {
    expect(formatRecoveryTime("not a date", now)).toBe("not a date");
  });
});
