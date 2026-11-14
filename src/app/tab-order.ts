/** Reorders existing tab models without replacing their identity or active state. */
export function reorderTabs<T extends { id: number }>(
  tabs: readonly T[],
  sourceId: number,
  targetId: number,
  after: boolean,
): readonly T[] {
  if (sourceId === targetId) return tabs;
  const source = tabs.find((tab) => tab.id === sourceId);
  if (!source || !tabs.some((tab) => tab.id === targetId)) return tabs;
  const next = tabs.filter((tab) => tab.id !== sourceId);
  const target = next.findIndex((tab) => tab.id === targetId);
  next.splice(target + (after ? 1 : 0), 0, source);
  return next;
}
