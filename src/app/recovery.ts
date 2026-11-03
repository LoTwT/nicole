/** The first copy is written two seconds after the model becomes dirty. */
export const RECOVERY_FIRST_DELAY_MS = 2000;
/** After that, the model is checked every five seconds. */
export const RECOVERY_INTERVAL_MS = 5000;

export interface RecoveryTimers {
  /** Starts the first timer for id; repeated calls do not reset it. */
  start(id: number): void;
  stop(id: number): void;
  stopAll(): void;
  isRunning(id: number): boolean;
}

/**
 * Per-document copy timers. Unlike the autosave timer, touching the document
 * again does not restart the countdown: the first copy is written two seconds
 * after the model became dirty, and the callback decides whether another copy
 * is needed every five seconds.
 */
export function createRecoveryTimers(
  onDue: (id: number) => boolean,
): RecoveryTimers {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function schedule(id: number, delay: number) {
    const timer = setTimeout(() => {
      timers.delete(id);
      if (onDue(id)) {
        schedule(id, RECOVERY_INTERVAL_MS);
      }
    }, delay);
    timers.set(id, timer);
  }

  return {
    start(id) {
      if (!timers.has(id)) {
        schedule(id, RECOVERY_FIRST_DELAY_MS);
      }
    },
    stop(id) {
      const timer = timers.get(id);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(id);
      }
    },
    stopAll() {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    },
    isRunning(id) {
      return timers.has(id);
    },
  };
}

/** One row of the recovery dialog, already formatted for display. */
export interface RecoveryDialogItem {
  id: string;
  name: string;
  /** Workspace-relative path, or the full path of a single file. */
  location: string;
  time: string;
  note: string;
  unable?: boolean;
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * Shows the copy time as "今天 23:41", "昨天 09:12" or "11月2日 09:12" in the
 * user's local time. Invalid input is returned unchanged so a corrupt record
 * never blanks a dialog row.
 */
export function formatRecoveryTime(
  savedAt: string,
  now: Date = new Date(),
): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return savedAt;
  }
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  if (sameDay(date, now)) {
    return `今天 ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) {
    return `昨天 ${time}`;
  }
  const parts = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${month}月${day}日 ${time}`;
}
