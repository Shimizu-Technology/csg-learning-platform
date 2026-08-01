export type MessageBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bulletList'; items: string[] }
  | { type: 'orderedList'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; code: string; language: string }
  | { type: 'spacer' };

const COMMON_FILE_EXTENSIONS = new Set([
  'css', 'csv', 'doc', 'docx', 'gif', 'html', 'jpeg', 'jpg', 'js', 'json', 'md',
  'pdf', 'php', 'png', 'py', 'rb', 'svg', 'ts', 'tsx', 'txt', 'webp', 'yaml',
  'yml', 'zip',
]);

function appendTextBlocks(blocks: MessageBlock[], text: string) {
  const lines = text.replace(/^\n+|\n+$/g, '').split('\n');
  let paragraph: string[] = [];
  let listType: 'bulletList' | 'orderedList' | null = null;
  let listItems: string[] = [];
  let quoteLines: string[] = [];

  const flushParagraph = () => {
    const value = paragraph.join('\n').trim();
    if (value) blocks.push({ type: 'paragraph', text: value });
    paragraph = [];
  };

  const flushList = () => {
    if (listType && listItems.length > 0) blocks.push({ type: listType, items: listItems });
    listType = null;
    listItems = [];
  };

  const flushQuote = () => {
    const value = quoteLines.join('\n').trim();
    if (value) blocks.push({ type: 'blockquote', text: value });
    quoteLines = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  lines.forEach((line) => {
    if (!line.trim()) {
      flushAll();
      if (blocks.length > 0 && blocks.at(-1)?.type !== 'spacer') blocks.push({ type: 'spacer' });
      return;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== 'bulletList') flushList();
      listType = 'bulletList';
      listItems.push(bullet[1].trim());
      return;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== 'orderedList') flushList();
      listType = 'orderedList';
      listItems.push(ordered[1].trim());
      return;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      return;
    }

    flushList();
    flushQuote();
    paragraph.push(line);
  });

  flushAll();
}

export function parseMessageBlocks(body: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(body)) !== null) {
    if (match.index > cursor) appendTextBlocks(blocks, body.slice(cursor, match.index));
    blocks.push({
      type: 'code',
      language: match[1].trim(),
      code: match[2].replace(/^\n+|\n+$/g, ''),
    });
    cursor = fencePattern.lastIndex;
  }

  if (cursor < body.length) appendTextBlocks(blocks, body.slice(cursor));

  while (blocks.at(-1)?.type === 'spacer') blocks.pop();
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', text: body }];
}

export function plainMessageText(body: string, fallback = 'Attachment') {
  const value = (body || fallback)
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/`{1,3}/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\+\+([^+]+)\+\+/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  return value || fallback;
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

export function splitTrailingUrlPunctuation(value: string) {
  let href = value;
  let trailing = '';

  while (/[.,!?;:]$/.test(href)) {
    trailing = `${href.slice(-1)}${trailing}`;
    href = href.slice(0, -1);
  }

  if (href.endsWith(')') && !href.includes('(')) {
    trailing = `)${trailing}`;
    href = href.slice(0, -1);
  }

  return { href, trailing };
}
