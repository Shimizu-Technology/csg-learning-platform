import { renderLessonMarkdown } from './lesson-markdown';

const HTML_DOCUMENT_START = /^\s*<(?:!doctype|p|div|h[1-6]|ul|ol|li|pre|blockquote|table|img|br|hr)(?:\s|>)/i;

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

export const STARTER_TAG = 'csg-starter';

const STANDALONE_LINK = /<p>\s*<a\s([^>]*?)>([^<]*)<\/a>\s*<\/p>/gi;
const HREF_ATTRIBUTE = /\bhref\s*=\s*"([^"]*)"/i;

function decodeAttribute(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * A paragraph that is only a Hafa Code starter link becomes a dedicated
 * element, so the native renderer can show it as a button with a hint
 * instead of an easy-to-miss underlined link.
 */
export function markStarterLinks(html: string, isStarterLink: (href: string) => boolean) {
  return html.replace(STANDALONE_LINK, (match, attributes: string, label: string) => {
    const href = attributes.match(HREF_ATTRIBUTE)?.[1];
    if (!href || !isStarterLink(decodeAttribute(href))) return match;
    return `<${STARTER_TAG} href="${href}">${label}</${STARTER_TAG}>`;
  });
}
