/**
 * Geometry for remembering and restoring the editor's scroll position.
 *
 * CodeMirror measures line blocks from the top of the first line, while
 * scrollTop also includes the document's top padding. Keeping the conversion
 * here makes the two coordinate systems explicit.
 */

/** The line at the viewport top and how far it has scrolled past that edge. */
export interface ScrollAnchor {
  /** 1-based document line. */
  line: number;
  /**
   * Pixels of the line's top that lie above the viewport top. Positive when
   * part of the line is scrolled out of view; negative when the document's
   * top padding keeps the first lines below the viewport top.
   */
  offset: number;
}

/**
 * Height in CodeMirror's document coordinates where the visible viewport
 * starts. The one-pixel shift keeps a line whose top sits exactly on the
 * viewport edge from being reported as the previous line: lineBlockAtHeight
 * returns the earlier block when the height lands on a boundary.
 */
export function visibleTopHeight(
  scrollTop: number,
  paddingTop: number,
): number {
  return Math.max(0, scrollTop - paddingTop + 1);
}

/** Anchors the line at the viewport top at its current in-line offset. */
export function scrollAnchor(
  scrollTop: number,
  paddingTop: number,
  line: number,
  lineTop: number,
): ScrollAnchor {
  return { line, offset: scrollTop - paddingTop - lineTop };
}

/** Scroll offset that returns an anchor line to the same in-line offset. */
export function scrollTopForAnchor(
  anchor: ScrollAnchor,
  paddingTop: number,
  lineTop: number,
): number {
  return Math.max(0, paddingTop + lineTop + anchor.offset);
}
