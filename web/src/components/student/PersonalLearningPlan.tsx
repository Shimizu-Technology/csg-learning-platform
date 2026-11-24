import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { ArrowRight, CalendarDays, CheckCircle2, Lock } from 'lucide-react'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import type { PersonalLearningPlan as Plan, PersonalPlanLesson } from '../../types/api'
import { LEARNER_STATUS, lessonStatus } from '../../lib/learningStatus'
import { useLearnerPaths } from '../../lib/useRecordPath'
import { MarkdownText } from '../shared/MarkdownRenderer'
import { useStudentExperience } from '../../lib/studentExperience'

// One status per lesson, from the server when the payload has it (AS-10).
function planLessonLabel(lesson: PersonalPlanLesson) {
  const status = lessonStatus(lesson)
  return status === 'open' || status === 'upcoming' ? '' : ` · ${LEARNER_STATUS[status].label}`
}

export function PersonalLearningPlan({ plan, cohortId, showNextTask = true }: { plan: Plan; cohortId?: number; showNextTask?: boolean }) {
  const current = plan.milestones.findIndex((milestone) => milestone.lessons.some((lesson) => lesson.required && !lesson.completed))
  const query = cohortId ? `?cohort_id=${cohortId}` : ''
  const paths = useLearnerPaths(cohortId)
  // The new student experience links the waiting count to My work (L-1.2).
  const { v2 } = useStudentExperience()
  return <section aria-label="Your catch-up plan" className="app-surface space-y-5 p-5 sm:p-6">
    <div>
      <p className="app-eyebrow">Your personal plan</p>
      <h2 className="mt-1 text-xl font-bold text-ink [overflow-wrap:anywhere]">{plan.title}</h2>
      {/* Staff write the note in the shared Markdown editor (§9); read it through the one renderer. */}
      {plan.description && <div className="mt-2 text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]"><MarkdownText content={plan.description} /></div>}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-ink-secondary">
        {plan.target_date && <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4" aria-hidden="true" />Target finish: {formatShortDate(plan.target_date)}</p>}
        {plan.next_check_in_on && <p>Next follow-up: {formatShortDate(plan.next_check_in_on)}</p>}
      </div>
      <p className="mt-3 text-sm text-ink-secondary">{plan.completed_count} of {plan.required_count} required lessons done or submitted.{plan.awaiting_review_count > 0 && (v2
        ? <> <Link to={`/my-work?${new URLSearchParams({ ...(cohortId ? { cohort_id: String(cohortId) } : {}), tab: 'waiting' })}`} className="app-link inline-flex min-h-11 items-center tabular-nums">{plan.awaiting_review_count} waiting for review</Link>.</>
        : ` ${plan.awaiting_review_count} waiting for review.`)}</p>
    </div>
    {showNextTask && plan.next_lesson && <Link className="pressable flex min-h-11 items-center justify-between gap-3 rounded-xl bg-surface-sunken p-4 font-semibold text-ink" to={paths.lesson(plan.next_lesson.lesson_id)}><span className="min-w-0 [overflow-wrap:anywhere]">Next required task: {plan.next_lesson.title}</span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>}
    {plan.milestones.length > 0 && <div className="space-y-3">{plan.milestones.map((milestone, index) => <details key={`${index}:${milestone.title}`} open={index === current} className="rounded-xl border border-line">
      <summary className="min-h-11 cursor-pointer px-4 py-3 font-semibold text-ink [overflow-wrap:anywhere]">{milestone.title}<span className="mt-1 block text-sm font-normal tabular-nums text-ink-muted">Target {formatShortDate(milestone.due_on)} · {milestone.completed_count}/{milestone.required_count} required done or submitted{index === current ? ' · Current milestone' : ''}</span></summary>
      <ul className="border-t border-line px-4">{milestone.lessons.map((lesson) => <li key={lesson.lesson_id} className="flex min-h-11 items-start gap-2 py-3 text-sm">
        {lesson.completed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-ink" aria-hidden="true" /> : !lesson.available ? <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" /> : null}
        <div className="min-w-0">{lesson.available ? <Link to={paths.lesson(lesson.lesson_id)} className="app-link inline-flex min-h-11 items-center [overflow-wrap:anywhere]">{lesson.title}</Link> : <span className="[overflow-wrap:anywhere]">{lesson.title} · Not open yet</span>}<p className="text-xs text-ink-muted">{lesson.required ? 'Required' : 'Optional'}{planLessonLabel(lesson)}</p></div>
      </li>)}</ul>
    </details>)}</div>}
    {!!plan.submission_deadlines?.length && <details className="border-t border-line pt-4" open><summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink">Submission deadlines</summary><p className="mb-2 text-xs text-ink-muted">Milestone targets do not extend submission windows.</p><ul className="space-y-2 text-sm">{plan.submission_deadlines.map((deadline) => <li key={deadline.lesson_id}>{deadline.available ? <Link className="app-link inline-flex min-h-11 items-center" to={paths.lesson(deadline.lesson_id)}>{deadline.title}</Link> : <p className="py-3 text-ink-secondary">{deadline.title} · Not open yet</p>}<p className={deadline.closed ? 'text-warning-ink' : 'text-ink-secondary'}>{deadline.closed ? 'Submissions closed' : 'Submissions close'}{deadline.closes_at ? ` · ${formatShortDateTime(deadline.closes_at)}` : ''}</p></li>)}</ul></details>}
    {plan.requirement_changes.length > 0 && <details className="border-t border-line pt-4"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink">What’s different in your plan</summary><ul className="space-y-3 text-sm text-ink-secondary">{plan.requirement_changes.map((change) => <li key={change.lesson_id} className="[overflow-wrap:anywhere]"><span className="font-semibold">{change.title} · {change.required ? 'Required' : 'Optional'}</span><p>{change.reason}</p></li>)}</ul></details>}
    <Link to={`/materials${query}`} className="app-link inline-flex min-h-11 items-center text-sm font-semibold">Browse all lessons and optional resources<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
    <p className="text-xs leading-5 text-ink-muted">Target dates guide your pace. Your other assigned lessons and optional resources remain in Learn. Done or submitted work may still need instructor review.</p>
  </section>
}
