import { useLocation } from 'react-router-dom'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { ArrowRight, MessageCircle } from 'lucide-react'
import type { SupportQueueStudent } from '../../types/api'
import { Avatar } from '../ui/Avatar'
import { RecordLink } from '../shared/RecordLink'
import { lessonsLabel } from '../../lib/progressLabel'
import { useMessageStudent } from './MessageStudentsDialog'

export const ATTENTION_CHECKED = 'Checked help requests, recent work, follow-ups that are due, invitations, and open lessons that aren’t finished.'

export function AttentionRow({ student }: { student: SupportQueueStudent }) {
  const location = useLocation()
  const message = useMessageStudent()
  const action = student.next_action
  if (!action) return null
  const [path, query] = action.web_path.split('?')
  const params = new URLSearchParams(query)
  params.set('return_to', `${location.pathname}${location.search}`)
  const name = student.full_name || student.email
  return <div className="pressable relative flex min-h-20 flex-wrap items-start gap-3 px-5 py-4 hover:bg-surface-sunken sm:items-center">
    <Avatar name={name} size="sm" />
    {/* Phones: the name takes the line beside the avatar and the actions wrap below it, instead of squeezing it to one letter per line. */}
    <div className="min-w-0 flex-1 basis-[calc(100%-2.75rem)] sm:basis-56"><p className="break-words text-sm font-semibold text-ink"><RecordLink record={{ type: 'student', id: student.user_id, cohortId: student.cohort_id }} variant="plain" className="relative z-10">{name}</RecordLink></p><p className="mt-1 break-words text-xs text-ink-muted"><RecordLink record={{ type: 'cohort', id: student.cohort_id }} variant="plain" className="relative z-10 font-medium text-ink-muted">{student.cohort_name}</RecordLink></p><ul className="mt-2 space-y-1">{student.reasons?.map((reason) => <li key={reason.code} className="text-sm text-ink-secondary [overflow-wrap:anywhere]">{reason.label}</li>)}</ul><p className="mt-2 text-xs tabular-nums text-ink-muted">Progress: {lessonsLabel(student)}</p></div>
    <button type="button" onClick={() => void message.open(student.user_id, student.cohort_id)} disabled={message.opening === student.user_id} aria-label={`Message ${name}`} className="relative z-10 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-ink-secondary hover:bg-surface-sunken hover:text-ink disabled:opacity-60"><MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />{message.opening === student.user_id ? 'Opening…' : 'Message'}</button>
    <Link to={`${path}?${params}`} aria-label={`${action.label}: ${name}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-semibold text-ink">{action.label}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>
  </div>
}

export function AttentionList({ students, limit, viewAll }: { students: SupportQueueStudent[]; limit?: number; viewAll?: string }) {
  return <section className="app-surface overflow-hidden" aria-label="Needs attention"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><h2 className="text-lg font-bold text-ink">Needs attention</h2>{viewAll && students.length > 0 && <Link className="app-link inline-flex min-h-11 items-center text-sm" to={viewAll}>View all {students.length}</Link>}</div>
    {students.length > 0 ? <div className="divide-y divide-line">{students.slice(0, limit).map((student) => <AttentionRow key={student.enrollment_id} student={student} />)}</div> : <div className="px-5 py-8"><p className="font-semibold text-ink">Everyone’s on track</p><p className="mt-2 text-sm leading-6 text-ink-muted">{ATTENTION_CHECKED}</p></div>}
  </section>
}
