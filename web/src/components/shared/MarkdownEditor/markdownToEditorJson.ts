import type { JSONContent } from '@tiptap/core'
import {
  editorJsonToMarkdown,
  inlinePlainText,
  parseInline,
  parseMessageBlocks,
  type InlineNode,
  type MessageBlock,
  type MessageListBlock,
  type MessageListChild,
} from '../../../lib/messageFormat'
import { isLessonHtml } from '../../../lib/lessonHtml'
import { lessonMarkdownStructure, linkReferenceLines, writtenMarkdownStructure } from '../../../lib/writtenMarkdown'

/**
 * Markdown to the Rich editor's Tiptap JSON, the reverse of
 * `editorJsonToMarkdown`. It reads Markdown with the shared message parser
 * (`markdownCore`), so Rich mode shows exactly what readers see.
 *
 * Anything Rich mode can't edit (design spec §9.6) becomes a locked
 * `rawMarkdown` block that keeps its source byte for byte. A block is also
 * locked when converting it and writing it back would read differently in
 * the renderer that shows it (`target`), so switching modes never changes
 * what readers see.
 */

/**
 * Where the text is read. `message`: messages and class chat (the message
 * parser). `written`: updates, feedback, help replies and submissions
 * (`MarkdownText`, CommonMark + GFM), which must also read the same.
 * `lesson`: lesson text and instructions (`MarkdownRenderer`'s lesson
 * pipeline, GFM without line breaks), which must also read the same.
 */
export type MarkdownTarget = 'message' | 'written' | 'lesson'

export type MarkdownToEditorOptions = { target?: MarkdownTarget }

type Mark = { type: string; attrs?: Record<string, unknown> }

export type UnsupportedKind =
  | 'a table'
  | 'an image'
  | 'a checklist'
  | 'a divider'
  | 'a heading Rich mode can\'t show'
  | 'HTML'
  | 'a link reference'
  | 'a list or code block inside a quote'
  | 'an indented code block'
  | 'an HTML5 character reference'
  | 'Markdown Rich mode can\'t show exactly'

/** A top-level piece of the source and how many of the document's first blocks it became, in order. */
export type SourceSegment = { text: string; start: number; end: number; count: number }

export type MarkdownToEditorResult = {
  doc: JSONContent
  /** Why each locked block was locked, in document order. */
  issues: UnsupportedKind[]
  /**
   * Where each block came from, so blocks nobody edited are written back
   * exactly as they were typed (`editorJsonToMarkdownKeepingSource`).
   * Offsets are in `source`, the Markdown with line endings normalized;
   * `raw` is the Markdown exactly as given (CRLF and all).
   */
  source: string
  raw: string
  segments: SourceSegment[]
}

export const RAW_MARKDOWN_NODE = 'rawMarkdown'

export const EMPTY_EDITOR_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

function pushText(output: JSONContent[], text: string, marks: Mark[]) {
  text.split('\n').forEach((line, index) => {
    if (index > 0) output.push({ type: 'hardBreak' })
    if (!line) return
    output.push(marks.length ? { type: 'text', text: line, marks: marks.map((mark) => ({ ...mark })) } : { type: 'text', text: line })
  })
}

const INLINE_MARKS: Record<string, string> = { strong: 'bold', emphasis: 'italic', strike: 'strike', underline: 'underline' }

function inlineToJson(nodes: InlineNode[], marks: Mark[] = []): JSONContent[] {
  const output: JSONContent[] = []
  for (const node of nodes) {
    if (node.type === 'text') pushText(output, node.text, marks)
    else if (node.type === 'code') pushText(output, node.text, [...marks, { type: 'code' }])
    // The spelling keeps a bare URL or <autolink> as typed when it's written back (docs/MARKDOWN.md).
    else if (node.type === 'link') output.push(...inlineToJson(node.children, [...marks, { type: 'link', attrs: { href: node.href, spelling: node.autolink ?? 'inline' } }]))
    else output.push(...inlineToJson(node.children, [...marks, { type: INLINE_MARKS[node.type] }]))
  }
  return output
}

function textblock(type: string, text: string, attrs?: Record<string, unknown>): JSONContent {
  const content = inlineToJson(parseInline(text))
  return { type, ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) }
}

function codeBlockJson(code: string, language: string): JSONContent {
  return { type: 'codeBlock', attrs: { language: language || null }, ...(code ? { content: [{ type: 'text', text: code }] } : {}) }
}

function listJson(block: MessageListBlock): JSONContent {
  return {
    type: block.type,
    ...(block.type === 'orderedList' && block.start !== undefined && block.start !== 1 ? { attrs: { start: block.start } } : {}),
    content: block.items.map((item) => ({
      type: 'listItem',
      content: [textblock('paragraph', item.text), ...item.children.map(listChildJson)],
    })),
  }
}

function listChildJson(child: MessageListChild): JSONContent {
  if (child.type === 'code') return codeBlockJson(child.code, child.language)
  if (child.type === 'bulletList' || child.type === 'orderedList') return listJson(child)
  if (child.type === 'blockquote') return { type: 'blockquote', content: [textblock('paragraph', child.text)] }
  return textblock('paragraph', child.text)
}

function blockJson(block: MessageBlock): JSONContent | null {
  switch (block.type) {
    case 'paragraph': return textblock('paragraph', block.text)
    case 'heading': return textblock('heading', block.text, { level: block.level })
    // A quote is one paragraph whose lines are line breaks, as the serializer writes it.
    case 'blockquote': return { type: 'blockquote', content: [textblock('paragraph', block.text)] }
    case 'code': return codeBlockJson(block.code, block.language)
    case 'bulletList':
    case 'orderedList': return listJson(block)
    default: return null
  }
}

function blocksToJson(markdown: string): JSONContent[] {
  return parseMessageBlocks(markdown).map(blockJson).filter((node): node is JSONContent => Boolean(node))
}

/** The parsed structure readers see, for comparing two Markdown strings (a link's spelling doesn't change it). */
function inlineStructure(text: string): unknown {
  return parseInline(text).map(withoutSpelling)
}

function withoutSpelling(node: InlineNode): unknown {
  if (node.type === 'text' || node.type === 'code') return node
  if (node.type === 'link') return { type: 'link', href: node.href, children: node.children.map(withoutSpelling) }
  return { type: node.type, children: node.children.map(withoutSpelling) }
}

function listStructure(block: MessageListBlock): unknown {
  return {
    type: block.type,
    start: block.type === 'orderedList' ? block.start ?? 1 : undefined,
    items: block.items.map((item) => ({ text: inlineStructure(item.text), children: item.children.map(childStructure) })),
  }
}

function childStructure(child: MessageListChild): unknown {
  if (child.type === 'code') return child
  if (child.type === 'bulletList' || child.type === 'orderedList') return listStructure(child)
  return { type: child.type, text: inlineStructure(child.text) }
}

export function markdownStructure(markdown: string): unknown[] {
  return parseMessageBlocks(markdown).filter((block) => block.type !== 'spacer').map((block) => {
    if (block.type === 'code') return block
    if (block.type === 'bulletList' || block.type === 'orderedList') return listStructure(block)
    if (block.type === 'heading') return { type: 'heading', level: block.level, text: inlineStructure(block.text) }
    return { type: block.type, text: inlineStructure(block.text) }
  })
}

/** Do two Markdown strings read the same in the message parser and, for written or lesson text, where that text is shown? */
export function sameMarkdownStructure(left: string, right: string, target: MarkdownTarget = 'message') {
  if (JSON.stringify(markdownStructure(left)) !== JSON.stringify(markdownStructure(right))) return false
  if (target === 'written') return writtenMarkdownStructure(left) === writtenMarkdownStructure(right)
  if (target === 'lesson') return lessonMarkdownStructure(left) === lessonMarkdownStructure(right)
  return true
}

/** `[label]: url`, a link reference definition. */
const LINK_DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*\S/

const UNSUPPORTED: { pattern: RegExp; kind: UnsupportedKind }[] = [
  { pattern: /^\s*\|.*\|\s*$/, kind: 'a table' },
  { pattern: /^\s*\|?\s*:?-+:?\s*\|\s*:?-+:?/, kind: 'a table' },
  { pattern: /!\[[^\]]*\]\(/, kind: 'an image' },
  { pattern: /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\](?:\s|$)/, kind: 'a checklist' },
  { pattern: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/, kind: 'a divider' },
  { pattern: /^ {0,3}(?:#|#{4,6})(?:[ \t]|$)/, kind: 'a heading Rich mode can\'t show' },
  { pattern: /^ {0,3}=+[ \t]*$/, kind: 'a heading Rich mode can\'t show' },
  { pattern: /^ {0,3}(?:<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$)|<!--|<\?|<![A-Za-z])/, kind: 'HTML' },
  { pattern: LINK_DEFINITION, kind: 'a link reference' },
  { pattern: /^\s*>\s*(?:[-*+][ \t]|\d{1,9}[.)][ \t]|#{1,6}[ \t]|`{3,}|~{3,})/, kind: 'a list or code block inside a quote' },
]

const LIST_LINE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/
const FENCE = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/

function closesFence(line: string, fence: string) {
  const match = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)
  return Boolean(match && match[1][0] === fence[0] && match[1].length >= fence.length)
}

/** Lines outside fenced code, where block syntax counts. */
function linesOutsideFences(markdown: string) {
  const lines: string[] = []
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    if (fence) {
      if (closesFence(line, fence)) fence = null
      continue
    }
    const opener = line.match(FENCE)
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      fence = opener[1]
      continue
    }
    lines.push(line)
  }
  return lines
}

const ENTITY_REFERENCE = /&[A-Za-z][A-Za-z0-9]{1,31};/g

/**
 * An HTML5-only entity name (`&check;`): messages show it as typed, while
 * CommonMark (long-form text, and the API's push and email excerpts) shows
 * the character. Rich mode would escape it to keep what messages show, so
 * it stays as typed instead (docs/MARKDOWN.md).
 */
function hasDivergentEntity(line: string) {
  for (const [entity] of line.matchAll(ENTITY_REFERENCE)) {
    if (inlinePlainText(parseInline(entity)) !== entity) continue
    if (writtenMarkdownStructure(entity) !== writtenMarkdownStructure(`\\${entity}`)) return true
  }
  return false
}

/** CommonMark matches a link label case-insensitively with whitespace collapsed. */
function normalizeLinkLabel(label: string) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Labels defined by `[label]: url` lines anywhere in the text (outside code). */
function definedLinkLabels(markdown: string) {
  const labels = new Set<string>()
  for (const line of linesOutsideFences(markdown)) {
    const match = line.match(LINK_DEFINITION)
    if (match) labels.add(normalizeLinkLabel(match[1]))
  }
  return labels
}

/**
 * A `[label]` that names a definition is a reference link (`[text][label]`,
 * `[label][]`, `[label]`): long-form readers resolve it through the definition,
 * which may be in another block. Rich mode shows it as text and would escape
 * it, so the block that uses it stays as typed, like the definition.
 */
function usesLinkReference(lines: string[], labels: Set<string>) {
  if (labels.size === 0) return false
  return lines.some((line) => Array.from(line.matchAll(/\[([^[\]\n]+)\]/g)).some((match) => labels.has(normalizeLinkLabel(match[1]))))
}

function unsupportedKind(chunk: string, linkLabels: Set<string> = new Set()): UnsupportedKind | null {
  if (/^( {4,}|\t)\S/.test(chunk) && !FENCE.test(chunk.split('\n')[0])) return 'an indented code block'
  const lines = linesOutsideFences(chunk)
  for (const line of lines) {
    const match = UNSUPPORTED.find(({ pattern }) => pattern.test(line))
    if (match) return match.kind
  }
  if (usesLinkReference(lines, linkLabels)) return 'a link reference'
  if (lines.some(hasDivergentEntity)) return 'an HTML5 character reference'
  return null
}

/**
 * Does the chunk hold a link definition or a reference that resolves through
 * one, found in the Markdown tree (so a definition in a quote or a list item
 * counts too)? Both stay as typed: Rich mode would escape them.
 */
function usesReferenceLine(source: string, chunk: MarkdownChunk, lines: Set<number>) {
  if (lines.size === 0) return false
  const first = source.slice(0, chunk.start).split('\n').length
  const last = first + chunk.text.split('\n').length - 1
  for (let line = first; line <= last; line += 1) if (lines.has(line)) return true
  return false
}

export type MarkdownChunk = {
  /** The chunk exactly as it is in the source. */
  text: string
  start: number
  end: number
}

/**
 * Top-level chunks separated by blank lines, as exact slices of the source.
 * Blank lines inside a fence, and blank lines followed by an indented line
 * (list continuation), stay inside. Whitespace-only lines inside a chunk keep
 * their spaces.
 */
export function markdownChunks(markdown: string): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = []
  let current: { start: number; end: number; lines: string[] } | null = null
  let blanks = false
  let fence: string | null = null
  let offset = 0

  for (const line of markdown.split('\n')) {
    const lineStart = offset
    const lineEnd = offset + line.length
    offset = lineEnd + 1
    if (fence && current) {
      current.lines.push(line)
      current.end = lineEnd
      if (closesFence(line, fence)) fence = null
      continue
    }
    if (!line.trim()) {
      if (current) blanks = true
      continue
    }
    if (blanks && current) {
      // An indented line after a blank continues a list item; anywhere else it starts a new block.
      const inList = current.lines.some((previous) => LIST_LINE.test(previous))
      if (!(inList && /^[ \t]/.test(line))) {
        chunks.push({ text: markdown.slice(current.start, current.end), start: current.start, end: current.end })
        current = null
      }
    }
    blanks = false
    if (!current) current = { start: lineStart, end: lineEnd, lines: [] }
    current.lines.push(line)
    current.end = lineEnd
    const opener = line.match(FENCE)
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) fence = opener[1]
  }
  if (current) chunks.push({ text: markdown.slice(current.start, current.end), start: current.start, end: current.end })
  return chunks
}

export function splitMarkdownChunks(markdown: string): string[] {
  return markdownChunks(markdown).map((chunk) => chunk.text)
}

const GENERIC_KIND: UnsupportedKind = 'Markdown Rich mode can\'t show exactly'
/** Separates the kinds of a locked block that holds several (neighbouring locked chunks are one block). */
const KIND_SEPARATOR = '|'

function rawNode(markdown: string, kinds: UnsupportedKind[]): JSONContent {
  return { type: RAW_MARKDOWN_NODE, attrs: { markdown, kind: [...new Set(kinds)].join(KIND_SEPARATOR) } }
}

function withTrailingParagraph(content: JSONContent[]): JSONContent[] {
  const last = content.at(-1)
  return last && last.type !== 'paragraph' && last.type !== 'heading' ? [...content, { type: 'paragraph' }] : content
}

export function markdownToEditorDoc(markdown: string, { target = 'message' }: MarkdownToEditorOptions = {}): MarkdownToEditorResult {
  const raw = markdown || ''
  const source = raw.replace(/\r\n?/g, '\n')
  if (!source.trim()) return { doc: EMPTY_EDITOR_DOC, issues: [], source, raw, segments: [] }

  // A lesson body that starts with HTML is shown as HTML, all of it, so none of it may become
  // Rich formatting (which would be written back as Markdown): it stays one locked block.
  if (target === 'lesson' && isLessonHtml(source)) return wholeRaw(source, raw, ['HTML'])

  const content: JSONContent[] = []
  const issues: UnsupportedKind[] = []
  const segments: SourceSegment[] = []
  /** The last locked block and where it ends in the source, so a locked neighbour joins it. */
  let lastRaw: { node: JSONContent; end: number; kinds: UnsupportedKind[] } | null = null
  const linkLabels = definedLinkLabels(source)
  const referenceLines = linkReferenceLines(source)
  for (const chunk of markdownChunks(source)) {
    const unsupported = unsupportedKind(chunk.text, linkLabels) || (usesReferenceLine(source, chunk, referenceLines) ? 'a link reference' : null)
    if (!unsupported) {
      const blocks = blocksToJson(chunk.text)
      if (blocks.length && sameMarkdownStructure(chunk.text, editorJsonToMarkdown({ type: 'doc', content: blocks }), target)) {
        content.push(...blocks)
        segments.push({ text: chunk.text, start: chunk.start, end: chunk.end, count: blocks.length })
        lastRaw = null
        continue
      }
    }
    const kind = unsupported || 'Markdown Rich mode can\'t show exactly'
    if (lastRaw && content.at(-1) === lastRaw.node) {
      // Neighbouring locked chunks stay one block with the exact text between them
      // (the blank lines inside an indented code block are part of the code).
      const markdownText = `${String(lastRaw.node.attrs?.markdown)}${source.slice(lastRaw.end, chunk.start)}${chunk.text}`
      const kinds: UnsupportedKind[] = [...lastRaw.kinds, kind]
      const node = rawNode(markdownText, kinds)
      content[content.length - 1] = node
      lastRaw = { node, end: chunk.end, kinds }
      const merged = segments[segments.length - 1]
      segments[segments.length - 1] = { text: markdownText, start: merged.start, end: chunk.end, count: 1 }
    } else {
      const node = rawNode(chunk.text, [kind])
      content.push(node)
      lastRaw = { node, end: chunk.end, kinds: [kind] }
      segments.push({ text: chunk.text, start: chunk.start, end: chunk.end, count: 1 })
    }
    issues.push(kind)
  }

  const doc = { type: 'doc', content: withTrailingParagraph(content) }
  // The pieces must read the same together too (a list continuation split across chunks, say).
  if (!sameMarkdownStructure(source, editorJsonToMarkdown(doc), target)) {
    return wholeRaw(source, raw, issues.length ? [...new Set(issues)] : [GENERIC_KIND])
  }
  return { doc, issues, source, raw, segments }
}

/** The whole text as one locked block (blank lines at either end stay outside it, as stored). */
function wholeRaw(source: string, raw: string, kinds: UnsupportedKind[]): MarkdownToEditorResult {
  const text = source.replace(/^\n+|\n+$/g, '')
  const start = source.length - source.replace(/^\n+/, '').length
  return {
    doc: { type: 'doc', content: withTrailingParagraph([rawNode(text, kinds)]) },
    issues: kinds,
    source,
    raw,
    segments: [{ text, start, end: start + text.length, count: 1 }],
  }
}

/**
 * Source segments keyed by their blocks exactly as the editor holds them,
 * with each segment's text, the text between segments, and the whitespace
 * before the first and after the last, all exactly as stored.
 */
export type KeyedSource = {
  segments: (SourceSegment & { key: string; stored: string })[]
  /** Exactly what was stored between segment i and segment i + 1. */
  gaps: string[]
  leading: string
  trailing: string
  /** The stored line ending, for text the editor writes fresh. */
  lineEnding: '\n' | '\r\n'
}

/** For each offset in the line-ending-normalized text, the offset in the text as stored. */
function storedOffsets(raw: string) {
  const offsets: number[] = []
  for (let index = 0; index < raw.length; index += 1) {
    offsets.push(index)
    if (raw[index] === '\r' && raw[index + 1] === '\n') index += 1
  }
  offsets.push(raw.length)
  return offsets
}

/**
 * Keys each segment by its blocks in `doc`, the document as the editor holds
 * it once loaded (the schema fills in default attributes). Null when the
 * editor's blocks don't line up with the segments one for one.
 */
export function keySourceSegments(result: Pick<MarkdownToEditorResult, 'raw' | 'segments'>, doc: JSONContent): KeyedSource | null {
  const nodes = doc.content || []
  const offsets = storedOffsets(result.raw)
  const stored = (start: number, end: number) => result.raw.slice(offsets[start], offsets[end])
  let index = 0
  const segments: KeyedSource['segments'] = []
  for (const segment of result.segments) {
    const blocks = nodes.slice(index, index + segment.count)
    if (blocks.length !== segment.count) return null
    segments.push({ ...segment, key: JSON.stringify(blocks), stored: stored(segment.start, segment.end) })
    index += segment.count
  }
  // Anything after the segments is the empty paragraph that keeps typing possible below a block.
  if (nodes.slice(index).some((node) => node.type !== 'paragraph' || node.content?.length)) return null
  if (segments.length === 0) return null
  return {
    segments,
    gaps: segments.slice(1).map((segment, position) => stored(segments[position].end, segment.start)),
    leading: result.raw.slice(0, offsets[segments[0].start]),
    trailing: result.raw.slice(offsets[segments[segments.length - 1].end]),
    lineEnding: result.raw.includes('\r\n') ? '\r\n' : '\n',
  }
}

/**
 * The Rich document as Markdown, with every block nobody edited written
 * exactly as it was typed: an edit to one paragraph doesn't respell the rest
 * (`*` to `_`, `\_` to `_`, `&nbsp;` to the character, blank lines). Edited
 * and new blocks are written by `editorJsonToMarkdown`, in the stored line
 * ending. The text between kept blocks and the whitespace before the first
 * and after the last block stay exactly as stored. If the result would read
 * differently from that plain serialization, the plain one is used.
 */
export function editorJsonToMarkdownKeepingSource(doc: JSONContent, kept: KeyedSource | null, target: MarkdownTarget = 'message'): string {
  const plain = editorJsonToMarkdown(doc)
  if (!kept || kept.segments.length === 0) return plain
  const nodes = doc.content || []
  const parts: { text: string; segment: number | null; raw: boolean }[] = []
  let next = 0
  for (let index = 0; index < nodes.length;) {
    let matched = -1
    for (let candidate = next; candidate < kept.segments.length; candidate += 1) {
      const segment = kept.segments[candidate]
      if (index + segment.count <= nodes.length && JSON.stringify(nodes.slice(index, index + segment.count)) === segment.key) {
        matched = candidate
        break
      }
    }
    if (matched >= 0) {
      const segment = kept.segments[matched]
      parts.push({ text: segment.stored, segment: matched, raw: true })
      index += segment.count
      next = matched + 1
    } else {
      const node = nodes[index]
      parts.push({ text: editorJsonToMarkdown(node), segment: null, raw: node.type === RAW_MARKDOWN_NODE })
      index += 1
    }
  }
  // The same trimming as the plain serializer: empty paragraphs at either end go.
  const droppable = (part: (typeof parts)[number]) => (part.raw ? part.text === '' : !part.text.trim())
  while (parts.length && droppable(parts[0])) parts.shift()
  while (parts.length && droppable(parts[parts.length - 1])) parts.pop()
  if (parts.length === 0) return plain
  if (!parts[0].raw) parts[0].text = parts[0].text.trimStart()
  const last = parts[parts.length - 1]
  if (!last.raw) last.text = last.text.trimEnd()
  const eol = kept.lineEnding
  // Text the editor writes fresh uses the stored line ending; kept text is already as stored.
  for (const part of parts) if (part.segment === null && eol !== '\n') part.text = part.text.replace(/\n/g, eol)
  /** The blank lines the source had after segment `index`, or null past the last one. */
  const gapAfter = (index: number) => kept.gaps[index] ?? null
  let markdown = parts[0].text
  for (let index = 1; index < parts.length; index += 1) {
    const before = parts[index - 1]
    const part = parts[index]
    // A kept block keeps the blank lines it had on each side (only blank lines: the
    // check below still guards the result); between two new blocks, one blank line.
    const gap = (before.segment !== null && (part.segment === null || part.segment === before.segment + 1) ? gapAfter(before.segment) : null)
      ?? (part.segment !== null && part.segment > 0 && before.segment === null ? gapAfter(part.segment - 1) : null)
      ?? eol + eol
    markdown += gap + part.text
  }
  const written = kept.leading + markdown + kept.trailing
  if (sameMarkdownStructure(written.replace(/\r\n?/g, '\n'), plain, target)) return written
  // Fresh everywhere, still with the stored line ending and outer whitespace.
  return kept.leading + plain.replace(/\n/g, eol) + kept.trailing
}

/** Kinds of locked block in a document, for the warning under the toolbar. */
export function lockedKinds(doc: JSONContent | undefined): UnsupportedKind[] {
  const kinds = new Set<UnsupportedKind>()
  doc?.content?.forEach((node) => {
    if (node.type !== RAW_MARKDOWN_NODE) return
    const named = String(node.attrs?.kind || '').split(KIND_SEPARATOR).filter(Boolean) as UnsupportedKind[]
    ;(named.length ? named : [GENERIC_KIND]).forEach((kind) => kinds.add(kind))
  })
  // Name what Rich mode can't edit; the generic reason only when it's the only one.
  const specific = [...kinds].filter((kind) => kind !== GENERIC_KIND)
  return specific.length ? specific : [...kinds]
}

export function lockedWarning(kinds: UnsupportedKind[]): string {
  if (kinds.length === 0) return ''
  const list = kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} and ${kinds.at(-1)}`
  return kinds.length === 1 && kinds[0] === 'Markdown Rich mode can\'t show exactly'
    ? 'Rich mode can\'t show part of this text exactly. It\'s shown as Markdown text and saved unchanged.'
    : `Rich mode can't edit ${list}. It's shown as Markdown text and saved unchanged.`
}

/**
 * Plain text that reads as Markdown: emphasis, code, fences, list, quote and
 * heading markers at the start of a line, or links. Pasted into Rich mode it
 * becomes formatting (§9.5).
 */
export function looksLikeMarkdown(text: string): boolean {
  return /\*\*[^*\n]+\*\*|__[^_\n]+__|(^|[\s(])_[^_\n]+_(?=$|[\s).,!?:;])|`[^`\n]+`|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\s]+\)/.test(text)
    || /^ {0,3}(?:```|~~~|[-*+][ \t]+\S|\d{1,9}[.)][ \t]+\S|>[ \t]?\S|#{1,6}[ \t]+\S|\|.*\|[ \t]*$)/m.test(text)
}
