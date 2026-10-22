import { Link, useLocation } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { SupportQueueStudent } from '../../types/api'
import { Avatar } from '../ui/Avatar'

export const ATTENTION_CHECKED = 'Checked help requests, latest work, due follow-ups, invitations, assigned learning, and released unfinished work.'

export function AttentionRow({ student }: { student: SupportQueueStudent }) {
  const location = useLocation()
  const action = student.next_action
  if (!action) return null
  const [path, query] = action.web_path.split('?')
  const params = new URLSearchParams(query)
  params.set('return_to', `${location.pathname}${location.search}`)
  return <Link to={`${path}?${params}`} className="pressable flex min-h-20 flex-wrap items-start gap-3 px-5 py-4 hover:bg-surface-sunken sm:flex-nowrap sm:items-center">
    <Avatar name={student.full_name || student.email} size="sm" />
    <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-ink">{student.full_name || student.email}</p><p className="mt-1 break-words text-xs text-ink-muted">{student.cohort_name}</p><ul className="mt-2 space-y-1">{student.reasons?.map((reason) => <li key={reason.code} className="text-sm text-ink-secondary [overflow-wrap:anywhere]">{reason.label}</li>)}</ul><p className="mt-2 text-xs tabular-nums text-ink-muted">Assigned learning: {student.completed_blocks}/{student.total_blocks} steps · Released unfinished: {student.released_unfinished_blocks ?? 0}</p></div>
    <span className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">{action.label}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></span>
  </Link>
}

export function AttentionList({ students, limit, viewAll }: { students: SupportQueueStudent[]; limit?: number; viewAll?: string }) {
  return <section className="app-surface overflow-hidden" aria-label="Needs attention"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><h2 className="text-lg font-bold text-ink">Needs attention</h2>{viewAll && students.length > 0 && <Link className="app-link inline-flex min-h-11 items-center text-sm" to={viewAll}>View all {students.length}</Link>}</div>
    {students.length > 0 ? <div className="divide-y divide-line">{students.slice(0, limit).map((student) => <AttentionRow key={student.enrollment_id} student={student} />)}</div> : <div className="px-5 py-8"><p className="font-semibold text-ink">Everyone’s on track</p><p className="mt-2 text-sm leading-6 text-ink-muted">{ATTENTION_CHECKED}</p></div>}
  </section>
}
