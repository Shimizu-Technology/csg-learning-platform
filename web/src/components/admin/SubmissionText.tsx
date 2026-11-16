import { useState } from 'react'
import { SegmentButton, SegmentedControl } from '../ui/Choice'
import { CodeBlock } from '../shared/CodeBlock'
import { MarkdownText } from '../shared/MarkdownRenderer'

const CODE_LINE = /(?:[;{}]\s*$)|^\s*(?:def|class|function|const|let|var|import|from|export|return|if|elif|elsif|else|for|while|end|puts|print|console\.log|public|private)\b|=>|^\s*(?:<\/?[a-z][\w-]*[\s>]|#include|@\w+)|^\s*[\w.]+\s*=\s*[^=]/

/**
 * True when most lines of an answer read like source code rather than sentences
 * (statements ending in ; { or }, keywords at the start, assignments, tags).
 */
export function looksLikeCode(text: string) {
  const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim())
  if (lines.length === 0) return false
  const code = lines.filter((line) => CODE_LINE.test(line)).length
  return code / lines.length >= 0.4
}

/**
 * A written answer reads best formatted; source code reads best as code.
 * Markdown files open formatted. With no code file named, an answer opens
 * formatted when it has a fenced block or reads like sentences, and as source
 * when it reads like code. A named code file always opens as source. Staff can
 * switch either way.
 */
export function submissionReadsAsWriting(text: string, namedLanguage: string | null) {
  if (namedLanguage === 'markdown') return true
  if (namedLanguage) return false
  return /^[ \t]*(?:```|~~~)/m.test(text) || !looksLikeCode(text)
}

export function SubmissionText({ text, language, namedLanguage, preferSource = false }: {
  text: string
  /** Editor language for the source view. */
  language: string
  /** The language the exercise's filename or hint names, if any. */
  namedLanguage: string | null
  /** Runnable code always opens as source. */
  preferSource?: boolean
}) {
  const [view, setView] = useState<'formatted' | 'source'>(
    !preferSource && submissionReadsAsWriting(text, namedLanguage) ? 'formatted' : 'source',
  )

  return (
    <div className="space-y-2">
      <SegmentedControl label="Show the submission as">
        <SegmentButton dense selected={view === 'formatted'} onClick={() => setView('formatted')}>Formatted</SegmentButton>
        <SegmentButton dense selected={view === 'source'} onClick={() => setView('source')}>Source</SegmentButton>
      </SegmentedControl>
      {view === 'formatted'
        ? <div className="min-w-0 rounded-xl border border-line bg-surface-raised p-4 text-sm leading-6 text-ink [overflow-wrap:anywhere]"><MarkdownText content={text} /></div>
        : <CodeBlock code={text} language={language} surface="submission" lineNumbers className="my-0" />}
    </div>
  )
}
