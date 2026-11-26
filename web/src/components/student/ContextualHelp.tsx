import { useStudentExperience } from '../../lib/studentExperience'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CheckCircle2, CircleHelp, Clock3, MessageCircleReply, Send, ShieldAlert, XCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { captureProductEvent } from '../../lib/analytics'
import { formatShortDateTime } from '../../lib/format'
import { useToast } from '../../contexts/ToastContext'
import { CourseSupport } from './CourseSupport'
import { HELP_REPLY_LIMIT, newReplyRequestId } from '../admin/HelpReplyBox'
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

// One scrolling row on phones; wrapping rows from sm up. Padding keeps focus rings unclipped, and
// `relative` keeps the visually hidden radios inside the row so the sheet never scrolls sideways.
const PILL_ROW = 'relative mt-1.5 flex flex-nowrap gap-2 overflow-x-auto p-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible'
const PILL = 'pressable relative inline-flex min-h-11 shrink-0 cursor-pointer items-center whitespace-nowrap sm:max-w-full sm:shrink sm:whitespace-normal rounded-full border px-3.5 py-2 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus'
const PILL_SELECTED = 'border-ink bg-surface-sunken text-ink'
const PILL_IDLE = 'border-line bg-surface-raised text-ink-secondary hover:bg-surface-sunken hover:text-ink'

/** Follow-up guidance before staff reply (more detail while they wait) and after (an answer to their question). */
export const FOLLOW_UP_WAITING_HINT = 'Add more details or paste an error message while you wait'
export const FOLLOW_UP_REPLIED_HINT = 'Answer their question or share what happened when you tried it'

interface ContextualHelpProps {
  capabilities?: LearnerCapabilities
  contextPath?: string
  cohortId: number
  contextType: HelpContextType
  contextSource?: HelpContextSource
  contextId: number
  contextLabel: string
  contexts?: Array<{ type: HelpContextType; id: number; label: string }>
  compact?: boolean
  requests?: HelpRequest[]
  requestsLoading?: boolean
  onRequestsChange?: (requests: HelpRequest[]) => void
  onRequestsRefresh?: () => void | Promise<void>
}

export function ContextualHelp({ capabilities, contextPath, cohortId, contextType, contextSource = 'primary', contextId, contextLabel, contexts, compact = false, requests: controlledRequests, requestsLoading, onRequestsChange, onRequestsRefresh }: ContextualHelpProps) {
  const { v2 } = useStudentExperience()
  const toast = useToast()
  const [chosenContext, setChosenContext] = useState('')
  const choices = v2 ? contexts : undefined
  // The form opens on the current lesson (or the first choice), never behind an empty picker.
  const defaultChoice = choices?.find(item => item.type === contextType && item.id === contextId) ?? choices?.[0]
  const defaultContext = defaultChoice ? `${defaultChoice.type}:${defaultChoice.id}` : ''
  const shownContext = chosenContext || defaultContext
  const choice = choices?.find(item => `${item.type}:${item.id}` === shownContext)
  const requestType = choice?.type ?? contextType
  const requestId = choice?.id ?? contextId
  const needsChoice = Boolean(choices && choices.length > 1 && !choice)
  const [open, setOpen] = useState(false)
  const [localRequests, setLocalRequests] = useState<HelpRequest[]>([])
  const [localLoading, setLocalLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState<HelpCategory>('concept')
  const [urgency, setUrgency] = useState<HelpUrgency>('normal')
  const [message, setMessage] = useState('')
  // Follow-up drafts and their retry ids belong to one request each, so switching the
  // lesson or exercise never carries a draft, or a retry of it, onto another request.
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<number, string>>({})
  const followUpAttempts = useRef(new Map<number, string>())

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
  const history = choices ? requests.filter(request => request.cohort.id === cohortId && request.context_source === contextSource && choices.some(item => item.type === request.context_type && item.id === request.context_id)) : relevantRequests
  const selectedRequests = choices ? history.filter(request => !needsChoice && request.context_type === requestType && request.context_id === requestId) : relevantRequests
  const activeRequest = selectedRequests.find((request) => request.status === 'open' || request.status === 'acknowledged')
  const latestResolved = selectedRequests.find((request) => request.status === 'resolved')

  const canRequest = capabilities?.support_mode === 'guided_help'

  // New student experience (L-1.3): a link with ?help_request=:id (the learner's
  // notification, Today) opens that request's dialog, once, when it belongs here.
  const location = useLocation()
  const linkedRequestId = v2 ? Number(new URLSearchParams(location.search).get('help_request')) || null : null
  const autoOpened = useRef<number | null>(null)
  // The linked request is the one shown, even when a newer one was resolved on this lesson.
  const linkedRequest = linkedRequestId ? history.find((request) => request.id === linkedRequestId) : undefined
  const shownResolved = linkedRequest?.status === 'resolved' ? linkedRequest : latestResolved
  // A new link on a lesson that is already open (the page didn't remount) fetches the requests again,
  // so a reply sent since the page loaded is there. The first link is covered by the page's own load.
  const refreshedFor = useRef(linkedRequestId)
  useEffect(() => {
    if (!linkedRequestId || refreshedFor.current === linkedRequestId) return
    refreshedFor.current = linkedRequestId
    if (onRequestsRefresh) void onRequestsRefresh()
    else void loadRequests().catch(() => {})
  }, [linkedRequestId, loadRequests, onRequestsRefresh])
  useEffect(() => {
    if (!linkedRequestId || loading || autoOpened.current === linkedRequestId || !linkedRequest) return
    autoOpened.current = linkedRequestId
    // With several contexts (the lesson and its exercises), open on the linked request's own one, so its reply shows.
    const linkedChoice = choices?.find(item => item.type === linkedRequest.context_type && item.id === linkedRequest.context_id)
    if (linkedChoice) setChosenContext(`${linkedChoice.type}:${linkedChoice.id}`)
    setOpen(true)
  }, [linkedRequestId, loading, linkedRequest, choices])

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault()
    const cleanMessage = message.trim()
    if (!canRequest || needsChoice || !cleanMessage) return
    const generation = requestGeneration.current
    setSaving(true)
    const response = await api.createHelpRequest({
      cohort_id: cohortId,
      context_type: requestType,
      context_source: contextSource,
      context_id: requestId,
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

  async function sendFollowUp(event: React.FormEvent) {
    event.preventDefault()
    if (!canRequest || !activeRequest) return
    const requestId = activeRequest.id
    const answeringStaff = staffReplied
    const body = (followUpDrafts[requestId] ?? '').trim()
    if (!body || body.length > HELP_REPLY_LIMIT) return
    // One id per attempt on this request, kept until a send is confirmed (as the staff reply box does).
    let attempt = followUpAttempts.current.get(requestId)
    if (!attempt) followUpAttempts.current.set(requestId, attempt = newReplyRequestId())
    const generation = requestGeneration.current
    setSaving(true)
    const response = await api.replyToHelpRequest(requestId, { body, resolve: false, client_request_id: attempt })
    if (generation !== requestGeneration.current) return
    setSaving(false)
    if (!response.data) {
      toast.error(response.error || 'Your reply could not be sent. Your draft is still here—please try again.')
      return
    }
    followUpAttempts.current.delete(requestId)
    replaceRequests(requests.map((item) => item.id === response.data!.help_request.id ? response.data!.help_request : item))
    // Clear the draft only if it is still the text that was sent, so nothing typed meanwhile is lost.
    setFollowUpDrafts((drafts) => {
      if ((drafts[requestId] ?? '').trim() !== body) return drafts
      const rest = { ...drafts }
      delete rest[requestId]
      return rest
    })
    toast.success(answeringStaff ? 'Reply sent to your instructor.' : 'Added to your help request.')
  }

  // Staff replies only: the learner's own follow-ups never count as an answer.
  const staffReplied = Boolean(activeRequest?.replies?.some((reply) => !reply.from_student) || (v2 && activeRequest?.staff_response))
  const awaitingInstructor = Boolean(staffReplied && activeRequest?.replies?.at(-1)?.from_student)
  const replied = staffReplied && !awaitingInstructor
  const statusLabel = awaitingInstructor ? 'You replied' : replied ? 'Your instructor replied' : activeRequest?.status === 'acknowledged' ? 'Instructor is taking a look' : 'Sent to your instructor'
  // Learners can add to an open request before staff reply too (more detail, an error message).
  const canFollowUp = canRequest
  const followUp = activeRequest ? followUpDrafts[activeRequest.id] ?? '' : ''

  if (capabilities?.features?.help_requests === false) return null

  return (
    <>
      {!canRequest && <CourseSupport capabilities={capabilities} cohortId={cohortId} contextLabel={contextLabel} contextPath={contextPath} />}
      {(canRequest || history.length > 0) && <Button
        variant="secondary"
        size={v2 ? "md" : "sm"}
        fullWidth={compact}
        onClick={() => {
          // With several contexts, open on the learner's active request (a replied one first), so its thread and reply box show.
          if (choices && !message.trim()) {
            const active = history.filter((request) => request.status === 'open' || request.status === 'acknowledged')
            const shown = active.find((request) => request.replies?.some((reply) => !reply.from_student) || request.staff_response) ?? active[0]
            setChosenContext(shown ? `${shown.context_type}:${shown.context_id}` : defaultContext)
          }
          setOpen(true)
          if (onRequestsRefresh) void onRequestsRefresh()
          else void loadRequests()
        }}
        className={activeRequest ? 'border-line! bg-surface-sunken! text-ink-secondary!' : 'text-ink-secondary!'}
      >
        {activeRequest ? <Clock3 className="h-4 w-4" aria-hidden="true" /> : <CircleHelp className="h-4 w-4" aria-hidden="true" />}
        {!canRequest ? 'View previous help' : v2 && history.some(request => request.replies?.some((reply) => !reply.from_student) || request.staff_response) ? 'View response' : activeRequest ? statusLabel : 'Ask for help'}
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
          {choices && canRequest && choices.length > 1 && <fieldset disabled={saving} className="min-w-0 border-0 p-0">
            <legend className="text-sm font-semibold text-ink">What is your question about?</legend>
            <div className={PILL_ROW}>
              {choices.map(item => {
                const key = `${item.type}:${item.id}`
                return <label key={key} className={`${PILL} ${key === shownContext ? PILL_SELECTED : PILL_IDLE}`}>
                  <input className="sr-only" type="radio" name={`help-context-${contextType}-${contextId}`} value={key} checked={key === shownContext} onChange={() => setChosenContext(key)} />
                  {item.label}
                </label>
              })}
            </div>
          </fieldset>}
          {!loading && shownResolved && (
            <div className="rounded-2xl border border-success-line bg-success-soft p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-ink" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-success-ink">{(shownResolved.replies?.length ?? 0) > 1 ? 'Previous replies' : 'Previous response'}</p>
                  {/* Every reply, not only the last one, so a hint sent before resolving isn't lost. */}
                  <dl className="mt-1 space-y-3 text-sm"><HelpReplies request={shownResolved} /></dl>
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
                      {awaitingInstructor
                        ? 'Your instructor will see your reply here.'
                        : replied
                        ? 'Read the reply below. If they asked you something, answer right here.'
                        : activeRequest.status === 'acknowledged'
                        ? `${activeRequest.owner?.full_name || 'An instructor'} is looking at your question.`
                        : 'Your instructor has your question.'}
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-line bg-surface-sunken/60 p-4 text-sm">
                <dl className="space-y-3">
                  <div><dt className="font-semibold text-ink-muted">Your question</dt><dd className="mt-1 whitespace-pre-wrap leading-6 text-ink [overflow-wrap:anywhere]">{activeRequest.message}</dd></div>
                  {/* Replies sent while the request stays open (U-4.7); older payloads have only staff_response. */}
                  <HelpReplies request={activeRequest} />
                </dl>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-secondary">
                  <Badge tone="neutral">{categories.find((option) => option.value === activeRequest.category)?.label || humanize(activeRequest.category)}</Badge>
                  {activeRequest.urgency === 'urgent' && <Badge tone="warning">Urgent</Badge>}
                  <span className="px-1 py-1 font-medium tabular-nums text-ink-muted">Sent {formatShortDateTime(activeRequest.created_at)}</span>
                </div>
              </div>
              {canFollowUp && <form className="space-y-2" onSubmit={sendFollowUp}>
                <label htmlFor={`help-follow-up-${activeRequest.id}`} className="block text-sm font-semibold text-ink">{staffReplied ? 'Reply to your instructor' : 'Add to your question'}</label>
                <p id={`help-follow-up-hint-${activeRequest.id}`} className="text-sm text-ink-secondary">{staffReplied ? FOLLOW_UP_REPLIED_HINT : FOLLOW_UP_WAITING_HINT}</p>
                <textarea
                  aria-describedby={`help-follow-up-hint-${activeRequest.id}`}
                  id={`help-follow-up-${activeRequest.id}`}
                  disabled={saving}
                  value={followUp}
                  onChange={(event) => {
                    const requestId = activeRequest.id
                    const value = event.target.value
                    setFollowUpDrafts((drafts) => ({ ...drafts, [requestId]: value }))
                  }}
                  maxLength={HELP_REPLY_LIMIT}
                  rows={3}
                  placeholder={staffReplied ? 'What did you try, and what happened?' : 'For example, the exact error message'}
                  className="app-control w-full leading-6"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={saving || !followUp.trim()}>
                    <MessageCircleReply className="h-4 w-4" aria-hidden="true" /> {saving ? 'Sending…' : staffReplied ? 'Send reply' : 'Add details'}
                  </Button>
                  <p className="ml-auto text-xs tabular-nums text-ink-muted">{followUp.length.toLocaleString()}/{HELP_REPLY_LIMIT.toLocaleString()}</p>
                </div>
              </form>}
              {canRequest && <Button variant={staffReplied ? 'quiet' : 'danger'} onClick={cancelRequest} disabled={saving}>
                <XCircle className="h-4 w-4" /> {staffReplied ? 'I no longer need help' : 'Cancel request'}
              </Button>}
            </div>
          ) : canRequest && !needsChoice ? (
            <form className="space-y-5" onSubmit={submitRequest}>
              <fieldset aria-describedby={`help-category-hint-${contextType}-${contextId}`} className="min-w-0 border-0 p-0">
                <legend className="text-sm font-semibold text-ink">What kind of help do you need?</legend>
                <div className={PILL_ROW}>
                  {categories.map((option) => (
                    <label key={option.value} className={`${PILL} ${category === option.value ? PILL_SELECTED : PILL_IDLE}`}>
                      <input className="sr-only" type="radio" name="help-category" value={option.value} checked={category === option.value} onChange={() => setCategory(option.value)} />
                      {option.label}
                    </label>
                  ))}
                </div>
                <p id={`help-category-hint-${contextType}-${contextId}`} className="mt-2 text-sm text-ink-muted">{categories.find((option) => option.value === category)?.description}</p>
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
          {/* Earlier requests come after the form, so the question box opens in view. */}
          {choices && history.filter(request => request.id !== activeRequest?.id && request.id !== shownResolved?.id).map(request => <details key={request.id} className="rounded-xl border border-line bg-surface-sunken p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink">{choices.find(item => item.type === request.context_type && item.id === request.context_id)?.label} · {formatShortDateTime(request.created_at)}</summary>
            <p className="my-3 whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">{request.message}</p>
            <dl className="space-y-3 text-sm"><HelpReplies request={request} /></dl>
          </details>)}
        </div>
      </Modal>
    </>
  )
}

/** Every reply on a request, oldest first, the learner's own follow-ups included; older payloads have only `staff_response`. */
function HelpReplies({ request }: { request: Pick<HelpRequest, 'replies' | 'staff_response'> }) {
  if (request.replies?.length) {
    return <>{request.replies.map((reply) => <div key={reply.id}><dt className="font-semibold text-ink-muted">{reply.from_student ? 'You replied' : `${reply.author.full_name} replied`} <span className="font-medium tabular-nums">· {formatShortDateTime(reply.created_at)}</span></dt><dd className="mt-1 leading-6 text-ink [overflow-wrap:anywhere]"><MarkdownText content={reply.body} /></dd></div>)}</>
  }
  if (!request.staff_response) return null
  return <div><dt className="font-semibold text-ink-muted">Instructor response</dt><dd className="mt-1 leading-6 text-ink [overflow-wrap:anywhere]"><MarkdownText content={request.staff_response} /></dd></div>
}
