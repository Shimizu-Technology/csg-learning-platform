export type MessageListBlock =
  | { type: 'bulletList'; items: MessageListItem[] }
  | { type: 'orderedList'; items: MessageListItem[] }
export type MessageListItem = { text: string; children: Array<MessageListBlock | { type: 'paragraph'; text: string } | { type: 'blockquote'; text: string }> }

export type MessageBlock =
  | { type: 'paragraph'; text: string }
  | MessageListBlock
  | { type: 'blockquote'; text: string }
  | { type: 'code'; code: string; language: string }
  | { type: 'spacer' }

const COMMON_FILE_EXTENSIONS = new Set([
  'css', 'csv', 'doc', 'docx', 'gif', 'html', 'jpeg', 'jpg', 'js', 'json', 'md',
  'pdf', 'php', 'png', 'py', 'rb', 'svg', 'ts', 'tsx', 'txt', 'webp', 'yaml',
  'yml', 'zip',
]);

function appendTextBlocks(blocks: MessageBlock[], text: string) {
  const lines = text.replace(/^\n+|\n+$/g, '').split('\n')
  let paragraph: string[] = []
  let listLevels: { indent: number; block: MessageListBlock }[] = []
  let pendingListBreak = false

  const indentation = (whitespace: string) => {
    let columns = 0
    for (const character of whitespace) columns += character === '\t' ? 4 - columns % 4 : 1
    return columns
  }
  let quoteLines: string[] = []

  const flushParagraph = () => {
    const value = paragraph.join('\n').trim()
    if (value) blocks.push({ type: 'paragraph', text: value })
    paragraph = []
  }

  const flushList = () => {
    listLevels = []
  }

  const appendListItem = (indent: number, type: MessageListBlock['type'], text: string) => {
    while (listLevels.length && listLevels[listLevels.length - 1].indent > indent) listLevels.pop()

    let current = listLevels[listLevels.length - 1]
    if (!current || current.indent < indent || current.block.type !== type) {
      const block: MessageListBlock = type === 'bulletList'
        ? { type: 'bulletList', items: [] }
        : { type: 'orderedList', items: [] }
      if (current && current.indent < indent) {
        current.block.items.at(-1)?.children.push(block)
      } else if (listLevels.length > 1) {
        listLevels[listLevels.length - 2].block.items.at(-1)?.children.push(block)
        listLevels.pop()
      } else {
        blocks.push(block)
        listLevels = []
      }
      listLevels.push({ indent, block })
      current = listLevels[listLevels.length - 1]
    }
    current.block.items.push({ text, children: [] })
  }

  const appendListContinuation = (line: string) => {
    // Keep continuation paragraphs in order with sublists on their owning item.
    const leadingWhitespace = line.match(/^[ \t]*/)?.[0] || ''
    const continuationIndent = indentation(leadingWhitespace)
    if (!listLevels.length || continuationIndent <= listLevels[0].indent) return false
    while (listLevels.length > 1 && listLevels.at(-1)!.indent >= continuationIndent) listLevels.pop()
    const item = listLevels.at(-1)!.block.items.at(-1)!
    const previous = item.children.at(-1)
    const continuation = line.slice(leadingWhitespace.length)
    const quote = continuation.match(/^>\s?(.*)$/)
    const type = quote ? 'blockquote' : 'paragraph'
    const text = quote ? quote[1] : continuation
    if (previous?.type === type) previous.text += `\n${text}`
    else item.children.push({ type, text })
    return true
  }

  const flushQuote = () => {
    const value = quoteLines.join('\n').trim()
    if (value) blocks.push({ type: 'blockquote', text: value })
    quoteLines = []
  }

  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  lines.forEach((line) => {
    if (!line.trim()) {
      if (appendListContinuation(line)) return
      if (listLevels.length) {
        pendingListBreak = true
        return
      }
      flushAll()
      if (blocks.length > 0 && blocks.at(-1)?.type !== 'spacer') blocks.push({ type: 'spacer' })
      return
    }

    if (pendingListBreak) {
      pendingListBreak = false
      // A loose list may have an unindented blank before a nested child.
      // Wait for content before deciding whether the list has ended.
      if (indentation(line.match(/^[ \t]*/)?.[0] || '') <= listLevels[0].indent) {
        flushAll()
        if (blocks.at(-1)?.type !== 'spacer') blocks.push({ type: 'spacer' })
      }
    }

    const list = line.match(/^([ \t]*)([-*]|\d+[.)])\s+(.+)$/)
    if (list) {
      flushParagraph()
      flushQuote()
      appendListItem(indentation(list[1]), /^\d/.test(list[2]) ? 'orderedList' : 'bulletList', list[3].trim())
      return
    }

    if (appendListContinuation(line)) return

    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      quoteLines.push(quote[1])
      return
    }

    flushList()
    flushQuote()
    paragraph.push(line)
  })

  flushAll()
}

export function parseMessageBlocks(body: string): MessageBlock[] {
  const blocks: MessageBlock[] = []
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = fencePattern.exec(body)) !== null) {
    if (match.index > cursor) appendTextBlocks(blocks, body.slice(cursor, match.index))
    blocks.push({
      type: 'code',
      language: match[1].trim(),
      code: match[2].replace(/^\n+|\n+$/g, ''),
    })
    cursor = fencePattern.lastIndex
  }

  if (cursor < body.length) appendTextBlocks(blocks, body.slice(cursor))

  while (blocks.at(-1)?.type === 'spacer') blocks.pop()
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', text: body }]
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
