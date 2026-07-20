import type { JSONContent } from '@tiptap/core'

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

export function normalizeMessageMarkdown(body: string): string {
  let insideCodeFence = false
  const lines = body.replace(/\r\n/g, '\n').split('\n').filter((line) => {
    if (/^\s*```/.test(line)) {
      insideCodeFence = !insideCodeFence
      return true
    }

    if (insideCodeFence) return true
    return !/^\s*(?:[-*]|\d+[.)])\s*$/.test(line)
  })

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function editorJsonToMarkdown(node?: JSONContent): string {
  if (!node) return ''
  if (node.type === 'text') return applyMarks(node.text || '', node.marks || [])

  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return serializeList(node, node.type === 'orderedList')
  }

  const children = (node.content || []).map((child) => editorJsonToMarkdown(child))

  switch (node.type) {
    case 'doc':
      return children.join('\n\n').trim()
    case 'paragraph':
      return children.join('')
    case 'hardBreak':
      return '\n'
    case 'codeBlock':
      return `\`\`\`\n${children.join('')}\n\`\`\``
    case 'blockquote':
      return children.join('\n').split('\n').map((line) => `> ${line}`).join('\n')
    default:
      return children.join('')
  }
}

function serializeList(node: JSONContent, ordered: boolean): string {
  const items = (node.content || []).map((item) => {
    const [firstChild, ...remainingChildren] = item.content || []
    const firstLine = firstChild ? editorJsonToMarkdown(firstChild) : ''
    const continuation = remainingChildren
      .map((child) => editorJsonToMarkdown(child))
      .filter(Boolean)
      .map((value) => value.split('\n').map((line) => `  ${line}`).join('\n'))
      .join('\n')

    return continuation ? `${firstLine}\n${continuation}`.trimEnd() : firstLine.trimEnd()
  }).filter((item) => item.trim().length > 0)

  return items.map((item, index) => `${ordered ? `${index + 1}.` : '-'} ${item}`).join('\n')
}

function applyMarks(text: string, marks: NonNullable<JSONContent['marks']>) {
  return marks.reduce((value, mark) => {
    if (mark.type === 'bold') return `**${value}**`
    if (mark.type === 'italic') return `_${value}_`
    if (mark.type === 'underline') return `++${value}++`
    if (mark.type === 'strike') return `~~${value}~~`
    if (mark.type === 'code') return `\`${value}\``
    if (mark.type === 'link') return `[${value}](${mark.attrs?.href || value})`
    return value
  }, text)
}
