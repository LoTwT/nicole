// jsdom has no layout, so CodeMirror's coordinate measurements need these stubs.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function getClientRects() {
    return {
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* iterator() {},
    } as unknown as DOMRectList;
  };
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0 } as DOMRect;
  };
}
