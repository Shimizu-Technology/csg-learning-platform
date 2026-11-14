import { markdownToPlainText } from './markdown-core';

/**
 * Turns written Markdown (feedback, updates, help replies, notification
 * bodies) into a short plain-text excerpt for cards, notification rows, and
 * previews, so readers never see literal `**`, `*why*`, or code fences.
 * Mirrors the web app's `markdownExcerpt`: both read the shared message
 * parser's structure (markdown-core), and fixtures/markdown-excerpts.json
 * holds them in step with the API's MarkdownExcerpt.
 */
export function markdownExcerpt(markdown: string | null | undefined, maxLength = 180): string {
  if (!markdown) return '';
  let text = markdownToPlainText(markdown, { codeFirstLine: true, longForm: true });
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  return text;
}
