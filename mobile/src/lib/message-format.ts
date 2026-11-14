import { markdownToPlainText } from './markdown-core';

export {
  inlinePlainText,
  markdownToPlainText,
  parseInline,
  parseMessageBlocks,
  splitTrailingUrlPunctuation,
  type InlineNode,
  type MessageBlock,
  type MessageCodeBlock,
  type MessageListBlock,
  type MessageListChild,
  type MessageListItem,
} from './markdown-core';

const COMMON_FILE_EXTENSIONS = new Set([
  'css', 'csv', 'doc', 'docx', 'gif', 'html', 'jpeg', 'jpg', 'js', 'json', 'md',
  'pdf', 'php', 'png', 'py', 'rb', 'svg', 'ts', 'tsx', 'txt', 'webp', 'yaml',
  'yml', 'zip',
]);

/** Message text without Markdown syntax, for inbox rows, pins, and search results. */
export function plainMessageText(body: string, fallback = 'Attachment') {
  // An unmatched backtick is literal Markdown, but it reads as noise in a one-line preview.
  return markdownToPlainText(body || '').replace(/`+/g, '').replace(/\s+/g, ' ').trim() || fallback;
}

export function messagePreview(body: string, maxLength = 80, fallback = 'Attachment') {
  const value = plainMessageText(body, fallback);
  if (maxLength <= 0 || value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function normalizeMessageLink(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
    } catch {
      return null;
    }
  }
  if (/^www\./i.test(trimmed)) return normalizeMessageLink(`https://${trimmed}`);

  const bareDomainMatch = trimmed.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)([/?#].*)?$/i);
  if (!bareDomainMatch) return null;

  const tld = bareDomainMatch[1].split('.').pop()?.toLowerCase() || '';
  if (!/^[a-z]{2,24}$/.test(tld) || COMMON_FILE_EXTENSIONS.has(tld)) return null;
  return normalizeMessageLink(`https://${trimmed}`);
}
