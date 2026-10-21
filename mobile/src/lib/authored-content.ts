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

export const CODE_TAG = 'csg-code';

export interface AuthoredCodeBlock {
  code: string;
  language: string;
}

const PRE_BLOCK = /<pre(?:\s[^>]*)?>([\s\S]*?)<\/pre>/gi;
const CODE_LANGUAGE = /class\s*=\s*"[^"]*\b(?:language|lang)-([\w+#.-]+)/i;

/** A numeric character reference as text; out-of-range values stay as written instead of throwing. */
function codePointText(codePoint: number, original: string) {
  return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : original;
}

function decodeHtmlText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (match, code: string) => codePointText(Number(code), match))
    .replace(/&#x([\da-f]+);/gi, (match, code: string) => codePointText(Number.parseInt(code, 16), match))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Pulls every <pre> block out of the HTML before it reaches the native HTML
 * renderer. That renderer collapses whitespace while building its tree, so on
 * device a multi-line code block arrived as one long line. The exact source
 * text (newlines, indentation, tabs) is kept here and rendered by the shared
 * native code block instead; the HTML keeps an empty placeholder element.
 */
export function extractCodeBlocks(html: string): { html: string; blocks: AuthoredCodeBlock[] } {
  const blocks: AuthoredCodeBlock[] = [];
  const next = html.replace(PRE_BLOCK, (_match, inner: string) => {
    const language = inner.match(CODE_LANGUAGE)?.[1] || '';
    const code = decodeHtmlText(inner).replace(/\n$/, '');
    blocks.push({ code, language });
    return `<${CODE_TAG} data-index="${blocks.length - 1}"></${CODE_TAG}>`;
  });
  return { html: next, blocks };
}
