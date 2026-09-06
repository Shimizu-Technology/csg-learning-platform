import { renderLessonMarkdown } from './lesson-markdown';

const HTML_DOCUMENT_START = /^\s*<(?:!doctype|p|div|h[1-6]|ul|ol|li|pre|blockquote|table|br|hr)(?:\s|>)/i;

export type AuthoredContentFormat = 'html' | 'markdown';

export interface AuthoredContentSource {
  format: AuthoredContentFormat;
  html: string;
}

/**
 * Course content predates the rich-text editor, so stored bodies can be either
 * Markdown or the HTML emitted by TipTap. Keep that distinction at the native
 * rendering boundary instead of escaping valid editor HTML as Markdown text.
 */
export function authoredContentSource(body: string): AuthoredContentSource {
  if (HTML_DOCUMENT_START.test(body)) return { format: 'html', html: body };
  return { format: 'markdown', html: renderLessonMarkdown(body) };
}
