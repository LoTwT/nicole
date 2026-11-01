export interface LatestOperation {
  /** Invalidates the previous operation and returns the new operation ID. */
  start(): number;
  /** Reports whether id is still the newest operation. */
  isCurrent(id: number): boolean;
  /** Invalidates the current operation. */
  stop(): void;
}

/**
 * Tracks which of a series of async operations is still wanted.
 *
 * IPC reads cannot be cancelled cheaply, so callers check `isCurrent` when an
 * operation settles and discard stale results instead of applying them.
 */
export function latestOperation(): LatestOperation {
  let current = 0;
  let active = false;
  return {
    start() {
      active = true;
      return ++current;
    },
    isCurrent(id) {
      return active && id === current;
    },
    stop() {
      active = false;
      current++;
    },
  };
}
