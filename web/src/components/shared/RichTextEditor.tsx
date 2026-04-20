import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'

function isHtml(str: string): boolean {
  if (!str) return false
  return /^\s*<(p|div|h[1-6]|ul|ol|li|pre|blockquote|table|br|hr|!DOCTYPE)[\s>]/i.test(str)
}

function legacyMarkdownToHtml(md: string): string {
  if (!md) return ''
  return marked.parse(md, { async: false }) as string
}

function normalizeValue(value: string): string {
  if (!value) return ''
  if (isHtml(value)) return value
  return legacyMarkdownToHtml(value)
}

interface Props {
  value: string
  onChange: (value: string) => void
  label: string
  sublabel?: string
  placeholder?: string
  height?: number
}

const SNIPPETS: Record<string, { open: string; close: string }> = {
  bold: { open: '<strong>', close: '</strong>' },
  italic: { open: '<em>', close: '</em>' },
  code: { open: '<code>', close: '</code>' },
  link: { open: '<a href="https://example.com">', close: '</a>' },
  quote: { open: '<blockquote>', close: '</blockquote>' },
  list: { open: '<ul>\n  <li>', close: '</li>\n</ul>' },
  codeBlock: { open: '<pre><code>', close: '</code></pre>' },
}

export function RichTextEditor({
  value,
  onChange,
  label,
  sublabel,
  placeholder,
  height = 350,
}: Props) {
  const [html, setHtml] = useState(() => normalizeValue(value))
  const lastValueRef = useRef(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (value !== lastValueRef.current) {
      const next = normalizeValue(value)
      setHtml(next)
      lastValueRef.current = value
    }
  }, [value])

  const emitChange = useCallback((next: string) => {
    setHtml(next)
    const output = next.trim() ? next : ''
    lastValueRef.current = output
    onChange(output)
  }, [onChange])

  const insertSnippet = useCallback((kind: keyof typeof SNIPPETS) => {
    const textarea = textareaRef.current
    const snippet = SNIPPETS[kind]
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = html.slice(start, end) || 'Text'
    const next = `${html.slice(0, start)}${snippet.open}${selected}${snippet.close}${html.slice(end)}`
    emitChange(next)

    requestAnimationFrame(() => {
      textarea.focus()
      const cursorStart = start + snippet.open.length
      textarea.setSelectionRange(cursorStart, cursorStart + selected.length)
    })
  }, [emitChange, html])

  const actions = useMemo(
    () => [
      { key: 'bold', label: 'Bold' },
      { key: 'italic', label: 'Italic' },
      { key: 'link', label: 'Link' },
      { key: 'quote', label: 'Quote' },
      { key: 'code', label: 'Inline code' },
      { key: 'codeBlock', label: 'Code block' },
      { key: 'list', label: 'List' },
    ] as const,
    [],
  )

  return (
    <div>
      <div className="flex items-end justify-between mb-1.5">
        <div>
          <span className="text-sm font-semibold text-slate-700">{label}</span>
          {sublabel && (
            <span className="text-sm font-normal text-slate-400 ml-1">
              {sublabel}
            </span>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2">
          {actions.map(action => (
            <button
              key={action.key}
              type="button"
              onClick={() => insertSnippet(action.key)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:border-primary-200 hover:text-primary-700"
            >
              {action.label}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={html}
          onChange={(event) => emitChange(event.target.value)}
          placeholder={placeholder}
          className="block w-full resize-y border-0 bg-white p-3 font-mono text-sm leading-6 text-slate-800 outline-none focus:ring-0"
          style={{ minHeight: height }}
          spellCheck={false}
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        Content is saved as HTML and sanitized when shown to students. Use the buttons above to insert common formatting.
      </p>
    </div>
  )
}
