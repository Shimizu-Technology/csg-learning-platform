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

const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})/

export function normalizeMessageMarkdown(body: string): string {
  let openFence = ''
  const lines = body.replace(/\r\n?/g, '\n').split('\n').filter((line) => {
    const fence = line.match(FENCE_LINE)?.[1]
    if (fence && (!openFence || (fence[0] === openFence[0] && fence.length >= openFence.length && !line.slice(line.indexOf(fence) + fence.length).trim()))) {
      openFence = openFence ? '' : fence
      return true
    }

    if (openFence) return true
    return !/^\s*(?:[-*+]|\d+[.)])\s*$/.test(line)
  })

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
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
      return (node.content || []).map((child) => editorJsonToMarkdown(child)).join('\n\n').trim()
    case 'paragraph':
      return serializeInline(node.content || [])
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 2), 3)
      return `${'#'.repeat(level)} ${serializeInline(node.content || [])}`
    }
    case 'hardBreak':
      return '\n'
    case 'codeBlock':
      return codeFence((node.content || []).map((child) => child.text || '').join(''), String(node.attrs?.language || ''))
    case 'blockquote':
      return (node.content || []).map((child) => editorJsonToMarkdown(child)).join('\n')
        .split('\n').map((line) => line ? `> ${line}` : '>').join('\n')
    default:
      return (node.content || []).map((child) => editorJsonToMarkdown(child)).join('')
  }
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

  return items.map((item, index) => {
    const marker = ordered ? `${index + 1}.` : '-'
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
type Segment = { text: string; marks: Mark[]; code: boolean; lineBreak: boolean }

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline']
const sameMark = (a: Mark, b: Mark) => a.type === b.type && (a.type !== 'link' || a.attrs?.href === b.attrs?.href)
const isWordCharacter = (character: string) => /^[\p{L}\p{N}]$/u.test(character)
const isFlankingSpace = (character: string) => character === '' || /^\s$/u.test(character)
const isFlankingPunctuation = (character: string) => character !== '' && /^[\p{P}\p{S}]$/u.test(character)

function linkHref(mark: Mark) {
  return String(mark.attrs?.href || '').trim().replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/** Could a delimiter run here open emphasis? (CommonMark left-flanking, with `_`'s intraword rule.) */
function canOpen(character: string, before: string, after: string) {
  const left = !isFlankingSpace(after) && (!isFlankingPunctuation(after) || isFlankingSpace(before) || isFlankingPunctuation(before))
  if (character !== '_') return left
  const right = !isFlankingSpace(before) && (!isFlankingPunctuation(before) || isFlankingSpace(after) || isFlankingPunctuation(after))
  return left && (!right || isFlankingPunctuation(before))
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
 * stays as typed, `*word*` doesn't), every backtick, `_`, `~~` and `++` that
 * could open formatting (snake_case and C++ stay as typed), link brackets,
 * entities, and markers at the start of a line (lists, quotes, headings, fences).
 */
function escapeText(text: string, output: string) {
  let result = ''
  let lineStart = output.split('\n').at(-1)!.trim() === ''
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
      result += /^[!-/:-@[-`{-~]$/.test(after) || index + 1 === text.length ? '\\\\' : '\\'
    } else if (character === '*') {
      let end = index
      while (text[end] === '*') end += 1
      const run = text.slice(index, end)
      result += starCouldFormat(before, end < text.length ? text[end] : 'a') ? run.replace(/\*/g, '\\*') : run
      index = end - 1
    } else if (character === '`') {
      result += `\\${character}`
    } else if (character === '_') {
      result += canOpen('_', before, after) ? '\\_' : '_'
    } else if ((character === '~' || character === '+') && after === character && before !== character && text[index + 2] !== character) {
      // Only an exact pair (~~ or ++) formats; escape it when it could open.
      result += canOpen(character, before, index + 2 < text.length ? text[index + 2] : 'a') ? `\\${character}` : character
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

function serializeInline(nodes: JSONContent[]): string {
  const segments = segmentsFor(nodes)
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

    output += segment.code ? codeSpan(text) : escapeText(text, output)
  })

  closeFrom(0)
  return output
}
