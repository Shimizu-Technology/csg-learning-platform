import { ArrowRight, BarChart3, CheckCircle2, ChevronDown, CircleDashed, GitBranch, RefreshCw, Target, Users } from 'lucide-react'
import { EmptyState } from '../../../components/shared/EmptyState'
import { LoadingSpinner } from '../../../components/shared/LoadingSpinner'
import { ProgressBar } from '../../../components/shared/ProgressBar'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Avatar } from '../../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { PreviewLink as Link } from '../../../contexts/PreviewNavigationContext'
import { cohortPath, cohortStudentPath, submissionPath } from '../../../lib/routes'
import type { CohortDetail, LearningEvidenceItem, LearningEvidenceStatus, LearningInsights } from '../../../types/api'
import { Metric } from './Overview'
import { Signal } from './Students'

export function Insights({
  cohort,
  insights,
  loading,
  error,
  onRetry,
}: {
  cohort: CohortDetail
  insights: LearningInsights | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading && !insights) return <LoadingSpinner message="Building explainable learning evidence…" />
  if (!insights)
    return (
      <EmptyState
        icon={BarChart3}
        title="Could not load learning evidence"
        description={error || 'Evidence is unavailable.'}
        action={
          <Button onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        }
      />
    )
  if (!insights.objectives.length && !insights.revision_patterns.length)
    return (
      <details className="group app-surface overflow-hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-surface-sunken">
          <span>No learning evidence yet</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
        </summary>
        <p className="border-t border-line px-5 py-4 text-sm leading-6 text-ink-secondary">
          Nothing to show for this cohort yet. Learning insights use rubric ratings, graded submissions and checkpoints
          for each objective. Watch time and completion don't count as proof of understanding.
        </p>
      </details>
    )
  const returnTo = cohortPath(cohort.id, 'insights')
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-info-line bg-info-soft p-5 sm:p-6">
        <div className="flex gap-3">
          <Target className="mt-0.5 h-6 w-6 shrink-0 text-info-ink" />
          <div>
            <h2 className="text-base font-semibold text-ink">How these statuses are set</h2>
            <p className="mt-1 text-sm leading-6 text-info-ink">
              Statuses come only from rubric ratings, graded submissions for the objective, and checkpoints linked to
              it. Completion, watch time and messages don't count. Nothing here changes a grade, unlocks a lesson or
              changes a student's progress.
            </p>
            <details className="mt-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-info-ink">
                How each status is worked out
              </summary>
              <dl className="grid gap-2 pb-2 text-xs leading-5 text-info-ink sm:grid-cols-2">
                <Rule label="Demonstrated" value={insights.rule.demonstrated} />
                <Rule label="Needs revision" value={insights.rule.needs_revision} />
                <Rule label="Developing" value={insights.rule.developing} />
                <Rule label="Not evidenced" value={insights.rule.not_evidenced} />
              </dl>
            </details>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric value={insights.summary.objective_count} label="objectives" />
        <Metric value={insights.summary.demonstrated_count} label="demonstrated" />
        <Metric value={insights.summary.developing_count} label="developing" />
        <Metric value={insights.summary.needs_revision_count} label="need revision" />
        <Metric value={insights.summary.revision_pattern_count} label="revision patterns" />
      </section>

      <section className="app-surface overflow-hidden">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <p className="text-xs font-semibold text-ink-muted">Objective evidence</p>
          <h2 className="mt-1 text-lg font-bold text-ink">From each objective to the work behind it</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Expand an objective, then open a learner or the exact submission that supports the status.
          </p>
        </div>
        {insights.objectives.length ? (
          <div className="divide-y divide-line">
            {insights.objectives.map((objective) => (
              <details key={objective.id} className="group">
                <summary className="cursor-pointer list-none px-5 py-5 sm:px-6">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-surface-sunken px-2 py-1 font-mono text-xs font-semibold text-ink-secondary">
                          {objective.code}
                        </span>
                        <h3 className="text-base font-semibold text-ink">{objective.title}</h3>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-ink-secondary">{objective.success_criteria}</p>
                    </div>
                    <div>
                      <ProgressBar value={objective.demonstrated_percentage} size="sm" />
                      <p className="mt-1 text-xs font-semibold tabular-nums text-ink-muted">
                        {objective.demonstrated_count} of {objective.learner_count} demonstrated
                      </p>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
                  </div>
                </summary>
                <div className="border-t border-line bg-surface-sunken px-5 py-4 sm:px-6">
                  <div className="mb-4 flex flex-wrap gap-2">
                    <EvidencePill status="demonstrated" count={objective.status_counts.demonstrated} />
                    <EvidencePill status="developing" count={objective.status_counts.developing} />
                    <EvidencePill status="needs_revision" count={objective.status_counts.needs_revision} />
                    <EvidencePill status="not_evidenced" count={objective.status_counts.not_evidenced} />
                  </div>
                  <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-raised">
                    {objective.students.map((student) => (
                      <div key={student.enrollment_id} className="px-4 py-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <Link
                            to={`${cohortStudentPath(cohort.id, student.user.id, 'learning')}?objective=${objective.id}`}
                            className="inline-flex min-h-11 min-w-0 items-center gap-2 font-semibold text-ink hover:text-primary-soft-ink hover:underline"
                            title={student.user.full_name}
                          >
                            <Avatar name={student.user.full_name} size="sm" />
                            <span className="truncate">{student.user.full_name}</span>
                          </Link>
                          <EvidencePill status={student.status} />
                        </div>
                        {student.evidence.length ? (
                          <ul className="mt-2.5 divide-y divide-line border-t border-line pt-1">
                            {student.evidence.slice(0, 4).map((evidence) => (
                              <li key={evidence.id} className="py-2 first:pt-1.5 last:pb-0">
                                <ObjectiveEvidenceLinks
                                  evidence={evidence}
                                  cohortId={cohort.id}
                                  studentId={student.user.id}
                                  objectiveId={objective.id}
                                  returnTo={returnTo}
                                />
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs text-ink-muted">No objective evidence recorded yet.</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="px-6 py-8 text-center text-sm text-ink-muted">
            No active objectives are configured for this curriculum.
          </p>
        )}
      </section>

      <section className="app-surface overflow-hidden">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <p className="text-xs font-semibold text-ink-muted">Curriculum review</p>
          <h2 className="mt-1 text-lg font-bold text-ink">Revision and test patterns</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Counts describe current work, not how a student is doing overall. Each count opens the submission behind it.
          </p>
        </div>
        {insights.revision_patterns.length ? (
          <div className="divide-y divide-line">
            {insights.revision_patterns.map((pattern) => (
              <div key={pattern.content_block.id} className="px-5 py-5 sm:px-6">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <h3 className="text-base font-semibold text-ink">{pattern.content_block.title}</h3>
                    <p className="mt-1 text-sm text-ink-muted">
                      <RecordLink
                        record={{ type: 'module', id: pattern.module.id, cohortId: cohort.id }}
                        variant="plain"
                        touchTarget
                        className="font-normal text-ink-muted"
                      >
                        {pattern.module.name}
                      </RecordLink>{' '}
                      ·{' '}
                      <RecordLink
                        record={{ type: 'lesson', id: pattern.lesson.id, cohortId: cohort.id }}
                        variant="plain"
                        touchTarget
                        className="font-normal text-ink-muted"
                      >
                        {pattern.lesson.title}
                      </RecordLink>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Signal
                      label={`${pattern.open_redo_count} open redo`}
                      tone={pattern.open_redo_count ? 'amber' : 'slate'}
                    />
                    <Signal
                      label={`${pattern.repeat_attempt_count} repeat attempt`}
                      tone={pattern.repeat_attempt_count ? 'amber' : 'slate'}
                    />
                    <Signal
                      label={`${pattern.failed_check_count} failed check`}
                      tone={pattern.failed_check_count ? 'red' : 'slate'}
                    />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {pattern.records.map((record) => (
                    <Link
                      key={record.submission_id}
                      to={submissionPath(record.submission_id, {
                        cohortId: cohort.id,
                        userId: record.user.id,
                        returnTo,
                      })}
                      className={
                        'pressable inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 ' +
                        'text-xs font-semibold text-ink-secondary hover:border-line-strong ' +
                        'hover:bg-surface-sunken hover:text-ink'
                      }
                    >
                      <Users className="h-4 w-4" />
                      {record.user.full_name}
                      <span className="tabular-nums text-ink-muted">Attempt {record.attempt_count}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-6 py-8 text-center text-sm text-ink-muted">
            No current redo, repeated-attempt, or failed-check patterns.
          </p>
        )}
      </section>
    </div>
  )
}

export function ObjectiveEvidenceLinks({
  evidence,
  cohortId,
  studentId,
  objectiveId,
  returnTo,
}: {
  evidence: LearningEvidenceItem
  cohortId: number
  studentId: number
  objectiveId: number
  returnTo: string
}) {
  return (
    <>
      <Link
        to={
          evidence.submission_id
            ? submissionPath(evidence.submission_id, { cohortId, userId: studentId, returnTo })
            : `${cohortStudentPath(cohortId, studentId, 'learning')}?objective=${objectiveId}`
        }
        className="app-link inline-flex min-h-11 items-center gap-2 text-sm"
      >
        <EvidenceIcon kind={evidence.kind} />
        {evidence.label} · {evidence.value}
      </Link>
      <p className="text-sm text-ink-muted">
        <RecordLink record={{ type: 'module', id: evidence.module_id, cohortId }} variant="plain" touchTarget>
          {evidence.module_name || 'Module'}
        </RecordLink>
        <span aria-hidden="true"> · </span>
        <RecordLink record={{ type: 'lesson', id: evidence.lesson_id, cohortId }} variant="plain" touchTarget>
          {evidence.lesson_title || 'Lesson'}
        </RecordLink>
      </p>
      {evidence.github_checks?.failed ? (
        <p className="text-xs tabular-nums text-danger-ink">{evidence.github_checks.failed} failed checks</p>
      ) : null}
    </>
  )
}

export function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export function EvidenceIcon({ kind }: { kind: string }) {
  const Icon = kind === 'knowledge_check' ? CircleDashed : kind === 'rubric_criterion' ? CheckCircle2 : GitBranch
  return <Icon className="h-4 w-4" />
}

export function EvidencePill({ status, count }: { status: LearningEvidenceStatus; count?: number }) {
  const labels = {
    demonstrated: 'Demonstrated',
    developing: 'Developing',
    needs_revision: 'Needs revision',
    not_evidenced: 'Not evidenced',
  }
  const tones: Record<LearningEvidenceStatus, BadgeTone> = {
    demonstrated: 'success',
    developing: 'info',
    needs_revision: 'warning',
    not_evidenced: 'neutral',
  }
  return (
    <Badge tone={tones[status]} className="tabular-nums">
      {count !== undefined ? `${count} ` : ''}
      {labels[status]}
    </Badge>
  )
}
