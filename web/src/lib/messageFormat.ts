import type { JSONContent } from '@tiptap/core'

export type MessageListBlock =
  | { type: 'bulletList'; items: MessageListItem[] }
  | { type: 'orderedList'; items: MessageListItem[] }
export type MessageListItem = { text: string; children: MessageListBlock[] }

export type MessageBlock =
  | { type: 'paragraph'; text: string }
  | MessageListBlock
  | { type: 'blockquote'; text: string }
  | { type: 'code'; code: string; language: string }
  | { type: 'spacer' }

function appendTextBlocks(blocks: MessageBlock[], text: string) {
  const lines = text.replace(/^\n+|\n+$/g, '').split('\n')
  let paragraph: string[] = []
  let listLevels: { indent: number; block: MessageListBlock }[] = []
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

    const list = line.match(/^([ \t]*)([-*]|\d+[.)])\s+(.+)$/)
    if (list) {
      flushParagraph()
      flushQuote()
      const indent = list[1].replace(/\t/g, '    ').length
      appendListItem(indent, /^\d/.test(list[2]) ? 'orderedList' : 'bulletList', list[3].trim())
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
