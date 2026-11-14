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
 * - a backslash before ASCII punctuation makes it literal; common HTML
 *   entities (`&amp;`, `&quot;`, numeric ones) read as their character;
 * - fences (``` or ~~~) must start a line, may sit inside a list item (where
 *   they end with the item), and an unclosed fence ends with the message;
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

const BLOCK_TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul'
const ATTRIBUTE = String.raw`\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?`
/** CommonMark's HTML blocks (types 1-7): where each starts, and the line that ends it (null: a blank line). */
const HTML_BLOCKS: { start: RegExp; end: RegExp | null; interrupts: boolean }[] = [
  { start: /^ {0,3}<(?:pre|script|style|textarea)(?:\s|>|$)/i, end: /<\/(?:pre|script|style|textarea)>/i, interrupts: true },
  { start: /^ {0,3}<!--/, end: /-->/, interrupts: true },
  { start: /^ {0,3}<\?/, end: /\?>/, interrupts: true },
  { start: /^ {0,3}<![A-Za-z]/, end: />/, interrupts: true },
  { start: /^ {0,3}<!\[CDATA\[/, end: /\]\]>/, interrupts: true },
  { start: new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?:\\s|/?>|$)`, 'i'), end: null, interrupts: true },
  { start: new RegExp(`^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:${ATTRIBUTE})*\\s*/?>|</[A-Za-z][A-Za-z0-9-]*\\s*>)\\s*$`), end: null, interrupts: false },
]

type ParsedBlock = MessageBlock | { type: 'html'; text: string }

export function parseMessageBlocks(source: string): MessageBlock[] {
  return parseBlocks(source, false) as MessageBlock[]
}

/**
 * The message block structure. With `html`, lines that start a CommonMark
 * HTML block outside a list item become one `html` block, as typed, the way
 * long-form text reads them (`markdownToPlainText`'s `longForm`).
 */
function parseBlocks(source: string, html: boolean): ParsedBlock[] {
  // CommonMark reads a NUL character as U+FFFD.
  const body = source.replace(/\r\n?/g, '\n').replace(/\0/g, '\ufffd')
  const blocks: ParsedBlock[] = []
  const lines = body.replace(/^\n+|\n+$/g, '').split('\n')
  let paragraph: string[] = []
  // `indent` is the marker's column, `content` the column of its latest item's text.
  let listLevels: { indent: number; content: number; block: MessageListBlock }[] = []
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

  const appendListItem = (indent: number, content: number, type: MessageListBlock['type'], text: string, number: number) => {
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
      listLevels.push({ indent, content, block })
      current = listLevels[listLevels.length - 1]
    }
    current.content = content
    current.block.items.push({ text, children: [] })
  }

  /** The list level whose latest item owns an indented line, after closing deeper lists. */
  const continuationLevel = (indent: number) => {
    if (!listLevels.length || indent <= listLevels[0].indent) return null
    while (listLevels.length > 1 && listLevels.at(-1)!.indent >= indent) listLevels.pop()
    return listLevels.at(-1)!
  }
  const continuationItem = (indent: number) => continuationLevel(indent)?.block.items.at(-1) ?? null

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

  /**
   * The code after a fence opener at `start - 1`, and the last line it uses: its closing line, or
   * the end (an unclosed fence ends with the message). A fence in a list item also ends with the
   * item, before the first line indented less than `container`, which is then read normally.
   */
  const readFence = (start: number, marker: string, indent: number, container: number | null = null) => {
    const codeLines: string[] = []
    let cursor = start
    while (cursor < lines.length && !closesFence(lines[cursor], marker)) {
      if (container !== null && lines[cursor].trim() && leadingIndent(lines[cursor]) < container) {
        return { end: cursor - 1, code: trimBlankLines(codeLines.join('\n')) }
      }
      codeLines.push(stripIndent(lines[cursor], indent))
      cursor += 1
    }
    return { end: cursor, code: trimBlankLines(codeLines.join('\n')) }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    const fence = fenceOpener(line)
    if (fence) {
      settlePendingListBreak(line)
      flushParagraph()
      flushQuote()
      const level = continuationLevel(fence.indent)
      const fenced = readFence(index + 1, fence.marker, fence.indent, level && Math.min(level.content, fence.indent))
      index = fenced.end
      const code: MessageCodeBlock = { type: 'code', language: fence.language, code: fenced.code }
      if (level) {
        level.block.items.at(-1)!.children.push(code)
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

    const htmlBlock = html && leadingIndent(line) <= 3 && !(listLevels.length && leadingIndent(line) > listLevels[0].indent)
      ? HTML_BLOCKS.find(({ start, interrupts }) => start.test(line) && (interrupts || !paragraph.length))
      : undefined
    if (htmlBlock) {
      flushAll()
      let end = index
      while (end + 1 < lines.length && (htmlBlock.end ? !htmlBlock.end.test(lines[end]) : lines[end + 1].trim())) end += 1
      blocks.push({ type: 'html', text: lines.slice(index, end + 1).join('\n') })
      index = end
      continue
    }

    const list = line.match(LIST_ITEM)
    if (list) {
      flushParagraph()
      flushQuote()
      const ordered = /^\d/.test(list[2])
      // A fence can start on the item's own line ("- ```rb"); its code lines up with the item text.
      const itemFence = fenceOpener(list[3])
      const content = indentation(line.slice(0, line.length - list[3].length))
      appendListItem(indentation(list[1]), content, ordered ? 'orderedList' : 'bulletList', itemFence ? '' : list[3].trim(), ordered ? Number.parseInt(list[2], 10) : 1)
      if (itemFence) {
        const fenced = readFence(index + 1, itemFence.marker, content, content)
        index = fenced.end
        listLevels.at(-1)!.block.items.at(-1)!.children.push({ type: 'code', language: itemFence.language, code: fenced.code })
      }
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

/** micromark's character classes: whitespace (start and end of text included), punctuation, or neither. */
function classify(character: string) {
  if (isWhitespace(character)) return 'whitespace'
  return isPunctuation(character) ? 'punctuation' : undefined
}

/** micromark treats a neighbouring `*`, `_` or `~` as a word character for emphasis. */
const isAttentionMarker = (character: string) => character !== '' && '*_~'.includes(character)

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

type Delimiter = { kind: 'delimiter'; character: string; count: number; canOpen: boolean; canClose: boolean }
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

/**
 * CommonMark's "process emphasis" over the delimiter runs, plus GFM ~~strike~~
 * and ++underline++, matching micromark (react-markdown) where it refines the
 * spec: the rule of three uses what is left of each run.
 */
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
      if (emphasis && (opener.canClose || closer.canOpen) && closer.count % 3 !== 0 && (opener.count + closer.count) % 3 === 0) continue
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

/**
 * Named entities as name:code point (base 36): HTML4's, `apos`, and HTML5's
 * uppercase spellings of them (`&AMP;`), with HTML5's values. Other HTML5
 * names stay as typed here (docs/MARKDOWN.md).
 */
const NAMED_ENTITIES = new Map((
  'nbsp:4g iexcl:4h cent:4i pound:4j curren:4k yen:4l brvbar:4m sect:4n uml:4o copy:4p ordf:4q laquo:4r not:4s ' +
  'shy:4t reg:4u macr:4v deg:4w plusmn:4x sup2:4y sup3:4z acute:50 micro:51 para:52 middot:53 cedil:54 sup1:55 ' +
  'ordm:56 raquo:57 frac14:58 frac12:59 frac34:5a iquest:5b Agrave:5c Aacute:5d Acirc:5e Atilde:5f Auml:5g ' +
  'Aring:5h AElig:5i Ccedil:5j Egrave:5k Eacute:5l Ecirc:5m Euml:5n Igrave:5o Iacute:5p Icirc:5q Iuml:5r ETH:5s ' +
  'Ntilde:5t Ograve:5u Oacute:5v Ocirc:5w Otilde:5x Ouml:5y times:5z Oslash:60 Ugrave:61 Uacute:62 Ucirc:63 ' +
  'Uuml:64 Yacute:65 THORN:66 szlig:67 agrave:68 aacute:69 acirc:6a atilde:6b auml:6c aring:6d aelig:6e ccedil:6f ' +
  'egrave:6g eacute:6h ecirc:6i euml:6j igrave:6k iacute:6l icirc:6m iuml:6n eth:6o ntilde:6p ograve:6q oacute:6r ' +
  'ocirc:6s otilde:6t ouml:6u divide:6v oslash:6w ugrave:6x uacute:6y ucirc:6z uuml:70 yacute:71 thorn:72 yuml:73 ' +
  'fnof:b6 Alpha:pd Beta:pe Gamma:pf Delta:pg Epsilon:ph Zeta:pi Eta:pj Theta:pk Iota:pl Kappa:pm Lambda:pn Mu:po ' +
  'Nu:pp Xi:pq Omicron:pr Pi:ps Rho:pt Sigma:pv Tau:pw Upsilon:px Phi:py Chi:pz Psi:q0 Omega:q1 alpha:q9 beta:qa ' +
  'gamma:qb delta:qc epsilon:qd zeta:qe eta:qf theta:qg iota:qh kappa:qi lambda:qj mu:qk nu:ql xi:qm omicron:qn ' +
  'pi:qo rho:qp sigmaf:qq sigma:qr tau:qs upsilon:qt phi:qu chi:qv psi:qw omega:qx thetasym:r5 upsih:r6 piv:ra ' +
  'bull:6ci hellip:6cm prime:6cy Prime:6cz oline:6da frasl:6dg weierp:6jc image:6j5 real:6jg trade:6jm ' +
  'alefsym:6k5 larr:6mo uarr:6mp rarr:6mq darr:6mr harr:6ms crarr:6np lArr:6og uArr:6oh rArr:6oi dArr:6oj ' +
  'hArr:6ok forall:6ps part:6pu exist:6pv empty:6px nabla:6pz isin:6q0 notin:6q1 ni:6q3 prod:6q7 sum:6q9 ' +
  'minus:6qa lowast:6qf radic:6qi prop:6ql infin:6qm ang:6qo and:6qv or:6qw cap:6qx cup:6qy int:6qz there4:6r8 ' +
  'sim:6rg cong:6rp asymp:6rs ne:6sg equiv:6sh le:6sk ge:6sl sub:6te sup:6tf nsub:6tg sube:6ti supe:6tj oplus:6tx ' +
  'otimes:6tz perp:6ud sdot:6v9 lceil:6x4 rceil:6x5 lfloor:6x6 rfloor:6x7 lang:7vs rang:7vt loz:7gq spades:7kw ' +
  'clubs:7kz hearts:7l1 diams:7l2 quot:y amp:12 lt:1o gt:1q OElig:9e oelig:9f Scaron:9s scaron:9t Yuml:ag circ:jq ' +
  'tilde:kc ensp:6bm emsp:6bn thinsp:6bt zwnj:6bw zwj:6bx lrm:6by rlm:6bz ndash:6c3 mdash:6c4 lsquo:6c8 rsquo:6c9 ' +
  'sbquo:6ca ldquo:6cc rdquo:6cd bdquo:6ce dagger:6cg Dagger:6ch permil:6cw lsaquo:6d5 rsaquo:6d6 euro:6gc ' +
  'apos:13 AMP:12 COPY:4p ForAll:6ps GT:1q LT:1o QUOT:y REG:4u Sum:6q9 TRADE:6jm'
).split(' ').map((entry) => {
  const [name, code] = entry.split(':')
  return [name, String.fromCodePoint(Number.parseInt(code, 36))] as const
}))
const ENTITY = /^&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z][a-zA-Z\d]{1,31}));/

/** An HTML entity as CommonMark reads it (`&amp;` is "&"), or null to keep the text as typed. */
function decodeEntity(text: string) {
  const match = text.match(ENTITY)
  if (!match) return null
  if (match[3]) {
    const character = NAMED_ENTITIES.get(match[3])
    return character === undefined ? null : { text: character, length: match[0].length }
  }
  const codePoint = match[1] ? Number(match[1]) : Number.parseInt(match[2], 16)
  const character = codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff) ? String.fromCodePoint(codePoint) : '\ufffd'
  return { text: character, length: match[0].length }
}

const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<]+/i
const AUTOLINK = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i
const EMAIL_AUTOLINK = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/

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

    if (character === '&') {
      const entity = decodeEntity(text.slice(index))
      if (entity) {
        buffer += entity.text
        index += entity.length
        continue
      }
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
      // The label is the text between the brackets, as CommonMark shows it.
      const autolink = text.slice(index).match(AUTOLINK)
      const email = autolink ? null : text.slice(index).match(EMAIL_AUTOLINK)
      if (autolink || email) {
        const label = (autolink || email)![1]
        pushNode({ type: 'link', href: email ? `mailto:${label}` : label, children: [{ type: 'text', text: label }] })
        index += (autolink || email)![0].length
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
      const beforeClass = classify(before)
      const afterClass = classify(after)
      // CommonMark's left- and right-flanking runs, as micromark computes them.
      const emphasis = character === '*' || character === '_'
      const leftFlanking = !afterClass || (afterClass === 'punctuation' && Boolean(beforeClass)) || (emphasis && isAttentionMarker(after))
      const rightFlanking = !beforeClass || (beforeClass === 'punctuation' && Boolean(afterClass)) || (emphasis && isAttentionMarker(before))
      const underscore = character === '_'
      flush()
      tokens.push({
        kind: 'delimiter',
        character,
        count: length,
        canOpen: underscore ? leftFlanking && (Boolean(beforeClass) || !rightFlanking) : leftFlanking,
        canClose: underscore ? rightFlanking && (Boolean(afterClass) || !leftFlanking) : rightFlanking,
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

type PlainTextOptions = { codeFirstLine?: boolean; longForm?: boolean }

function codePlainText(code: string, { codeFirstLine = false }: PlainTextOptions) {
  return codeFirstLine ? code.trim().split('\n')[0] || '' : code
}

const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const TABLE_DIVIDER = /^(?=[^|]*\|)[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

/** A GFM table row as text: unescaped pipes separate cells, and `\|` is a literal pipe (even in code). */
function tableRowText(line: string) {
  return line.replace(/\\[\s\S]|\|/g, (match) => match === '|' ? ' ' : match === '\\|' ? '|' : match)
}

/**
 * One paragraph's words. `longForm` reads the lines CommonMark gives meaning to
 * and the message parser doesn't: # and #### headings, --- rules, GFM tables,
 * and HTML blocks (kept exactly as typed, entities included).
 */
function textPlainText(text: string, { longForm = false }: PlainTextOptions) {
  if (!longForm) return inlinePlainText(parseInline(text))
  if (HTML_BLOCKS.some(({ start }) => start.test(text))) return text
  const lines = text.split('\n')
  const table = lines.some((line) => TABLE_DIVIDER.test(line))
  const kept = lines
    .filter((line) => !THEMATIC_BREAK.test(line) && !(table && TABLE_DIVIDER.test(line)))
    .map((line) => {
      if (table) return tableRowText(line)
      const heading = line.match(ATX_HEADING)
      return heading ? heading[1] || '' : line
    })
  return inlinePlainText(parseInline(kept.join('\n')))
}

function listPlainText(block: MessageListBlock, options: PlainTextOptions): string[] {
  return block.items.flatMap((item) => [
    textPlainText(item.text, options),
    ...item.children.flatMap((child) => child.type === 'bulletList' || child.type === 'orderedList'
      ? listPlainText(child, options)
      : [child.type === 'code' ? codePlainText(child.code, options) : textPlainText(child.text, options)]),
  ])
}

/**
 * The words a reader sees, without Markdown syntax, for previews and
 * notifications, read from the parsed structure: code keeps its text, escapes
 * and entities read as they render. `codeFirstLine` keeps only the first line
 * of each code block; `longForm` reads long-form-only lines (textPlainText)
 * and HTML blocks, which stay as typed (fences and list markers inside them too).
 */
export function markdownToPlainText(body: string, options: PlainTextOptions = {}): string {
  if (!body) return ''
  return parseBlocks(body, Boolean(options.longForm))
    .flatMap((block) => {
      if (block.type === 'spacer') return []
      if (block.type === 'html') return [block.text]
      if (block.type === 'code') return [codePlainText(block.code, options)]
      if (block.type === 'bulletList' || block.type === 'orderedList') return listPlainText(block, options)
      return [textPlainText(block.text, options)]
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
