import { NoAccess } from '../../components/shared/NoAccess'
import { activityReturnPath, learnerPaths, recordPath } from '../../lib/routes'
import { useBackLink } from '../../lib/recordOrigin'
import { relatedRows, useRecordRelated } from '../../lib/recordRelated'
import { RecordHeader, learnerBreadcrumb } from '../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../components/shared/RelatedPanel'
import { RESTORE_LIST_STATE } from '../../lib/navigationContext'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronDown, Lock, RotateCcw } from 'lucide-react'
import { api } from '../../lib/api'
import { loadFailureMessage, unavailableResponse } from '../../lib/loadFailure'
import { ContentBlockRenderer } from '../../components/shared/ContentBlockRenderer'
import { RubricPanel } from '../../components/shared/RubricPanel'
import { CourseSupport } from '../../components/student/CourseSupport'
import { ContextualHelp } from '../../components/student/ContextualHelp'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { formatShortDateTime } from '../../lib/format'
import { captureProductEvent } from '../../lib/analytics'
import type { HelpRequest, LessonDetail as LessonData } from '../../types/api'
import { LearningObjectivesPanel } from '../../components/shared/LearningObjectivesPanel'
import { Badge } from '../../components/ui/Badge'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { isGradableWorkBlock } from '../../lib/learningStatus'
import { Button, LinkButton, buttonClasses } from '../../components/ui/Button'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { lessonReturnUrl } from '../../lib/hafaStarterLinks'

const LESSON_TYPE_LABELS: Record<string, string> = {
  video: 'Video lesson',
  exercise: 'Exercise',
  reading: 'Reading',
  project: 'Project',
  checkpoint: 'Checkpoint',
}

/** Learners never see an empty video placeholder: a video block with no video and no text is hidden. */
export function isEmptyMediaBlock(block: { block_type: string; video_url?: string | null; s3_video_key?: string | null; body?: string | null }) {
  return (block.block_type === 'video' || block.block_type === 'recording') && !block.video_url && !block.s3_video_key && !block.body?.trim()
}

function scrollToBlock(blockId: number) {
  const target = document.getElementById(`block-${blockId}`)
  if (!target) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  target.focus({ preventScroll: true })
}


export function LessonView() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const activityReturn = activityReturnPath(new URLSearchParams(location.search).get('return_to'))
  const [lesson, setLesson] = useState<LessonData | null>(null)
  const [loadedCohortId, setLoadedCohortId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [noAccess, setNoAccess] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savedData, setSavedData] = useState(false)
  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([])
  const [helpRequestsLoading, setHelpRequestsLoading] = useState(true)
  const { user } = useAuthContext()
  const { selectedCohortId, cohorts } = useCohortContext()
  // Staff lesson payloads may omit cohort_id; the cohort the page was opened in scopes the header and counts.
  const headerCohortId = lesson?.cohort_id ?? (user?.is_staff ? selectedCohortId : null) ?? null
  const related = useRecordRelated('lesson', lesson?.id, { cohortId: headerCohortId })
  const relatedContext = related.related?.id === lesson?.id ? related.related?.context : undefined
  const moduleName = relatedContext?.module?.name
  // A lesson honours only Activity as a return_to path; other origins (Today, Learn) come as router state.
  const back = useBackLink(
    lesson ? { returnTo: learnerPaths(lesson.cohort_id).module(lesson.module_id), returnLabel: moduleName || 'module' } : { returnTo: `/materials${selectedCohortId ? `?cohort_id=${selectedCohortId}` : ''}`, returnLabel: 'Learn' },
    { accept: 'activity' },
  )
  useEffect(() => {
    if (!lesson || !user || !selectedCohortId || loadedCohortId !== selectedCohortId || lesson.id !== Number(id)) return
    try { localStorage.setItem(`csg-last-lesson:${user.id}:${selectedCohortId}`, String(lesson.id)) } catch { /* Storage may be unavailable. */ }
  }, [lesson, user, selectedCohortId, loadedCohortId, id])
  const navigate = useNavigate()
  // An id from before "Make a copy for this cohort" opened the cohort's copy:
  // show the copy's id in the address bar, keeping the #block- link.
  useEffect(() => {
    const moved = lesson?.moved_from
    if (!lesson || !moved || moved.lesson_id !== Number(id)) return
    const blockId = /^#block-(\d+)$/.exec(location.hash)?.[1]
    const hash = blockId ? `#block-${moved.block_ids[blockId] ?? blockId}` : location.hash
    navigate({ pathname: `/lessons/${lesson.id}`, search: location.search, hash }, { replace: true, state: location.state })
  }, [lesson, id, location.hash, location.search, location.state, navigate])
  const requestId = useRef(0)
  const isPhone = useMediaQuery('(max-width: 1023px)')
  const scrolledToHashRef = useRef<string | null>(null)
  const activeCohortId = useRef(selectedCohortId)
  activeCohortId.current = selectedCohortId

  const loadLesson = useCallback((options?: { silent?: boolean }) => {
    if (!id) return
    if (selectedCohortId !== activeCohortId.current) return
    const currentRequest = ++requestId.current
    setLoadError(null)
    setNoAccess(false)
    if (!options?.silent) setSavedData(false)
    if (!options?.silent) setLoading(true)
    if (!options?.silent) setLesson(null)
    if (!user?.is_staff && !selectedCohortId) {
      setLoading(false)
      return
    }
    api.getLesson(Number(id), selectedCohortId ?? undefined).then((res) => {
      if (currentRequest !== requestId.current) return
      setNoAccess(unavailableResponse(res))
      if (unavailableResponse(res) || res.errorKind === 'auth' || res.status === 401) {
        setLesson(null)
        setLoadError(loadFailureMessage('Lesson', res))
      } else if (res.data) {
        setLesson(res.data.lesson)
        setLoadedCohortId(selectedCohortId)
        setSavedData(Boolean(res.fromCache))
        setLoadError(res.fromCache ? 'Showing a saved lesson. Reconnect and retry to check current access and progress.' : null)
      } else {
        setSavedData(true)
        setLoadError(`${options?.silent ? 'Showing the last loaded lesson. ' : ''}${loadFailureMessage('Lesson', res)}`)
      }
    }).catch(() => {
      if (currentRequest !== requestId.current) return
      setSavedData(true)
      setLoadError(`${options?.silent ? 'Showing the last loaded lesson. ' : ''}${loadFailureMessage('Lesson', {})}`)
    }).finally(() => {
      if (currentRequest === requestId.current) setLoading(false)
    })
  }, [id, selectedCohortId, user?.is_staff])

  useEffect(() => {
    loadLesson()
    return () => { requestId.current += 1 }
  }, [loadLesson])

  const helpRequestId = useRef(0)
  const loadHelpRequests = useCallback(async () => {
    const request = ++helpRequestId.current
    if (!lesson?.cohort_id || user?.is_staff) {
      setHelpRequestsLoading(false)
      return
    }
    setHelpRequests([])
    setHelpRequestsLoading(true)
    try {
      const response = await api.getHelpRequests({ cohort_id: lesson.cohort_id })
      if (request === helpRequestId.current && response.data) setHelpRequests(response.data.help_requests)
    } finally {
      if (request === helpRequestId.current) setHelpRequestsLoading(false)
    }
  }, [lesson?.cohort_id, user?.is_staff])

  useEffect(() => { void loadHelpRequests().catch(() => {}); return () => { helpRequestId.current += 1 } }, [loadHelpRequests])

  useEffect(() => {
    if (!lesson) return
    captureProductEvent('learning_step_started', {
      module_id: lesson.module_id,
      lesson_id: lesson.id,
      block_type: 'lesson',
    })
  }, [lesson?.id, lesson?.module_id])

  // Arriving from "Read feedback and resubmit" (#redo) lands on the first redo block;
  // returning from Hafa Code (#block-<id>) lands on the block that opened the starter.
  useEffect(() => {
    const key = `${lesson?.id}:${lesson?.cohort_id}:${location.hash}`
    if (!lesson || scrolledToHashRef.current === key) return
    const hash = location.hash
    const blockId = /^#block-(\d+)$/.exec(hash)?.[1]
    const target = hash === '#redo'
      ? lesson.content_blocks.find((block: any) => block.submissions?.[0]?.grade === 'R')
      : blockId ? lesson.content_blocks.find((block: any) => String(block.id) === blockId) : null
    if (!target) return
    scrolledToHashRef.current = key
    requestAnimationFrame(() => scrollToBlock(target.id))
  }, [lesson, location.hash])

  if (noAccess) return <NoAccess />
  if (loading) return <LoadingSpinner message="Loading lesson..." />
  if (!lesson) return <div className="app-page max-w-3xl">
    <p role="alert" className="text-ink-secondary">{!user?.is_staff && !selectedCohortId ? 'Choose a cohort to view this lesson.' : loadError || 'Lesson unavailable in this cohort.'}</p>
    <Button variant="secondary" onClick={() => loadLesson()}>Try again</Button>
    <LinkButton variant="quiet" to={activityReturn || `/materials${selectedCohortId ? `?cohort_id=${selectedCohortId}` : ''}`} state={activityReturn ? RESTORE_LIST_STATE : undefined}>{activityReturn ? 'Back to activity' : 'Back to Learn'}</LinkButton>
  </div>

  const readOnly = !user?.is_staff && (savedData || lesson.capabilities?.read_only !== false || lesson.capabilities?.can_submit !== true)
  const supportCapabilities = savedData ? undefined : lesson.capabilities

  const visibleBlocks = user?.is_staff ? lesson.content_blocks : lesson.content_blocks.filter((block: any) => !isEmptyMediaBlock(block))
  // Only reviewed work can need a redo; an imported Redo elsewhere is past feedback.
  const redoBlocks = visibleBlocks.filter((block: any) => block.submissions?.[0]?.grade === 'R' && isGradableWorkBlock(block))
  // Where this lesson stands and the enrollment's next step, from the server (AS-10).
  const learnerStatus = !user?.is_staff && !savedData ? lesson.learner_status : undefined
  const upNext = learnerStatus && ['done', 'awaiting_review'].includes(learnerStatus) && lesson.next_step
    && lesson.next_step.id !== lesson.id && lesson.next_step.id !== lesson.next_lesson?.id ? lesson.next_step : null
  const cohortQuery = lesson.cohort_id ? `?cohort_id=${lesson.cohort_id}` : ''
  const paths = learnerPaths(lesson.cohort_id)
  const typeLabel = LESSON_TYPE_LABELS[lesson.lesson_type] || 'Lesson'
  const objectives = lesson.objectives || []
  const activeObjectiveCount = objectives.filter((objective) => objective.active).length
  const cohortName = (headerCohortId ? cohorts?.find((cohort) => cohort.id === headerCohortId)?.name : undefined) || relatedContext?.cohort?.name
  const rows = related.related && related.related.id === lesson.id
    ? relatedRows(related.related, { viewer: user, returnTo: `${location.pathname}${location.search}`, learnerLesson: (lessonId, anchor) => paths.lesson(lessonId, anchor), actions: { scrollTo: scrollToSection } })
    : []

  return (
    <article className="app-page max-w-3xl">
      {loadError && <div role="alert" className="rounded-2xl border border-warning-line bg-warning-soft p-4 text-sm text-warning-ink"><p>{loadError}</p><Button variant="secondary" size="sm" onClick={() => loadLesson({ silent: true })}>Try again</Button></div>}
      {!user?.is_staff && lesson.capabilities?.read_only && <p className="rounded-2xl border border-line bg-surface-sunken p-4 font-semibold text-ink">Past course · review only</p>}
      <RecordHeader
        back={back}
        breadcrumb={learnerBreadcrumb({
          cohort: cohortName && headerCohortId ? { label: cohortName, to: recordPath({ type: 'cohort', id: headerCohortId }, { viewer: user }) } : null,
          learn: `/materials${cohortQuery}`,
          module: { label: moduleName || 'Module', to: paths.module(lesson.module_id) },
          lesson: lesson.title,
        })}
        type={<>{typeLabel}{moduleName ? <> · {moduleName}</> : null}</>}
        title={lesson.title}
        status={lesson.required || learnerStatus ? <span className="flex flex-wrap items-center gap-2">{lesson.required && <Badge tone="neutral">Required</Badge>}{learnerStatus && <StatusBadge status={learnerStatus} />}</span> : null}
        actions={!user?.is_staff && lesson.cohort_id ? (
          <div id="help" tabIndex={-1} className="scroll-mt-24 outline-none">
            <ContextualHelp key={`${lesson.cohort_id}:lesson:${lesson.id}`} capabilities={supportCapabilities} contextPath={`${window.location.origin}/lessons/${lesson.id}${cohortQuery}`} cohortId={lesson.cohort_id} contextType="lesson" contextId={lesson.id} contextLabel={lesson.title} requests={helpRequests} requestsLoading={helpRequestsLoading} onRequestsChange={setHelpRequests} onRequestsRefresh={loadHelpRequests} />
          </div>
        ) : null}
      />

      {isPhone && activeObjectiveCount > 0 ? (
        <details className="group app-surface overflow-hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span>What success looks like <span className="font-normal tabular-nums text-ink-muted">({activeObjectiveCount})</span></span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted transition-transform duration-[180ms] group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="border-t border-line">
            <LearningObjectivesPanel objectives={objectives} />
          </div>
        </details>
      ) : (
        <LearningObjectivesPanel objectives={objectives} />
      )}

      {lesson.submission_window?.submissions_close_at && (
        <div className={`rounded-2xl border p-4 ${lesson.submission_window.submissions_closed ? 'border-line bg-surface-sunken' : 'border-warning-line bg-warning-soft'}`}>
          <div className="flex items-start gap-3">
            <Lock className={`mt-0.5 h-5 w-5 shrink-0 ${lesson.submission_window.submissions_closed ? 'text-ink-muted' : 'text-warning-ink'}`} aria-hidden="true" />
            <div>
              <h2 className={`text-sm font-semibold ${lesson.submission_window.submissions_closed ? 'text-ink' : 'text-warning-ink'}`}>
                {lesson.submission_window.submissions_closed ? `Week ${lesson.submission_window.week_number} submissions are closed` : `Week ${lesson.submission_window.week_number} submissions close soon`}
              </h2>
              <p className={`mt-1 text-sm ${lesson.submission_window.submissions_closed ? 'text-ink-secondary' : 'text-warning-ink'}`}>
                {lesson.submission_window.submissions_closed
                  ? `Submissions closed ${formatShortDateTime(lesson.submission_window.submissions_close_at)}. You can still review videos, readings, and feedback, but new work cannot be submitted.`
                  : `Submissions close ${formatShortDateTime(lesson.submission_window.submissions_close_at)}.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {redoBlocks.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-warning-line bg-warning-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <RotateCcw className="mt-0.5 h-5 w-5 shrink-0 text-warning-ink" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-warning-ink">Redo requested</h2>
              <p className="mt-0.5 text-sm text-warning-ink">
                {readOnly ? 'Review your previous feedback below.' : redoBlocks.length === 1 ? (redoBlocks[0].submission_type === 'prework_github_sync' ? 'Update your code on GitHub — your instructor will re-check it' : redoBlocks[0].submission_type === 'manual_complete' ? 'Read the feedback — your instructor will re-check this' : 'One exercise needs an updated submission.') : 'Read the feedback below for each exercise that needs attention.'}
              </p>
            </div>
          </div>
          <a
            href={`#block-${redoBlocks[0].id}`}
            onClick={(event) => { event.preventDefault(); scrollToBlock(redoBlocks[0].id) }}
            className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'shrink-0' })}
          >
            Go to the feedback
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      )}

      {/* Content blocks */}
      <div className="space-y-4">
        {visibleBlocks.map((block: any) => (
          <div key={block.id} id={`block-${block.id}`} tabIndex={-1} className={`scroll-mt-20 space-y-2 rounded-2xl outline-none ${location.hash === `#block-${block.id}` ? 'ring-2 ring-action-primary ring-offset-4' : ''}`}>
            <RubricPanel rubric={block.rubric} />
            <ContentBlockRenderer
              block={block}
              cohortId={lesson.cohort_id}
              isStaff={user?.is_staff}
              requiresGithub={lesson.requires_github}
              requiresSubmission={lesson.requires_submission}
              repositoryName={lesson.repository_name}
              readOnly={readOnly}
              submissionsLocked={lesson.submission_window?.submissions_closed || false}
              submissionsCloseAt={lesson.submission_window?.submissions_close_at || null}
              submissionWeekNumber={lesson.submission_window?.week_number}
              analyticsContext={{ moduleId: lesson.module_id, lessonId: lesson.id }}
              lessonReturn={{ url: lessonReturnUrl({ origin: window.location.origin, pathname: location.pathname, search: cohortQuery || location.search }, `block-${block.id}`), label: lesson.title }}
              onProgressUpdate={() => loadLesson({ silent: true })}
            />
            {!user?.is_staff && lesson.cohort_id && block.submission_type === 'manual_complete' && block.submissions?.[0]?.grade === 'R' && supportCapabilities?.support_mode === 'course_question' && <CourseSupport capabilities={supportCapabilities} cohortId={lesson.cohort_id} contextLabel={`${lesson.title} · feedback`} contextPath={`${window.location.origin}/lessons/${lesson.id}${cohortQuery}#block-${block.id}`} buttonLabel="Ask about this feedback" />}
            {!user?.is_staff && lesson.cohort_id && (['exercise', 'code_challenge'].includes(block.block_type) || block.submissions?.[0]?.grade === 'R') && (
              <div className="flex justify-end">
                <ContextualHelp key={`${lesson.cohort_id}:exercise:${block.id}`} capabilities={supportCapabilities} contextPath={`${window.location.origin}/lessons/${lesson.id}${cohortQuery}#block-${block.id}`} cohortId={lesson.cohort_id} contextType="exercise" contextId={block.id} contextLabel={block.title ? `${lesson.title} · ${block.title}` : lesson.title} requests={helpRequests} requestsLoading={helpRequestsLoading} onRequestsChange={setHelpRequests} onRequestsRefresh={loadHelpRequests} />
              </div>
            )}
          </div>
        ))}
      </div>

      <RelatedPanel rows={rows} loading={related.loading} error={related.error} onRetry={related.retry} returnLabel={lesson.title} />

      {upNext && (
        <LinkButton to={paths.lesson(upNext.id)} variant="quiet" className="max-w-full justify-start">
          <span className="truncate">Up next: {upNext.title}</span>
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </LinkButton>
      )}

      {/* Navigation: secondary actions; the work inside the lesson owns the primary action. */}
      <nav aria-label="Lesson navigation" className="flex items-center justify-between gap-3 border-t border-line pt-4">
        {lesson.prev_lesson ? (
          <LinkButton to={paths.lesson(lesson.prev_lesson.id)} variant="quiet" className="min-w-0 max-w-[48%]">
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden truncate sm:inline">{lesson.prev_lesson.title}</span>
            <span className="sm:hidden">Previous</span>
          </LinkButton>
        ) : (
          <div />
        )}
        {lesson.next_lesson ? (
          <LinkButton to={paths.lesson(lesson.next_lesson.id)} variant="secondary" className="min-w-0 max-w-[48%]">
            <span className="hidden truncate sm:inline">{lesson.next_lesson.title}</span>
            <span className="sm:hidden">Next</span>
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </LinkButton>
        ) : (
          <LinkButton to={back.to} state={RESTORE_LIST_STATE} variant="secondary" className="min-w-0 max-w-[48%]">
            <span className="truncate">{back.label}</span>
          </LinkButton>
        )}
      </nav>
    </article>
  )
}
