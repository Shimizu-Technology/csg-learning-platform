export type MessageBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bulletList'; items: string[] }
  | { type: 'orderedList'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; code: string; language: string }
  | { type: 'spacer' }

function appendTextBlocks(blocks: MessageBlock[], text: string) {
  const lines = text.replace(/^\n+|\n+$/g, '').split('\n')
  let paragraph: string[] = []
  let listType: 'bulletList' | 'orderedList' | null = null
  let listItems: string[] = []
  let quoteLines: string[] = []

  const flushParagraph = () => {
    const value = paragraph.join('\n').trim()
    if (value) blocks.push({ type: 'paragraph', text: value })
    paragraph = []
  }

  const flushList = () => {
    if (listType && listItems.length > 0) blocks.push({ type: listType, items: listItems })
    listType = null
    listItems = []
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
      flushAll()
      if (blocks.length > 0 && blocks.at(-1)?.type !== 'spacer') blocks.push({ type: 'spacer' })
      return
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      flushQuote()
      if (listType && listType !== 'bulletList') flushList()
      listType = 'bulletList'
      listItems.push(bullet[1].trim())
      return
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (ordered) {
      flushParagraph()
      flushQuote()
      if (listType && listType !== 'orderedList') flushList()
      listType = 'orderedList'
      listItems.push(ordered[1].trim())
      return
    }

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
