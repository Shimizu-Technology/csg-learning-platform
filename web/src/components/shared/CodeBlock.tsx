import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { Check, Copy } from 'lucide-react'
import { analyticsLanguage, captureProductEvent } from '../../lib/analytics'
import { copyText } from '../../lib/clipboard'

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash', sh: 'Shell', shell: 'Shell', zsh: 'Shell', console: 'Terminal', terminal: 'Terminal',
  css: 'CSS', html: 'HTML', xml: 'XML', erb: 'ERB', js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX',
  json: 'JSON', py: 'Python', python: 'Python', rb: 'Ruby', ruby: 'Ruby', sql: 'SQL',
  ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', md: 'Markdown', markdown: 'Markdown', text: 'Text',
}

const ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby' }

export function codeLanguageLabel(language: string) {
  const key = language.trim().toLowerCase()
  return LANGUAGE_LABELS[key] || language.trim()
}

/** Leading and trailing blank lines are noise in every surface; inner blank lines stay. */
function trimBlankLines(code: string) {
  return code.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '')
}

function CopyCodeButton({ code, language, surface, beside }: { code: string; language: string; surface: 'message' | 'lesson'; beside: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copy = useCallback(() => {
    void copyText(code).then((copied) => {
      if (copied) captureProductEvent('code_block_copied', { surface, language: analyticsLanguage(language) })
      setState(copied ? 'copied' : 'failed')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('idle'), copied ? 2000 : 4000)
    })
  }, [code, language, surface])

  return (
    <button
      type="button"
      onClick={copy}
      data-state={state}
      aria-label={state === 'idle' ? 'Copy code' : undefined}
      className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-ink-secondary transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus data-[state=copied]:text-success-700 data-[state=failed]:bg-warning-50 data-[state=failed]:text-warning-800 relative ${beside ? 'm-1.5' : ''}`}
    >
      {state === 'copied'
        ? <><Check className="h-3.5 w-3.5" aria-hidden="true" /><span>Copied</span></>
        : state === 'failed'
          ? <span>Copy failed — select the code instead</span>
          : <><Copy className="h-3.5 w-3.5" aria-hidden="true" /><span>Copy</span></>}
      {/* The 32px button gets a 44px hit area from the ::after above. */}
      <span className="sr-only" aria-live="polite">{state === 'copied' ? 'Copied' : ''}</span>
    </button>
  )
}

/**
 * The one code block (design spec §8) for lessons, messages, submissions,
 * feedback, help replies and updates: language label and Copy in a header,
 * monospace that scrolls sideways instead of wrapping, and syntax colors for
 * labeled languages once the highlighter has loaded.
 */
export function CodeBlock({
  code,
  language = '',
  surface = 'lesson',
  size = 'default',
}: {
  code: string
  language?: string
  /** Analytics surface for the Copy event. */
  surface?: 'message' | 'lesson'
  /** "compact" is the chat size: 13.5px text, and single-line snippets without a label drop the header. */
  size?: 'default' | 'compact'
}) {
  const text = useMemo(() => trimBlankLines(code), [code])
  const name = language.trim().split(/\s+/)[0] || ''
  const highlightName = ALIASES[name.toLowerCase()] || name.toLowerCase()
  const [highlighted, setHighlighted] = useState<{ source: string; html: string } | null>(null)

  useEffect(() => {
    if (!highlightName) return
    let active = true
    void import('../../lib/highlight')
      .then(({ highlightCode }) => {
        const html = highlightCode(text, highlightName)
        // hljs escapes the code itself; sanitize anyway so only class-named spans reach the DOM.
        if (active && html !== null) setHighlighted({ source: text, html: DOMPurify.sanitize(html, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] }) })
      })
      .catch(() => { /* Plain code is a fine fallback. */ })
    return () => { active = false }
  }, [highlightName, text])

  const headerless = size === 'compact' && !name && !text.includes('\n')
  const html = highlighted?.source === text ? highlighted.html : null

  return (
    <div className={`code-block my-3 max-w-full overflow-hidden rounded-xl border border-code-line bg-code-bg text-code-ink ${headerless ? 'flex items-start' : ''}`} data-language={name || undefined}>
      {!headerless && (
        <div className="flex h-9 items-center gap-2 border-b border-code-line bg-code-header pl-3 pr-1.5">
          <span className="min-w-0 flex-1 truncate font-sans text-xs font-semibold text-ink-muted">{name ? codeLanguageLabel(name) : 'Code'}</span>
          <CopyCodeButton code={text} language={name} surface={surface} beside={false} />
        </div>
      )}
      <pre
        tabIndex={0}
        aria-label={name ? `${codeLanguageLabel(name)} code` : 'Code'}
        className={`m-0 min-w-0 flex-1 overflow-x-auto whitespace-pre px-3.5 py-3 font-mono leading-[1.6] [tab-size:4] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${size === 'compact' ? 'text-[13.5px]' : 'text-sm'}`}
      >
        {html !== null
          ? <code className={`hljs language-${highlightName}`} dangerouslySetInnerHTML={{ __html: html }} />
          : <code>{text}</code>}
      </pre>
      {/* A one-line snippet keeps Copy beside the code, so it never covers text that scrolls. */}
      {headerless && <CopyCodeButton code={text} language={name} surface={surface} beside />}
    </div>
  )
}
