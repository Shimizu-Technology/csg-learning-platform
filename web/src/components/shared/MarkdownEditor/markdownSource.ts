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
    const positions: number[] = []
    let index = value.indexOf(wrapper)
    while (index >= 0) {
      positions.push(index)
      index = value.indexOf(wrapper, index + wrapper.length)
    }
    for (let i = 0; i + 1 < positions.length; i += 2) {
      const open = positions[i], close = positions[i + 1]
      if ((open + wrapper.length <= start && end <= close) || (start === open && end === close + wrapper.length)) {
        return unwrap(open, open + wrapper.length, close, close + wrapper.length)
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

/**
 * Markdown mode: Enter adds a line instead of sending while the caret is in
 * an open ``` fence, counting the caret's own line (§9.7), so pressing Enter
 * after typing "```js" starts the block.
 */
export function markdownEnterAddsLine(value: string, caret: number) {
  return isInsideMarkdownFence(`${value.slice(0, caret)}\n`, caret + 1)
}

/**
 * Replaces a textarea range through the browser's editing command so the
 * change is one native undo step; falls back to setting the value directly.
 */
export function replaceTextareaRange(textarea: HTMLTextAreaElement, edit: SourceEdit, onChange: (value: string) => void) {
  textarea.focus()
  textarea.setSelectionRange(edit.start, edit.end)
  const expected = textarea.value.slice(0, edit.start) + edit.text + textarea.value.slice(edit.end)
  let applied: boolean
  try {
    applied = typeof document.execCommand === 'function' && document.execCommand('insertText', false, edit.text) && textarea.value === expected
  } catch {
    applied = false
  }
  if (!applied) onChange(expected)
  const select = () => textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd)
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
