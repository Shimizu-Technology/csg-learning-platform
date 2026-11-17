import { useId, type ReactNode } from 'react'
import { Eye, Layers, Table2 } from 'lucide-react'
import { PreviewLink } from '../../contexts/PreviewNavigationContext'
import { cohortModuleGradingPath, cohortStudentViewLessonPath } from '../../lib/routes'
import { deliveryLabel, gradingPath, otherCohortsLine, plural, supportPath } from '../../lib/recordUsage'
import { formatShortDate } from '../../lib/format'
import { TERMS } from '../../lib/glossary'
import type { CurriculumUsageCohort, LessonUsageCohort, ModuleUsageCohort } from '../../types/api'
import { CohortStatusBadge } from '../shared/CohortStatusBadge'
import { RecordLink } from '../shared/RecordLink'

type Row =
  | { kind: 'curriculum'; cohort: CurriculumUsageCohort }
  | { kind: 'module'; cohort: ModuleUsageCohort; moduleId: number }
  | { kind: 'lesson'; cohort: LessonUsageCohort; lessonId: number; moduleId: number }

const day = (value: string | null | undefined) => formatShortDate(value, '', { weekday: true, withYear: false })
const today = () => new Date().toISOString().slice(0, 10)

/** The schedule line under a cohort's name: when this content runs there. */
function scheduleLine(row: Row): string {
  const { cohort } = row
  const selfPaced = cohort.course_delivery === 'self_paced'
  if (row.kind === 'curriculum') {
    if (!cohort.start_date) return 'No start date'
    return `${cohort.start_date <= today() ? 'Started' : 'Starts'} ${day(cohort.start_date)}`
  }
  if (!row.cohort.assigned) return 'Not assigned in this cohort'
  if (selfPaced) return 'Learners go at their own pace'
  if (row.kind === 'module') {
    const { starts_on: starts, ends_on: ends } = row.cohort
    if (!starts) return 'Not scheduled'
    return ends && ends !== starts ? `${day(starts)} to ${day(ends)}` : day(starts)
  }
  const opens = row.cohort.release_date
  if (!opens) return 'Not scheduled'
  return `${opens <= today() ? 'Opened' : 'Opens'} ${day(opens)}`
}

function CountLink({ to, count, label, attention = false }: { to: string; count: number; label: string; attention?: boolean }) {
  return (
    <PreviewLink
      to={to}
      className={`inline-flex min-h-11 items-center rounded-xl px-2 text-xs font-semibold tabular-nums transition-colors duration-150 hover:bg-surface-sunken sm:min-h-8 ${attention && count ? 'text-warning-ink' : count ? 'text-ink-secondary hover:text-ink' : 'text-ink-muted'}`}
    >
      {label}
    </PreviewLink>
  )
}

function RowActions({ row }: { row: Row }) {
  const { cohort } = row
  const links: ReactNode[] = []
  if (row.kind === 'curriculum') {
    links.push(<span key="students" className="inline-flex min-h-8 items-center px-2 text-xs font-semibold tabular-nums text-ink-muted">{plural(row.cohort.students, 'active student')}</span>)
    links.push(<CountLink key="waiting" to={gradingPath({ cohortId: cohort.id })} count={row.cohort.waiting} label={`${row.cohort.waiting} waiting`} attention />)
  } else {
    const scope = row.kind === 'module' ? { moduleId: row.moduleId } : { lessonId: row.lessonId }
    links.push(<CountLink key="submissions" to={gradingPath({ cohortId: cohort.id, ...scope, all: true })} count={row.cohort.submissions} label={plural(row.cohort.submissions, 'submission')} />)
    links.push(<CountLink key="waiting" to={gradingPath({ cohortId: cohort.id, ...scope })} count={row.cohort.waiting} label={`${row.cohort.waiting} waiting`} attention />)
  }
  const help = row.cohort.open_help
  if (typeof help === 'number') links.push(<CountLink key="help" to={supportPath(cohort.id)} count={help} label={`${help} open help`} attention />)
  if (row.kind === 'module') {
    links.push(
      <PreviewLink key="grid" to={cohortModuleGradingPath(cohort.id, row.moduleId)} className="app-link inline-flex min-h-11 items-center gap-1 px-2 text-xs sm:min-h-8">
        <Table2 className="h-3.5 w-3.5" aria-hidden="true" />Module grading
      </PreviewLink>,
    )
  }
  if (row.kind === 'lesson') {
    links.push(
      <PreviewLink key="preview" to={cohortStudentViewLessonPath(cohort.id, row.lessonId)} className="app-link inline-flex min-h-11 items-center gap-1 px-2 text-xs sm:min-h-8" aria-label={`${TERMS.viewAsStudent} in ${cohort.name}`}>
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />{TERMS.viewAsStudent}
      </PreviewLink>,
    )
  }
  return <div className="flex flex-wrap items-center gap-x-1 sm:justify-end">{links}</div>
}

/**
 * "Used in" (L-3.2): the cohorts a curriculum, module or lesson is used in,
 * each with when it runs there, its delivery, and links to that cohort's work,
 * help and (for a lesson) the learner view. Cohorts the viewer doesn't teach
 * appear only as a number.
 */
export function UsedInCohorts({ rows, otherCount, focusCohortId, id = 'used-in', title = 'Used in', compact = false, emptyText = 'No cohort uses this curriculum yet.' }: {
  rows: Row[]
  otherCount: number
  focusCohortId?: number | null
  id?: string
  title?: string
  /** The lesson editor's inspector: no card, tighter rows. */
  compact?: boolean
  emptyText?: string
}) {
  const headingId = useId()
  const other = otherCohortsLine(otherCount)
  const list = rows.length ? (
    <ul className={compact ? 'grid gap-2' : 'divide-y divide-line'}>
      {rows.map((row) => {
        const focused = row.cohort.id === focusCohortId
        return (
          <li
            key={row.cohort.id}
            data-used-in-cohort={row.cohort.id}
            aria-current={focused ? 'true' : undefined}
            className={compact
              ? `rounded-xl border px-3 py-2 ${focused ? 'border-line-strong bg-surface-selected' : 'border-line'}`
              : `relative grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5 ${focused ? 'bg-surface-selected before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-action-primary' : ''}`}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Layers className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <RecordLink record={{ type: 'cohort', id: row.cohort.id }} variant="plain" touchTarget truncate className="min-w-0 font-semibold text-ink">{row.cohort.name}</RecordLink>
                {!compact && <CohortStatusBadge status={row.cohort.status} />}
                {row.cohort.on_sale && <span className="text-xs font-semibold text-success-ink">On sale</span>}
              </div>
              <p className="mt-0.5 text-xs tabular-nums text-ink-muted">{deliveryLabel(row.cohort.course_delivery)} · {scheduleLine(row)}</p>
            </div>
            <RowActions row={row} />
          </li>
        )
      })}
    </ul>
  ) : <p className={`text-sm text-ink-muted ${compact ? '' : 'px-4 py-5 sm:px-5'}`}>{otherCount ? 'None of the cohorts you teach use it.' : emptyText}</p>

  if (compact) {
    return <div id={id} className="grid gap-2">{list}{other && <p className="text-xs text-ink-muted">{other}</p>}</div>
  }
  return (
    <section id={id} aria-labelledby={headingId} className="app-surface overflow-hidden" tabIndex={-1}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 id={headingId} className="text-base font-semibold text-ink">{title}</h2>
        <span className="text-xs font-semibold tabular-nums text-ink-muted">{plural(rows.length, 'cohort')}</span>
      </div>
      {list}
      {other && <p className="border-t border-line px-4 py-3 text-xs text-ink-muted sm:px-5" data-other-cohorts="">{other}</p>}
    </section>
  )
}

export type UsedInRow = Row
