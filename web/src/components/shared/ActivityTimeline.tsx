import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import { submissionPath } from '../../lib/routes'
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
  const [category, setCategory] = useState('')
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
    const result = await api.getActivityEvents({ user_id: userId, category: category || undefined, before_id: beforeId })
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
  }, [category, userId])

  useEffect(() => {
    void load()
    return () => { generation.current++ }
  }, [load])

  return <section className="app-surface overflow-hidden">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:px-6">
      <div><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary-700" /><h2 className="text-lg font-extrabold text-slate-950">Activity history</h2></div><p className="mt-1 text-sm text-slate-500">Sign-ins, learning progress, and work saved by the app.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-primary-700 hover:bg-primary-50 disabled:opacity-50"><RefreshCw className="h-4 w-4" />Refresh</button>
    </div>
    <div className="flex flex-wrap gap-2 px-5 py-4 sm:px-6" aria-label="Activity filters">{categories.map((option) => <button key={option.value} type="button" aria-pressed={category === option.value} onClick={() => setCategory(option.value)} className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${category === option.value ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{option.label}</button>)}</div>
    {error && <div role="alert" className="mx-5 mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:mx-6">{error} <button type="button" onClick={() => void load()} className="font-bold underline">Try again</button></div>}
    {loading ? <p className="px-5 pb-6 text-sm text-slate-500 sm:px-6">Loading activity…</p> : rows.length === 0 ? <p className="px-5 pb-6 text-sm text-slate-500 sm:px-6">No activity recorded in this category yet. Earlier activity was not backfilled.</p> : <ol className="divide-y divide-slate-100 border-t border-slate-100">{rows.map((event) => <li key={event.id} className="flex gap-3 px-5 py-4 sm:px-6"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary-600" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-slate-900">{labels[event.event_type] || 'Activity recorded'}{event.record_label ? ` · ${event.record_label}` : ''}</p><p className="mt-1 text-xs leading-5 text-slate-500">{formatShortDateTime(event.created_at)}{event.cohort_name ? ` · ${event.cohort_name}` : ''}{event.actor.id !== event.subject_user_id ? ` · By ${event.actor.name}` : ''}</p>{event.evidence === 'player_reported' && <p className="mt-1 text-xs text-slate-500">Player reported progress; this does not verify attention.</p>}{cohortId && event.record_type === 'Submission' && event.record_id && <Link to={submissionPath(event.record_id, { cohortId, userId, returnTo: window.location.pathname })} className="app-link mt-1 inline-flex min-h-11 items-center text-xs font-bold">Open submission</Link>}</div></li>)}</ol>}
    {nextBeforeId && !loading && <div className="border-t border-slate-100 px-5 py-4 sm:px-6"><button type="button" disabled={loadingMore} onClick={() => void load(nextBeforeId)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{loadingMore ? 'Loading…' : 'Show earlier activity'}</button></div>}
  </section>
}
