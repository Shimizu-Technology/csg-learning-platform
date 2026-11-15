/*
 * jsdom has no layout, and its Range has no getClientRects or
 * getBoundingClientRect. The rich-text composer (TipTap/ProseMirror) calls
 * them when it measures or scrolls to the selection, sometimes from a timer
 * that fires after a test has finished, which surfaced as an unhandled
 * "getClientRects is not a function" error in full runs. Give every jsdom
 * test an empty layout instead. Tests that need real geometry still stub
 * their own.
 */
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function getClientRects() {
      return [] as unknown as DOMRectList
    }
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    }
  }
}
