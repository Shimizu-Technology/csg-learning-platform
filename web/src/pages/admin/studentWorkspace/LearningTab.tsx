import { ArrowRight, CheckCircle2, CircleDashed, GitBranch, RefreshCw, Target } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ProgressBar } from '../../../components/shared/ProgressBar'
import { RecordLink } from '../../../components/shared/RecordLink'
import { StatusBadge as LessonStatusBadge } from '../../../components/shared/StatusBadge'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { PreviewLink as Link } from '../../../contexts/PreviewNavigationContext'
import { api } from '../../../lib/api'
import { formatShortDateTime } from '../../../lib/format'
import { humanize } from '../../../lib/glossary'
import { lessonsLabel } from '../../../lib/progressLabel'
import { cohortPath, submissionPath } from '../../../lib/routes'
import { SectionBoundary, type Section } from '../../../lib/useSection'
import type {
  LearningEvidenceStatus,
  LearningInsights,
  StudentLessonVideoProgress,
  StudentProgressResponse,
  StudentRecordingProgress,
  Submission,
} from '../../../types/api'
import { SubmissionStatus } from './presentation'

export const EVIDENCE_KIND_LABELS: Record<string, string> = {
  knowledge_check: 'Checkpoint',
  rubric_criterion: 'Rubric rating',
  aligned_submission: 'Graded submission',
}

export function LearningTab({
  recordingsSection,
  videosSection,
  recordings,
  lessonVideos,
  progress,
  cohortId,
  studentId,
  returnTo,
}: {
  recordingsSection: Section<StudentRecordingProgress[]>
  videosSection: Section<StudentLessonVideoProgress[]>
  recordings: StudentRecordingProgress[]
  lessonVideos: StudentLessonVideoProgress[]
  progress: StudentProgressResponse
  cohortId: number
  studentId: number
  returnTo: string
}) {
  return (
    <div className="space-y-6">
      <section tabIndex={-1} id="recordings" className="app-surface scroll-mt-24 p-5">
        <h2 className="font-bold text-ink">Class recordings</h2>
        <SectionBoundary section={recordingsSection} label="Recordings">
          {recordings.length ? (
            recordings.map((recording) => (
              <RecordLink
                key={recording.recording_id}
                record={{ type: 'recording', id: recording.recording_id, cohortId }}
                variant="app"
                className="block min-h-11 py-3"
              >
                {recording.recording_title} · {recording.completed ? 'Complete' : 'In progress'}
              </RecordLink>
            ))
          ) : (
            <p className="mt-3 text-sm text-ink-muted">No class recordings yet.</p>
          )}
        </SectionBoundary>
      </section>
      <section tabIndex={-1} id="lesson-videos" className="app-surface scroll-mt-24 p-5">
        <h2 className="font-bold text-ink">Lesson videos</h2>
        <SectionBoundary section={videosSection} label="Lesson videos">
          {lessonVideos.length ? (
            lessonVideos.map((video) => {
              const lesson = progress.modules
                .flatMap((module) => module.lessons)
                .find((lesson) => lesson.blocks.some((block) => block.id === video.content_block_id))
              return (
                <p key={video.content_block_id} className="py-2 text-sm text-ink-secondary">
                  {lesson ? (
                    <RecordLink
                      record={{ type: 'lesson', id: lesson.id, cohortId, anchor: `block-${video.content_block_id}` }}
                      touchTarget
                    >
                      {video.title}
                    </RecordLink>
                  ) : (
                    video.title
                  )}{' '}
                  · {video.completed ? 'Complete' : 'In progress'}
                </p>
              )
            })
          ) : (
            <p className="mt-3 text-sm text-ink-muted">No lesson videos yet.</p>
          )}
        </SectionBoundary>
      </section>
      <StudentObjectiveEvidence cohortId={cohortId} studentId={studentId} returnTo={returnTo} />
      <div className="space-y-4">
        {progress.modules.map((mod) => (
          <details
            key={mod.id}
            className="app-surface overflow-hidden"
            open={mod.progress_percentage > 0 && mod.progress_percentage < 100}
          >
            <summary className="min-h-16 cursor-pointer px-5 py-4 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">{mod.name}</h2>
                  <p className="text-xs tabular-nums text-ink-muted">{lessonsLabel(mod)}</p>
                </div>
                <ProgressBar value={mod.progress_percentage} size="sm" />
                <span className="text-sm font-semibold tabular-nums text-ink-secondary">
                  {mod.progress_percentage}%
                </span>
              </div>
            </summary>
            <div className="divide-y divide-line border-t border-line">
              {mod.lessons.map((lesson) => (
                <div key={lesson.id} className="px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink [overflow-wrap:anywhere]">
                        <RecordLink record={{ type: 'lesson', id: lesson.id, cohortId }} variant="plain" touchTarget>
                          {lesson.title}
                        </RecordLink>
                      </p>
                      <p className="text-xs tabular-nums text-ink-muted">
                        {lesson.assigned === false
                          ? 'Not currently assigned · Saved evidence'
                          : `${lesson.completed_blocks}/${lesson.total_blocks} checkpoints · ${lesson.available ? 'Available' : 'Locked'}`}
                      </p>
                    </div>
                    {lesson.learner_status ? (
                      <LessonStatusBadge status={lesson.learner_status} />
                    ) : (
                      lesson.completed && (
                        <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>
                          Complete
                        </Badge>
                      )
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {lesson.blocks.map((block) =>
                      block.submission ? (
                        <Link
                          key={block.id}
                          to={submissionPath(block.submission.id, { cohortId, userId: studentId, returnTo })}
                          className={
                            'pressable flex min-h-11 items-center justify-between gap-2 rounded-xl border ' +
                            'border-line px-3 py-2 text-sm hover:border-line-strong hover:bg-surface-sunken'
                          }
                        >
                          <span className="min-w-0 truncate font-semibold text-ink" title={block.title}>
                            {block.title}
                          </span>
                          <SubmissionStatus submission={{ grade: block.submission.grade } as Submission} />
                        </Link>
                      ) : (
                        <div
                          key={block.id}
                          className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-sm"
                        >
                          <span className="min-w-0 truncate font-semibold text-ink-secondary" title={block.title}>
                            {block.title}
                          </span>
                          <span className="shrink-0 text-xs font-semibold capitalize text-ink-muted">
                            {block.status.replace('_', ' ')}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

export function StudentObjectiveEvidence({
  cohortId,
  studentId,
  returnTo,
}: {
  cohortId: number
  studentId: number
  returnTo: string
}) {
  const [searchParams] = useSearchParams()
  const selectedObjectiveId = Number(searchParams.get('objective')) || null
  const evidenceReturnTo = selectedObjectiveId ? `${returnTo}?objective=${selectedObjectiveId}` : returnTo
  const [insights, setInsights] = useState<LearningInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await api.getLearningInsights(cohortId, studentId)
    if (result.data) setInsights(result.data.learning_insights)
    else setError(result.error || 'Could not load objective evidence.')
    setLoading(false)
  }, [cohortId, studentId])

  useEffect(() => {
    void load()
  }, [load])
  if (loading)
    return (
      <section className="app-surface p-5">
        <p className="text-sm font-semibold text-ink-muted">Loading objective evidence…</p>
      </section>
    )
  if (!insights)
    return (
      <section className="app-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-secondary">{error || 'Learning objectives couldn’t load.'}</p>
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </section>
    )

  return (
    <section className="app-surface overflow-hidden">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-ink-muted">Learning objectives</p>
            <h2 className="mt-1 text-lg font-bold text-ink">Progress on each objective</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Rubric ratings and graded work can show an objective is met. Checkpoint answers alone count as developing.
              Completed lessons and watch time don’t count.
            </p>
          </div>
          <Link
            to={cohortPath(cohortId, 'insights')}
            className="app-link inline-flex min-h-11 items-center gap-1 text-sm"
          >
            Whole cohort <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
      <div className="divide-y divide-line">
        {insights.objectives.map((objective) => {
          const student = objective.students[0]
          return (
            <details
              key={objective.id}
              open={selectedObjectiveId === objective.id || student.status === 'needs_revision'}
              className="group scroll-mt-24"
            >
              <summary className="min-h-11 cursor-pointer list-none px-5 py-4 transition-colors duration-150 hover:bg-surface-sunken sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded-lg bg-surface-sunken px-2 py-1 font-mono text-xs font-semibold text-ink-secondary">
                        {objective.code}
                      </span>
                      <h3 className="text-base font-semibold text-ink">{objective.title}</h3>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">{objective.success_criteria}</p>
                  </div>
                  <EvidenceStatus status={student.status} />
                </div>
              </summary>
              <div className="border-t border-line bg-surface-sunken px-5 py-4 sm:px-6">
                {student.evidence.length ? (
                  <div className="grid gap-2">
                    {student.evidence.map((evidence) =>
                      evidence.submission_id ? (
                        <Link
                          key={evidence.id}
                          to={submissionPath(evidence.submission_id, {
                            cohortId,
                            userId: studentId,
                            returnTo: evidenceReturnTo,
                          })}
                          className={
                            'pressable grid min-h-14 gap-2 rounded-xl border border-line bg-surface-raised px-3 ' +
                            'py-2 hover:border-line-strong sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center'
                          }
                        >
                          <StudentEvidenceIcon kind={evidence.kind} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink">{evidence.label}</p>
                            <p className="text-xs tabular-nums text-ink-muted">
                              {humanize(evidence.kind, EVIDENCE_KIND_LABELS)} · {evidence.value} ·{' '}
                              {formatShortDateTime(evidence.occurred_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {evidence.github_checks?.failed ? (
                              <Badge tone="danger">
                                {evidence.github_checks.failed} failed check
                                {evidence.github_checks.failed === 1 ? '' : 's'}
                              </Badge>
                            ) : null}
                            <ArrowRight className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                          </div>
                        </Link>
                      ) : (
                        <div
                          key={evidence.id}
                          className={
                            'grid min-h-14 gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 ' +
                            'sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center'
                          }
                        >
                          <StudentEvidenceIcon kind={evidence.kind} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink">{evidence.label}</p>
                            <p className="text-xs tabular-nums text-ink-muted">
                              {evidence.value} · {evidence.attempt_count} attempt
                              {evidence.attempt_count === 1 ? '' : 's'} · {formatShortDateTime(evidence.occurred_at)}
                            </p>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">
                    No rubric ratings, graded work or checkpoint answers for this objective yet.
                  </p>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}

export function EvidenceStatus({ status }: { status: LearningEvidenceStatus }) {
  const labels = {
    demonstrated: 'Demonstrated',
    developing: 'Developing',
    needs_revision: 'Needs revision',
    not_evidenced: 'Not evidenced',
  }
  const tones: Record<LearningEvidenceStatus, BadgeTone> = {
    demonstrated: 'success',
    developing: 'pending',
    needs_revision: 'warning',
    not_evidenced: 'neutral',
  }
  return <Badge tone={tones[status]}>{labels[status]}</Badge>
}

export function StudentEvidenceIcon({ kind }: { kind: string }) {
  const Icon = kind === 'knowledge_check' ? CircleDashed : kind === 'rubric_criterion' ? Target : GitBranch
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  )
}
