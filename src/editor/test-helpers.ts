/** Waits for a condition on a real clock; do not use it with fake timers. */
export async function until(
  predicate: () => boolean,
  description: string,
  timeout = 5000,
) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}
