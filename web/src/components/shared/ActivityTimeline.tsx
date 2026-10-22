import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Activity, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import { submissionPath } from '../../lib/routes'
import { Button } from '../ui/Button'
import type { ActivityEvent } from '../../types/api'

const categories = [
  { value: '', label: 'All' },
  { value: 'account', label: 'Sign-ins' },
  { value: 'learning', label: 'Learning' },
  { value: 'work', label: 'Work' },
] as const

const labels: Record<string, string> = {
  account_signed_in: 'Signed in',
  checkpoint_completed: 'Completed a learning step',
  checkpoint_reopened: 'Reopened a learning step',
  video_started: 'Started a lesson video',
  video_completed: 'Completed a lesson video',
  recording_started: 'Started a class recording',
  recording_completed: 'Completed a class recording',
  submission_created: 'Submitted work',
  submission_updated: 'Updated submitted work',
  submission_graded: 'Graded submitted work',
}

export function ActivityTimeline({ userId, cohortId }: { userId?: number; cohortId?: number }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const categoryParam = searchParams.get('activity_category') || ''
  const category = categories.some((option) => option.value === categoryParam) ? categoryParam : ''
  const setCategory = (value: string) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous)
    if (value) next.set('activity_category', value)
    else next.delete('activity_category')
    return next
  }, { replace: true })
  const [rows, setRows] = useState<ActivityEvent[]>([])
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(async (beforeId?: number) => {
    const current = ++generation.current
    if (beforeId) setLoadingMore(true)
    else { setLoading(true); setError(null); setRows([]); setNextBeforeId(null) }
    const result = await api.getActivityEvents({ user_id: userId, cohort_id: cohortId, category: category || undefined, before_id: beforeId })
    if (current !== generation.current) return
    if (result.data) {
      setRows((previous) => beforeId ? [...previous, ...result.data!.activity_events] : result.data!.activity_events)
      setNextBeforeId(result.data.next_before_id)
      setError(null)
    } else {
      setError(result.error || 'Could not load activity history.')
    }
    setLoading(false)
    setLoadingMore(false)
  }, [category, cohortId, userId])

  useEffect(() => {
    void load()
    return () => { generation.current++ }
  }, [load])

  return <section className="app-surface overflow-hidden">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-5 sm:px-6">
      <div><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-ink-muted" aria-hidden="true" /><h2 className="text-lg font-bold text-ink">Activity history</h2></div><p className="mt-1 text-sm text-ink-muted">Sign-ins, learning progress, and work saved by the app.</p></div>
      <Button variant="quiet" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</Button>
    </div>
    <div className="flex flex-wrap gap-2 px-5 py-4 sm:px-6" aria-label="Activity filters">{categories.map((option) => <button key={option.value} type="button" aria-pressed={category === option.value} onClick={() => setCategory(option.value)} className={`pressable min-h-11 rounded-full border px-3 text-sm font-semibold ${category === option.value ? 'border-ink bg-slate-100 text-ink' : 'border-line text-ink-secondary hover:bg-surface-sunken'}`}>{option.label}</button>)}</div>
    {error && <div role="alert" className="mx-5 mb-4 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800 sm:mx-6">{error} <button type="button" onClick={() => void load()} className="inline-flex min-h-11 items-center font-semibold underline">Try again</button></div>}
    {loading ? <p className="px-5 pb-6 text-sm text-ink-muted sm:px-6">Loading activity…</p> : rows.length === 0 ? <p className="px-5 pb-6 text-sm text-ink-muted sm:px-6">No activity recorded in this category yet. Earlier activity was not backfilled.</p> : <ol className="divide-y divide-line border-t border-line">{rows.map((event) => <li key={event.id} className="flex gap-3 px-5 py-4 sm:px-6"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink">{labels[event.event_type] || 'Activity recorded'}{event.record_label ? ` · ${event.record_label}` : ''}</p><p className="mt-1 text-xs leading-5 tabular-nums text-ink-muted">{formatShortDateTime(event.created_at)}{event.cohort_name ? ` · ${event.cohort_name}` : ''}{event.actor.id !== event.subject_user_id ? ` · By ${event.actor.name}` : ''}</p>{event.evidence === 'player_reported' && <p className="mt-1 text-xs text-ink-muted">Player reported progress; this does not verify attention.</p>}{activityPath(event, `${location.pathname}${location.search}`) && <Link to={activityPath(event, `${location.pathname}${location.search}`)!} className="app-link mt-1 inline-flex min-h-11 items-center text-xs font-semibold">{event.destination?.kind === 'submission' ? 'Open submission' : event.destination?.kind === 'recording' ? 'Open recording' : 'Open learning step'}</Link>}</div></li>)}</ol>}
    {nextBeforeId && !loading && <div className="border-t border-line px-5 py-4 sm:px-6"><Button variant="secondary" disabled={loadingMore} onClick={() => void load(nextBeforeId)}>{loadingMore ? 'Loading…' : 'Show earlier activity'}</Button></div>}
  </section>
}

function activityPath(event: ActivityEvent, returnTo: string) {
  const target = event.destination
  if (!target || event.event_type === 'account_signed_in') return null
  if (target.kind === 'submission' && target.submission_id) return submissionPath(target.submission_id, { cohortId: target.cohort_id, userId: target.student_id, returnTo })
  if (target.kind === 'lesson' || target.kind === 'recording') return target.destination_path || null
  return null
}
