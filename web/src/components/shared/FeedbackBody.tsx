import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '../ui/Button'
import { MarkdownRenderer } from './MarkdownRenderer'

/** Instructor feedback, rendered through the sanitized markdown renderer. */
export function FeedbackBody({ feedback, className = '' }: { feedback: string; className?: string }) {
  return (
    <div className={`feedback-body text-sm ${className}`}>
      <MarkdownRenderer content={feedback} />
    </div>
  )
}

/**
 * Sits under a staff feedback textarea: says what formatting learners will
 * see and offers an exact preview through the learner-side renderer.
 */
export function FeedbackFormattingHint({ value }: { value: string }) {
  const [open, setOpen] = useState(false)
  const previewId = useId()
  const hasContent = value.trim().length > 0
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <p>
          Markdown works: <code className="rounded bg-slate-100 px-1">**bold**</code>, <code className="rounded bg-slate-100 px-1">`code`</code>, and <code className="rounded bg-slate-100 px-1">```python</code> code blocks.
        </p>
        <Button
          variant="quiet"
          size="sm"
          aria-expanded={open}
          aria-controls={previewId}
          disabled={!hasContent}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          {open ? 'Hide preview' : 'Preview as learner'}
        </Button>
      </div>
      {open && hasContent && (
        <div id={previewId} className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
          <FeedbackBody feedback={value} />
        </div>
      )}
    </div>
  )
}
