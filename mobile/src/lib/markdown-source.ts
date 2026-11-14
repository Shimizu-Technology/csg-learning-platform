/** Formatting actions shared by both modes' toolbars and shortcuts. */
export type FormatAction = 'bold' | 'italic' | 'strike' | 'code' | 'codeBlock' | 'bulletList' | 'orderedList' | 'blockquote' | 'link'

export type SourceEdit = { start: number; end: number; text: string; selectionStart: number; selectionEnd: number }

const WRAPS: Partial<Record<FormatAction, [string, string, string]>> = {
  bold: ['**', '**', 'bold text'],
  italic: ['_', '_', 'italic text'],
  strike: ['~~', '~~', 'struck text'],
}

const PREFIXES: Partial<Record<FormatAction, (index: number) => string>> = {
  bulletList: () => '- ',
  orderedList: (index) => `${index + 1}. `,
  blockquote: () => '> ',
}

/**
 * The text change a toolbar button or shortcut makes in Markdown mode: wraps
 * the selection, prefixes each selected line, or fences the selected lines.
 */
export function markdownSourceEdit(value: string, start: number, end: number, action: FormatAction, href = ''): SourceEdit {
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
    return { start, end, text, selectionStart: href ? start + text.length : urlStart, selectionEnd: href ? start + text.length : urlStart + url.length }
  }

  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const nextBreak = value.indexOf('\n', Math.max(end - (end > start && value[end - 1] === '\n' ? 1 : 0), start))
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const lines = value.slice(lineStart, lineEnd)

  if (action === 'codeBlock') {
    const longest = Math.max(2, ...Array.from(lines.matchAll(/`+/g), (match) => match[0].length))
    const fence = '`'.repeat(longest + 1)
    const before = lineStart > 0 && value[lineStart - 1] !== '\n' ? '\n' : ''
    const text = `${before}${fence}\n${lines}\n${fence}`
    const codeStart = lineStart + before.length + fence.length + 1
    return { start: lineStart, end: lineEnd, text, selectionStart: codeStart, selectionEnd: codeStart + lines.length }
  }

  const prefix = PREFIXES[action]!
  const prefixed = lines.split('\n').map((line, index) => `${prefix(index)}${line}`).join('\n')
  const firstPrefix = prefix(0).length
  return {
    start: lineStart,
    end: lineEnd,
    text: prefixed,
    selectionStart: start + firstPrefix,
    selectionEnd: end === start ? start + firstPrefix : lineStart + prefixed.length,
  }
}

