import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import ReactQuill from 'react-quill-new'
import 'react-quill-new/dist/quill.snow.css'
import { marked } from 'marked'

/**
 * Detect whether a string is HTML (from Quill / Trix) vs legacy markdown.
 * If it contains any HTML tags we treat it as HTML; otherwise as markdown.
 */
function isHtml(str: string): boolean {
  if (!str) return false
  return /<\/?[a-z][\s\S]*>/i.test(str)
}

/**
 * Convert legacy markdown content to HTML so Quill can edit it.
 * Only called once on initial load for old content — new content
 * is stored as HTML and never round-trips through markdown again.
 */
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

  useEffect(() => {
    if (value !== lastValueRef.current) {
      setHtml(normalizeValue(value))
      lastValueRef.current = value
    }
  }, [value])

  const handleChange = useCallback(
    (newHtml: string) => {
      setHtml(newHtml)
      const output = (!newHtml || newHtml === '<p><br></p>') ? '' : newHtml
      lastValueRef.current = output
      onChange(output)
    },
    [onChange],
  )

  const modules = useMemo(
    () => ({
      toolbar: [
        ['bold', 'italic', 'strike'],
        ['link'],
        ['blockquote', 'code-block'],
        ['code'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ indent: '-1' }, { indent: '+1' }],
        ['clean'],
      ],
    }),
    [],
  )

  const formats = useMemo(
    () => [
      'bold',
      'italic',
      'strike',
      'link',
      'blockquote',
      'code-block',
      'code',
      'list',
      'indent',
    ],
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
      <div className="rich-editor-wrapper" style={{ marginBottom: 12 }}>
        <ReactQuill
          value={html}
          onChange={handleChange}
          modules={modules}
          formats={formats}
          placeholder={placeholder}
          theme="snow"
          style={{ height: `${height}px` }}
        />
      </div>
    </div>
  )
}
