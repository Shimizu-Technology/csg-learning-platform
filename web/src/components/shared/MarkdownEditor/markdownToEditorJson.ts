import type { JSONContent } from '@tiptap/core'
import {
  editorJsonToMarkdown,
  parseInline,
  parseMessageBlocks,
  type InlineNode,
  type MessageBlock,
  type MessageListBlock,
  type MessageListChild,
} from '../../../lib/messageFormat'

/**
 * Markdown to the Rich editor's Tiptap JSON, the reverse of
 * `editorJsonToMarkdown`. It reads Markdown with the shared message parser
 * (`markdownCore`), so Rich mode shows exactly what readers see.
 *
 * Anything Rich mode can't edit (design spec §9.6) becomes a locked
 * `rawMarkdown` block that keeps its source byte for byte. A block is also
 * locked when converting it and writing it back would read differently, so
 * switching modes never changes what is saved.
 */

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
  | 'Markdown Rich mode can\'t show exactly'

export type MarkdownToEditorResult = {
  doc: JSONContent
  /** Why each locked block was locked, in document order. */
  issues: UnsupportedKind[]
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
    else if (node.type === 'link') output.push(...inlineToJson(node.children, [...marks, { type: 'link', attrs: { href: node.href } }]))
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
    ...(block.type === 'orderedList' && block.start && block.start !== 1 ? { attrs: { start: block.start } } : {}),
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

/** The parsed structure readers see, for comparing two Markdown strings. */
function inlineStructure(text: string) {
  return parseInline(text)
}

function listStructure(block: MessageListBlock): unknown {
  return {
    type: block.type,
    start: block.type === 'orderedList' ? block.start || 1 : undefined,
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

export function sameMarkdownStructure(left: string, right: string) {
  return JSON.stringify(markdownStructure(left)) === JSON.stringify(markdownStructure(right))
}

const UNSUPPORTED: { pattern: RegExp; kind: UnsupportedKind }[] = [
  { pattern: /^\s*\|.*\|\s*$/, kind: 'a table' },
  { pattern: /^\s*\|?\s*:?-+:?\s*\|\s*:?-+:?/, kind: 'a table' },
  { pattern: /!\[[^\]]*\]\(/, kind: 'an image' },
  { pattern: /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\](?:\s|$)/, kind: 'a checklist' },
  { pattern: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/, kind: 'a divider' },
  { pattern: /^ {0,3}(?:#|#{4,6})(?:[ \t]|$)/, kind: 'a heading Rich mode can\'t show' },
  { pattern: /^ {0,3}=+[ \t]*$/, kind: 'a heading Rich mode can\'t show' },
  { pattern: /^ {0,3}(?:<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$)|<!--|<\?|<![A-Za-z])/, kind: 'HTML' },
  { pattern: /^ {0,3}\[[^\]]+\]:\s*\S/, kind: 'a link reference' },
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

function unsupportedKind(chunk: string): UnsupportedKind | null {
  if (/^( {4,}|\t)\S/.test(chunk) && !FENCE.test(chunk.split('\n')[0])) return 'an indented code block'
  for (const line of linesOutsideFences(chunk)) {
    const match = UNSUPPORTED.find(({ pattern }) => pattern.test(line))
    if (match) return match.kind
  }
  return null
}

/**
 * Top-level chunks separated by blank lines. Blank lines inside a fence, and
 * blank lines followed by an indented line (list continuation), stay inside.
 */
export function splitMarkdownChunks(markdown: string): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let blanks = 0
  let fence: string | null = null

  for (const line of markdown.split('\n')) {
    if (fence) {
      current.push(line)
      if (closesFence(line, fence)) fence = null
      continue
    }
    if (!line.trim()) {
      if (current.length) blanks += 1
      continue
    }
    if (blanks && current.length) {
      // An indented line after a blank continues a list item; anywhere else it starts a new block.
      const inList = current.some((previous) => LIST_LINE.test(previous))
      if (inList && /^[ \t]/.test(line)) current.push(...Array(blanks).fill(''))
      else {
        chunks.push(current.join('\n'))
        current = []
      }
    }
    blanks = 0
    current.push(line)
    const opener = line.match(FENCE)
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) fence = opener[1]
  }
  if (current.length) chunks.push(current.join('\n'))
  return chunks
}

function rawNode(markdown: string, kind: UnsupportedKind): JSONContent {
  return { type: RAW_MARKDOWN_NODE, attrs: { markdown, kind } }
}

function withTrailingParagraph(content: JSONContent[]): JSONContent[] {
  const last = content.at(-1)
  return last && last.type !== 'paragraph' && last.type !== 'heading' ? [...content, { type: 'paragraph' }] : content
}

export function markdownToEditorDoc(markdown: string): MarkdownToEditorResult {
  const source = (markdown || '').replace(/\r\n?/g, '\n')
  if (!source.trim()) return { doc: EMPTY_EDITOR_DOC, issues: [] }

  const content: JSONContent[] = []
  const issues: UnsupportedKind[] = []
  for (const chunk of splitMarkdownChunks(source)) {
    const unsupported = unsupportedKind(chunk)
    if (!unsupported) {
      const blocks = blocksToJson(chunk)
      if (blocks.length && sameMarkdownStructure(chunk, editorJsonToMarkdown({ type: 'doc', content: blocks }))) {
        content.push(...blocks)
        continue
      }
    }
    const kind = unsupported || 'Markdown Rich mode can\'t show exactly'
    content.push(rawNode(chunk, kind))
    issues.push(kind)
  }

  const doc = { type: 'doc', content: withTrailingParagraph(content) }
  // The pieces must read the same together too (a list continuation split across chunks, say).
  if (!sameMarkdownStructure(source, editorJsonToMarkdown(doc))) {
    const kind = issues[0] || 'Markdown Rich mode can\'t show exactly'
    return { doc: { type: 'doc', content: withTrailingParagraph([rawNode(source.replace(/^\n+|\n+$/g, ''), kind)]) }, issues: [kind] }
  }
  return { doc, issues }
}

/** Kinds of locked block in a document, for the warning under the toolbar. */
export function lockedKinds(doc: JSONContent | undefined): UnsupportedKind[] {
  const kinds = new Set<UnsupportedKind>()
  doc?.content?.forEach((node) => {
    if (node.type === RAW_MARKDOWN_NODE) kinds.add((node.attrs?.kind as UnsupportedKind) || 'Markdown Rich mode can\'t show exactly')
  })
  return [...kinds]
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
