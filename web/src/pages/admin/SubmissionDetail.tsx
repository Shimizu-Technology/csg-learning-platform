import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ReturnOrigin } from '../../contexts/PreviewNavigationContext'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { MessageSquareText, UserRound } from 'lucide-react'
import { api } from '../../lib/api'
import {
  cohortPath,
  cohortStudentPath,
  directMessagePath,
  submissionPath,
} from '../../lib/routes'
import { moduleReviewQueue, orderSubmissionQueue, withFreshSubmission, type SubmissionQueueFilter } from '../../lib/submissionQueue'
import { RESTORE_LIST_STATE } from '../../lib/navigationContext'
import { useBackLink } from '../../lib/recordOrigin'
import { moduleQueueSource, queuePositionLabel, queueStep, retargetReturnPath, scrollToRecordTop } from '../../lib/recordQueue'
import { relatedRows, useRecordRelated } from '../../lib/recordRelated'
import { useRecordViewer } from '../../lib/useRecordPath'
import { useRecordQueue } from '../../lib/useRecordQueue'
import { formatShortDateTime } from '../../lib/format'
import { Button, LinkButton } from '../../components/ui/Button'
import { RecordHeader, staffBreadcrumb } from '../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../components/shared/RelatedPanel'
import { RecordLink } from '../../components/shared/RecordLink'
import { SubmissionStatus } from '../../components/shared/SubmissionStatus'
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
  const [queueFinished, setQueueFinished] = useState(false)
  // The end of the queue: the completion notice takes focus. (Moving on focuses the next review panel.)
  const finishedNotice = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (queueFinished) finishedNotice.current?.focus({ preventScroll: true })
  }, [queueFinished])
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
  const related = useRecordRelated('submission', submissionId)
  const relatedCohort = related.related?.context.cohort
  const viewer = useRecordViewer()
  const location = useLocation()
  const studentPath =
    context && submission
      ? cohortStudentPath(context.cohortId, submission.user_id, 'work')
      : '/admin/grading'
  // Back names where the review was opened from (router state, or a validated return_to);
  // with neither it goes to the learner's work, or the grading inbox.
  const back = useBackLink({ returnTo: studentPath, returnLabel: context ? 'Student workspace' : 'Grading inbox' })
  const returnTo = back.to
  // A record opened from a module grading page walks that page's queue, read from its URL (L-0.7).
  const moduleSource = !queueMode && !back.fallback ? moduleQueueSource(back.to) : null
  // Shared by viewer and source, and briefly remembered, so stepping through the queue fetches it
  // once; leaving aborts a request still in flight, and grading invalidates it (recordQueueCache).
  const queueSource = moduleSource
    ? `module:${moduleSource.cohortId}:${moduleSource.moduleId}`
    : queueMode
      ? `submissions:${queueCohortId ?? ''}`
      : null
  const queueLoad = useRecordQueue<Submission[]>(queueSource, async (signal) => {
    // Fetched with the viewer's own access: a queue for a cohort they can't see is simply unavailable.
    const result = moduleSource
      ? await api.getCohortModuleSubmissions(moduleSource.cohortId, moduleSource.moduleId, signal)
      : await api.getSubmissions(queueCohortId ? { cohort_id: String(queueCohortId) } : undefined, signal)
    const items = result.data?.submissions as Submission[] | undefined
    return items && !result.error && !result.fromCache
      ? { status: 'ready', items }
      : { status: 'error', error: result.error || 'Queue unavailable. Return to the list to retry.' }
  }, {
    // Graded (or resubmitted) elsewhere since the queue was fetched: fetch it again.
    staleToken: (items) => (withFreshSubmission(items, submission) && submission ? `${submission.id}:${submission.grade}:${submission.latest_submission_id}` : null),
  })
  const moduleKey = moduleSource ? JSON.stringify(moduleSource) : ''
  const queue = useMemo(() => {
    if (queueLoad?.status !== 'ready') return null
    // Until the refetch lands, the fresh record's own state decides whether it is still in the queue.
    const items = withFreshSubmission(queueLoad.items, submission) ?? queueLoad.items
    const source = moduleKey ? (JSON.parse(moduleKey) as NonNullable<typeof moduleSource>) : null
    return source ? moduleReviewQueue(items, source) : queueMode ? orderSubmissionQueue(items, queueMode) : null
  }, [queueLoad, moduleKey, queueMode, submission])
  const queueError = queueLoad?.status === 'error' ? queueLoad.error : null
  const navigationContext = {
    cohortId: context?.cohortId,
    userId: submission?.user_id,
    returnTo,
    queue: queueMode,
    queueCohortId,
  }
  const step = queue ? queueStep(queue, (item) => item.id === submissionId) : null
  const index = step?.index ?? -1
  const previousId = step?.previous?.id
  // When this submission left the queue (graded by someone else), Next opens the first one still waiting.
  const nextId = step?.next?.id
  function goToQueueItem(targetId: number) {
    const target = queue?.find((item) => item.id === targetId)
    if (!target) return
    // Back to the list then lands on the item you were last on.
    const nextReturn = back.fallback ? undefined : retargetReturnPath(returnTo, target)
    navigate(
      submissionPath(target.id, {
        returnTo: nextReturn,
        queue: queueMode,
        queueCohortId,
        cohortId: target.cohort_id || moduleSource?.cohortId || queueCohortId,
        userId: target.user_id,
      }),
      // Keep a router-state origin (and its label) for the next record.
      { state: back.fallback ? undefined : { returnTo: nextReturn, returnLabel: back.label.replace(/^Back to /, '') } },
    )
    scrollToRecordTop()
  }
  function advanceAfterSave(saved: Submission) {
    if (!queue) return
    // Save and next (L-0.7). A filtered queue drops finished work, so when this was the last
    // item the one before it is still waiting; "All" has nothing left after its last item.
    const filtered = (queueMode && queueMode !== 'all') || (moduleSource?.view === 'queue' && moduleSource.filter !== 'all')
    const keepsSaved = saved.grade === 'R' && (queueMode === 'redo' || (moduleSource?.view === 'queue' && moduleSource.filter === 'redo'))
    const following = step?.next ?? (index >= 0 && filtered && !keepsSaved ? step?.previous : null)
    if (following) goToQueueItem(following.id)
    else {
      setQueueFinished(true)
      scrollToRecordTop()
    }
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
          returnTo,
        }),
      )
    else {
      // Still here with the draft: keep asking before it is discarded.
      panel.current?.keepGuarding()
      toast.error(result.error || 'Could not open a direct message.')
    }
  }
  // Links out of the review ask about unsaved feedback first; ⌘/Ctrl-clicks open a new tab as usual.
  const leave = (fixedState?: unknown) => async (event: MouseEvent<HTMLAnchorElement>, to: string, linkState?: unknown) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const state = fixedState ?? linkState
    if (!panel.current || (await panel.current.confirmLeave())) navigate(to, state ? { state } : undefined)
  }
  const guardedBack = leave(RESTORE_LIST_STATE)
  const guardedNavigate = leave()
  const guardedStep = (targetId: number | undefined) =>
    targetId ? async () => { if (!panel.current || (await panel.current.confirmLeave())) goToQueueItem(targetId) } : undefined
  const cohortId = context?.cohortId ?? submission?.cohort_id ?? relatedCohort?.id
  const cohortName = context?.name ?? relatedCohort?.name
  const rows = related.related
    ? relatedRows(related.related, {
        viewer,
        returnTo: `${location.pathname}${location.search}`,
        actions: { message: context ? () => void openMessage() : undefined, scrollTo: scrollToSection },
      })
    : []
  return (
    <ReturnOrigin label={`Submission #${submissionId}`}><div className="app-page-wide space-y-6">
      <RecordHeader
        back={back}
        onBack={guardedBack}
        breadcrumb={submission ? staffBreadcrumb({
          cohort: cohortName && cohortId ? { label: cohortName, to: cohortPath(cohortId) } : null,
          student: { label: submission.user_name, to: cohortId ? cohortStudentPath(cohortId, submission.user_id) : null },
          record: submission.lesson_title,
        }) : []}
        type={<span className="tabular-nums">Submission #{submissionId}{submission ? ` · attempt ${submission.num_submissions}` : ''}</span>}
        title={submission?.lesson_title || 'Submission'}
        status={submission ? <SubmissionStatus grade={submission.grade} /> : null}
        context={submission ? <>
          <RecordLink record={{ type: 'student', id: submission.user_id, cohortId }} variant="plain" touchTarget onClick={(event, path) => void guardedNavigate(event, path)}>{submission.user_name}</RecordLink>
          <span aria-hidden="true">·</span>
          <span>{submission.content_block_title}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">submitted {formatShortDateTime(submission.created_at)}</span>
        </> : null}
        queue={step ? {
          position: queuePositionLabel(step),
          onPrevious: guardedStep(previousId),
          onNext: guardedStep(nextId),
          previousLabel: 'Previous submission',
          nextLabel: 'Next submission',
        } : undefined}
        actions={context ? <>
          <Button variant="secondary" size="sm" onClick={() => setShowContext(true)}>
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Student context
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void openMessage()} disabled={openingMessage} className="max-w-full">
            <MessageSquareText className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{openingMessage ? 'Opening…' : `Message in ${context.name}`}</span>
          </Button>
        </> : null}
      />
      {queueError && <p role="alert">{queueError}</p>}
      {queueFinished && (
        <div ref={finishedNotice} tabIndex={-1} role="status" className="app-surface flex flex-wrap items-center justify-between gap-3 p-4 focus:outline-none">
          <p className="text-sm font-semibold text-ink">That was the last submission in this queue.</p>
          <LinkButton to={back.to} state={RESTORE_LIST_STATE} onClick={(event) => void guardedBack(event, back.to)} variant="secondary" size="sm">{back.label}</LinkButton>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="app-surface min-w-0 p-4 sm:p-6">
          <SubmissionReviewPanel
            showRecordLink={false}
            showHeader={false}
            ref={panel}
            submissionId={submissionId}
            navigationContext={navigationContext}
            active={!showContext}
            onLoaded={setSubmission}
            previousId={previousId}
            nextId={nextId}
            position={step ? queuePositionLabel(step) : undefined}
            onNavigate={step ? goToQueueItem : undefined}
            onSaved={advanceAfterSave}
          />
        </div>
        <RelatedPanel rows={rows} loading={related.loading} error={related.error} onRetry={related.retry} returnLabel={`Submission #${submissionId}`} onNavigate={(event, to, state) => void guardedNavigate(event, to, state)} className="lg:sticky lg:top-20" />
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
    </div></ReturnOrigin>
  )
}
