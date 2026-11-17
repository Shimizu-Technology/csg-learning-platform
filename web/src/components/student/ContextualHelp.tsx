import { useStudentExperience } from '../../lib/studentExperience'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, CircleHelp, Clock3, Send, ShieldAlert, XCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { captureProductEvent } from '../../lib/analytics'
import { formatShortDateTime } from '../../lib/format'
import { useToast } from '../../contexts/ToastContext'
import { CourseSupport } from './CourseSupport'
import { Modal } from '../shared/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { MarkdownText } from '../shared/MarkdownRenderer'
import type { HelpCategory, HelpContextSource, HelpContextType, HelpRequest, HelpUrgency, LearnerCapabilities } from '../../types/api'
import { humanize } from '../../lib/glossary'

const categories: Array<{ value: HelpCategory; label: string; description: string }> = [
  { value: 'concept', label: 'Concept', description: 'I need the idea explained another way.' },
  { value: 'technical', label: 'Technical issue', description: 'A tool, setup, or error is blocking me.' },
  { value: 'instructions', label: 'Instructions', description: 'I am unsure what the task is asking.' },
  { value: 'feedback', label: 'Feedback', description: 'I need help applying instructor feedback.' },
  { value: 'other', label: 'Something else', description: 'My question does not fit the options above.' },
]

interface ContextualHelpProps {
  capabilities?: LearnerCapabilities
  contextPath?: string
  cohortId: number
  contextType: HelpContextType
  contextSource?: HelpContextSource
  contextId: number
  contextLabel: string
  compact?: boolean
  requests?: HelpRequest[]
  requestsLoading?: boolean
  onRequestsChange?: (requests: HelpRequest[]) => void
  onRequestsRefresh?: () => void | Promise<void>
}

export function ContextualHelp({ capabilities, contextPath, cohortId, contextType, contextSource = 'primary', contextId, contextLabel, compact = false, requests: controlledRequests, requestsLoading, onRequestsChange, onRequestsRefresh }: ContextualHelpProps) {
  const { v2 } = useStudentExperience()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [localRequests, setLocalRequests] = useState<HelpRequest[]>([])
  const [localLoading, setLocalLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState<HelpCategory>('concept')
  const [urgency, setUrgency] = useState<HelpUrgency>('normal')
  const [message, setMessage] = useState('')

  const requestGeneration = useRef(0)
  const loadRequests = useCallback(async () => {
    if (controlledRequests) return
    const generation = ++requestGeneration.current
    setLocalLoading(true)
    setLocalRequests([])
    try {
      const response = await api.getHelpRequests({ cohort_id: cohortId, context_type: contextType })
      if (generation === requestGeneration.current && response.data) setLocalRequests(response.data.help_requests)
    } finally {
      if (generation === requestGeneration.current) setLocalLoading(false)
    }
  }, [cohortId, contextType, controlledRequests])

  useEffect(() => { void loadRequests().catch(() => {}); return () => { requestGeneration.current += 1 } }, [loadRequests])

  const requests = controlledRequests || localRequests
  const loading = requestsLoading ?? (controlledRequests ? false : localLoading)
  const replaceRequests = useCallback((next: HelpRequest[]) => {
    if (onRequestsChange) onRequestsChange(next)
    else setLocalRequests(next)
  }, [onRequestsChange])

  const relevantRequests = useMemo(() => requests.filter((request) =>
    request.cohort.id === cohortId && request.context_type === contextType && request.context_id === contextId && request.context_source === contextSource
  ), [cohortId, contextType, contextId, contextSource, requests])
  const activeRequest = relevantRequests.find((request) => request.status === 'open' || request.status === 'acknowledged')
  const latestResolved = relevantRequests.find((request) => request.status === 'resolved')

  const canRequest = capabilities?.support_mode === 'guided_help'

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault()
    const cleanMessage = message.trim()
    if (!canRequest || !cleanMessage) return
    const generation = requestGeneration.current
    setSaving(true)
    const response = await api.createHelpRequest({
      cohort_id: cohortId,
      context_type: contextType,
      context_source: contextSource,
      context_id: contextId,
      category,
      urgency,
      message: cleanMessage,
    })
    if (generation !== requestGeneration.current) return
    setSaving(false)
    if (!response.data) {
      toast.error(response.error || 'Your request could not be sent. Your draft is still here—please try again.')
      return
    }
    replaceRequests([response.data.help_request, ...requests.filter((item) => item.id !== response.data!.help_request.id)])
    if (response.data.created) {
      captureProductEvent('help_requested', { cohort_id: cohortId, context_type: contextType, context_id: contextId, category, urgency })
      toast.success('Your instructor can now see this request.')
    } else {
      toast.success('Your existing request is already in the instructor queue.')
    }
    setMessage('')
  }

  async function cancelRequest() {
    if (!canRequest || !activeRequest) return
    const generation = requestGeneration.current
    setSaving(true)
    const response = await api.updateHelpRequest(activeRequest.id, { status: 'canceled' })
    if (generation !== requestGeneration.current) return
    setSaving(false)
    if (!response.data) {
      toast.error(response.error || 'Could not cancel the request.')
      return
    }
    replaceRequests(requests.map((item) => item.id === response.data!.help_request.id ? response.data!.help_request : item))
    toast.success('Help request canceled.')
  }

  const replied = Boolean(activeRequest?.replies?.length)
  const statusLabel = replied ? 'Your instructor replied' : activeRequest?.status === 'acknowledged' ? 'Instructor is taking a look' : 'Sent to your instructor'

  if (capabilities?.features?.help_requests === false) return null

  return (
    <>
      {!canRequest && <CourseSupport capabilities={capabilities} cohortId={cohortId} contextLabel={contextLabel} contextPath={contextPath} />}
      {(canRequest || relevantRequests.length > 0) && <Button
        variant="secondary"
        size={v2 ? "md" : "sm"}
        fullWidth={compact}
        onClick={() => {
          setOpen(true)
          if (onRequestsRefresh) void onRequestsRefresh()
          else void loadRequests()
        }}
        className={activeRequest ? 'border-line! bg-surface-sunken! text-ink-secondary!' : 'text-ink-secondary!'}
      >
        {activeRequest ? <Clock3 className="h-4 w-4" aria-hidden="true" /> : <CircleHelp className="h-4 w-4" aria-hidden="true" />}
        {!canRequest ? 'View previous help' : v2 && (replied || latestResolved?.replies?.length || latestResolved?.staff_response) ? 'View response' : activeRequest ? statusLabel : 'Ask for help'}
      </Button>}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={activeRequest ? 'Your help request' : !canRequest ? 'Previous help' : "Tell us where you're stuck"}
        subtitle={contextLabel}
        icon={<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><CircleHelp className="h-5 w-5" aria-hidden="true" /></span>}
        size="md"
      >
        <div className="space-y-4">
          {!loading && latestResolved && (
            <div className="rounded-2xl border border-success-line bg-success-soft p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-ink" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-success-ink">{(latestResolved.replies?.length ?? 0) > 1 ? 'Previous replies' : 'Previous response'}</p>
                  {/* Every reply, not only the last one, so a hint sent before resolving isn't lost. */}
                  <dl className="mt-1 space-y-3 text-sm"><HelpReplies request={latestResolved} /></dl>
                  {canRequest && <p className="mt-2 text-xs font-medium text-success-ink">You can send a new request if you still need help.</p>}
                </div>
              </div>
            </div>
          )}
          {loading ? (
            <p className="py-8 text-center text-sm text-ink-muted">Checking your help requests…</p>
          ) : activeRequest ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-line bg-surface-sunken p-4">
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-ink-secondary" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-ink">{statusLabel}</p>
                    <p className="mt-1 text-sm leading-6 text-ink-secondary">
                      {replied
                        ? 'Read the reply below. The request stays open until it is resolved.'
                        : activeRequest.status === 'acknowledged'
                        ? `${activeRequest.owner?.full_name || 'An instructor'} acknowledged this request.`
                        : 'Staff can see it in Support.'}
                    </p>
                  </div>
                </div>
              </div>
              <dl className="space-y-3 rounded-2xl border border-line bg-surface-sunken/60 p-4 text-sm">
                <div><dt className="font-semibold text-ink-muted">Your question</dt><dd className="mt-1 whitespace-pre-wrap leading-6 text-ink [overflow-wrap:anywhere]">{activeRequest.message}</dd></div>
                {/* Replies sent while the request stays open (U-4.7); older payloads have only staff_response. */}
                <HelpReplies request={activeRequest} />
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-secondary">
                  <Badge tone="neutral">{categories.find((option) => option.value === activeRequest.category)?.label || humanize(activeRequest.category)}</Badge>
                  {activeRequest.urgency === 'urgent' && <Badge tone="warning">Urgent</Badge>}
                  <span className="px-1 py-1 font-medium tabular-nums text-ink-muted">Sent {formatShortDateTime(activeRequest.created_at)}</span>
                </div>
              </dl>
              {canRequest && <Button variant="danger" onClick={cancelRequest} disabled={saving}>
                <XCircle className="h-4 w-4" /> Cancel request
              </Button>}
            </div>
          ) : canRequest ? (
            <form className="space-y-5" onSubmit={submitRequest}>
              <fieldset>
                <legend className="text-sm font-semibold text-ink">What kind of help do you need?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {categories.map((option) => (
                    <label key={option.value} className={`pressable cursor-pointer rounded-xl border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${category === option.value ? 'border-action-primary bg-surface-raised ring-1 ring-action-primary' : 'border-line hover:bg-surface-sunken'}`}>
                      <input className="sr-only" type="radio" name="help-category" value={option.value} checked={category === option.value} onChange={() => setCategory(option.value)} />
                      <span className="block text-sm font-semibold text-ink">{option.label}</span>
                      <span className="mt-0.5 block text-sm leading-5 text-ink-muted">{option.description}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor={`help-message-${contextType}-${contextId}`} className="text-sm font-semibold text-ink">What have you tried, and where did you get stuck?</label>
                <textarea
                  id={`help-message-${contextType}-${contextId}`}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={2000}
                  rows={5}
                  required
                  placeholder="Share the step you reached, what you expected, and what happened instead."
                  className="app-control mt-2 w-full leading-6"
                />
                <p className="mt-1 text-right text-xs tabular-nums text-ink-muted">{message.length}/2,000</p>
              </div>

              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${urgency === 'urgent' ? 'border-warning-line bg-warning-soft' : 'border-line'}`}>
                <input type="checkbox" checked={urgency === 'urgent'} onChange={(event) => setUrgency(event.target.checked ? 'urgent' : 'normal')} className="mt-1 h-4 w-4 rounded border-line-strong accent-action-primary" />
                <ShieldAlert className={`mt-0.5 h-5 w-5 shrink-0 ${urgency === 'urgent' ? 'text-warning-ink' : 'text-ink-muted'}`} aria-hidden="true" />
                <span><span className="block text-sm font-semibold text-ink">I am fully blocked</span><span className="mt-0.5 block text-sm leading-5 text-ink-muted">Use urgent only when you cannot continue and need attention before the next class.</span></span>
              </label>

              <Button type="submit" fullWidth disabled={saving || !message.trim()}>
                <Send className="h-4 w-4" /> {saving ? 'Sending…' : 'Send to my instructor'}
              </Button>
            </form>
          ) : null}
        </div>
      </Modal>
    </>
  )
}

/** Every staff reply on a request, oldest first; older payloads have only `staff_response`. */
function HelpReplies({ request }: { request: Pick<HelpRequest, 'replies' | 'staff_response'> }) {
  if (request.replies?.length) {
    return <>{request.replies.map((reply) => <div key={reply.id}><dt className="font-semibold text-ink-muted">{reply.author.full_name} replied <span className="font-medium tabular-nums">· {formatShortDateTime(reply.created_at)}</span></dt><dd className="mt-1 leading-6 text-ink [overflow-wrap:anywhere]"><MarkdownText content={reply.body} /></dd></div>)}</>
  }
  if (!request.staff_response) return null
  return <div><dt className="font-semibold text-ink-muted">Instructor response</dt><dd className="mt-1 leading-6 text-ink [overflow-wrap:anywhere]"><MarkdownText content={request.staff_response} /></dd></div>
}
