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
import type { HelpCategory, HelpContextSource, HelpContextType, HelpRequest, HelpUrgency, LearnerCapabilities } from '../../types/api'

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

  const statusLabel = activeRequest?.status === 'acknowledged' ? 'Instructor is taking a look' : 'Sent to your instructor'

  return (
    <>
      {!canRequest && <CourseSupport capabilities={capabilities} cohortId={cohortId} contextLabel={contextLabel} contextPath={contextPath} />}
      {(canRequest || relevantRequests.length > 0) && <Button
        variant="secondary"
        size="sm"
        fullWidth={compact}
        onClick={() => {
          setOpen(true)
          if (onRequestsRefresh) void onRequestsRefresh()
          else void loadRequests()
        }}
        className={activeRequest ? 'border-pending-200! bg-pending-50! text-pending-700!' : 'text-ink-secondary!'}
      >
        {activeRequest ? <Clock3 className="h-4 w-4" aria-hidden="true" /> : <CircleHelp className="h-4 w-4" aria-hidden="true" />}
        {!canRequest ? 'View previous help' : activeRequest ? statusLabel : 'Ask for help'}
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
            <div className="rounded-2xl border border-success-200 bg-success-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-700" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-success-800">Previous response</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink [overflow-wrap:anywhere]">{latestResolved.staff_response}</p>
                  {canRequest && <p className="mt-2 text-xs font-medium text-success-700">You can send a new request if you still need help.</p>}
                </div>
              </div>
            </div>
          )}
          {loading ? (
            <p className="py-8 text-center text-sm text-ink-muted">Checking your help requests…</p>
          ) : activeRequest ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-pending-200 bg-pending-50 p-4">
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-pending-700" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-ink">{statusLabel}</p>
                    <p className="mt-1 text-sm leading-6 text-pending-700">
                      {activeRequest.status === 'acknowledged'
                        ? `${activeRequest.owner?.full_name || 'An instructor'} acknowledged this request.`
                        : 'It is visible in the staff support queue.'}
                    </p>
                  </div>
                </div>
              </div>
              <dl className="space-y-3 rounded-2xl border border-line bg-surface-sunken/60 p-4 text-sm">
                <div><dt className="font-semibold text-ink-muted">Your question</dt><dd className="mt-1 whitespace-pre-wrap leading-6 text-ink [overflow-wrap:anywhere]">{activeRequest.message}</dd></div>
                {activeRequest.staff_response && <div><dt className="font-semibold text-ink-muted">Instructor response</dt><dd className="mt-1 whitespace-pre-wrap leading-6 text-ink [overflow-wrap:anywhere]">{activeRequest.staff_response}</dd></div>}
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-secondary">
                  <Badge tone="neutral" className="capitalize">{activeRequest.category}</Badge>
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
                    <label key={option.value} className={`pressable cursor-pointer rounded-xl border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${category === option.value ? 'border-ruby-600 bg-surface-raised ring-1 ring-ruby-600' : 'border-line hover:bg-surface-sunken'}`}>
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

              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${urgency === 'urgent' ? 'border-warning-300 bg-warning-50' : 'border-line'}`}>
                <input type="checkbox" checked={urgency === 'urgent'} onChange={(event) => setUrgency(event.target.checked ? 'urgent' : 'normal')} className="mt-1 h-4 w-4 rounded border-line-strong accent-ruby-600" />
                <ShieldAlert className={`mt-0.5 h-5 w-5 shrink-0 ${urgency === 'urgent' ? 'text-warning-800' : 'text-ink-muted'}`} aria-hidden="true" />
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
