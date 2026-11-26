import { isInsideMarkdownFence } from '../../../lib/codePaste'

/** Formatting actions shared by both modes' toolbars and shortcuts. */
export type FormatAction = 'bold' | 'italic' | 'strike' | 'code' | 'codeBlock' | 'bulletList' | 'orderedList' | 'blockquote' | 'link'

export type SourceEdit = { start: number; end: number; text: string; selectionStart: number; selectionEnd: number }

const WRAPS: Partial<Record<FormatAction, [string, string, string]>> = {
  bold: ['**', '**', 'bold text'],
  italic: ['_', '_', 'italic text'],
  strike: ['~~', '~~', 'struck text'],
}

const LINE_MARKERS = {
  bulletList: /^(\s*)[-*+]\s/,
  orderedList: /^(\s*)\d+[.)]\s/,
  blockquote: /^(\s*)> ?/,
}

function lineBounds(value: string, start: number, end: number) {
  const from = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
  const next = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end)
  return { from, to: next < 0 ? value.length : next }
}

/** The removal edit is also the source of truth for toolbar pressed state. */
function removal(value: string, start: number, end: number, action: FormatAction): SourceEdit | null {
  const unwrap = (open: number, contentStart: number, contentEnd: number, closeEnd: number): SourceEdit => ({
    start: open, end: closeEnd, text: value.slice(contentStart, contentEnd),
    selectionStart: Math.max(open, Math.min(start, contentEnd) - (contentStart - open)),
    selectionEnd: Math.max(open, Math.min(end, contentEnd) - (contentStart - open)),
  })
  if (action === 'codeBlock') {
    const fences = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n/gm
    let consumedUntil = 0
    for (const match of value.matchAll(fences)) {
      const open = match.index
      if (open < consumedUntil) continue
      const contentStart = open + match[0].length
      const closing = new RegExp(`^[ \t]*${match[2][0]}{${match[2].length},}[ \t]*$`, 'gm')
      closing.lastIndex = contentStart
      const close = closing.exec(value)
      if (!close) continue
      const closeEnd = close.index + close[0].length
      consumedUntil = closeEnd
      if (open <= start && end <= closeEnd) return unwrap(open, contentStart, Math.max(contentStart, close.index - 1), closeEnd)
    }
    return null
  }
  if (action in LINE_MARKERS) {
    const { from, to } = lineBounds(value, start, end)
    const lines = value.slice(from, to).split('\n')
    const marker = LINE_MARKERS[action as keyof typeof LINE_MARKERS]
    if (!lines.some((line) => marker.test(line)) || !lines.every((line) => !line.trim() || marker.test(line))) return null
    const text = lines.map((line) => line.replace(marker, '$1')).join('\n')
    const removedFirst = lines[0].length - lines[0].replace(marker, '$1').length
    return { start: from, end: to, text, selectionStart: start === end ? Math.max(from, start - removedFirst) : from, selectionEnd: start === end ? Math.max(from, start - removedFirst) : from + text.length }
  }
  const wrapper = WRAPS[action]?.[0]
  if (wrapper) {
    // Pair delimiters only on the selection's own lines, outside code spans, and only where
    // CommonMark could open or close emphasis: `snake_case_name`, `2 * 3 * 4` and `a**b` in
    // code are not formatting, so pressing the button must not strip them.
    const { from, to } = lineBounds(value, start, end)
    const masked = value.slice(from, to).replace(/(`+)[^`]*?\1/g, (code) => ' '.repeat(code.length))
    const word = /[\p{L}\p{N}]/u
    const positions: number[] = []
    let index = masked.indexOf(wrapper)
    while (index >= 0) {
      positions.push(from + index)
      index = masked.indexOf(wrapper, index + wrapper.length)
    }
    const canOpen = (at: number) => {
      const next = value[at + wrapper.length] ?? ' '
      return !/\s/.test(next) && (wrapper !== '_' || !word.test(value[at - 1] ?? ' '))
    }
    const canClose = (at: number) => {
      const previous = value[at - 1] ?? ' '
      return !/\s/.test(previous) && (wrapper !== '_' || !word.test(value[at + wrapper.length] ?? ' '))
    }
    let open: number | null = null
    for (const at of positions) {
      if (open !== null && at > open + wrapper.length && canClose(at)) {
        const close = at
        if ((open + wrapper.length <= start && end <= close) || (start === open && end === close + wrapper.length)) {
          return unwrap(open, open + wrapper.length, close, close + wrapper.length)
        }
        open = null
      } else if (canOpen(at)) {
        open = at
      }
    }
  }
  if (action === 'code') {
    const runs = Array.from(value.matchAll(/`+/g))
    for (let i = 0; i < runs.length; i++) {
      const open = runs[i]
      const closeIndex = runs.findIndex((run, j) => j > i && run[0].length === open[0].length)
      if (closeIndex < 0) continue
      const close = runs[closeIndex]
      const contentStart = open.index + open[0].length
      if ((contentStart <= start && end <= close.index) || (start === open.index && end === close.index + close[0].length)) {
        const content = value.slice(contentStart, close.index)
        const pad = content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content) ? 1 : 0
        return unwrap(open.index, contentStart + pad, close.index - pad, close.index + close[0].length)
      }
      i = closeIndex
    }
  }
  return null
}

export function markdownSourceIsActive(value: string, start: number, end: number, action: FormatAction) {
  return removal(value, start, end, action) !== null
}

/**
 * The text change a toolbar button or shortcut makes in Markdown mode: wraps
 * the selection, prefixes each selected line, or fences the selected lines.
 * An active action removes its syntax instead; list kinds replace each other.
 */
export function markdownSourceEdit(value: string, start: number, end: number, action: FormatAction, href = ''): SourceEdit {
  const toggle = removal(value, start, end, action)
  if (toggle) return toggle
  const selected = value.slice(start, end)
  if (action === 'code') {
    // A delimiter longer than any backtick run inside, padded when the text touches a backtick,
    // so "a `b`" stays one code span (the Rich serializer writes code the same way).
    const text = selected || 'code'
    const fence = '`'.repeat(Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length)) + 1)
    const pad = /^`|`$/.test(text) || /^ .*[^ ].* $/s.test(text) ? ' ' : ''
    const open = `${fence}${pad}`
    return { start, end, text: `${open}${text}${pad}${fence}`, selectionStart: start + open.length, selectionEnd: start + open.length + text.length }
  }

  const wrap = WRAPS[action]
  if (wrap) {
    const [open, close, fallback] = wrap
    const text = selected || fallback
    return { start, end, text: `${open}${text}${close}`, selectionStart: start + open.length, selectionEnd: start + open.length + text.length }
  }

  if (action === 'link') {
    const label = selected || href || 'link text'
    const url = href || 'https://'
    const text = `[${label}](${url})`
    const urlStart = start + label.length + 3
    return { start, end, text, selectionStart: href ? start + 1 : urlStart, selectionEnd: href ? start + 1 + label.length : urlStart + url.length }
  }

  const { from: lineStart, to: lineEnd } = lineBounds(value, start, end)
  const lines = value.slice(lineStart, lineEnd)

  if (action === 'codeBlock') {
    const longest = Math.max(2, ...Array.from(lines.matchAll(/`+/g), (match) => match[0].length))
    const fence = '`'.repeat(longest + 1)
    const before = lineStart > 0 && value[lineStart - 1] !== '\n' ? '\n' : ''
    const text = `${before}${fence}\n${lines}\n${fence}`
    const codeStart = lineStart + before.length + fence.length + 1
    return { start: lineStart, end: lineEnd, text, selectionStart: codeStart, selectionEnd: codeStart + lines.length }
  }

  const counts = new Map<number, number>()
  const prefixed = lines.split('\n').map((line) => {
    const match = line.match(/^(\s*)(.*)$/)!
    const indent = match[1]
    const body = action === 'blockquote' ? match[2] : match[2].replace(/^(?:[-*+]|\d+[.)])\s/, '')
    for (const level of counts.keys()) if (level > indent.length) counts.delete(level)
    const number = (counts.get(indent.length) || 0) + 1
    counts.set(indent.length, number)
    const prefix = action === 'orderedList' ? `${number}. ` : action === 'bulletList' ? '- ' : '> '
    return `${indent}${prefix}${body}`
  }).join('\n')
  const cursor = !lines.trim() ? lineStart + prefixed.length : start + prefixed.split('\n')[0].length - lines.split('\n')[0].length
  return {
    start: lineStart, end: lineEnd, text: prefixed,
    selectionStart: start === end ? cursor : lineStart,
    selectionEnd: start === end ? cursor : lineStart + prefixed.length,
  }
}

const MARKDOWN_LIST_LINE = /^([ \t]*)(?:([-*+])|(\d+)([.)]))([ \t]+)(.*)$/
const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})(.*)$/

function isFenceOpenerLine(text: string) {
  const match = text.match(FENCE_OPENER)
  if (!match) return false
  return !(match[1][0] === '`' && match[2].includes('`'))
}

/** True when the caret sits inside a fenced block, including fences nested inside list items. */
function isInsideFenceIncludingLists(value: string, caret: number) {
  if (isInsideMarkdownFence(value, caret)) return true
  const lines = value.slice(0, Math.max(0, caret)).split('\n').slice(0, -1)
  let open: string | null = null
  for (const rawLine of lines) {
    const stripped = rawLine.replace(/^(?:[ \t]*(?:[-*+]|\d+[.)])[ \t]+)+/, '')
    const match = stripped.match(/^\s*(`{3,}|~{3,})(.*)$/)
    if (!match) continue
    if (open === null) {
      if (match[1][0] === '`' && match[2].includes('`')) continue
      open = match[1]
    } else if (match[1][0] === open[0] && match[1].length >= open.length && match[2].trim() === '') {
      open = null
    }
  }
  return open !== null
}

function parseMarkdownListLine(value: string, caret: number) {
  if (isInsideFenceIncludingLists(value, caret)) return null
  const { from, to } = lineBounds(value, caret, caret)
  const line = value.slice(from, to)
  const match = line.match(MARKDOWN_LIST_LINE)
  if (!match) return null
  const indent = match[1]
  const bullet = match[2]
  const numberText = match[3]
  const delimiter = match[4]
  const space = match[5]
  const body = match[6]
  const prefixLength = indent.length + (bullet ? bullet.length : numberText.length + delimiter.length) + space.length
  return { from, to, indent, bullet, number: numberText ? Number(numberText) : null, delimiter, space, body, prefixLength }
}

/**
 * Markdown mode: Enter adds a line instead of sending while the caret is in
 * an open ``` fence (counting the caret's own line, §9.7) or on a bulleted /
 * numbered list item, matching Rich mode and Slack.
 */
export function markdownEnterAddsLine(value: string, caret: number) {
  if (isInsideFenceIncludingLists(`${value.slice(0, caret)}\n`, caret + 1)) return true
  return parseMarkdownListLine(value, caret) !== null
}

/**
 * Markdown mode: pressing Enter inside a bulleted or numbered list continues
 * the list on the next line (incrementing ordered items), or exits the list by
 * clearing an empty marker — matching Rich mode and Slack.
 */
export function markdownListEnterEdit(value: string, start: number, end: number): SourceEdit | null {
  if (isInsideFenceIncludingLists(`${value.slice(0, start)}\n`, start + 1)) return null
  const info = parseMarkdownListLine(value, start)
  if (!info || end > info.to) return null
  // A list item whose body opens a fenced code block (e.g. "- ```js") starts a fence, not another marker.
  if (isFenceOpenerLine(info.body)) return null
  const contentStart = info.from + info.prefixLength
  if (start < contentStart) return null
  // Empty list item (e.g. "2. " or "- "): Enter exits the list cleanly.
  if (info.body.trim().length === 0 && start === end) {
    return { start: info.from, end: info.to, text: '', selectionStart: info.from, selectionEnd: info.from }
  }
  const nextMarker = info.bullet ? info.bullet : `${(info.number ?? 1) + 1}${info.delimiter}`
  const insertion = `\n${info.indent}${nextMarker}${info.space}`
  const nextCaret = start + insertion.length
  return { start, end, text: insertion, selectionStart: nextCaret, selectionEnd: nextCaret }
}

function indentWidth(indent: string) {
  return indent.replace(/\t/g, '  ').length
}

/**
 * Markdown mode: Tab / Shift+Tab on a list line indents to its parent list
 * item's CommonMark content column (never turning an isolated item into an
 * indented code block) or outdents cleanly, returning null when no valid
 * nesting edit applies so Tab keeps working for focus navigation.
 */
export function markdownListIndentEdit(value: string, start: number, end: number, outdent: boolean): SourceEdit | null {
  if (isInsideFenceIncludingLists(value, start)) return null
  const { from, to } = lineBounds(value, start, end)
  const blockLines = value.slice(from, to).split('\n')
  const firstMatch = blockLines[0].match(MARKDOWN_LIST_LINE)
  if (!firstMatch) return null
  const firstIndent = indentWidth(firstMatch[1])

  // Find the nearest preceding list line whose indent is <= firstIndent so CommonMark nesting is exact.
  let targetIndent: number | null = null
  const precedingLines = from > 0 ? value.slice(0, from - 1).split('\n') : []
  if (outdent) {
    if (firstIndent === 0) return null
    let shallower = 0
    for (let i = precedingLines.length - 1; i >= 0; i -= 1) {
      const prev = precedingLines[i].match(MARKDOWN_LIST_LINE)
      if (!prev) {
        if (!precedingLines[i].trim()) continue
        if (indentWidth(precedingLines[i].match(/^([ \t]*)/)![1]) < firstIndent) break
        continue
      }
      const prevWidth = indentWidth(prev[1])
      if (prevWidth < firstIndent) {
        shallower = prevWidth
        break
      }
    }
    targetIndent = shallower
  } else {
    for (let i = precedingLines.length - 1; i >= 0; i -= 1) {
      const prev = precedingLines[i].match(MARKDOWN_LIST_LINE)
      if (!prev) {
        if (!precedingLines[i].trim()) break
        continue
      }
      const prevWidth = indentWidth(prev[1])
      const prevContentColumn = prevWidth + (prev[2] ? prev[2].length : prev[3].length + prev[4].length) + prev[5].length
      if (prevWidth <= firstIndent) {
        if (prevContentColumn > firstIndent) targetIndent = prevContentColumn
        break
      }
    }
    if (targetIndent === null) return null
  }

  const delta = targetIndent - firstIndent
  if (delta === 0) return null

  const mapOffset = (offset: number, lineOffsets: number[], deltas: number[]) => {
    let shift = 0
    for (let i = 0; i < lineOffsets.length; i += 1) {
      const lineStart = lineOffsets[i]
      if (offset < lineStart) break
      if (deltas[i] < 0 && offset < lineStart - deltas[i]) {
        shift += -(offset - lineStart)
        break
      }
      shift += deltas[i]
    }
    return Math.max(from, offset + shift)
  }

  const lineOffsets: number[] = []
  const deltas: number[] = []
  let cursor = from
  const nextLines = blockLines.map((line) => {
    lineOffsets.push(cursor)
    cursor += line.length + 1
    if (!line.trim()) {
      deltas.push(0)
      return line
    }
    if (delta > 0) {
      deltas.push(delta)
      return `${' '.repeat(delta)}${line}`
    }
    const remove = Math.min(-delta, line.match(/^ */)![0].length)
    deltas.push(-remove)
    return line.slice(remove)
  })
  const text = nextLines.join('\n')
  if (text === value.slice(from, to)) return null

  return {
    start: from,
    end: to,
    text,
    selectionStart: mapOffset(start, lineOffsets, deltas),
    selectionEnd: mapOffset(end, lineOffsets, deltas),
  }
}

/**
 * Replaces a textarea range through the browser's editing command so the
 * change is one native undo step; falls back to setting the value directly.
 */
export function replaceTextareaRange(textarea: HTMLTextAreaElement, edit: SourceEdit, onChange: (value: string) => void) {
  const direction = textarea.selectionDirection
  textarea.focus()
  textarea.setSelectionRange(edit.start, edit.end)
  const expected = textarea.value.slice(0, edit.start) + edit.text + textarea.value.slice(edit.end)
  let applied: boolean
  try {
    applied = typeof document.execCommand === 'function'
      && (edit.text === '' ? document.execCommand('delete', false) : document.execCommand('insertText', false, edit.text))
      && textarea.value === expected
  } catch {
    applied = false
  }
  if (!applied) onChange(expected)
  const select = () => textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd, direction)
  if (applied) select()
  else requestAnimationFrame(select)
  return expected
}

const COMMON_FILE_EXTENSIONS = new Set(['md', 'txt', 'rb', 'py', 'js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'sh', 'yml', 'yaml', 'png', 'jpg', 'jpeg', 'gif', 'pdf', 'zip', 'csv', 'sql'])

/** A typed link target as a safe URL (https added to bare domains), or '' when it isn't one. */
export function normalizeEditorLink(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^(https?:\/\/|mailto:)\S+$/i.test(trimmed)) return trimmed
  if (/^www\.\S+$/i.test(trimmed)) return `https://${trimmed}`
  const domain = trimmed.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)([/?#]\S*)?$/i)
  if (!domain) return ''
  const tld = domain[1].split('.').pop()?.toLowerCase() || ''
  if (!/^[a-z]{2,24}$/.test(tld) || COMMON_FILE_EXTENSIONS.has(tld)) return ''
  return `https://${trimmed}`
}
