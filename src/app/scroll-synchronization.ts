import type { EditorView } from "@codemirror/view";

export interface ScrollAnchor { source: number; target: number }

/** Interpolate between matching source lines; repeated container anchors are collapsed. */
export function interpolateScroll(anchors: readonly ScrollAnchor[], source: number): number {
  if (!anchors.length) return 0;
  if (source <= anchors[0]!.source) return anchors[0]!.target;
  for (let index = 1; index < anchors.length; index++) {
    const right = anchors[index]!, left = anchors[index - 1]!;
    if (source <= right.source) {
      const distance = right.source - left.source;
      return left.target + (right.target - left.target) * (distance > 0 ? (source - left.source) / distance : 0);
    }
  }
  return anchors.at(-1)!.target;
}

export function synchronizeReadingScroll(view: EditorView, preview: HTMLElement, sameDocument: boolean): () => void {
  const editor = view.scrollDOM;
  let frame = 0;
  let disposed = false;
  let expected: { element: HTMLElement; top: number } | null = null;
  let anchors: ScrollAnchor[] | null = null;
  const invalidate = () => { anchors = null; };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(invalidate);
  observer?.observe(preview);
  if (preview.firstElementChild) observer?.observe(preview.firstElementChild);
  const mutations = new MutationObserver(invalidate);
  mutations.observe(preview, { subtree: true, childList: true, attributes: true });
  preview.addEventListener("load", invalidate, true);

  function sourceAnchors(): ScrollAnchor[] {
    if (anchors) return anchors;
    const top = preview.getBoundingClientRect().top;
    const byLine = new Map<number, number>();
    byLine.set(1, 0);
    for (const element of preview.querySelectorAll<HTMLElement>("[data-source-line]")) {
      // Hidden details content has no position until the user unfolds it.
      if (!element.getClientRects().length) continue;
      const line = Number(element.dataset.sourceLine);
      if (!Number.isFinite(line) || line < 1 || byLine.has(line)) continue;
      byLine.set(line, element.getBoundingClientRect().top - top + preview.scrollTop);
    }
    byLine.set(view.state.doc.lines + 1, preview.scrollHeight);
    anchors = [...byLine].sort((a, b) => a[0] - b[0]).map(([source, target]) => ({ source, target }));
    return anchors;
  }

  function editorSourceLine(): number {
    const height = editor.scrollTop - view.documentPadding.top;
    if (height < 0) return 1;
    const block = view.lineBlockAtHeight(height);
    const first = view.state.doc.lineAt(block.from).number;
    const last = view.state.doc.lineAt(block.to).number;
    return first + Math.max(0, Math.min(1, (height - block.top) / Math.max(1, block.height))) * Math.max(1, last - first + 1);
  }

  function editorTop(line: number): number {
    const number = Math.min(view.state.doc.lines, Math.max(1, Math.floor(line)));
    const block = view.lineBlockAt(view.state.doc.line(number).from);
    const first = view.state.doc.lineAt(block.from).number;
    const last = view.state.doc.lineAt(block.to).number;
    return view.documentPadding.top + block.top + (line - first) / Math.max(1, last - first + 1) * block.height;
  }

  function scroll(event: Event) {
    const from = event.currentTarget as HTMLElement;
    if (expected?.element === from && Math.abs(from.scrollTop - expected.top) < 1) { expected = null; return; }
    expected = null;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed || !view.dom.isConnected) return;
      const to = from === editor ? preview : editor;
      let top: number;
      const positions = sameDocument ? sourceAnchors() : [];
      if (positions.length > 2) {
        top = from === editor
          ? interpolateScroll(positions, editorSourceLine())
          : editorTop(interpolateScroll(positions.map((anchor) => ({ source: anchor.target, target: anchor.source })), preview.scrollTop));
      } else {
        const range = from.scrollHeight - from.clientHeight;
        top = range > 0 ? from.scrollTop / range * (to.scrollHeight - to.clientHeight) : 0;
      }
      top = Math.max(0, Math.min(to.scrollHeight - to.clientHeight, top));
      if (Math.abs(to.scrollTop - top) < 1) return;
      to.scrollTop = top;
      expected = { element: to, top: to.scrollTop };
    });
  }
  editor.addEventListener("scroll", scroll, { passive: true });
  preview.addEventListener("scroll", scroll, { passive: true });
  preview.addEventListener("toggle", invalidate, true);
  window.addEventListener("resize", invalidate);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    mutations.disconnect();
    editor.removeEventListener("scroll", scroll);
    preview.removeEventListener("scroll", scroll);
    preview.removeEventListener("load", invalidate, true);
    preview.removeEventListener("toggle", invalidate, true);
    window.removeEventListener("resize", invalidate);
  };
}
