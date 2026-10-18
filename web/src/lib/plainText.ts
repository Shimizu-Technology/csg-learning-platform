/**
 * Turns instructor markdown into a short plain-text excerpt for cards and
 * previews, so learners never see literal `**`, `*why*`, or code fences.
 */
export function markdownExcerpt(markdown: string | null | undefined, maxLength = 180): string {
  if (!markdown) return ''
  let text = markdown
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\w+-]*\n?([\s\S]*?)```/g, (_match, code: string) => ` ${code.trim().split('\n')[0] || ''} `)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1).trimEnd()}…`
  return text
}
