/**
 * A lesson body from the old rich-text editors (Trix archives, imported
 * lessons): it starts with an HTML block tag. Lessons render it as HTML
 * (`MarkdownRenderer`'s lesson variant), and the lesson editor's Rich mode
 * keeps it whole and unconverted. One test, so the two always agree.
 */
export function isLessonHtml(text: string): boolean {
  if (!text) return false
  return /^\s*<(p|div|h[1-6]|ul|ol|li|pre|blockquote|table|br|hr|!DOCTYPE)[\s>]/i.test(text)
}
