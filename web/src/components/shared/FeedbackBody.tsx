import { MarkdownText } from './MarkdownRenderer'

/** Instructor feedback, rendered through the sanitized markdown renderer (written text: newlines are line breaks). */
export function FeedbackBody({ feedback, className = '' }: { feedback: string; className?: string }) {
  return (
    <div className={`feedback-body text-sm ${className}`}>
      <MarkdownText content={feedback} />
    </div>
  )
}
