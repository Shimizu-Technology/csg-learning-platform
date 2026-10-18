import { useEffect, useId, useRef, useState } from 'react'
import MonacoEditor, { type OnMount } from '@monaco-editor/react'
import { Keyboard } from 'lucide-react'

interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: string
  readOnly?: boolean
  minHeight?: number
  height?: string
  /** Shows the keyboard hint and Tab-behaviour toggle under an editable editor. */
  showKeyboardHelp?: boolean
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
  if (name.endsWith('.md') || name.includes('markdown')) return 'markdown'
  return null
}

export function detectLanguage(filename?: string | null, hint?: string | null): string {
  const filenameMatch = filename ? detectLanguageFromName(filename.toLowerCase()) : null
  if (filenameMatch) return filenameMatch

  const hintMatch = hint ? detectLanguageFromName(hint.toLowerCase()) : null
  if (hintMatch) return hintMatch

  return 'ruby' // CSG default — most exercises are Ruby
}

/** Python (PEP 8) and the CSG Python course indent with 4 spaces; the web languages use 2. */
export function indentSizeFor(language?: string | null): number {
  return language === 'python' || language === 'markdown' ? 4 : 2
}

export function languageLabel(language?: string | null): string {
  if (!language) return 'Code'
  const labels: Record<string, string> = { javascript: 'JavaScript', typescript: 'TypeScript', html: 'HTML', css: 'CSS', sql: 'SQL', json: 'JSON' }
  return labels[language] || language.charAt(0).toUpperCase() + language.slice(1)
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusOutside(container: HTMLElement | null, direction: 1 | -1) {
  if (!container) return
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !container.contains(el) && el.offsetParent !== null)
  const target = direction === 1
    ? all.find((el) => container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    : [...all].reverse().find((el) => container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
  target?.focus()
}

function prefersLargerText() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

export function CodeEditor({
  value,
  onChange,
  language = 'ruby',
  readOnly = false,
  minHeight = 200,
  height,
  showKeyboardHelp = false,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const tabMovesFocusRef = useRef<{ set: (value: boolean) => void } | null>(null)
  const [tabMovesFocus, setTabMovesFocus] = useState(false)
  const helpId = useId()
  const indentSize = indentSizeFor(language)
  const editable = !readOnly

  useEffect(() => {
    tabMovesFocusRef.current?.set(tabMovesFocus)
  }, [tabMovesFocus])

  const handleMount: OnMount = (editor, monaco) => {
    if (!editable) return
    const tabKey = editor.createContextKey<boolean>('csgTabMovesFocus', false)
    tabMovesFocusRef.current = tabKey
    tabKey.set(tabMovesFocus)
    // Keyboard users must never be trapped: Escape leaves the editor (when no
    // suggestion or find widget is open), and Tab can optionally move focus.
    editor.addCommand(monaco.KeyCode.Escape, () => {
      if (helpButtonRef.current) helpButtonRef.current.focus()
      else focusOutside(containerRef.current, 1)
    }, '!suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible && !renameInputVisible')
    editor.addCommand(monaco.KeyCode.Tab, () => focusOutside(containerRef.current, 1), 'csgTabMovesFocus && !suggestWidgetVisible')
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => focusOutside(containerRef.current, -1), 'csgTabMovesFocus && !suggestWidgetVisible')
  }

  return (
    <div>
      <div
        ref={containerRef}
        className="rounded-xl overflow-hidden border border-slate-700"
        style={{ minHeight, height: height || minHeight }}
        aria-describedby={showKeyboardHelp && editable ? helpId : undefined}
      >
        <MonacoEditor
          height={height || minHeight}
          language={language}
          value={value}
          theme="vs-dark"
          onChange={(v) => onChange?.(v ?? '')}
          onMount={handleMount}
          options={{
            readOnly,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            // 16px on touch screens keeps iOS from zooming the page when the editor is focused.
            fontSize: prefersLargerText() ? 16 : 14,
            lineNumbers: 'on',
            tabSize: indentSize,
            insertSpaces: true,
            detectIndentation: false,
            wordWrap: 'on',
            automaticLayout: true,
            padding: { top: 12, bottom: 12 },
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            scrollbar: { alwaysConsumeMouseWheel: false },
            renderLineHighlight: 'line',
            contextmenu: true,
            quickSuggestions: !readOnly,
            suggestOnTriggerCharacters: !readOnly,
            'semanticHighlighting.enabled': false,
          }}
        />
      </div>
      {showKeyboardHelp && editable && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-500">
          <p id={helpId}>
            {languageLabel(language)} · Tab = {indentSize} spaces<span className="pointer-coarse:hidden"> · Press <kbd className="rounded border border-slate-300 bg-white px-1 font-sans">Esc</kbd> to leave the editor</span>
          </p>
          <button
            ref={helpButtonRef}
            type="button"
            aria-pressed={tabMovesFocus}
            onClick={() => setTabMovesFocus((current) => !current)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-semibold text-slate-600 hover:bg-slate-200 hover:text-slate-900 pointer-coarse:hidden"
          >
            <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
            {tabMovesFocus ? 'Tab moves focus' : 'Tab indents'}
          </button>
        </div>
      )}
    </div>
  )
}
