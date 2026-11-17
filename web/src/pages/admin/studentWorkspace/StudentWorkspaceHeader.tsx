import { AlertTriangle, ExternalLink, FileCheck2, MessageSquareText } from 'lucide-react'
import { StartFollowUpPlan } from '../../../components/admin/StartFollowUpPlan'
import { RecordHeader, staffBreadcrumb } from '../../../components/shared/RecordHeader'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Avatar } from '../../../components/ui/Avatar'
import { Badge } from '../../../components/ui/Badge'
import { Button, LinkButton } from '../../../components/ui/Button'
import { formatShortDateTime } from '../../../lib/format'
import { humanize } from '../../../lib/glossary'
import { queuePositionLabel } from '../../../lib/recordQueue'
import { cohortPath, cohortStudentPath, cohortStudentViewPath } from '../../../lib/routes'
import type { CohortDetail, StudentProgressResponse } from '../../../types/api'
import { StatusBadge } from './presentation'
import { StudentStepper } from './StudentStepper'
import type { useStudentWorkspace } from './useStudentWorkspace'

export function StudentWorkspaceHeader({
  workspace,
}: {
  workspace: ReturnType<typeof useStudentWorkspace> & { progress: StudentProgressResponse; cohort: CohortDetail }
}) {
  const {
    cohortId,
    studentId,
    activeTab,
    navigate,
    back,
    returnState,
    rosterStep,
    goToRosterEntry,
    openingMessage,
    location,
    openDirectMessage,
    progress,
    cohort,
  } = workspace
  const studentIndex = cohort.students.findIndex((student) => student.user_id === studentId)
  const previousStudent = studentIndex > 0 ? cohort.students[studentIndex - 1] : null
  const nextStudent =
    studentIndex >= 0 && studentIndex < cohort.students.length - 1 ? cohort.students[studentIndex + 1] : null

  const ungraded = progress.status?.ungraded_count
  const nextReview = progress.status?.next_review_submission_id
  const currentPath = `${location.pathname}${location.search}`
  return (
    <>
      <RecordHeader
        back={back}
        breadcrumb={staffBreadcrumb({
          cohort: { label: cohort.name, to: cohortPath(cohortId) },
          record: progress.user.full_name,
        })}
        type={<>Student · {cohort.curriculum_name}</>}
        queue={
          rosterStep
            ? {
                position: queuePositionLabel(rosterStep),
                onPrevious: rosterStep.previous ? () => goToRosterEntry(rosterStep.previous!) : undefined,
                onNext: rosterStep.next ? () => goToRosterEntry(rosterStep.next!) : undefined,
                previousLabel: 'Previous student',
                nextLabel: 'Next student',
                direction: 'horizontal',
              }
            : undefined
        }
        leading={<Avatar name={progress.user.full_name} src={progress.user.avatar_url} size="lg" />}
        title={progress.user.full_name}
        titleText={progress.user.full_name}
        status={
          <>
            {progress.status && progress.enrollment.status === 'active' ? (
              <Badge tone={progress.status.needs_attention ? 'warning' : 'success'}>{progress.status.label}</Badge>
            ) : (
              <StatusBadge status={progress.enrollment.status} />
            )}
          </>
        }
        context={
          <>
            <span className="max-w-full truncate" title={progress.user.email}>
              {progress.user.email}
            </span>
            <span aria-hidden="true">·</span>
            <RecordLink
              record={{ type: 'cohort', id: cohortId }}
              variant="plain"
              touchTarget
              className="font-normal text-ink-muted"
            >
              {cohort.name}
            </RecordLink>
            {'last_active_at' in progress.user && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {progress.user.last_active_at
                    ? `Last active ${formatShortDateTime(progress.user.last_active_at)}`
                    : 'No learning activity yet'}
                </span>
              </>
            )}
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              onClick={() => void openDirectMessage()}
              disabled={openingMessage || progress.can_message === false}
            >
              <MessageSquareText className="h-4 w-4" aria-hidden="true" />
              {openingMessage ? 'Opening…' : 'Message'}
            </Button>
            {nextReview && (
              <LinkButton
                size="sm"
                to={
                  '/admin/grading?' +
                  new URLSearchParams({
                    cohort_id: String(cohortId),
                    student_id: String(studentId),
                    submission: String(nextReview),
                    return_to: currentPath,
                  })
                }
                variant="secondary"
              >
                <FileCheck2 className="h-4 w-4" aria-hidden="true" />
                Grade next ({ungraded})
              </LinkButton>
            )}
            <StartFollowUpPlan
              activePlanId={progress.status?.active_intervention_id}
              enrollmentId={progress.enrollment.id}
              studentName={progress.user.full_name}
              returnTo={currentPath}
            />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <LinkButton size="sm" to={cohortStudentViewPath(cohortId, studentId)} variant="quiet">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            View as student
          </LinkButton>
          {(progress.enrollments?.length || 0) > 1 && (
            <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-ink-secondary">
              Enrollment
              <select
                aria-label="Switch student enrollment"
                className="app-control max-w-full"
                value={cohortId}
                onChange={(event) =>
                  navigate(cohortStudentPath(Number(event.target.value), studentId, activeTab), {
                    state: returnState,
                  })
                }
              >
                {progress.enrollments!.map((enrollment) => (
                  <option key={enrollment.id} value={enrollment.cohort_id}>
                    {enrollment.cohort_name} · {humanize(enrollment.status)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </RecordHeader>
      {progress.status?.needs_attention && (
        <section
          role="note"
          aria-labelledby="why-flagged"
          className="flex gap-3 rounded-2xl border border-warning-line bg-warning-soft p-4 sm:p-5"
        >
          <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-warning-ink" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="why-flagged" className="font-bold text-warning-ink">
              Why flagged
            </h2>
            <p className="mt-1 text-sm font-semibold text-ink">{progress.status.label}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-secondary">
              {progress.status.reasons.map((reason) => (
                <li key={reason.code}>{reason.label}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <section className="app-surface overflow-hidden">
        <div className="grid items-center gap-2 bg-surface-sunken px-4 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_minmax(0,1fr)] sm:px-6">
          <StudentStepper
            direction="previous"
            student={previousStudent}
            cohortId={cohortId}
            tab={activeTab}
            state={returnState}
          />
          <label className="grid gap-1 text-center text-xs font-semibold tabular-nums text-ink-muted">
            <span>
              {studentIndex >= 0 ? `Student ${studentIndex + 1} of ${cohort.students.length}` : 'Historical enrollment'}
            </span>
            <select
              aria-label={`Switch student in ${cohort.name}`}
              value={studentId}
              onChange={(event) =>
                navigate(cohortStudentPath(cohortId, Number(event.target.value), activeTab), { state: returnState })
              }
              className="app-control w-full font-semibold"
            >
              {cohort.students.map((student) => (
                <option key={student.enrollment_id} value={student.user_id}>
                  {student.full_name || student.email}
                </option>
              ))}
            </select>
          </label>
          <StudentStepper
            direction="next"
            student={nextStudent}
            cohortId={cohortId}
            tab={activeTab}
            state={returnState}
          />
        </div>
      </section>
    </>
  )
}
