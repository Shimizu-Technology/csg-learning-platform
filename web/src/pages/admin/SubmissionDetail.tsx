import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, MessageSquareText, UserRound } from 'lucide-react'
import { api } from '../../lib/api'
import {
  cohortStudentPath,
  directMessagePath,
  safeInternalReturnPath,
  submissionPath,
} from '../../lib/routes'
import { orderSubmissionQueue, type SubmissionQueueFilter } from '../../lib/submissionQueue'
import { RESTORE_LIST_STATE } from '../../lib/navigationContext'
import { Button } from '../../components/ui/Button'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import {
  SubmissionReviewPanel,
  type SubmissionReviewHandle,
} from '../../components/admin/SubmissionReviewPanel'
import { useToast } from '../../contexts/ToastContext'
import type { Submission } from '../../types/api'

export function SubmissionDetail() {
  const { id } = useParams<{ id: string }>()
  // Key the whole record so navigation cannot retain another learner's context or draft.
  return <SubmissionRecord key={id} submissionId={Number(id)} />
}
function SubmissionRecord({ submissionId }: { submissionId: number }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const panel = useRef<SubmissionReviewHandle>(null)
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [context, setContext] = useState<{ cohortId: number; name: string } | null>(null)
  const [showContext, setShowContext] = useState(false)
  const [openingMessage, setOpeningMessage] = useState(false)
  const [queue, setQueue] = useState<Submission[]>([])
  const [queueError, setQueueError] = useState<string | null>(null)
  const requestedCohort = Number(params.get('cohort_id')) || null
  const requestedStudent = Number(params.get('student_id')) || null
  const queueMode = (['ungraded', 'redo', 'all'] as const).includes(
    params.get('queue') as SubmissionQueueFilter,
  )
    ? (params.get('queue') as SubmissionQueueFilter)
    : undefined
  const queueCohortId = Number(params.get('queue_cohort_id')) || undefined
  useEffect(() => {
    let cancelled = false
    setContext(null)
    if (
      submission &&
      requestedCohort &&
      (!requestedStudent || requestedStudent === submission.user_id)
    ) {
      void api.getStudentProgress(submission.user_id, requestedCohort).then((result) => {
        if (
          cancelled ||
          !result.data ||
          result.error ||
          result.fromCache ||
          (result.data.cohort.id !== submission.cohort_id && submission.cohort_id != null)
        )
          return
        const blocks = result.data.modules.flatMap((mod) =>
          mod.lessons.flatMap((lesson) => lesson.blocks.map((block) => block.id)),
        )
        if (blocks.includes(submission.content_block_id))
          setContext({ cohortId: requestedCohort, name: result.data.cohort.name })
      })
    }
    return () => {
      cancelled = true
    }
  }, [
    requestedCohort,
    requestedStudent,
    submission?.user_id,
    submission?.content_block_id,
    submission?.cohort_id,
  ])
  useEffect(() => {
    let cancelled = false
    if (queueMode)
      void api
        .getSubmissions(queueCohortId ? { cohort_id: String(queueCohortId) } : undefined)
        .then((result) => {
          if (cancelled) return
          if (!result.data || result.error || result.fromCache)
            setQueueError(result.error || 'Queue unavailable. Return to the list to retry.')
          else setQueue(orderSubmissionQueue(result.data.submissions, queueMode))
        })
    return () => {
      cancelled = true
    }
  }, [queueMode, queueCohortId])
  const studentPath =
    context && submission
      ? cohortStudentPath(context.cohortId, submission.user_id, 'work')
      : '/admin/grading'
  const returnTo = safeInternalReturnPath(params.get('return_to'), studentPath)
  const navigationContext = {
    cohortId: context?.cohortId,
    userId: submission?.user_id,
    returnTo,
    queue: queueMode,
    queueCohortId,
  }
  const index = queue.findIndex((item) => item.id === submissionId)
  const previousId = queue[index - 1]?.id
  const nextId = index >= 0 ? queue[index + 1]?.id : undefined
  function goToQueueItem(targetId: number) {
    const target = queue.find((item) => item.id === targetId)
    if (!target) return
    navigate(
      submissionPath(target.id, {
        returnTo,
        queue: queueMode,
        queueCohortId,
        cohortId: target.cohort_id || queueCohortId,
        userId: target.user_id,
      }),
    )
  }
  async function openMessage() {
    if (!submission || !context || (panel.current && !(await panel.current.confirmLeave()))) return
    setOpeningMessage(true)
    const result = await api.createDirectConversation({
      cohort_id: context.cohortId,
      user_ids: [submission.user_id],
    })
    setOpeningMessage(false)
    if (result.data)
      navigate(
        directMessagePath(result.data.direct_conversation.id, {
          type: 'submission',
          id: submission.id,
          label: submission.content_block_title,
        }),
      )
    else toast.error(result.error || 'Could not open a direct message.')
  }
  return (
    <div className="app-page-wide space-y-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-3">
        <Link
          to={returnTo}
          state={RESTORE_LIST_STATE}
          className="app-link inline-flex min-h-11 items-center gap-1"
          onClick={async (event) => {
            event.preventDefault()
            if (!panel.current || (await panel.current.confirmLeave()))
              navigate(returnTo, { state: RESTORE_LIST_STATE })
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        {context && submission && (
          <Link className="app-link inline-flex min-h-11 items-center" to={studentPath}>
            Workspace: {context.name} · {submission.user_name}
          </Link>
        )}
      </nav>
      {context && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setShowContext(true)}>
            <UserRound className="h-4 w-4" />
            Student context
          </Button>
          <Button variant="secondary" onClick={() => void openMessage()} disabled={openingMessage}>
            <MessageSquareText className="h-4 w-4" />
            {openingMessage ? 'Opening…' : `Message in ${context.name}`}
          </Button>
        </div>
      )}
      {queueError && <p role="alert">{queueError}</p>}
      <div className="app-surface p-4 sm:p-6">
        <SubmissionReviewPanel
          showRecordLink={false}
          ref={panel}
          submissionId={submissionId}
          navigationContext={navigationContext}
          active={!showContext}
          onLoaded={setSubmission}
          previousId={previousId}
          nextId={nextId}
          position={index >= 0 ? `${index + 1} of ${queue.length}` : undefined}
          onNavigate={queueMode ? goToQueueItem : undefined}
          onSaved={() => {
            if (queueMode === 'ungraded' && nextId) goToQueueItem(nextId)
          }}
        />
      </div>
      {context && submission && (
        <StudentContextDrawer
          open={showContext}
          cohortId={context.cohortId}
          studentId={submission.user_id}
          source={{ type: 'submission', id: submission.id, label: submission.content_block_title }}
          onClose={() => setShowContext(false)}
        />
      )}
    </div>
  )
}
