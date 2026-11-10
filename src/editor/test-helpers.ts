/** Waits for a condition on a real clock; do not use it with fake timers. */
export async function until(predicate: () => boolean, timeout = 5000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) {
      throw new Error("timed out waiting for the editor");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}
