import { markdownToPlainText } from './markdownCore'

/**
 * Turns written Markdown (feedback, updates, help replies, notification
 * bodies) into a short plain-text excerpt for cards and previews, so readers
 * never see literal `**`, `*why*`, or code fences. It reads the parsed
 * structure (markdownCore), so code keeps its text, escapes and entities read
 * as they render, and HTML typed as text stays as typed, like the written
 * renderer shows it. fixtures/markdown-excerpts.json holds it in step with the
 * mobile copy and the API's MarkdownExcerpt.
 */
export function markdownExcerpt(markdown: string | null | undefined, maxLength = 180): string {
  if (!markdown) return ''
  let text = markdownToPlainText(markdown, { codeFirstLine: true, longForm: true })
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1).trimEnd()}…`
  return text
}
