import { markdownToPlainText } from './markdownCore'

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

/**
 * Turns instructor markdown into a short plain-text excerpt for cards and
 * previews, so learners never see literal `**`, `*why*`, or code fences.
 * Markdown goes through the shared message parser (markdownCore); HTML tags
 * from older rich-text bodies are dropped first.
 */
export function markdownExcerpt(markdown: string | null | undefined, maxLength = 180): string {
  if (!markdown) return ''
  const withoutHtml = markdown
    .replace(/<\/?[a-zA-Z][^<>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity])
    // Table rows read as cells separated by spaces; the |---| divider row is dropped.
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_row, cells: string) => cells.split('|').join(' '))
  let text = markdownToPlainText(withoutHtml, { codeFirstLine: true })
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1).trimEnd()}…`
  return text
}
