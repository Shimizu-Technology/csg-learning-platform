import MonacoEditor from '@monaco-editor/react'

interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: string
  readOnly?: boolean
  minHeight?: number
}

// Derive Monaco language from filename first, then fall back to explicit admin hint.
function detectLanguageFromName(name: string): string | null {
  if (name.includes('.rb') || name.includes('ruby') || name.includes('rails')) return 'ruby'
  if (name.includes('.py') || name.includes('python')) return 'python'
  if (name.includes('.tsx') || name.includes('.ts') || name.includes('typescript')) return 'typescript'
  if (name.includes('.jsx')) return 'javascript'
  if (name.includes('.json') || name.includes('json')) return 'json'
  if (name.includes('.js') || name.includes('javascript')) return 'javascript'
  if (name.includes('.html') || name.includes('html')) return 'html'
  if (name.includes('.css') || name.includes('css')) return 'css'
  if (name.includes('.sql') || name.includes('sql')) return 'sql'
  if (name.includes('.sh') || name.includes('bash') || name.includes('shell')) return 'shell'
  return null
}

export function detectLanguage(filename?: string | null, hint?: string | null): string {
  const filenameMatch = filename ? detectLanguageFromName(filename.toLowerCase()) : null
  if (filenameMatch) return filenameMatch

  const hintMatch = hint ? detectLanguageFromName(hint.toLowerCase()) : null
  if (hintMatch) return hintMatch

  return 'ruby' // CSG default — most exercises are Ruby
}

export function CodeEditor({
  value,
  onChange,
  language = 'ruby',
  readOnly = false,
  minHeight = 200,
}: CodeEditorProps) {
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
        onChange={(v) => onChange?.(v ?? '')}
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
          'semanticHighlighting.enabled': false,
        }}
      />
    </div>
  )
}
