import { Component, type FocusEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import MonacoEditor, { type OnMount } from '@monaco-editor/react'
import { Button } from '../ui/Button'
import { Keyboard } from 'lucide-react'
import { detectLanguageFromName } from '../../lib/codeLanguage'
import { ensureMonacoLoaded, getMonacoLoadStatus, PHONE_CODE_EDITOR_QUERY } from '../../lib/monacoLoader'
import { useTheme } from '../../lib/theme'
import { defineMonacoThemes, MONACO_THEME_NAMES } from '../../lib/monacoTheme'
import { useMediaQuery } from '../../lib/useMediaQuery'

interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: string
  readOnly?: boolean
  minHeight?: number
  height?: string
  /** Accessible name for the code editor when rendered as a textarea fallback. */
  ariaLabel?: string
  /** Shows the keyboard hint and Tab-behaviour toggle under an editable editor. */
  showKeyboardHelp?: boolean
  /** Temporarily blocks edits (for example while a submission is sending) without hiding the help row. */
  busy?: boolean
  /** Lesson redesign: source never wraps mid-token. Off keeps the existing editor. */
  wordWrap?: 'on' | 'off'
}

// Derive Monaco language from filename first, then fall back to explicit admin hint.
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

function focusOutside(container: HTMLElement | null, direction: 1 | -1): boolean {
  if (!container) return false
  const modal = container.closest<HTMLElement>('[data-app-modal]')
  const scope: ParentNode = modal ?? document
  const all = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !container.contains(el) && el.offsetParent !== null)
  const target = direction === 1
    ? all.find((el) => container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) ?? (modal ? all[0] : undefined)
    : [...all].reverse().find((el) => container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) ?? (modal ? all.at(-1) : undefined)
  if (!target) return false
  target.focus()
  return document.activeElement === target
}

function prefersLargerText() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

class MonacoErrorBoundary extends Component<{ onError: () => void; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.hasError ? null : this.props.children
  }
}

type EditorMode = 'loading' | 'ready' | 'fallback'

export function CodeEditor({
  value,
  onChange,
  language = 'ruby',
  readOnly = false,
  minHeight = 200,
  height,
  ariaLabel,
  showKeyboardHelp = false,
  busy = false,
  wordWrap = 'on',
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const tabMovesFocusRef = useRef<{ set: (value: boolean) => void } | null>(null)
  const [tabMovesFocus, setTabMovesFocus] = useState(false)
  const coarsePointer = useMediaQuery('(pointer: coarse)')
  const phoneViewport = useMediaQuery(PHONE_CODE_EDITOR_QUERY)
  const desiredPreferPlain = coarsePointer || phoneViewport
  const [activePreferPlain, setActivePreferPlain] = useState(desiredPreferPlain)
  const [mode, setMode] = useState<EditorMode>(() => {
    const status = getMonacoLoadStatus()
    if (status === 'ready') return 'ready'
    if (status === 'failed') return 'fallback'
    return 'loading'
  })
  const helpId = useId()
  const textareaId = useId()
  const fallbackNoteId = useId()
  const indentSize = indentSizeFor(language)
  const editable = !readOnly
  const { theme } = useTheme()
  const usePlainTextarea = activePreferPlain || mode === 'fallback'
  const showFallbackNotice = !activePreferPlain && mode === 'fallback'
  const showHelp = showKeyboardHelp && editable && !activePreferPlain

  useEffect(() => {
    tabMovesFocusRef.current?.set(tabMovesFocus)
  }, [tabMovesFocus])

  useEffect(() => {
    // Keep the current input and its selection until the user leaves it.
    if (!busy && !containerRef.current?.contains(document.activeElement)) {
      setActivePreferPlain(desiredPreferPlain)
    }
  }, [busy, desiredPreferPlain])

  useEffect(() => {
    if (desiredPreferPlain || activePreferPlain || mode !== 'loading') return

    let active = true
    ensureMonacoLoaded().then(
      () => { if (active) setMode('ready') },
      () => { if (active) setMode('fallback') },
    )
    return () => { active = false }
  }, [activePreferPlain, desiredPreferPlain, mode])

  const leaveEditor = (): boolean => {
    const help = helpButtonRef.current
    // The help toggle is hidden on touch screens; fall back to the next control.
    if (help && help.offsetParent !== null) {
      help.focus()
      if (document.activeElement === help) return true
    }
    return focusOutside(containerRef.current, 1)
  }

  const handleContainerBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocused = event.relatedTarget
    if (nextFocused instanceof Node && containerRef.current?.contains(nextFocused)) {
      return
    }
    if (!busy && activePreferPlain !== desiredPreferPlain) {
      setActivePreferPlain(desiredPreferPlain)
    }
  }

  // Commands are registered for every editor (Monaco calls onMount once), so an
  // editor that mounts read-only and later becomes editable still lets
  // keyboard users leave it.
  const handleMount: OnMount = (editor, monaco) => {
    const tabKey = editor.createContextKey<boolean>('csgTabMovesFocus', false)
    tabMovesFocusRef.current = tabKey
    tabKey.set(tabMovesFocus)
    // Keyboard users must never be trapped: Escape leaves the editor (when no
    // suggestion or find widget is open), and Tab can optionally move focus.
    editor.addCommand(monaco.KeyCode.Escape, () => { leaveEditor() }, '!suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible && !renameInputVisible')
    editor.addCommand(monaco.KeyCode.Tab, () => { focusOutside(containerRef.current, 1) }, 'csgTabMovesFocus && !suggestWidgetVisible')
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => { focusOutside(containerRef.current, -1) }, 'csgTabMovesFocus && !suggestWidgetVisible')
  }

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (leaveEditor()) event.preventDefault()
      return
    }
    if (
      event.key === 'Tab' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !tabMovesFocus &&
      !activePreferPlain &&
      editable &&
      !busy
    ) {
      event.preventDefault()
      const target = event.currentTarget
      const start = target.selectionStart ?? value.length
      const end = target.selectionEnd ?? value.length
      const spaces = ' '.repeat(indentSize)
      const nextValue = `${value.slice(0, start)}${spaces}${value.slice(end)}`
      onChange?.(nextValue)
      const nextCursor = start + spaces.length
      window.requestAnimationFrame(() => {
        target.setSelectionRange(nextCursor, nextCursor)
      })
    }
  }

  const describedBy = [
    showHelp ? helpId : null,
    showFallbackNotice ? fallbackNoteId : null,
  ].filter(Boolean).join(' ') || undefined

  return (
    <div className="min-w-0">
      {activePreferPlain && showKeyboardHelp && ariaLabel && (
        <label htmlFor={textareaId} className="mb-2 block text-sm font-semibold text-ink">{ariaLabel}</label>
      )}
      <div
        ref={containerRef}
        data-code-editor=""
        onBlur={handleContainerBlur}
        className="min-w-0 rounded-xl overflow-hidden border border-code-line bg-code-bg focus-within:border-focus focus-within:ring-2 focus-within:ring-focus"
        style={{ minHeight, height: height || minHeight }}
        aria-describedby={!usePlainTextarea ? describedBy : undefined}
      >
        {usePlainTextarea ? (
          <textarea
            id={textareaId}
            aria-label={ariaLabel || `${languageLabel(language)} code`}
            aria-describedby={describedBy}
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
            readOnly={readOnly}
            disabled={busy}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            wrap={wordWrap === 'off' ? 'off' : 'soft'}
            className={`block h-full w-full min-w-0 resize-none bg-code-bg p-3 font-mono ${activePreferPlain ? 'text-base' : 'text-sm'} leading-relaxed text-code-ink focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${wordWrap === 'off' ? 'overflow-x-auto whitespace-pre' : 'whitespace-pre-wrap'}`}
          />
        ) : mode === 'ready' ? (
          <MonacoErrorBoundary
            onError={() => setMode('fallback')}
          >
            <MonacoEditor
              height={height || minHeight}
              language={language}
              value={value}
              // The code tokens in both themes, so the editor matches <CodeBlock>.
              theme={MONACO_THEME_NAMES[theme]}
              beforeMount={defineMonacoThemes}
              onChange={(v) => onChange?.(v ?? '')}
              onMount={handleMount}
              options={{
                readOnly: readOnly || busy,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                // 16px on touch screens keeps iOS from zooming the page when the editor is focused.
                fontSize: prefersLargerText() ? 16 : 14,
                lineNumbers: 'on',
                tabSize: indentSize,
                insertSpaces: true,
                detectIndentation: false,
                wordWrap,
                automaticLayout: true,
                padding: { top: 12, bottom: 12 },
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                scrollbar: { alwaysConsumeMouseWheel: false },
                renderLineHighlight: 'line',
                // Monaco 0.55.1 can reject an in-flight occurrence scan when its model is disposed.
                occurrencesHighlight: 'off',
                contextmenu: true,
                quickSuggestions: !readOnly,
                suggestOnTriggerCharacters: !readOnly,
                'semanticHighlighting.enabled': false,
              }}
            />
          </MonacoErrorBoundary>
        ) : (
          <div
            role="status"
            aria-live="polite"
            className="flex h-full w-full items-center justify-center p-4 text-sm text-ink-muted"
            style={{ minHeight }}
          >
            Loading code editor…
          </div>
        )}
      </div>
      {showFallbackNotice && (
        <p id={fallbackNoteId} role="status" className="mt-2 text-xs text-ink-muted">
          Using the basic code editor — your work still saves and submits normally.
        </p>
      )}
      {showHelp && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-muted">
          <p id={helpId}>
            {languageLabel(language)} · Tab = {indentSize} spaces<span className="pointer-coarse:hidden"> · Press <kbd className="rounded border border-line-strong bg-surface-raised px-1 font-sans">Esc</kbd> to leave the editor</span>
          </p>
          <Button
            ref={helpButtonRef}
            variant="quiet"
            size="sm"
            aria-pressed={tabMovesFocus}
            onClick={() => setTabMovesFocus((current) => !current)}
            className="pointer-coarse:hidden"
          >
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            {tabMovesFocus ? 'Tab moves focus' : 'Tab indents'}
          </Button>
        </div>
      )}
    </div>
  )
}
