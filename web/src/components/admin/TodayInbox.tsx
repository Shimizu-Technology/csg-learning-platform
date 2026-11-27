import { useLocation, useSearchParams } from 'react-router-dom'
import { CalendarClock, ClipboardCheck, Clock3, HelpCircle, MessageSquare } from 'lucide-react'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { RecordLink } from '../shared/RecordLink'
import { Badge } from '../ui/Badge'
import { Button, LinkButton } from '../ui/Button'
import { PastReviewTargetBadge } from './PastReviewTargetBadge'
import { useMessageStudent } from './MessageStudentsDialog'
import type { InstructorTodayData } from '../../types/api'

const KIND_META = {
  help: { label: 'Help request', icon: HelpCircle, tone: 'border-primary-soft-line bg-primary-soft text-primary-ink' },
  review: { label: 'Waiting for review', icon: ClipboardCheck, tone: 'border-info-line bg-info-soft text-info-ink' },
  message: { label: 'Unread message', icon: MessageSquare, tone: 'border-info-line bg-info-soft text-info-ink' },
  follow_up: { label: 'Follow-up due', icon: CalendarClock, tone: 'border-warning-line bg-warning-soft text-warning-ink' },
  quiet: { label: 'Going quiet', icon: Clock3, tone: 'border-warning-line bg-warning-soft text-warning-ink' },
} as const

export function TodayInbox({ today }: { today: InstructorTodayData }) {
  const location = useLocation()
  const message = useMessageStudent()
  const [params] = useSearchParams()
  const kind = params.get('kind')
  const items = today.items.filter(item => !kind || !['help', 'review', 'message', 'quiet', 'follow_up'].includes(kind) || item.kind === kind)
  return <section className="app-surface overflow-hidden" aria-label="Ranked inbox">
    <h2 className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-lg font-bold text-ink sm:px-5">
      <span>Needs you</span>
      {kind && <Link to={`${location.pathname}${params.get('cohort_id') ? `?cohort_id=${params.get('cohort_id')}` : ''}`} className="app-link inline-flex min-h-11 items-center text-sm lg:min-h-0">Show all</Link>}
    </h2>
    {items.length === 0 ? <div className="p-5 sm:p-6"><p className="font-semibold text-ink">{today.items.length || today.attention_remaining ? 'More attention is pending' : "You're caught up"}</p><p className="mt-2 text-sm text-ink-secondary">{today.upcoming.length ? 'Your next session is listed below.' : 'Check your cohorts or come back when new work arrives.'}</p></div> : <div className="divide-y divide-line">{items.map(item => {
      const meta = KIND_META[item.kind]
      const KindIcon = meta.icon
      return <article key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-sunken/60 sm:flex-nowrap sm:px-5" data-today-item={item.kind}>
        <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${item.urgent ? 'border-danger-line bg-danger-soft text-danger-ink' : meta.tone}`}>
          <KindIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-ink"><>{item.student_record === false || !item.cohort_id ? item.full_name : <RecordLink record={{ type: 'student', id: item.user_id, cohortId: item.cohort_id }} returnLabel="Today" touchTarget>{item.full_name}</RecordLink>}</><span className="text-xs font-normal text-ink-muted">{item.cohort_id && item.cohort_name && <RecordLink record={{ type: 'cohort', id: item.cohort_id }} returnLabel="Today" touchTarget>{item.cohort_name}</RecordLink>}</span></div>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-ink-secondary [overflow-wrap:anywhere]">
            {item.urgent && <><Badge tone="danger">Urgent</Badge><span className="sr-only"> · </span></>}
            <span className="line-clamp-2 break-words">{item.text}</span>
          </p>
          {item.overdue === true && <div className="mt-1.5"><PastReviewTargetBadge /></div>}
          {item.since && <p className="mt-1 text-xs tabular-nums text-ink-muted">{new Date(item.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {meta.label}</p>}
        </div>
        {item.web_path ? <LinkButton variant={item.urgent ? 'primary' : 'secondary'} size="sm" className="shrink-0" to={`${item.web_path}${item.web_path.includes('?') ? '&' : '?'}return_to=${encodeURIComponent(location.pathname + location.search)}`}>{item.action_label}</LinkButton> : <Button variant="secondary" size="sm" className="shrink-0" disabled={message.opening === item.user_id} onClick={() => void message.open(item.user_id, item.cohort_id!)}>{message.opening === item.user_id ? 'Opening…' : 'Message'}</Button>}
      </article>
    })}</div>}
    {today.attention_remaining > 0 && <Link className="flex min-h-11 items-center border-t border-line bg-surface-sunken/40 px-4 py-3 text-sm font-semibold text-primary-ink transition-colors hover:bg-surface-sunken hover:text-primary-soft-ink sm:px-5" to={`/admin/support${params.get('cohort_id') ? `?cohort_id=${params.get('cohort_id')}` : ''}`}>{today.attention_remaining} more {today.attention_remaining === 1 ? 'learner needs' : 'learners need'} attention → Support</Link>}
  </section>
}
