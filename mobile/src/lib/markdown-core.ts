/**
 * The message Markdown subset: one parser for chat messages on web and mobile,
 * and the plain-text version used for previews.
 *
 * This file is shared verbatim with mobile/src/lib/markdown-core.ts.
 * messageFormat.native-parity.test.ts fails if the two copies differ, so edit
 * both together (copy this file over the mobile one).
 *
 * The syntax and the rules that keep it in step with the long-form renderer
 * (react-markdown with remark-gfm) are in docs/MARKDOWN.md. In short:
 * - a single newline is a line break; a blank line starts a new paragraph;
 * - **bold**, _italic_ or *italic*, `code` (bold or italic around code keeps
 *   both), ~~strike~~ and ++underline++ (the composer's legacy underline);
 * - CommonMark flanking rules decide emphasis, so snake_case never italicizes;
 * - a backslash before ASCII punctuation makes it literal;
 * - fences (``` or ~~~) must start a line, may sit inside a list item, and an
 *   unclosed fence becomes a code block that ends with the message;
 * - bulleted and numbered lists (nested, numbering keeps its start), > quotes,
 *   ## and ### headings, [links](url), <autolinks> and bare URLs.
 */

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'emphasis' | 'strike' | 'underline'; children: InlineNode[] }
  | { type: 'link'; href: string; children: InlineNode[] }

export type MessageCodeBlock = { type: 'code'; code: string; language: string }
export type MessageListBlock =
  | { type: 'bulletList'; items: MessageListItem[] }
  | { type: 'orderedList'; items: MessageListItem[]; start?: number }
export type MessageListChild =
  | MessageListBlock
  | MessageCodeBlock
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
export type MessageListItem = { text: string; children: MessageListChild[] }

export type MessageBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 2 | 3; text: string }
  | MessageListBlock
  | { type: 'blockquote'; text: string }
  | MessageCodeBlock
  | { type: 'spacer' }

const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.+)$/
const HEADING = /^ {0,3}(#{2,3})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/

function indentation(whitespace: string) {
  let columns = 0
  for (const character of whitespace) columns += character === '\t' ? 4 - columns % 4 : 1
  return columns
}

function leadingIndent(line: string) {
  return indentation(line.match(/^[ \t]*/)?.[0] || '')
}

/** Removes up to `columns` columns of leading whitespace (CommonMark fence content). */
function stripIndent(line: string, columns: number) {
  let removed = 0
  let index = 0
  while (index < line.length && removed < columns && (line[index] === ' ' || line[index] === '\t')) {
    removed += line[index] === '\t' ? 4 - removed % 4 : 1
    index += 1
  }
  return line.slice(index)
}

function trimBlankLines(code: string) {
  return code.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '')
}

/** A fence opener: backtick fences may not have backticks in their info string. */
function fenceOpener(line: string) {
  const match = line.match(FENCE_OPEN)
  if (!match) return null
  if (match[2][0] === '`' && match[3].includes('`')) return null
  return { indent: indentation(match[1]), marker: match[2], language: match[3].trim().split(/\s+/)[0] || '' }
}

function closesFence(line: string, marker: string) {
  const match = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)
  return Boolean(match && match[1][0] === marker[0] && match[1].length >= marker.length)
}

export function parseMessageBlocks(source: string): MessageBlock[] {
  const body = source.replace(/\r\n?/g, '\n')
  const blocks: MessageBlock[] = []
  const lines = body.replace(/^\n+|\n+$/g, '').split('\n')
  let paragraph: string[] = []
  let listLevels: { indent: number; block: MessageListBlock }[] = []
  let quoteLines: string[] = []
  let pendingListBreak = false

  const flushParagraph = () => {
    const value = paragraph.join('\n').trim()
    if (value) blocks.push({ type: 'paragraph', text: value })
    paragraph = []
  }

  const flushQuote = () => {
    const value = quoteLines.join('\n').trim()
    if (value) blocks.push({ type: 'blockquote', text: value })
    quoteLines = []
  }

  const flushAll = () => {
    flushParagraph()
    listLevels = []
    flushQuote()
  }

  const pushSpacer = () => {
    const last = blocks.at(-1)
    if (last && last.type !== 'spacer' && last.type !== 'code') blocks.push({ type: 'spacer' })
  }

  const appendListItem = (indent: number, type: MessageListBlock['type'], text: string, number: number) => {
    while (listLevels.length && listLevels[listLevels.length - 1].indent > indent) listLevels.pop()

    let current = listLevels[listLevels.length - 1]
    if (!current || current.indent < indent || current.block.type !== type) {
      const block: MessageListBlock = type === 'bulletList'
        ? { type: 'bulletList', items: [] }
        : number === 1 ? { type: 'orderedList', items: [] } : { type: 'orderedList', items: [], start: number }
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

  /** The list item that owns an indented line, after closing deeper lists. */
  const continuationItem = (indent: number) => {
    if (!listLevels.length || indent <= listLevels[0].indent) return null
    while (listLevels.length > 1 && listLevels.at(-1)!.indent >= indent) listLevels.pop()
    return listLevels.at(-1)!.block.items.at(-1)!
  }

  const appendListContinuation = (line: string) => {
    // Keep continuation paragraphs in order with sublists on their owning item.
    const leadingWhitespace = line.match(/^[ \t]*/)?.[0] || ''
    const item = continuationItem(indentation(leadingWhitespace))
    if (!item) return false
    const previous = item.children.at(-1)
    const continuation = line.slice(leadingWhitespace.length)
    const quote = continuation.match(/^>\s?(.*)$/)
    const type = quote ? 'blockquote' : 'paragraph'
    const text = quote ? quote[1] : continuation
    if (previous?.type === type) previous.text += `\n${text}`
    else item.children.push({ type, text })
    return true
  }

  const settlePendingListBreak = (line: string) => {
    if (!pendingListBreak) return
    pendingListBreak = false
    // A loose list may have an unindented blank before a nested child.
    // Wait for content before deciding whether the list has ended.
    if (leadingIndent(line) <= listLevels[0].indent) {
      flushAll()
      pushSpacer()
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    const fence = fenceOpener(line)
    if (fence) {
      const codeLines: string[] = []
      let cursor = index + 1
      while (cursor < lines.length && !closesFence(lines[cursor], fence.marker)) {
        codeLines.push(stripIndent(lines[cursor], fence.indent))
        cursor += 1
      }
      // An unclosed fence ends with the message instead of swallowing it silently.
      index = cursor
      const code: MessageCodeBlock = { type: 'code', language: fence.language, code: trimBlankLines(codeLines.join('\n')) }
      settlePendingListBreak(line)
      flushParagraph()
      flushQuote()
      const item = continuationItem(fence.indent)
      if (item) {
        item.children.push(code)
      } else {
        listLevels = []
        if (blocks.at(-1)?.type === 'spacer') blocks.pop()
        blocks.push(code)
      }
      continue
    }

    if (!line.trim()) {
      if (listLevels.length && appendListContinuation(line)) continue
      if (listLevels.length) {
        pendingListBreak = true
        continue
      }
      flushAll()
      pushSpacer()
      continue
    }

    settlePendingListBreak(line)

    const list = line.match(LIST_ITEM)
    if (list) {
      flushParagraph()
      flushQuote()
      const ordered = /^\d/.test(list[2])
      appendListItem(indentation(list[1]), ordered ? 'orderedList' : 'bulletList', list[3].trim(), ordered ? Number.parseInt(list[2], 10) : 1)
      continue
    }

    if (appendListContinuation(line)) continue

    const heading = line.match(HEADING)
    if (heading) {
      flushAll()
      blocks.push({ type: 'heading', level: heading[1].length as 2 | 3, text: heading[2] })
      continue
    }

    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      listLevels = []
      quoteLines.push(quote[1])
      continue
    }

    listLevels = []
    flushQuote()
    paragraph.push(line)
  }

  flushAll()
  while (blocks.at(-1)?.type === 'spacer') blocks.pop()
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', text: body }]
}

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/

function isPunctuation(character: string) {
  return character !== '' && (ASCII_PUNCTUATION.test(character) || /^[\p{P}\p{S}]$/u.test(character))
}

/** Start and end of the text count as whitespace for flanking. */
function isWhitespace(character: string) {
  return character === '' || /^\s$/u.test(character)
}

/** Splits trailing sentence punctuation (and an unbalanced closing parenthesis) off a bare URL. */
export function splitTrailingUrlPunctuation(value: string) {
  let href = value
  let trailing = ''

  while (/[.,!?;:*_~]$/.test(href) || (href.endsWith(')') && (href.match(/\(/g) || []).length < (href.match(/\)/g) || []).length)) {
    trailing = `${href.slice(-1)}${trailing}`
    href = href.slice(0, -1)
  }

  return { href, trailing }
}

function findBacktickCloser(text: string, from: number, length: number) {
  let index = text.indexOf('`', from)
  while (index >= 0) {
    let end = index
    while (text[end] === '`') end += 1
    if (end - index === length) return index
    index = text.indexOf('`', end)
  }
  return -1
}

function codeSpanText(raw: string) {
  const value = raw.replace(/\n/g, ' ')
  return /^ .*[^ ].* $/s.test(value) ? value.slice(1, -1) : value
}

/** `[label](href)` or `[label](href "title")` starting at `start`, skipping code spans and escapes in the label. */
function matchLink(text: string, start: number) {
  let depth = 0
  let index = start
  let labelEnd = -1
  while (index < text.length) {
    const character = text[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === '`') {
      let run = index
      while (text[run] === '`') run += 1
      const closer = findBacktickCloser(text, run, run - index)
      index = closer >= 0 ? closer + (run - index) : run
      continue
    }
    if (character === '[') depth += 1
    if (character === ']') {
      depth -= 1
      if (depth === 0) {
        labelEnd = index
        break
      }
    }
    index += 1
  }
  if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null

  let cursor = labelEnd + 2
  let parens = 1
  const hrefStart = cursor
  while (cursor < text.length) {
    const character = text[cursor]
    if (/\s/.test(character)) {
      const title = text.slice(cursor).match(/^\s+"[^"\n]*"\s*\)/)
      if (!title || parens !== 1) return null
      return { label: text.slice(start + 1, labelEnd), href: text.slice(hrefStart, cursor), end: cursor + title[0].length }
    }
    if (character === '\\' && cursor + 1 < text.length) {
      cursor += 2
      continue
    }
    if (character === '(') parens += 1
    if (character === ')') {
      parens -= 1
      if (parens === 0) {
        return { label: text.slice(start + 1, labelEnd), href: text.slice(hrefStart, cursor), end: cursor + 1 }
      }
    }
    cursor += 1
  }
  return null
}

type Delimiter = { kind: 'delimiter'; character: string; count: number; length: number; canOpen: boolean; canClose: boolean }
type InlineToken = { kind: 'node'; node: InlineNode } | Delimiter

function tokenText(token: InlineToken): InlineNode {
  return token.kind === 'node' ? token.node : { type: 'text', text: token.character.repeat(token.count) }
}

function mergeText(nodes: InlineNode[]) {
  const merged: InlineNode[] = []
  for (const node of nodes) {
    const previous = merged.at(-1)
    if (node.type === 'text' && previous?.type === 'text') previous.text += node.text
    else if (node.type !== 'text' || node.text) merged.push(node.type === 'text' ? { ...node } : node)
  }
  return merged
}

/** CommonMark's "process emphasis" over the delimiter runs, plus GFM ~~strike~~ and ++underline++. */
function processEmphasis(tokens: InlineToken[]) {
  let closerIndex = 0
  while (closerIndex < tokens.length) {
    const closer = tokens[closerIndex]
    if (closer.kind !== 'delimiter' || !closer.canClose) {
      closerIndex += 1
      continue
    }

    let openerIndex = -1
    for (let index = closerIndex - 1; index >= 0; index -= 1) {
      const opener = tokens[index]
      if (opener.kind !== 'delimiter' || opener.character !== closer.character || !opener.canOpen) continue
      const emphasis = closer.character === '*' || closer.character === '_'
      if (emphasis && (opener.canClose || closer.canOpen) && (opener.length + closer.length) % 3 === 0 && !(opener.length % 3 === 0 && closer.length % 3 === 0)) continue
      openerIndex = index
      break
    }

    if (openerIndex < 0) {
      closerIndex += 1
      continue
    }

    const opener = tokens[openerIndex] as Delimiter
    const paired = closer.character === '~' || closer.character === '+'
    const used = paired || (opener.count >= 2 && closer.count >= 2) ? 2 : 1
    const type = closer.character === '~' ? 'strike' : closer.character === '+' ? 'underline' : used === 2 ? 'strong' : 'emphasis'
    const children = mergeText(tokens.slice(openerIndex + 1, closerIndex).map(tokenText))
    opener.count -= used
    closer.count -= used

    const replacement: InlineToken[] = []
    if (opener.count > 0) replacement.push(opener)
    replacement.push({ kind: 'node', node: { type, children } })
    if (closer.count > 0) replacement.push(closer)
    tokens.splice(openerIndex, closerIndex - openerIndex + 1, ...replacement)
    closerIndex = openerIndex + replacement.length - (closer.count > 0 ? 1 : 0)
  }
}

const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<]+/i
const AUTOLINK = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i

/** Parses one paragraph's inline Markdown. Link labels are parsed without nested links. */
export function parseInline(source: string, { links = true }: { links?: boolean } = {}): InlineNode[] {
  const text = source.replace(/\r\n?/g, '\n')
  const tokens: InlineToken[] = []
  let buffer = ''

  const flush = () => {
    if (buffer) tokens.push({ kind: 'node', node: { type: 'text', text: buffer } })
    buffer = ''
  }
  const pushNode = (node: InlineNode) => {
    flush()
    tokens.push({ kind: 'node', node })
  }

  let index = 0
  while (index < text.length) {
    const character = text[index]
    const before = index === 0 ? '' : text[index - 1]

    // A backslash makes ASCII punctuation literal; before a newline it is a line break.
    if (character === '\\' && (ASCII_PUNCTUATION.test(text[index + 1] || '') || text[index + 1] === '\n')) {
      buffer += text[index + 1]
      index += 2
      continue
    }

    if (character === '`') {
      let end = index
      while (text[end] === '`') end += 1
      const closer = findBacktickCloser(text, end, end - index)
      if (closer >= 0) {
        pushNode({ type: 'code', text: codeSpanText(text.slice(end, closer)) })
        index = closer + (end - index)
      } else {
        buffer += text.slice(index, end)
        index = end
      }
      continue
    }

    if (links && (character === '[' || (character === '!' && text[index + 1] === '['))) {
      const link = matchLink(text, character === '!' ? index + 1 : index)
      if (link) {
        pushNode({ type: 'link', href: link.href.trim().replace(/^<(.*)>$/, '$1'), children: parseInline(link.label, { links: false }) })
        index = link.end
        continue
      }
    }

    if (links && character === '<') {
      const autolink = text.slice(index).match(AUTOLINK)
      if (autolink) {
        pushNode({ type: 'link', href: autolink[1], children: [{ type: 'text', text: autolink[1].replace(/^mailto:/i, '') }] })
        index += autolink[0].length
        continue
      }
    }

    if (links && /[hHwW]/.test(character) && (isWhitespace(before) || /[*_~(]/.test(before))) {
      const bare = text.slice(index).match(BARE_URL)
      if (bare) {
        const { href } = splitTrailingUrlPunctuation(bare[0])
        if (/^(?:https?:\/\/|www\.)[^./]/i.test(href)) {
          pushNode({ type: 'link', href, children: [{ type: 'text', text: href }] })
          index += href.length
          continue
        }
      }
    }

    if (character === '*' || character === '_' || character === '~' || character === '+') {
      let end = index
      while (text[end] === character) end += 1
      const length = end - index
      if ((character === '~' || character === '+') && length !== 2) {
        buffer += text.slice(index, end)
        index = end
        continue
      }
      const after = text[end] || ''
      const leftFlanking = !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before))
      const rightFlanking = !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after))
      const underscore = character === '_'
      flush()
      tokens.push({
        kind: 'delimiter',
        character,
        count: length,
        length,
        canOpen: underscore ? leftFlanking && (!rightFlanking || isPunctuation(before)) : leftFlanking,
        canClose: underscore ? rightFlanking && (!leftFlanking || isPunctuation(after)) : rightFlanking,
      })
      index = end
      continue
    }

    buffer += character
    index += 1
  }

  flush()
  processEmphasis(tokens)
  return mergeText(tokens.map(tokenText))
}

export function inlinePlainText(nodes: InlineNode[]): string {
  return nodes.map((node) => node.type === 'text' || node.type === 'code' ? node.text : inlinePlainText(node.children)).join('')
}

type PlainTextOptions = { codeFirstLine?: boolean }

function codePlainText(code: string, { codeFirstLine = false }: PlainTextOptions) {
  return codeFirstLine ? code.trim().split('\n')[0] || '' : code
}

function listPlainText(block: MessageListBlock, options: PlainTextOptions): string[] {
  return block.items.flatMap((item) => [
    inlinePlainText(parseInline(item.text)),
    ...item.children.flatMap((child) => child.type === 'bulletList' || child.type === 'orderedList'
      ? listPlainText(child, options)
      : [child.type === 'code' ? codePlainText(child.code, options) : inlinePlainText(parseInline(child.text))]),
  ])
}

/**
 * The words a reader sees, without Markdown syntax, for previews and
 * notifications. `codeFirstLine` keeps only the first line of each code block.
 */
export function markdownToPlainText(body: string, options: PlainTextOptions = {}): string {
  if (!body) return ''
  return parseMessageBlocks(body)
    .flatMap((block) => {
      if (block.type === 'spacer') return []
      if (block.type === 'code') return [codePlainText(block.code, options)]
      if (block.type === 'bulletList' || block.type === 'orderedList') return listPlainText(block, options)
      return [inlinePlainText(parseInline(block.text))]
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
