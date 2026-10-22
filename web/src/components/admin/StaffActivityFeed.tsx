import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath, submissionPath } from '../../lib/routes'
import { useListScrollMemory } from '../../lib/navigationContext'
import { formatShortDateTime } from '../../lib/format'
import { Button } from '../ui/Button'
import type { ActivityEvent, ActivityEventsResponse, CohortDetail } from '../../types/api'

type Person = { id: number; name: string }
type Choice = { id: number; name: string }
const labels: Record<string, string> = {
  account_signed_in: 'Signed in', checkpoint_completed: 'Completed a learning step', checkpoint_reopened: 'Reopened a learning step',
  video_started: 'Started a lesson video', video_completed: 'Completed a lesson video', recording_started: 'Started a recording', recording_completed: 'Completed a recording',
  submission_created: 'Submitted work', submission_updated: 'Resubmitted or updated work', submission_graded: 'Reviewed work',
}

export function StaffActivityFeed({ cohort, learners = [], actors = [], cohorts = [] }: { cohort?: CohortDetail; learners?: Person[]; actors?: Person[]; cohorts?: Choice[] }) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const feed = cohort ? 'cohort' : 'school'
  const learnerId = Number(params.get('activity_learner')) || undefined
  const actorId = Number(params.get('activity_actor')) || undefined
  const cohortId = cohort?.id || Number(params.get('activity_cohort')) || undefined
  const category = params.get('activity_category') || ''
  const since = params.get('activity_since') || ''
  const until = params.get('activity_until') || ''
  const beforeId = Number(params.get('activity_before')) || undefined
  const returnTo = `${location.pathname}${location.search}`
  const [result, setResult] = useState<ActivityEventsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useListScrollMemory(!loading && Boolean(result))
  const generation = useRef(0)
  const people = cohort ? cohort.students.map((student) => ({ id: student.user_id, name: student.full_name || student.email })) : learners

  useEffect(() => {
    const current = ++generation.current
    setLoading(true); setError(null); setResult(null)
    void api.getActivityEvents({ feed, cohort_id: cohortId, user_id: learnerId, actor_id: actorId, category: category || undefined, since: since || undefined, until: until || undefined, before_id: beforeId }).then((response) => {
      if (generation.current !== current) return
      if (response.data && !response.error && !response.fromCache) setResult(response.data)
      else setError(response.error || 'Could not load activity.')
      setLoading(false)
    })
    return () => { generation.current++ }
  }, [feed, cohortId, learnerId, actorId, category, since, until, beforeId, refresh])

  function filter(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value) next.set(`activity_${key}`, value); else next.delete(`activity_${key}`)
      next.delete('activity_before'); next.delete('activity_pages')
      return next
    })
  }
  function page(earlier: boolean) {
    const next = new URLSearchParams(params)
    const pages = (params.get('activity_pages') || '').split(',').filter(Boolean)
    const cursor = earlier ? result?.next_before_id : Number(pages.pop())
    if (earlier) pages.push(String(beforeId || 0))
    if (cursor) next.set('activity_before', String(cursor)); else next.delete('activity_before')
    if (pages.length) next.set('activity_pages', pages.join(',')); else next.delete('activity_pages')
    setParams(next)
  }

  return <section className="app-surface overflow-hidden" aria-label={`${cohort ? 'Cohort' : 'School'} activity`}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5 sm:px-6"><div><h2 className="flex items-center gap-2 text-lg font-bold text-ink"><Activity className="h-5 w-5" aria-hidden="true" />{cohort ? 'Cohort activity' : 'School activity'}</h2><p className="mt-1 text-sm text-ink-muted">{result?.recorded_since ? `Recorded since ${formatShortDateTime(result.recorded_since)}. Earlier activity was not backfilled.` : 'No earlier history was backfilled.'}</p></div><Button variant="quiet" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh</Button></header>
    <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3 sm:px-6" aria-label="Activity filters">
      {!cohort && <Select label="Cohort" value={String(cohortId || '')} onChange={(value) => filter('cohort', value)} choices={cohorts} />}
      <Select label="Learner" value={String(learnerId || '')} onChange={(value) => filter('learner', value)} choices={people} />
      {!cohort && <Select label="Actor" value={String(actorId || '')} onChange={(value) => filter('actor', value)} choices={actors} />}
      <label className="text-sm font-semibold text-ink-secondary">Category<select className="app-control mt-1 w-full" value={category} onChange={(event) => filter('category', event.target.value)}><option value="">All categories</option>{!cohort && <option value="account">Sign-ins</option>}<option value="learning">Learning</option><option value="work">Work & reviews</option></select></label>
      <label className="min-w-0 text-sm font-semibold text-ink-secondary">From<input className="app-control mt-1 w-full min-w-0" type="date" value={since} onChange={(event) => filter('since', event.target.value)} /></label>
      <label className="min-w-0 text-sm font-semibold text-ink-secondary">Through<input className="app-control mt-1 w-full min-w-0" type="date" value={until} min={since} onChange={(event) => filter('until', event.target.value)} /></label>
    </div>
    {loading ? <p className="p-5 text-sm text-ink-muted">Loading activity…</p> : error ? <div role="alert" className="p-5 text-sm text-danger-700">{error}<Button variant="quiet" onClick={() => setRefresh((value) => value + 1)}>Try again</Button></div> : !result?.activity_events.length ? <p className="p-5 text-sm text-ink-muted">No recorded activity matches these filters.</p> : <ol className="divide-y divide-line border-t border-line">{result.activity_events.map((event) => {
      const path = activityDestination(event, returnTo)
      const learner = event.subject_user?.name || `Learner ${event.subject_user_id}`
      return <li key={event.id} className="space-y-1 p-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{event.cohort_id && event.subject_user?.role === 'student' ? <Link className="app-link inline-flex min-h-11 items-center font-semibold" to={`${cohortStudentPath(event.cohort_id, event.subject_user_id)}?return_to=${encodeURIComponent(returnTo)}`} state={{ returnTo, returnLabel: 'Activity' }}>{learner}</Link> : <span className="font-semibold text-ink">{event.subject_user?.name || event.actor.name}</span>}<span className="text-sm text-ink">{labels[event.event_type] || event.event_type}</span></div>
        <p className="text-sm text-ink-secondary">{event.actor.id === event.subject_user_id ? (event.actor.role === 'student' ? 'Learner acted' : 'Account activity') : `Staff acted for learner · ${event.actor.name}`}</p>
        {path ? <Link to={path} state={{ returnTo, returnLabel: 'Activity' }} className="app-link inline-flex min-h-11 items-center text-sm font-semibold">{event.record_label || 'Open record'}</Link> : event.record_label && <p className="text-sm text-ink-muted">{event.record_label} · Record unavailable</p>}
        <p className="text-xs leading-5 text-ink-muted"><time dateTime={event.created_at}>{formatShortDateTime(event.created_at)}</time>{event.cohort_name ? ` · ${event.cohort_name}` : ''} · {event.evidence === 'player_reported' ? 'Player reported progress; does not verify attention' : 'App record'}</p>
      </li>
    })}</ol>}
    {!loading && result && <footer className="flex flex-wrap gap-3 border-t border-line p-5 sm:px-6">{beforeId && <Button variant="secondary" onClick={() => page(false)}>Newer activity</Button>}{result.next_before_id && <Button variant="secondary" onClick={() => page(true)}>Earlier activity</Button>}</footer>}
  </section>
}
function Select({ label, value, onChange, choices }: { label: string; value: string; onChange: (value: string) => void; choices: Choice[] }) {
  return <label className="min-w-0 text-sm font-semibold text-ink-secondary">{label}<select className="app-control mt-1 w-full" value={value} onChange={(event) => onChange(event.target.value)}><option value="">All {label.toLowerCase()}s</option>{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
}
function activityDestination(event: ActivityEvent, returnTo: string) {
  const target = event.destination
  if (!target) return null
  if (target.kind === 'submission' && target.submission_id) return submissionPath(target.submission_id, { cohortId: target.cohort_id, userId: target.student_id, returnTo })
  if (!target.destination_path) return null
  const url = new URL(target.destination_path, 'https://csg.local')
  url.searchParams.set('return_to', returnTo)
  return `${url.pathname}${url.search}${url.hash}`
}
