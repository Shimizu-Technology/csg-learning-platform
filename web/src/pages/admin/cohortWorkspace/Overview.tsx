import { ArrowRight, Users } from 'lucide-react'
import { Avatar } from '../../../components/ui/Avatar'
import { LinkButton } from '../../../components/ui/Button'
import { PreviewLink as Link } from '../../../contexts/PreviewNavigationContext'
import { formatDateTimeRange } from '../../../lib/format'
import { cohortPath, cohortStudentPath } from '../../../lib/routes'
import type { CohortDetail } from '../../../types/api'

export function Overview({ cohort }: { cohort: CohortDetail }) {
  const assigned = cohort.modules.filter((module) => module.assigned)
  const occurrences = cohort.office_hour_occurrences || []
  return (
    <div className="space-y-6">
      <section aria-labelledby="overview-at-glance" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="overview-at-glance" className="text-lg font-bold text-ink">At a glance</h2>
          <Link className="app-link inline-flex min-h-11 items-center gap-1 text-sm" to={cohortPath(cohort.id, 'insights')}>
            View insights <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric value={cohort.students.length} label="enrolled students" />
          <Metric value={assigned.length} label="assigned modules" />
          <Metric value={cohort.uploaded_recordings_count || 0} label="uploaded recordings" />
          <Metric value={occurrences.length} label="upcoming sessions" />
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="app-surface p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-ink">Students</h2>
            <Link className="app-link inline-flex min-h-11 items-center text-sm" to={cohortPath(cohort.id, 'students')}>
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {cohort.students.slice(0, 5).map((student) => (
              <Link
                key={student.enrollment_id}
                to={cohortStudentPath(cohort.id, student.user_id)}
                className={
                  'pressable flex min-h-14 items-center justify-between gap-3 rounded-xl border ' +
                  'border-line px-3 hover:border-line-strong hover:bg-surface-sunken'
                }
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={student.full_name || student.email} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink" title={student.full_name || student.email}>
                      {student.full_name || student.email}
                    </p>
                    <p className="truncate text-xs text-ink-muted" title={student.email}>
                      {student.email}
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" />
              </Link>
            ))}
          </div>
        </section>
        <section className="app-surface p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-ink">What’s next</h2>
            <Link className="app-link inline-flex min-h-11 items-center text-sm" to={cohortPath(cohort.id, 'schedule')}>
              Schedule
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {occurrences.length ? (
              occurrences.slice(0, 4).map((occurrence, index) => (
                <div
                  key={`${occurrence.office_hour_id}-${occurrence.starts_at}-${index}`}
                  className="min-w-0 rounded-xl border border-line p-3"
                >
                  <p className="truncate text-sm font-semibold text-ink" title={occurrence.title}>
                    {occurrence.title}
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-ink-muted">
                    {formatDateTimeRange(
                      occurrence.starts_at,
                      occurrence.ends_at,
                      'Not scheduled',
                      occurrence.timezone,
                    )}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-ink-muted">No live classes or office hours scheduled.</p>
            )}
          </div>
        </section>
      </div>
      <section className="app-surface-muted p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-semibold text-ink">Work student by student</p>
            <p className="mt-1 text-sm text-ink-secondary">
              Choose a student to see learning, work, support, messages, and access and come back to this cohort.
            </p>
          </div>
          {cohort.students[0] && (
            <LinkButton
              variant="secondary"
              className="shrink-0"
              to={cohortStudentPath(cohort.id, cohort.students[0].user_id)}
            >
              <Users className="h-4 w-4" />
              Open first student
            </LinkButton>
          )}
        </div>
      </section>
    </div>
  )
}

export function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="app-surface p-5">
      <p className="text-3xl font-bold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-sm font-semibold text-ink-muted">{label}</p>
    </div>
  )
}
