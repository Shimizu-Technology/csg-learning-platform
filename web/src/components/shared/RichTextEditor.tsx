import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { marked } from 'marked'
import { sanitizeUrl } from '../../lib/sanitizeUrl'

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

function ToolbarButton({
  label,
  active = false,
  onClick,
}: {
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => {
        event.preventDefault()
        onClick()
      }}
      className={`min-h-9 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
        active
          ? 'border-primary-200 bg-primary-50 text-primary-700'
          : 'border-slate-200 bg-white text-slate-600 hover:border-primary-200 hover:text-primary-700'
      }`}
    >
      {label}
    </button>
  )
}

export function RichTextEditor({
  value,
  onChange,
  label,
  sublabel,
  placeholder,
  height = 350,
}: Props) {
  const normalizedValue = useMemo(() => normalizeValue(value), [value])
  const lastSyncedValueRef = useRef(normalizedValue)
  const [showLinkEditor, setShowLinkEditor] = useState(false)
  const [linkHref, setLinkHref] = useState('https://')
  const [linkError, setLinkError] = useState('')

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Placeholder.configure({
        placeholder: placeholder || 'Start writing…',
      }),
    ],
    content: normalizedValue,
    editorProps: {
      attributes: {
        class: 'exercise-content rich-text-editor-surface px-4 py-3 text-sm leading-7 text-slate-800 outline-none',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const next = currentEditor.isEmpty ? '' : currentEditor.getHTML()
      lastSyncedValueRef.current = next
      onChange(next)
    },
  })

  useEffect(() => {
    if (!editor) return
    if (normalizedValue === lastSyncedValueRef.current) return

    editor.commands.setContent(normalizedValue || '', { emitUpdate: false })
    lastSyncedValueRef.current = normalizedValue
  }, [editor, normalizedValue])

  const openLinkEditor = () => {
    if (!editor) return

    const currentHref = editor.getAttributes('link').href as string | undefined
    setLinkHref(currentHref || 'https://')
    setLinkError('')
    setShowLinkEditor(true)
  }

  const setLink = () => {
    if (!editor) return

    if (!linkHref.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      setShowLinkEditor(false)
      return
    }

    const sanitizedHref = sanitizeUrl(linkHref.trim())
    if (sanitizedHref === '#') {
      setLinkError('Enter a valid http, https, or mailto link.')
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: sanitizedHref }).run()
    setShowLinkEditor(false)
    setLinkError('')
  }

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
          <ToolbarButton label="Bold" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} />
          <ToolbarButton label="Italic" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} />
          <ToolbarButton label="Link" active={editor?.isActive('link')} onClick={openLinkEditor} />
          <ToolbarButton label="Quote" active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
          <ToolbarButton label="Inline code" active={editor?.isActive('code')} onClick={() => editor?.chain().focus().toggleCode().run()} />
          <ToolbarButton label="Code block" active={editor?.isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
          <ToolbarButton label="List" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
        </div>

        {showLinkEditor && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setLink()
            }}
            className="border-b border-slate-200 bg-primary-50/60 p-3"
          >
            <label htmlFor="rich-text-link-url" className="text-xs font-bold text-slate-700">Link URL</label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input
                id="rich-text-link-url"
                type="text"
                inputMode="url"
                value={linkHref}
                onChange={(event) => {
                  setLinkHref(event.target.value)
                  setLinkError('')
                }}
                className="app-control min-w-0 flex-1"
                autoFocus
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowLinkEditor(false)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="submit" className="min-h-11 rounded-xl bg-primary-600 px-3 text-xs font-bold text-white hover:bg-primary-700">Apply link</button>
              </div>
            </div>
            {linkError && <p className="mt-1.5 text-xs font-semibold text-red-700" role="alert">{linkError}</p>}
          </form>
        )}

        <div style={{ minHeight: height }}>
          <EditorContent editor={editor} />
        </div>
      </div>

      <p className="mt-1.5 text-xs text-slate-400">
        Write normally and use the toolbar for formatting. The app stores sanitized HTML automatically.
      </p>
    </div>
  )
}
