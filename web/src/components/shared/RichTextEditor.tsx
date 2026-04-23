import { useEffect, useMemo, useRef } from 'react'
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
      className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
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

  const setLink = () => {
    if (!editor) return

    const currentHref = editor.getAttributes('link').href as string | undefined
    const href = window.prompt('Enter the link URL', currentHref || 'https://')
    if (href === null) return

    if (!href.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    const sanitizedHref = sanitizeUrl(href.trim())
    if (sanitizedHref === '#') {
      window.alert('Please enter a valid http, https, or mailto link.')
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: sanitizedHref }).run()
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
          <ToolbarButton label="Link" active={editor?.isActive('link')} onClick={setLink} />
          <ToolbarButton label="Quote" active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
          <ToolbarButton label="Inline code" active={editor?.isActive('code')} onClick={() => editor?.chain().focus().toggleCode().run()} />
          <ToolbarButton label="Code block" active={editor?.isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
          <ToolbarButton label="List" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
        </div>

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
