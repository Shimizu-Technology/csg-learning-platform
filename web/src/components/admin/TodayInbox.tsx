import { useLocation, useSearchParams } from 'react-router-dom'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { RecordLink } from '../shared/RecordLink'
import { useMessageStudent } from './MessageStudentsDialog'
import type { InstructorTodayData } from '../../types/api'

export function TodayInbox({ today }: { today: InstructorTodayData }) {
  const location = useLocation()
  const message = useMessageStudent()
  const [params] = useSearchParams()
  const kind = params.get('kind')
  const items = today.items.filter(item => !kind || !['help', 'review', 'message', 'quiet', 'follow_up'].includes(kind) || item.kind === kind)
  return <section className="app-surface overflow-hidden" aria-label="Ranked inbox">
    <h2 className="border-b border-line px-4 py-3 text-lg font-bold text-ink">Needs you{kind && <Link to={`${location.pathname}${params.get('cohort_id') ? `?cohort_id=${params.get('cohort_id')}` : ''}`} className="ml-3 text-sm font-normal underline">Show all</Link>}</h2>
    {items.length === 0 ? <div className="p-5"><p className="font-semibold text-ink">{today.items.length || today.attention_remaining ? 'More attention is pending' : "You're caught up"}</p><p className="mt-2 text-sm text-ink-secondary">{today.upcoming.length ? 'Your next session is listed below.' : 'Check your cohorts or come back when new work arrives.'}</p></div> : <div className="divide-y divide-line">{items.map(item => <article key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap" data-today-item={item.kind}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink"><>{item.student_record === false || !item.cohort_id ? item.full_name : <RecordLink record={{ type: 'student', id: item.user_id, cohortId: item.cohort_id }} returnLabel="Today" touchTarget>{item.full_name}</RecordLink>}</><span className="text-xs font-normal text-ink-muted">{item.cohort_id && <RecordLink record={{ type: 'cohort', id: item.cohort_id }} returnLabel="Today" touchTarget>{item.cohort_name}</RecordLink>}</span></div>
        <p className="line-clamp-2 break-words text-sm text-ink-secondary [overflow-wrap:anywhere]">{item.urgent && <strong>Urgent · </strong>}{item.text}</p>
        {item.since && <p className="mt-1 text-xs text-ink-muted">{new Date(item.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {({ help: 'Help request', review: 'Waiting for review', message: 'Unread message', quiet: 'Going quiet', follow_up: 'Follow-up due' })[item.kind]}</p>}
      </div>
      {item.web_path ? <Link className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-action-primary px-4 text-sm font-semibold text-on-action" to={`${item.web_path}${item.web_path.includes('?') ? '&' : '?'}return_to=${encodeURIComponent(location.pathname + location.search)}`}>{item.action_label}</Link> : <button type="button" disabled={message.opening === item.user_id} onClick={() => void message.open(item.user_id, item.cohort_id!)} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-ink hover:bg-surface-sunken">{message.opening === item.user_id ? 'Opening…' : 'Message'}</button>}
    </article>)}</div>}
    {today.attention_remaining > 0 && <Link className="block min-h-11 px-4 py-3 text-sm underline" to={`/admin/support${params.get('cohort_id') ? `?cohort_id=${params.get('cohort_id')}` : ''}`}>{today.attention_remaining} more learners need attention → Support</Link>}
  </section>
}
