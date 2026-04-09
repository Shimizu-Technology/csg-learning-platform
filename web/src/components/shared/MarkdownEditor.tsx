import { useState, useRef, useCallback } from 'react'
import { Bold, Italic, Code, Link, List, ListOrdered, Heading2, Quote, FileCode } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'

interface Props {
  value: string
  onChange: (value: string) => void
  label: string
  sublabel?: string
  placeholder?: string
  rows?: number
  mono?: boolean
}

type FormatAction = {
  icon: React.ReactNode
  title: string
  apply: (text: string, selStart: number, selEnd: number) => { text: string; cursorStart: number; cursorEnd: number }
}

const FORMATS: FormatAction[] = [
  {
    icon: <Bold className="h-3.5 w-3.5" />,
    title: 'Bold',
    apply: (text, s, e) => wrap(text, s, e, '**', '**'),
  },
  {
    icon: <Italic className="h-3.5 w-3.5" />,
    title: 'Italic',
    apply: (text, s, e) => wrap(text, s, e, '_', '_'),
  },
  {
    icon: <Code className="h-3.5 w-3.5" />,
    title: 'Inline code',
    apply: (text, s, e) => wrap(text, s, e, '`', '`'),
  },
  {
    icon: <FileCode className="h-3.5 w-3.5" />,
    title: 'Code block',
    apply: (text, s, e) => wrap(text, s, e, '```\n', '\n```'),
  },
  {
    icon: <Link className="h-3.5 w-3.5" />,
    title: 'Link',
    apply: (text, s, e) => {
      const selected = text.slice(s, e) || 'link text'
      const before = text.slice(0, s)
      const after = text.slice(e)
      const inserted = `[${selected}](url)`
      return { text: before + inserted + after, cursorStart: s + selected.length + 3, cursorEnd: s + selected.length + 6 }
    },
  },
  {
    icon: <Heading2 className="h-3.5 w-3.5" />,
    title: 'Heading',
    apply: (text, s, e) => prefix(text, s, e, '## '),
  },
  {
    icon: <Quote className="h-3.5 w-3.5" />,
    title: 'Blockquote',
    apply: (text, s, e) => prefix(text, s, e, '> '),
  },
  {
    icon: <List className="h-3.5 w-3.5" />,
    title: 'Bullet list',
    apply: (text, s, e) => prefix(text, s, e, '- '),
  },
  {
    icon: <ListOrdered className="h-3.5 w-3.5" />,
    title: 'Numbered list',
    apply: (text, s, e) => prefix(text, s, e, '1. '),
  },
]

function wrap(text: string, s: number, e: number, before: string, after: string) {
  const selected = text.slice(s, e) || 'text'
  const result = text.slice(0, s) + before + selected + after + text.slice(e)
  return { text: result, cursorStart: s + before.length, cursorEnd: s + before.length + selected.length }
}

function prefix(text: string, s: number, e: number, pre: string) {
  const lineStart = text.lastIndexOf('\n', s - 1) + 1
  const selected = text.slice(s, e) || 'text'
  const result = text.slice(0, lineStart) + pre + text.slice(lineStart, s) + selected + text.slice(e)
  return { text: result, cursorStart: s + pre.length, cursorEnd: s + pre.length + selected.length }
}

export function MarkdownEditor({ value, onChange, label, sublabel, placeholder, rows = 8, mono }: Props) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const applyFormat = useCallback((format: FormatAction) => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart, selectionEnd } = ta
    const result = format.apply(value, selectionStart, selectionEnd)
    onChange(result.text)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(result.cursorStart, result.cursorEnd)
    })
  }, [value, onChange])

  return (
    <div>
      <div className="flex items-end justify-between mb-1.5">
        <div>
          <span className="text-sm font-semibold text-slate-700">{label}</span>
          {sublabel && <span className="text-sm font-normal text-slate-400 ml-1">{sublabel}</span>}
        </div>
        <div className="flex rounded-md border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setTab('write')}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'write' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Write
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'preview' ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Preview
          </button>
        </div>
      </div>

      {tab === 'write' ? (
        <div className="rounded-lg border border-slate-200 overflow-hidden focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent">
          {/* Toolbar */}
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-slate-100 bg-slate-50">
            {FORMATS.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => applyFormat(f)}
                title={f.title}
                className="rounded p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              >
                {f.icon}
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className={`w-full px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none resize-y ${
              mono ? 'font-mono text-xs' : ''
            }`}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 px-4 py-3 bg-white min-h-[200px]">
          {value.trim() ? (
            <MarkdownRenderer content={value} />
          ) : (
            <p className="text-sm text-slate-300 italic">Nothing to preview</p>
          )}
        </div>
      )}
    </div>
  )
}
