import { useState } from 'react'
import { SegmentButton, SegmentedControl } from '../ui/Choice'
import { CodeEditor } from '../shared/CodeEditor'
import { MarkdownText } from '../shared/MarkdownRenderer'

/**
 * A written answer reads best formatted; source code reads best in the editor.
 * Markdown files, and answers with no code file that contain a fenced block,
 * open formatted; everything else opens as source. Staff can switch either way.
 */
export function submissionReadsAsWriting(text: string, namedLanguage: string | null) {
  if (namedLanguage === 'markdown') return true
  return !namedLanguage && /^[ \t]*(?:```|~~~)/m.test(text)
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
        : <CodeEditor value={text} language={language} readOnly minHeight={220} />}
    </div>
  )
}
