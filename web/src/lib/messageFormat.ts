import type { JSONContent } from '@tiptap/core'

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
} from './markdownCore'
import { parseInline } from './markdownCore'

/**
 * Drops blank lines at the start and end of written Markdown, and nothing
 * else: the first line keeps its indentation (`    code` is an indented code
 * block) and the last keeps its trailing spaces, so text is stored as typed.
 * Use it instead of `.trim()` before saving.
 */
export function trimBlankLines(markdown: string): string {
  if (!markdown.trim()) return ''
  return markdown.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')
}

const EMPTY_LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s*$/
const MESSAGE_FENCE = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/
const MESSAGE_LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/
/** CommonMark HTML blocks that run across blank lines until their end marker (types 1-5). */
const MULTILINE_HTML: { start: RegExp; end: RegExp }[] = [
  { start: /^ {0,3}<(?:pre|script|style|textarea)(?:\s|>|$)/i, end: /<\/(?:pre|script|style|textarea)>/i },
  { start: /^ {0,3}<!--/, end: /-->/ },
  { start: /^ {0,3}<\?/, end: /\?>/ },
  { start: /^ {0,3}<![A-Za-z]/, end: />/ },
  { start: /^ {0,3}<!\[CDATA\[/, end: /\]\]>/ },
]

function columns(line: string) {
  let count = 0
  for (const character of line.match(/^[ \t]*/)![0]) count += character === '\t' ? 4 - count % 4 : 1
  return count
}

/**
 * The body a message is sent or saved with. Outside code it collapses runs
 * of blank lines into one and drops list markers with nothing after them
 * (an empty bullet left in the composer). Fenced code, indented code (at the
 * top level or inside a list item) and HTML blocks that run across blank
 * lines are kept byte for byte, as is every other line: only blank lines
 * between blocks and empty markers change.
 */
export function normalizeMessageMarkdown(body: string): string {
  const output: string[] = []
  let fence: string | null = null
  let htmlEnd: RegExp | null = null
  /** The column indented code must reach to continue, while inside it. */
  let codeIndent: number | null = null
  /** Content columns of the open list items, outermost first. */
  const items: { indent: number; content: number }[] = []
  let blanks: string[] = []
  /** Can an indented line start code here (start of text, after a blank line, a fence or a heading)? */
  let blockStart = true

  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) {
      output.push(line)
      const close = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        fence = null
        blockStart = true
      }
      continue
    }
    if (htmlEnd) {
      output.push(line)
      if (htmlEnd.test(line)) htmlEnd = null
      continue
    }
    if (!line.trim()) {
      blanks.push(line)
      continue
    }

    const indent = columns(line)
    const afterBlank = blanks.length > 0
    if (codeIndent !== null) {
      if (indent >= codeIndent) {
        // Blank lines inside indented code are part of the code.
        output.push(...blanks, line)
        blanks = []
        continue
      }
      codeIndent = null
    }
    if (blanks.length) {
      if (output.length) output.push(blanks.length === 1 ? blanks[0] : '')
      blanks = []
    }

    // After a blank line, a line belongs to the deepest list item it's indented into.
    if (afterBlank) while (items.length && items[items.length - 1].content > indent) items.pop()
    const base = items.length ? items[items.length - 1].content : 0
    if ((afterBlank || blockStart) && indent >= base + 4) {
      codeIndent = base + 4
      output.push(line)
      continue
    }
    blockStart = false

    const opener = line.match(MESSAGE_FENCE)
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      fence = opener[1]
      output.push(line)
      continue
    }
    const html = MULTILINE_HTML.find(({ start }) => start.test(line))
    if (html) {
      if (!html.end.test(line.replace(html.start, ''))) htmlEnd = html.end
      output.push(line)
      continue
    }
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) blockStart = true

    // A marker with nothing after it is dropped, so it doesn't start a list item either.
    if (EMPTY_LIST_MARKER.test(line)) continue
    const item = line.match(MESSAGE_LIST_ITEM)
    if (item) {
      while (items.length && items[items.length - 1].indent >= indent) items.pop()
      items.push({ indent, content: columns(item[0].slice(0, -1).replace(/[^ \t]/g, ' ')) })
    }
    output.push(line)
  }

  return trimBlankLines(output.join('\n'))
}

/**
 * Tiptap JSON to the stored Markdown. What the sender sees is what the reader
 * gets: marks open and close across text runs (inline code innermost, so bold
 * around code stays bold), literal Markdown characters are escaped, and code
 * uses a backtick run longer than any inside it.
 */
export function editorJsonToMarkdown(node?: JSONContent): string {
  if (!node) return ''
  if (node.type === 'text') return serializeInline([node])

  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return serializeList(node, node.type === 'orderedList')
  }

  switch (node.type) {
    case 'doc':
      return serializeDoc(node.content || [])
    case 'paragraph':
      return serializeInline(node.content || [])
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 2), 3)
      return `${'#'.repeat(level)} ${serializeInline(node.content || [])}`
    }
    case 'hardBreak':
      return '\n'
    case 'rawMarkdown':
      // Markdown Rich mode can't edit (a table, raw HTML…) is kept byte for byte.
      return String(node.attrs?.markdown ?? '')
    case 'codeBlock':
      return codeFence((node.content || []).map((child) => child.text || '').join(''), String(node.attrs?.language || ''))
    case 'blockquote':
      return (node.content || []).map((child) => editorJsonToMarkdown(child)).join('\n')
        .split('\n').map((line) => line ? `> ${line}` : '>').join('\n')
    default:
      return (node.content || []).map((child) => editorJsonToMarkdown(child)).join('')
  }
}

/**
 * Blocks joined by a blank line. A locked `rawMarkdown` block keeps every
 * byte, including leading indentation (`    indented code`) and trailing
 * spaces, wherever it sits; only whitespace the editor itself wrote (empty
 * paragraphs at either end, spaces at the outer edges of editable blocks) is
 * trimmed.
 */
function serializeDoc(children: JSONContent[]): string {
  const parts = children.map((child) => ({ raw: child.type === 'rawMarkdown', text: editorJsonToMarkdown(child) }))
  const droppable = (part: { raw: boolean; text: string }) => (part.raw ? part.text === '' : !part.text.trim())
  while (parts.length && droppable(parts[0])) parts.shift()
  while (parts.length && droppable(parts[parts.length - 1])) parts.pop()
  if (parts.length === 0) return ''
  const first = parts[0]
  const last = parts[parts.length - 1]
  if (!first.raw) first.text = first.text.trimStart()
  if (!last.raw) last.text = last.text.trimEnd()
  return parts.map((part) => part.text).join('\n\n')
}

function serializeList(node: JSONContent, ordered: boolean): string {
  const items = (node.content || []).map((item) => {
    const [firstChild, ...remainingChildren] = item.content || []
    const lines = [firstChild ? editorJsonToMarkdown(firstChild) : '']
    const continuation = remainingChildren
      .map((child) => editorJsonToMarkdown(child))
      .filter(Boolean)
    return [...lines, ...continuation].join('\n').trimEnd()
  }).filter((item) => item.trim().length > 0)

  // A numbered list keeps its starting number (a list split by a code block continues at 2).
  const requestedStart = Number(node.attrs?.start ?? 1)
  const start = Number.isInteger(requestedStart) && requestedStart >= 0 && requestedStart < 1e9 ? requestedStart : 1
  return items.map((item, index) => {
    const marker = ordered ? `${start + index}.` : '-'
    // Continuation lines line up with the item text, so CommonMark keeps them in the item.
    const indent = ' '.repeat(marker.length + 1)
    return `${marker} ${item.split('\n').map((line, lineIndex) => lineIndex === 0 || !line ? line : `${indent}${line}`).join('\n')}`
  }).join('\n')
}

function longestBacktickRun(text: string) {
  return Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length))
}

function codeFence(code: string, language: string) {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1))
  return `${fence}${language.replace(/[`\s]/g, '')}\n${code}\n${fence}`
}

function codeSpan(text: string) {
  const fence = '`'.repeat(longestBacktickRun(text) + 1)
  const pad = /^`|`$/.test(text) || /^ .*[^ ].* $/s.test(text) ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

type Mark = NonNullable<JSONContent['marks']>[number]
type OpenMark = { mark: Mark; delimiter: string }
/** `verbatim`: a URL written exactly as typed (a bare URL or `<autolink>`), never escaped. */
type Segment = { text: string; marks: Mark[]; code: boolean; lineBreak: boolean; verbatim?: boolean }

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline']
const sameMark = (a: Mark, b: Mark) => a.type === b.type && (a.type !== 'link' || a.attrs?.href === b.attrs?.href)
const isWordCharacter = (character: string) => /^[\p{L}\p{N}]$/u.test(character)
const isFlankingSpace = (character: string) => character === '' || /^\s$/u.test(character)
const isFlankingPunctuation = (character: string) => character !== '' && /^[\p{P}\p{S}]$/u.test(character)

function linkHref(mark: Mark) {
  return String(mark.attrs?.href || '').trim().replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

const leftFlanking = (before: string, after: string) => !isFlankingSpace(after)
  && (!isFlankingPunctuation(after) || isFlankingSpace(before) || isFlankingPunctuation(before))
const rightFlanking = (before: string, after: string) => !isFlankingSpace(before)
  && (!isFlankingPunctuation(before) || isFlankingSpace(after) || isFlankingPunctuation(after))

/** Could a delimiter run here open emphasis? (CommonMark left-flanking, with `_`'s intraword rule.) */
function canOpen(character: string, before: string, after: string) {
  const left = leftFlanking(before, after)
  if (character !== '_') return left
  return left && (!rightFlanking(before, after) || isFlankingPunctuation(before))
}

/**
 * Could a `*` run here open or close emphasis? micromark's flanking rules,
 * which also count a neighbouring `*`, `_` or `~` (a superset of CommonMark's).
 */
function starCouldFormat(before: string, after: string) {
  const marker = (character: string) => character !== '' && '*_~'.includes(character)
  const left = !isFlankingSpace(after) && (!isFlankingPunctuation(after) || isFlankingSpace(before) || isFlankingPunctuation(before))
  const right = !isFlankingSpace(before) && (!isFlankingPunctuation(before) || isFlankingSpace(after) || isFlankingPunctuation(after))
  return left || right || marker(before) || marker(after)
}

/**
 * Escapes plain text so it reads back exactly as typed. Only what could become
 * syntax is escaped: a `*` run that could open or close emphasis (`2 * 3`
 * stays as typed, `*word*` doesn't), every backtick, every `_` that isn't
 * inside a word (snake_case stays as typed), `~~` and `++` that could open
 * formatting, or close one the serializer wrote (C++ stays as typed), link
 * brackets, entities, and markers at the start of a line (lists, quotes,
 * headings, fences). At the edges of the text, where a delimiter may touch it,
 * a `_`, `~` or `+` is escaped so it can't join the delimiter's run, and a `\`
 * so it can't escape the delimiter.
 */
function escapeText(text: string, output: string, active: OpenMark[]) {
  let result = ''
  let lineStart = output.split('\n').at(-1)!.trim() === ''
  const delimiterOpen = (character: string) => active.some((open) => open.delimiter.includes(character))
  /** Could this run close an open `~~` or `++`? At the end of the text, a closing delimiter may follow it. */
  const couldClose = (character: string, before: string, after: string | null) => delimiterOpen(character)
    && (after === null ? rightFlanking(before, 'a') || rightFlanking(before, '*') : rightFlanking(before, after))
  // Trailing spaces move outside a closing delimiter (closeFrom), so the delimiter may follow them.
  const atEdge = (position: number) => !text.slice(position).trim()
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const before = index === 0 ? output.slice(-1) : text[index - 1]
    // Assume a letter follows the end of this run; the next segment may start with one.
    const after = index + 1 < text.length ? text[index + 1] : 'a'

    if (character === '\n') {
      lineStart = true
      result += character
      continue
    }
    if (lineStart && /\S/.test(character)) {
      lineStart = false
      const line = text.slice(index).split('\n')[0]
      if (/^(?:#{1,6}(?:\s|$)|>|[-+*](?:\s|$)|(?:=+|-+)\s*$|~~~|\[[^\]]*\]:)/.test(line)) {
        result += `\\${character}`
        continue
      }
      const ordered = line.match(/^(\d{1,9})([.)])(?=\s|$)/)
      if (ordered) {
        result += `${ordered[1]}\\${ordered[2]}`
        index += ordered[0].length - 1
        continue
      }
    }

    if (character === '\\') {
      // At the edge a delimiter may follow, after any trailing spaces move outside it (closeFrom).
      result += /^[!-/:-@[-`{-~]$/.test(after) || atEdge(index + 1) ? '\\\\' : '\\'
    } else if (character === '*') {
      let end = index
      while (text[end] === '*') end += 1
      const run = text.slice(index, end)
      result += starCouldFormat(before, atEdge(end) ? 'a' : text[end]) ? run.replace(/\*/g, '\\*') : run
      index = end - 1
    } else if (character === '`') {
      result += `\\${character}`
    } else if (character === '_') {
      // Inside a word `_` never formats; anywhere else a parser may pair it.
      result += isWordCharacter(before) && !atEdge(index + 1) && isWordCharacter(text[index + 1]) ? '_' : '\\_'
    } else if ((character === '~' || character === '+') && after === character && before !== character && text[index + 2] !== character) {
      // Only an exact pair (~~ or ++) formats; escape it when it could open or close.
      const known = atEdge(index + 2) ? null : text[index + 2]
      result += canOpen(character, before, known ?? 'a') || couldClose(character, before, known) ? `\\${character}` : character
    } else if ((character === '~' || character === '+') && ((index === 0 && before === character) || atEdge(index + 1))) {
      result += `\\${character}`
    } else if (character === '[' && /^\[[^\]\n]*\](?:\(|$)/.test(text.slice(index))) {
      result += '\\['
    } else if (character === '&' && /^&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i.test(text.slice(index))) {
      result += '\\&'
    } else {
      result += character
    }
  }
  return result
}

function segmentsFor(nodes: JSONContent[]): Segment[] {
  return nodes.map((node) => {
    if (node.type === 'hardBreak') return { text: '\n', marks: [], code: false, lineBreak: true }
    const marks = (node.marks || []).filter((mark) => MARK_ORDER.includes(mark.type))
    const code = (node.marks || []).some((mark) => mark.type === 'code')
    return { text: node.type === 'text' ? node.text || '' : editorJsonToMarkdown(node), marks, code, lineBreak: false }
  })
}

const FORMATTING = ['bold', 'italic', 'strike', 'underline']
const hasMark = (segment: Segment, mark: Mark) => segment.marks.some((candidate) => sameMark(candidate, mark))
/** The first or last character a delimiter would touch ('' for code, which starts and ends with a backtick). */
const edgeCharacter = (segment: Segment, end: boolean) => segment.code ? '' : end ? segment.text.slice(-1) : segment.text[0] || ''

/**
 * A closing delimiter between punctuation and a letter (`*end.*next`, or
 * `*foo_*bar`) doesn't close in CommonMark, and an opening one between a
 * letter and punctuation (`foo*.bar*`) doesn't open, so the reader would see
 * the asterisks. When no other delimiter sits between them, that punctuation
 * moves outside the mark: the text stays exactly as typed and only the
 * punctuation loses the mark (docs/MARKDOWN.md).
 */
function moveUnflankedPunctuation(segments: Segment[]): Segment[] {
  const result = [...segments]
  for (let index = 0; index + 1 < result.length; index += 1) {
    const current = result[index]
    const next = result[index + 1]
    if (current.lineBreak || next.lineBreak) continue
    const formatting = (segment: Segment) => segment.marks.filter((mark) => FORMATTING.includes(mark.type))
    const closing = formatting(current).filter((mark) => !hasMark(next, mark))
    const opening = formatting(next).filter((mark) => !hasMark(current, mark))
    // A link's brackets are punctuation, so a link opening or closing here already separates them.
    const linkChanges = [...current.marks, ...next.marks].some((mark) => mark.type === 'link' && !(hasMark(current, mark) && hasMark(next, mark)))
    if (linkChanges || (closing.length > 0) === (opening.length > 0)) continue

    const trailing = current.code ? '' : current.text.match(/[\p{P}\p{S}]+$/u)?.[0] || ''
    const leading = next.code ? '' : next.text.match(/^[\p{P}\p{S}]+/u)?.[0] || ''
    if (closing.length && trailing && isWordCharacter(edgeCharacter(next, false))) {
      const moved = { ...current, text: trailing, marks: current.marks.filter((mark) => !closing.includes(mark)) }
      const kept = current.text.slice(0, -trailing.length)
      result.splice(index, 1, ...(kept ? [{ ...current, text: kept }] : []), moved)
      index = Math.max(-1, index - 2)
    } else if (opening.length && leading && isWordCharacter(edgeCharacter(current, true))) {
      const moved = { ...next, text: leading, marks: next.marks.filter((mark) => !opening.includes(mark)) }
      const kept = next.text.slice(leading.length)
      result.splice(index + 1, 1, moved, ...(kept ? [{ ...next, text: kept }] : []))
    }
  }
  return result
}

/**
 * Links that may be written as typed: a whole, unformatted-inside link whose
 * mark doesn't ask for `[text](url)`. A link parsed from a bare URL has
 * spelling `bare`, from `<https://…>` `angle`, from `[text](url)` `inline`;
 * links made in Rich mode (typed, pasted or added) default to `bare`.
 */
function autolinkCandidates(segments: Segment[]): number[] {
  const candidates: number[] = []
  segments.forEach((segment, index) => {
    if (segment.code || segment.lineBreak || !segment.text) return
    const link = segment.marks.find((mark) => mark.type === 'link')
    if (!link || link.attrs?.spelling === 'inline') return
    const continues = (other?: Segment) => Boolean(other && !other.lineBreak && other.marks.some((mark) => sameMark(mark, link)))
    if (continues(segments[index - 1]) || continues(segments[index + 1])) return
    candidates.push(index)
  })
  return candidates
}

function asAutolink(segment: Segment): Segment {
  const link = segment.marks.find((mark) => mark.type === 'link')
  const text = link?.attrs?.spelling === 'angle' ? `<${segment.text}>` : segment.text
  return { ...segment, text, verbatim: true, marks: segment.marks.filter((mark) => mark.type !== 'link') }
}

/**
 * What a reader sees in a paragraph, for checking a spelling choice. A `www.`
 * link reads the same with or without the scheme the renderers add to it.
 */
function inlineReading(markdown: string) {
  return JSON.stringify(parseInline(markdown), (key, value) => {
    if (key === 'autolink') return undefined
    if (key === 'href' && typeof value === 'string') return value.replace(/^https?:\/\/(?=www\.)/i, '')
    return value
  })
}

/**
 * Bare URLs and `<autolinks>` are stored as typed (docs/MARKDOWN.md). A link
 * is written that way only when the paragraph still reads exactly the same
 * as with `[text](url)` (a link whose text was changed, or a URL with a
 * letter typed right after it, keeps the brackets).
 */
function serializeInline(nodes: JSONContent[]): string {
  const segments = segmentsFor(nodes)
  const write = (verbatim: Set<number>) => writeSegments(moveUnflankedPunctuation(
    verbatim.size ? segments.map((segment, index) => (verbatim.has(index) ? asAutolink(segment) : segment)) : segments,
  ))
  const bracketed = write(new Set())
  const candidates = autolinkCandidates(segments)
  if (candidates.length === 0) return bracketed

  const reading = inlineReading(bracketed)
  const all = write(new Set(candidates))
  if (inlineReading(all) === reading) return all
  let kept = new Set<number>()
  let best = bracketed
  for (const candidate of candidates) {
    const trial = new Set([...kept, candidate])
    const output = write(trial)
    if (inlineReading(output) === reading) {
      kept = trial
      best = output
    }
  }
  return best
}

function writeSegments(segments: Segment[]): string {
  let output = ''
  let active: OpenMark[] = []

  const closeFrom = (count: number) => {
    if (active.length <= count) return
    // Closing delimiters must touch text, so move trailing spaces outside them.
    const trailing = output.match(/\s*$/)![0]
    output = output.slice(0, output.length - trailing.length)
    for (const open of active.slice(count).reverse()) {
      output += open.mark.type === 'link' ? `](${linkHref(open.mark)})` : open.delimiter
    }
    output += trailing
    active = active.slice(0, count)
  }

  /** How many segments from `from` keep `mark`, and the first character after them ('' at the end). */
  const markExtent = (from: number, mark: Mark) => {
    for (let index = from; index < segments.length; index += 1) {
      const segment = segments[index]
      if (segment.lineBreak) return { length: index - from, after: '' }
      if (!segment.marks.some((candidate) => sameMark(candidate, mark))) {
        // Trailing spaces move outside the closing delimiter (closeFrom).
        const last = segments[index - 1]
        if (!last.code && /\s$/.test(last.text)) return { length: index - from, after: ' ' }
        // A mark opening there puts its delimiter (punctuation) next.
        if (segment.marks.some((candidate) => !hasMark(last, candidate))) return { length: index - from, after: '*' }
        return { length: index - from, after: segment.code ? '`' : segment.text[0] || '' }
      }
    }
    return { length: segments.length - from, after: '' }
  }

  segments.forEach((segment, index) => {
    if (segment.lineBreak) {
      // Close formatting at a line break so a marker on the next line can't become a list or quote.
      closeFrom(0)
      output += '\n'
      return
    }

    let keep = 0
    while (keep < active.length && segment.marks.some((mark) => sameMark(mark, active[keep].mark))) keep += 1
    const blank = !segment.code && !segment.text.trim()
    // The mark that lasts longest opens first, so it can close last.
    const added = blank ? [] : segment.marks
      .filter((mark) => !active.slice(0, keep).some((open) => sameMark(open.mark, mark)))
      .map((mark) => ({ mark, ...markExtent(index, mark) }))
      .sort((a, b) => b.length - a.length || MARK_ORDER.indexOf(a.mark.type) - MARK_ORDER.indexOf(b.mark.type))
    closeFrom(keep)

    let text = segment.text
    if (added.length > 0 && !segment.code) {
      const lead = text.match(/^\s*/)![0]
      output += lead
      text = text.slice(lead.length)
    }
    // `_` can't open or close inside a word; `*` can.
    const before = output.slice(-1)
    const underscoreFits = (after: string) => !isWordCharacter(before) && !isWordCharacter(after)
    added.forEach(({ mark, after }, position) => {
      let delimiter = ''
      if (mark.type === 'strike') delimiter = '~~'
      if (mark.type === 'underline') delimiter = '++'
      if (mark.type === 'bold' || mark.type === 'italic') {
        // Neighbouring runs of one character (`***`, or `**` closing into `**`)
        // pair differently across Markdown parsers, so alternate `*` and `_`.
        const underscore = underscoreFits(after)
        const next = added[position + 1]
        const nextUsesStar = next && (next.mark.type === 'bold' || next.mark.type === 'italic') && !underscoreFits(next.after)
        let character = mark.type === 'italic' && underscore ? '_' : '*'
        if (underscore && (output.endsWith(character) || (character === '*' && nextUsesStar))) character = character === '*' ? '_' : '*'
        delimiter = character.repeat(mark.type === 'bold' ? 2 : 1)
      }
      output += mark.type === 'link' ? '[' : delimiter
      active.push({ mark, delimiter })
    })

    output += segment.code ? codeSpan(text) : segment.verbatim ? text : escapeText(text, output, active)
  })

  closeFrom(0)
  return output
}
