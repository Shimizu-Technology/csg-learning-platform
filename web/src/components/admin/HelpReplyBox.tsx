import { useEffect, useRef } from 'react'
import { CheckCircle2, Send } from 'lucide-react'
import { formatShortDateTime } from '../../lib/format'
import type { HelpRequest } from '../../types/api'
import { useVoiceDraft } from '../../hooks/useVoiceDraft'
import { MarkdownEditor, type MarkdownEditorHandle } from '../shared/MarkdownEditor'
import { MarkdownText } from '../shared/MarkdownRenderer'
import { VoiceDraftButton, VoiceDraftPanel } from '../shared/VoiceDraftControls'
import { Button } from '../ui/Button'

export const HELP_REPLY_LIMIT = 2000

export type HelpReplyAction = 'reply' | 'resolve'

export const newReplyRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `reply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`)

/**
 * One client request id per reply attempt (PR #282 fix round 1). A send that
 * fails, or whose response is lost, is retried with the same id, so the
 * server returns the reply it already saved instead of answering, and
 * notifying the learner, twice. `done()` after a reply is confirmed (or the
 * draft is discarded) starts a new attempt.
 */
export function useReplyAttempt() {
  const id = useRef<string | null>(null)
  return {
    id: () => (id.current ??= newReplyRequestId()),
    done: () => { id.current = null },
  }
}

/**
 * The reply box for a help request (U-4.7), on the Support card and the
 * request page. "Send reply" keeps the request open; "Reply & resolve" closes
 * it. The action the person chose to open the box with is the primary button.
 */
export function HelpReplyBox({
  id,
  studentName,
  value,
  onChange,
  onSend,
  onCancel,
  sending,
  primary = 'reply',
  autoFocus = false,
}: {
  id: string
  studentName?: string | null
  value: string
  onChange: (value: string) => void
  onSend: (action: HelpReplyAction) => void
  onCancel?: () => void
  /** The action being sent, so its button says "Sending…". */
  sending: HelpReplyAction | null
  primary?: HelpReplyAction
  autoFocus?: boolean
}) {
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const voice = useVoiceDraft({
    surface: 'help_request',
    disabled: sending !== null,
    maxDraftLength: HELP_REPLY_LIMIT,
    getDraft: () => editorRef.current?.getMarkdown() ?? value,
    getSelection: () => {
      const textarea = containerRef.current?.querySelector<HTMLTextAreaElement>('textarea')
      if (textarea) return { start: textarea.selectionStart, end: textarea.selectionEnd }
      const current = editorRef.current?.getMarkdown() ?? value
      return { start: current.length, end: current.length }
    },
    onDraftChange: (nextValue) => {
      onChange(nextValue)
      requestAnimationFrame(() => editorRef.current?.focus())
    },
  })
  const cancelVoice = voice.cancel
  useEffect(() => {
    cancelVoice()
  }, [id, cancelVoice])

  const tooLong = value.length > HELP_REPLY_LIMIT
  const disabled = !value.trim() || tooLong || sending !== null
  const firstName = studentName?.trim().split(/\s+/)[0]
  const label = firstName ? `Reply to ${firstName}` : 'Reply to the student'
  const handleSend = (action: HelpReplyAction) => {
    voice.markSent(editorRef.current?.getMarkdown() ?? value)
    onSend(action)
  }
  const buttons: Record<HelpReplyAction, React.ReactNode> = {
    reply: <Button key="reply" size="sm" variant={primary === 'reply' ? 'primary' : 'secondary'} disabled={disabled} onClick={() => handleSend('reply')}><Send className="h-4 w-4" aria-hidden="true" />{sending === 'reply' ? 'Sending…' : 'Send reply'}</Button>,
    resolve: <Button key="resolve" size="sm" variant={primary === 'resolve' ? 'primary' : 'secondary'} disabled={disabled} onClick={() => handleSend('resolve')}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{sending === 'resolve' ? 'Sending…' : 'Reply & resolve'}</Button>,
  }
  return (
    <div ref={containerRef} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
        <VoiceDraftButton
          state={voice.state}
          supported={voice.supported}
          disabled={sending !== null}
          label="Dictate reply"
          showLabel
          onClick={() => void voice.start()}
        />
      </div>
      <MarkdownEditor
        ref={editorRef}
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        placeholder="Give a clear next step, explanation, or question back."
        minHeight={112}
        maxHeight={420}
        autoFocus={autoFocus}
        onEscape={onCancel}
      />
      <VoiceDraftPanel
        state={voice.state}
        durationMillis={voice.durationMillis}
        maxDurationSeconds={voice.maxDurationSeconds}
        error={voice.error}
        notice={voice.notice}
        hasReview={Boolean(voice.review)}
        hasRecording={voice.hasRecording}
        onStop={() => void voice.stop()}
        onCancel={voice.cancel}
        onRetry={voice.retry}
        onRecordAgain={voice.recordAgain}
        onRestore={voice.restore}
        onDismiss={voice.dismissReview}
      />
      <div className="flex flex-wrap items-center gap-2">
        {primary === 'reply' ? [buttons.reply, buttons.resolve] : [buttons.resolve, buttons.reply]}
        {onCancel && <Button size="sm" variant="quiet" onClick={onCancel} disabled={sending !== null}>Cancel</Button>}
        <p className={`ml-auto text-xs tabular-nums ${tooLong ? 'font-semibold text-danger-ink' : 'text-ink-muted'}`}>{value.length.toLocaleString()}/{HELP_REPLY_LIMIT.toLocaleString()}</p>
      </div>
      <p className="text-xs text-ink-muted">The student is notified. "Send reply" keeps the request open.</p>
    </div>
  )
}

/**
 * Every staff reply on a help request, oldest first. A request resolved
 * before replies existed shows its one `staff_response` the same way.
 */
export function HelpReplyThread({ request }: { request: Pick<HelpRequest, 'replies' | 'staff_response' | 'resolved_at' | 'owner'> }) {
  const replies = request.replies?.length
    ? request.replies
    : request.staff_response
      ? [{ id: 0, body: request.staff_response, resolved_request: true, author: request.owner ?? { id: 0, full_name: 'Staff' }, created_at: request.resolved_at ?? '' }]
      : []
  if (!replies.length) return null
  return (
    <section aria-labelledby="help-replies-heading" className="app-surface overflow-hidden">
      <h2 id="help-replies-heading" className="border-b border-line px-5 py-4 text-sm font-semibold text-ink-muted sm:px-6">{replies.length === 1 ? 'Reply' : `Replies · ${replies.length}`}</h2>
      <ol className="divide-y divide-line">
        {replies.map((reply) => (
          <li key={reply.id || 'legacy'} className="px-5 py-4 sm:px-6">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-ink-muted">
              <span className="text-ink">{reply.author.full_name}</span>
              {reply.created_at && <span className="tabular-nums">{formatShortDateTime(reply.created_at)}</span>}
              {reply.resolved_request && <span className="inline-flex items-center gap-1 text-success-ink"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Resolved the request</span>}
            </p>
            <div className="mt-2 text-sm leading-6 text-ink [overflow-wrap:anywhere]"><MarkdownText content={reply.body} /></div>
          </li>
        ))}
      </ol>
    </section>
  )
}
