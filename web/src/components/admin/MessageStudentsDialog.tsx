import { useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, MessageCircle, Send } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { MarkdownEditor } from '../shared/MarkdownEditor'
import { Button } from '../ui/Button'
import { api } from '../../lib/api'
import { MESSAGE_BODY_LIMIT } from '../../lib/messageComposerState'
import { MAX_BULK_RECIPIENTS, sendToEach, summarizeBulk, type BulkRecipient, type BulkResult } from '../../lib/bulkMessage'
import { conversationPath } from '../../lib/routes'
import { useToast } from '../../contexts/ToastContext'

const UNSENT_REASON: Record<string, string> = {
  rate_limited: 'Paused: you’ve sent a lot of messages this minute. Try again shortly.',
  not_sent: 'Not sent after the pause.',
}

/**
 * Write one message and send it to each selected student as their own direct
 * conversation (T-3). Every send goes through the normal direct-message
 * checks (lib/bulkMessage.ts), so a blocked or unreachable student is
 * reported, never messaged.
 */
export function MessageStudentsDialog({ open, recipients, onClose }: { open: boolean; recipients: BulkRecipient[]; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const fieldId = useId()
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<BulkResult[] | null>(null)
  // One id per composed batch, so a retried send can't deliver twice (client_message_id).
  const batchId = useRef<string | null>(null)
  const sendable = recipients.slice(0, MAX_BULK_RECIPIENTS)
  const overLimit = recipients.length > MAX_BULK_RECIPIENTS
  const length = body.trim().length
  const names = sendable.map((recipient) => recipient.name)

  function close() {
    if (sending) return
    setBody('')
    setResults(null)
    batchId.current = null
    onClose()
  }

  async function send() {
    if (!length || length > MESSAGE_BODY_LIMIT || sending) return
    setSending(true)
    batchId.current ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const done = await sendToEach(api, sendable, body.trim(), batchId.current, setResults)
    setSending(false)
    const { sent, total } = summarizeBulk(done)
    if (sent === total) toast.success(`Sent to ${total === 1 ? done[0].name : `${total} students`}`)
    else toast.error(`Sent to ${sent} of ${total} students`)
  }

  // One student: open the conversation once it's sent, as "Message Alex" does.
  const single = results?.length === 1 && results[0].outcome.status === 'sent' ? results[0].outcome.conversationId : null

  return (
    <Modal open={open} onClose={close} size="md"
      title={sendable.length === 1 ? `Message ${names[0]}` : `Message ${sendable.length} students`}
      subtitle={sendable.length === 1 ? 'Opens a direct conversation.' : 'Each student gets their own direct message. Replies come back to you one by one.'}
      icon={<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><MessageCircle className="h-5 w-5" aria-hidden="true" /></span>}>
      {results ? (
        <div className="space-y-4">
          <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Who got the message">
            {results.map((result) => (
              <li key={result.userId} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">{result.name}</span>
                {result.outcome.status === 'sent'
                  ? <span className="inline-flex items-center gap-1 text-success-ink"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Sent</span>
                  : <span className="text-danger-ink">{'error' in result.outcome ? result.outcome.error : UNSENT_REASON[result.outcome.status]}</span>}
              </li>
            ))}
          </ul>
          {sending ? <p className="text-sm text-ink-muted" role="status">Sending {results.length} of {sendable.length}…</p> : (
            <div className="flex flex-wrap justify-end gap-2">
              {single && <Button variant="secondary" onClick={() => { close(); navigate(conversationPath({ type: 'dm', id: single })) }}>Open conversation</Button>}
              <Button onClick={close}>Done</Button>
            </div>
          )}
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void send() }}>
          <p className="text-sm text-ink-secondary [overflow-wrap:anywhere]">
            <span className="font-semibold text-ink">To:</span> {names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ')}
          </p>
          {overLimit && <p className="rounded-xl border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-ink">You can message up to {MAX_BULK_RECIPIENTS} students at a time. This sends to the first {MAX_BULK_RECIPIENTS}; post an update to reach a whole cohort.</p>}
          <div>
            <label htmlFor={fieldId} className="text-sm font-semibold text-ink">Message</label>
            <MarkdownEditor id={fieldId} label="Message" target="message" value={body} onChange={(value) => setBody(value)} placeholder="Write a short, specific note." className="mt-2" minHeight={120} maxHeight={360} disabled={sending} />
            <p className={`mt-1 text-right text-xs tabular-nums ${length > MESSAGE_BODY_LIMIT ? 'font-semibold text-danger-ink' : 'text-ink-muted'}`}>{length.toLocaleString()}/{MESSAGE_BODY_LIMIT.toLocaleString()}</p>
          </div>
          <Button type="submit" fullWidth disabled={!length || length > MESSAGE_BODY_LIMIT || sending}><Send className="h-4 w-4" aria-hidden="true" />{sendable.length === 1 ? 'Send' : `Send to ${sendable.length} students`}</Button>
        </form>
      )}
    </Modal>
  )
}

/**
 * "Message Alex": opens (or creates) the direct conversation with one student
 * and goes there, never to an empty inbox. The same server checks apply.
 */
export function useMessageStudent() {
  const navigate = useNavigate()
  const toast = useToast()
  const [opening, setOpening] = useState<number | null>(null)
  async function open(userId: number, cohortId: number) {
    if (opening) return
    setOpening(userId)
    const result = await api.createDirectConversation({ cohort_id: cohortId, user_ids: [userId] })
    setOpening(null)
    if (result.data) navigate(conversationPath({ type: 'dm', id: result.data.direct_conversation.id }))
    else toast.error(result.error || 'Couldn’t open a direct message.')
  }
  return { open, opening }
}
