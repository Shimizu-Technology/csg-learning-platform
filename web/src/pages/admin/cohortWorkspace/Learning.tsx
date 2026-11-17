import { CheckCircle2, PlayCircle, Settings2 } from 'lucide-react'
import { ProgressBar } from '../../../components/shared/ProgressBar'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge } from '../../../components/ui/Badge'
import { LinkButton } from '../../../components/ui/Button'
import { PreviewLink as Link } from '../../../contexts/PreviewNavigationContext'
import { cohortModuleGradingPath, cohortPath, cohortSettingsPath, cohortWatchProgressPath } from '../../../lib/routes'
import type { CohortDetail } from '../../../types/api'

export function Learning({ cohort, canConfigure }: { cohort: CohortDetail; canConfigure: boolean }) {
  return (
    <div className="space-y-4">
      <section className="app-surface-muted flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-ink">
            <RecordLink record={{ type: 'curriculum', id: cohort.curriculum_id }} variant="plain" touchTarget>
              {cohort.curriculum_name}
            </RecordLink>
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Review assigned modules, learner progress and work to grade.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <LinkButton variant="secondary" to={cohortWatchProgressPath(cohort.id)}>
            <PlayCircle className="h-4 w-4" />
            Watch progress
          </LinkButton>
          {canConfigure && (
            <LinkButton to={cohortSettingsPath(cohort.id, 'curriculum')}>
              <Settings2 className="h-4 w-4" />
              Configure learning
            </LinkButton>
          )}
        </div>
      </section>
      {cohort.modules.map((module) => (
        <section key={module.id} className="app-surface space-y-4 p-5" aria-label={module.name}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-ink">
                <RecordLink record={{ type: 'module', id: module.id, cohortId: cohort.id }} variant="plain" touchTarget>
                  {module.name}
                </RecordLink>
              </h3>
              <div className="flex flex-wrap items-center gap-x-2 text-sm tabular-nums text-ink-muted">
                <span>{module.lessons_count} lessons</span>
                <span aria-hidden="true">·</span>
                <Link
                  to={`${cohortPath(cohort.id, 'students')}&module_id=${module.id}`}
                  className="app-link inline-flex min-h-11 items-center"
                >
                  {module.assigned_count} {module.assigned_count === 1 ? 'student' : 'students'} assigned
                </Link>
              </div>
            </div>
            <Badge tone={module.assigned ? 'success' : 'neutral'}>
              {module.assigned ? 'Assigned' : 'Not assigned'}
            </Badge>
          </div>
          {module.progress_percentage !== undefined ? (
            <div>
              <ProgressBar value={module.progress_percentage} size="sm" />
              <p className="mt-2 text-sm tabular-nums text-ink-secondary">
                {module.completed_lessons} of {module.total_lessons} assigned lessons done or submitted ·{' '}
                {module.progress_percentage}%
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Progress unavailable. Reload this cohort to try again.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <LinkButton
              variant="secondary"
              to={`${cohortModuleGradingPath(cohort.id, module.id)}?return_to=${encodeURIComponent(cohortPath(cohort.id, 'learning'))}`}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Grade<span className="sr-only"> {module.name}</span>
            </LinkButton>
            <RecordLink record={{ type: 'module', id: module.id, cohortId: cohort.id }} variant="app" touchTarget>
              Lessons<span className="sr-only"> in {module.name}</span>
            </RecordLink>
          </div>
        </section>
      ))}
    </div>
  )
}
