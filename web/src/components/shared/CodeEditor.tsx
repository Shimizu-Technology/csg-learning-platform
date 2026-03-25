import { useRef } from 'react'
import MonacoEditor, { type OnMount } from '@monaco-editor/react'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language?: string
  readOnly?: boolean
  minHeight?: number
  placeholder?: string
}

// Derive Monaco language from filename or block metadata
export function detectLanguage(filename?: string | null, hint?: string | null): string {
  const name = filename?.toLowerCase() || hint?.toLowerCase() || ''
  if (name.includes('.rb') || name.includes('ruby') || name.includes('rails')) return 'ruby'
  if (name.includes('.py') || name.includes('python')) return 'python'
  if (name.includes('.ts') || name.includes('typescript')) return 'typescript'
  if (name.includes('.tsx')) return 'typescript'
  if (name.includes('.jsx')) return 'javascript'
  if (name.includes('.js') || name.includes('javascript')) return 'javascript'
  if (name.includes('.html') || name.includes('html')) return 'html'
  if (name.includes('.css') || name.includes('css')) return 'css'
  if (name.includes('.json') || name.includes('json')) return 'json'
  if (name.includes('.sql') || name.includes('sql')) return 'sql'
  if (name.includes('.sh') || name.includes('bash') || name.includes('shell')) return 'shell'
  return 'ruby' // CSG default — most exercises are Ruby
}

export function CodeEditor({
  value,
  onChange,
  language = 'ruby',
  readOnly = false,
  minHeight = 200,
  placeholder,
}: CodeEditorProps) {
  const editorRef = useRef<any>(null)

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor

    // Show placeholder when editor is empty and not focused
    if (placeholder && !value) {
      const model = editor.getModel()
      if (model) {
        // Monaco doesn't have native placeholder — use decorations
        editor.onDidFocusEditorText(() => {
          // clear any placeholder decorations on focus
        })
      }
    }

    // Auto-focus for exercise blocks
    if (!readOnly) {
      editor.focus()
    }
  }

  return (
    <div
      className="rounded-xl overflow-hidden border border-slate-700"
      style={{ minHeight }}
    >
      <MonacoEditor
        height={minHeight}
        language={language}
        value={value}
        theme="vs-dark"
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 14,
          lineNumbers: 'on',
          tabSize: 2,
          insertSpaces: true,
          wordWrap: 'on',
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          renderLineHighlight: 'line',
          contextmenu: true,
          quickSuggestions: !readOnly,
          suggestOnTriggerCharacters: !readOnly,
          // Keep it lightweight — no heavy linting
          'semanticHighlighting.enabled': false,
        }}
      />
    </div>
  )
}
