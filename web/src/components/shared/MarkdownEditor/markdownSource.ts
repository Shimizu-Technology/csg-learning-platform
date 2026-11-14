import { isInsideMarkdownFence } from '../../../lib/codePaste'

/** Formatting actions shared by both modes' toolbars and shortcuts. */
export type FormatAction = 'bold' | 'italic' | 'strike' | 'code' | 'codeBlock' | 'bulletList' | 'orderedList' | 'blockquote' | 'link'

export type SourceEdit = { start: number; end: number; text: string; selectionStart: number; selectionEnd: number }

const WRAPS: Partial<Record<FormatAction, [string, string, string]>> = {
  bold: ['**', '**', 'bold text'],
  italic: ['_', '_', 'italic text'],
  strike: ['~~', '~~', 'struck text'],
  code: ['`', '`', 'code'],
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
