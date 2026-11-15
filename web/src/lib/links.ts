/**
 * True for a click the app should handle in place: the primary button with no
 * modifier keys. ⌘/Ctrl/Shift/Alt-clicks and middle clicks keep the browser's
 * own behavior (new tab or window), which is why rows and names are real links.
 */
export function isPlainLeftClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}
