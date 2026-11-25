import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { useLocation, useNavigate } from 'react-router-dom'
import { urlParsers, useUrlState } from '../../lib/useUrlState'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Inbox,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Table2,
  UserRound,
  X,
} from 'lucide-react'
import { api } from '../../lib/api'
import { useStaffResource } from '../../lib/useStaffResource'
import { LoadError } from '../../components/shared/LoadError'
import {
  cohortModuleGradingPath,
  cohortPath,
  cohortStudentPath,
  directMessagePath,
  recordPath,
  submissionPath,
} from '../../lib/routes'
import { submissionWhereLabel } from '../../lib/submissionQueue'
import { useGradingQueue } from '../../lib/useGradingQueue'
import {
  queueContextLabel,
  waitingLabel,
  waitingSentence,
  waitingTooLong,
} from '../../lib/gradingQueue'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { SubmissionStatus } from '../../components/shared/SubmissionStatus'
import { Badge } from '../../components/ui/Badge'
import { Button, LinkButton } from '../../components/ui/Button'
import { FilterChip } from '../../components/ui/Choice'
import {
  gradeSuggestionQueueBadge,
  type SuggestionOutcomeFilter,
} from '../../lib/gradeSuggestion'
import { formatShortDateTime } from '../../lib/format'
import { gradeLabel } from '../../lib/glossary'
import { listLinkState, useListScrollMemory } from '../../lib/navigationContext'
import { originLabel, useBackLink } from '../../lib/recordOrigin'
import { relatedRows, useRecordRelated } from '../../lib/recordRelated'
import { useRecordViewer } from '../../lib/useRecordPath'
import { RowButton } from '../../components/ui/RowButton'
import {
  SubmissionReviewPanel,
  type SubmissionReviewHandle,
} from '../../components/admin/SubmissionReviewPanel'
import { PastReviewTargetBadge } from '../../components/admin/PastReviewTargetBadge'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import type { GradingQueueItem, Submission } from '../../types/api'
import { RecordLink } from '../../components/shared/RecordLink'
import { RecordHeader } from '../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../components/shared/RelatedPanel'
import { cohortScopeOptions, PageHeader, ScopeControl } from '../../components/ui/PageHeader'
import { useGuardedLinkClick } from '../../lib/useLeaveGuard'
import { useToast } from '../../contexts/ToastContext'

// The workbench's view lives in the URL (L-0.6, #251): scope, status, filters and order push
// history; the open review replaces it. A copied link or a reload restores the same queue.
const GRADING_URL = {
  cohort_id: urlParsers.id(),
  filter: urlParsers.oneOf(['ungraded', 'redo', 'all'] as const, 'ungraded'),
  module_id: urlParsers.id(),
  student_id: urlParsers.id(),
  lesson_id: urlParsers.id(),
  suggestion_outcome: urlParsers.oneOf(['all', 'suggest_b', 'review_for_redo', 'stale_evidence', 'no_suggestion'] as const, 'all'),
  sort: urlParsers.oneOf(['oldest', 'newest'] as const, 'oldest'),
  page: urlParsers.int(1, 99999, 1),
  submission: urlParsers.id(),
}

const SUGGESTION_FILTER_OPTIONS: ReadonlyArray<readonly [SuggestionOutcomeFilter, string]> = [
  ['all', 'All checks'],
  ['suggest_b', 'B suggested'],
  ['review_for_redo', 'Review for Redo'],
  ['stale_evidence', 'Out of date'],
  ['no_suggestion', 'No suggestion'],
]

type QueueFilter = 'ungraded' | 'redo' | 'all'
/** URL parameters the open review is keyed on: changing either replaces it. */
const SELECTION_PARAMS = ['submission', 'cohort_id']

interface CohortSummary {
  id: number
  name: string
  curriculum_name: string
}

type QueueItem = GradingQueueItem
/** A queue row, or the full submission once the review has loaded it. */
type ReviewRecord = GradingQueueItem | Submission

const SELECT_CLASSES =
  'app-control min-h-11 w-full min-w-0 truncate py-1.5 pr-8 text-sm lg:min-h-9'

export function Grading() {
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const back = useBackLink({ returnTo: '/admin/students', returnLabel: 'Students' }, { accept: 'any' })
  const hasOrigin = new URLSearchParams(location.search).has('return_to') && !back.fallback
  const viewer = useRecordViewer()
  const [urlState, setUrlState] = useUrlState(GRADING_URL)
  const cohortId = urlState.cohort_id ?? undefined
  const queueFilter: QueueFilter = urlState.filter
  // One page of the queue, filtered and counted on the server (GET /grading_queue).
  const {
    data: inbox,
    error: loadError,
    loading,
    reload: reloadQueue,
    dataIsCurrent,
  } = useGradingQueue(
    {
      cohort_id: cohortId ?? null,
      filter: queueFilter,
      module_id: urlState.module_id,
      student_id: urlState.student_id,
      lesson_id: urlState.lesson_id,
      suggestion_outcome: urlState.suggestion_outcome === 'all' ? null : urlState.suggestion_outcome,
      sort: urlState.sort,
      page: urlState.page,
    },
    urlState.submission,
    (page) => setUrlState({ page }, { history: 'replace' }),
  )
  const { data: cohortList } = useStaffResource<CohortSummary[]>('cohorts', async () => {
    const result = await api.getCohorts()
    return { data: result.data?.cohorts, error: result.error, fromCache: result.fromCache }
  })
  const cohorts = cohortList || []
  const filters = useMemo(
    () => ({
      filter: queueFilter,
      moduleId: urlState.module_id,
      studentId: urlState.student_id,
      lessonId: urlState.lesson_id,
      sort: urlState.sort,
    }),
    [queueFilter, urlState.module_id, urlState.student_id, urlState.lesson_id, urlState.sort],
  )
  const [syncing, setSyncing] = useState(false)
  const syncModuleIds = dataIsCurrent ? inbox?.github_sync_module_ids ?? [] : []
  const selectedId = urlState.submission
  const panel = useRef<SubmissionReviewHandle>(null)
  const reviewTop = useRef<HTMLElement>(null)
  const [loaded, setLoaded] = useState<Submission | null>(null)
  const [showContext, setShowContext] = useState(false)
  const [openingMessage, setOpeningMessage] = useState(false)
  // Links that leave the page ask about unsaved feedback in the open review first.
  const guardLeave = useGuardedLinkClick(() => panel.current?.confirmLeave())
  // Module grids opened from here come back to this list with its filter ("Grading · Redo").
  const here = `${location.pathname}${location.search}`
  const inboxOrigin = listLinkState(location, originLabel(here) || 'Grading')
  const queue: QueueItem[] = useMemo(() => inbox?.submissions || [], [inbox])
  const meta = inbox?.meta
  const counts = inbox?.counts || { ungraded: 0, redo: 0, all: 0 }
  const total = meta?.total_count ?? queue.length
  const offset = meta ? (meta.page - 1) * meta.per_page : 0
  const lessonFilterTitle = filters.lessonId ? inbox?.lesson?.title || 'This lesson' : null
  useListScrollMemory(!loading)
  const selectedIndex = queue.findIndex((item) => item.id === selectedId)
  // Previous and Next walk the whole list: past the page's edge they reach the next page's items.
  const previousInQueue = selectedIndex > 0 ? queue[selectedIndex - 1] : selectedIndex === 0 ? inbox?.previous ?? undefined : undefined
  const nextInQueue = selectedIndex >= 0 ? queue[selectedIndex + 1] ?? inbox?.next ?? undefined : queue[0]
  const queuePosition = selectedIndex >= 0 ? `${offset + selectedIndex + 1} of ${total}` : undefined
  const queueItem = queue.find((item) => item.id === selectedId) || null
  const current: ReviewRecord | null = loaded?.id === selectedId ? { ...queueItem, ...loaded } : queueItem
  const currentIsLatest = Boolean(current && (current.latest_submission_id == null || current.latest_submission_id === current.id))
  const reviewCohortId = current?.cohort_id ?? cohortId
  const reviewCohortName = current?.cohort_name || (reviewCohortId ? cohorts.find((cohort) => cohort.id === reviewCohortId)?.name : null) || null
  const related = useRecordRelated('submission', selectedId)
  const hasSuggestions = queue.some((item) => Boolean(item.grade_suggestion)) || urlState.suggestion_outcome !== 'all'
  const filtered = Boolean(filters.moduleId || filters.studentId || filters.lessonId || urlState.suggestion_outcome !== 'all')

  // Save and next swaps instantly and starts the next review at its top (spec §6, U-4.1).
  const showReviewTop = useCallback(() => {
    const element = reviewTop.current
    if (!element) return
    try {
      if (element.getBoundingClientRect().top < 0 || !window.matchMedia('(min-width: 1024px)').matches)
        element.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior })
    } catch {
      // jsdom: nothing to scroll.
    }
  }, [])
  useEffect(() => {
    if (!selectedId) return
    document.getElementById(`submission-row-${selectedId}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])

  function select(id: number) {
    setLoaded(null)
    setShowContext(false)
    setUrlState({ submission: id }, { history: 'replace' })
    requestAnimationFrame(showReviewTop)
    // Stepped past this page's edge: load the page that holds it.
    if (!queue.some((item) => item.id === id)) void reloadQueue(id)
  }
  async function leaveReview() {
    return !panel.current || (await panel.current.confirmLeave())
  }
  async function pickSubmission(submission: { id: number }) {
    if (submission.id === selectedId || !(await leaveReview())) return
    select(submission.id)
  }
  async function chooseView(patch: Partial<typeof urlState>) {
    if (!(await leaveReview())) return
    setUrlState({ page: 1, ...patch, submission: null })
  }
  // Where Save goes: the next item, or (a filtered list drops finished work) the one before it.
  // The panel's Save label reads this too, so it says "Save and next" only when that happens.
  const followingAfterSave = () => nextInQueue || (queueFilter === 'all' ? null : previousInQueue) || null
  function saved() {
    const following = followingAfterSave()
    if (following) {
      setLoaded(null)
      setShowContext(false)
      setUrlState({ submission: following.id }, { history: 'replace' })
      requestAnimationFrame(showReviewTop)
    } else setUrlState({ submission: null }, { history: 'replace' })
    // Refetch the page that now holds the next item (the graded one may have left the list).
    void reloadQueue(following?.id)
  }
  const loadSubmissions = () => reloadQueue(selectedId)
  async function syncGithub() {
    if (!cohortId || syncing || !syncModuleIds.length) return
    setSyncing(true)
    let synced = 0
    let firstError: string | undefined
    try {
      for (const moduleId of syncModuleIds) {
        try {
          const result = await api.syncCohortModuleGithub(cohortId, moduleId)
          if (result.error || !result.data) firstError ??= result.error || 'Could not sync this module.'
          else {
            synced += result.data.synced
            firstError ??= result.data.errors?.[0]
          }
        } catch (error) {
          firstError ??= error instanceof Error ? error.message : 'Could not sync this module.'
        }
      }
      const summary = `Synced ${synced} new submission${synced === 1 ? '' : 's'}`
      if (firstError) toast.error(`${synced ? `${summary}. ` : ''}GitHub sync incomplete. ${firstError}`)
      else toast.success(synced ? summary : 'Already up to date')
      await reloadQueue()
    } finally {
      setSyncing(false)
    }
  }
  const step = (target: QueueItem | undefined) =>
    target ? async () => { if (await leaveReview()) select(target.id) } : undefined
  // The list without its open review: where Back to queue goes on a phone.
  const queuePath = (() => {
    const params = new URLSearchParams(location.search)
    params.delete('submission')
    const query = params.toString()
    return `${location.pathname}${query ? `?${query}` : ''}`
  })()
  async function openMessage() {
    if (!current || !reviewCohortId || !(await leaveReview())) return
    setOpeningMessage(true)
    const result = await api.createDirectConversation({ cohort_id: reviewCohortId, user_ids: [current.user_id] })
    setOpeningMessage(false)
    if (result.data)
      navigate(directMessagePath(result.data.direct_conversation.id, {
        type: 'submission',
        id: current.id,
        label: current.content_block_title,
        returnTo: here,
      }))
    else {
      panel.current?.keepGuarding()
      toast.error(result.error || 'Could not open a direct message.')
    }
  }
  const guardedNavigate = async (event: MouseEvent<HTMLAnchorElement>, to: string, state?: unknown) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (await leaveReview()) navigate(to, state ? { state } : undefined)
  }
  const relatedPanelRows = related.related
    ? relatedRows(related.related, {
        viewer,
        returnTo: here,
        actions: { message: reviewCohortId ? () => void openMessage() : undefined, scrollTo: scrollToSection },
      })
    : []

  if (!inbox && (loading || !loadError)) return <LoadingSpinner message="Loading submissions..." />
  if (!inbox)
    return (
      <div className="app-page-wide">
        <LoadError
          error={loadError || 'Submissions unavailable.'}
          retry={() => void loadSubmissions()}
        />
      </div>
    )

  const cohortName = cohortId ? cohorts.find((cohort) => cohort.id === cohortId)?.name || 'this cohort' : null
  const options = {
    modules: inbox.modules.map((option) => ({ id: option.id, label: option.name, count: option.count })),
    students: inbox.students.map((option) => ({ id: option.id, label: option.name, count: option.count })),
  }
  const gridLinks = inbox.module_grids
  const submissionRecordPath = current
    ? submissionPath(current.id, {
        cohortId: reviewCohortId,
        userId: current.user_id,
        returnTo: here,
        queue: queueFilter,
        queueCohortId: cohortId,
      })
    : null

  return (
    <div className="app-page-wide">
      {hasOrigin && <Link to={back.to} onClick={event => guardLeave(event, back.to)} className="app-link mb-4 inline-flex min-h-11 items-center gap-1 text-sm"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{back.label}</Link>}
      {/* On a phone the open review is the whole screen; the list comes back with Back to queue. */}
      <div className={selectedId ? 'hidden lg:block' : undefined}>
        <PageHeader
          title="Grading"
          description={<>{counts.ungraded === 1 ? '1 attempt' : `${counts.ungraded} attempts`} waiting for review{cohortName ? <> in {cohortName}</> : ' across cohorts'} · {counts.redo} redo requested{counts.overdue ? <> · {counts.overdue} past review target</> : null}</>}
          scope={<ScopeControl value={cohortId ? String(cohortId) : ''} options={cohortScopeOptions(cohorts.some((cohort) => cohort.id === cohortId) || !cohortId ? cohorts : [...cohorts, { id: cohortId, name: cohortList ? 'Not one of your cohorts' : 'Loading cohort…' }])} onChange={(value) => void chooseView({ cohort_id: Number(value) || null, module_id: null, student_id: null, lesson_id: null, suggestion_outcome: 'all' })} />}
          actions={(cohortId && syncModuleIds.length > 0) || syncing ? (
            <Button variant="secondary" disabled={syncing || loading} onClick={() => void syncGithub()}>
              <RefreshCw className={`h-4 w-4 ${syncing ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
              {syncing ? 'Syncing…' : 'Sync GitHub'}
            </Button>
          ) : undefined}
          menu={[{ key: 'refresh', label: loading ? 'Refreshing…' : 'Refresh', icon: <RefreshCw aria-hidden="true" />, onSelect: () => void loadSubmissions() }]}
        />
      </div>

      {loadError && <LoadError error={loadError} stale retry={() => void loadSubmissions()} />}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] lg:items-start xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        {/* Queue: student, item, cohort and waiting time in one compact row (U-4.5). */}
        <section
          aria-label="Grading queue"
          className={`${selectedId ? 'hidden lg:flex' : 'flex'} app-surface min-w-0 flex-col overflow-hidden lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)]`}
        >
          <div className="space-y-3 border-b border-line p-3">
            <div role="group" aria-label="Submission queue" className="flex flex-wrap gap-2">
              <FilterChip selected={queueFilter === 'ungraded'} count={counts.ungraded} onClick={() => void chooseView({ filter: 'ungraded' })}>
                <Clock className="h-4 w-4" aria-hidden="true" />
                Waiting
              </FilterChip>
              <FilterChip selected={queueFilter === 'redo'} count={counts.redo} onClick={() => void chooseView({ filter: 'redo' })}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Redo
              </FilterChip>
              <FilterChip selected={queueFilter === 'all'} count={counts.all} onClick={() => void chooseView({ filter: 'all' })}>
                <Inbox className="h-4 w-4" aria-hidden="true" />
                All
              </FilterChip>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0">
                <span className="sr-only">Module</span>
                <select
                  className={SELECT_CLASSES}
                  value={filters.moduleId ? String(filters.moduleId) : ''}
                  onChange={(event) => void chooseView({ module_id: Number(event.target.value) || null })}
                >
                  <option value="">All modules</option>
                  {options.modules.map((option) => (
                    <option key={option.id} value={option.id}>{option.label} ({option.count})</option>
                  ))}
                </select>
              </label>
              <label className="min-w-0">
                <span className="sr-only">Student</span>
                <select
                  className={SELECT_CLASSES}
                  value={filters.studentId ? String(filters.studentId) : ''}
                  onChange={(event) => void chooseView({ student_id: Number(event.target.value) || null })}
                >
                  <option value="">All students</option>
                  {options.students.map((option) => (
                    <option key={option.id} value={option.id}>{option.label} ({option.count})</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button
                variant="quiet"
                size="sm"
                aria-label={filters.sort === 'oldest' ? 'Oldest first. Show newest first' : 'Newest first. Show oldest first'}
                onClick={() => void chooseView({ sort: filters.sort === 'oldest' ? 'newest' : 'oldest' })}
              >
                {filters.sort === 'oldest'
                  ? <ArrowDownWideNarrow className="h-4 w-4" aria-hidden="true" />
                  : <ArrowUpNarrowWide className="h-4 w-4" aria-hidden="true" />}
                {filters.sort === 'oldest' ? 'Oldest first' : 'Newest first'}
              </Button>
              {lessonFilterTitle && (
                <Button variant="secondary" size="sm" className="max-w-full" onClick={() => void chooseView({ lesson_id: null })} aria-label={`Lesson: ${lessonFilterTitle}. Remove this filter`}>
                  <span className="truncate">Lesson: {lessonFilterTitle}</span>
                  <X className="h-4 w-4 shrink-0" aria-hidden="true" />
                </Button>
              )}
              {filtered && !lessonFilterTitle && (
                <Button variant="quiet" size="sm" onClick={() => void chooseView({ module_id: null, student_id: null, lesson_id: null, suggestion_outcome: 'all' })}>
                  Clear filters
                </Button>
              )}
            </div>
            {hasSuggestions && (
              <div role="group" aria-label="Automated check filter" className="flex flex-wrap gap-1.5">
                {SUGGESTION_FILTER_OPTIONS.map(([value, label]) => (
                  <FilterChip
                    key={value}
                    selected={urlState.suggestion_outcome === value}
                    onClick={() => void chooseView({ suggestion_outcome: value })}
                  >
                    {label}
                  </FilterChip>
                ))}
              </div>
            )}
            {gridLinks.length > 0 && (
              <details className="group text-sm">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-ink-secondary hover:text-ink lg:min-h-9 [&::-webkit-details-marker]:hidden">
                  <Table2 className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                  Module grids
                  <ChevronRight className="ml-auto h-4 w-4 text-ink-muted transition-transform duration-200 group-open:rotate-90" aria-hidden="true" />
                </summary>
                <ul className="mt-1 space-y-1" aria-label="Grade by module">
                  {gridLinks.map((link) => {
                    const to = cohortModuleGradingPath(link.cohort_id, link.module_id)
                    return (
                      <li key={`${link.cohort_id}:${link.module_id}`}>
                        <Link
                          to={to}
                          state={inboxOrigin}
                          onClick={(event) => guardLeave(event, to, inboxOrigin)}
                          className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink lg:min-h-9"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {!cohortId && <span className="text-ink-muted">{link.cohort_name} · </span>}
                            {link.module_name}
                          </span>
                          <span className={`text-xs font-bold tabular-nums ${link.waiting ? 'text-ink' : 'text-ink-muted'}`} aria-label={`${link.waiting} waiting`}>{link.waiting}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </details>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {queue.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  icon={Check}
                  title={
                    filtered
                      ? 'No work matches these filters'
                      : queueFilter === 'ungraded'
                        ? 'Nothing waiting for review'
                        : queueFilter === 'redo'
                          ? 'No redo requests'
                          : 'No submissions yet'
                  }
                  description={
                    filtered
                      ? 'Try another module or student, or clear the filters.'
                      : queueFilter === 'ungraded'
                        ? 'New work appears here as students submit it.'
                        : queueFilter === 'redo'
                          ? 'Work you send back for a redo appears here until the student resubmits.'
                          : 'Submissions appear here as students turn in work.'
                  }
                />
              </div>
            ) : (
              <ul aria-label={`${total} ${total === 1 ? 'submission' : 'submissions'}`}>
                {queue.map((sub) => {
                  const latest = sub.latest_submission_id == null || sub.latest_submission_id === sub.id
                  const isSelected = selectedId === sub.id
                  const where = submissionWhereLabel(sub.lesson_title, sub.content_block_title)
                  const waiting = latest && sub.grade === null
                  const context = queueContextLabel(sub)
                  const rowSuggestion = loaded?.id === sub.id ? (loaded.grade_suggestion ?? sub.grade_suggestion) : sub.grade_suggestion
                  const suggestionBadge = rowSuggestion ? gradeSuggestionQueueBadge(rowSuggestion) : null
                  return (
                    <li key={sub.id} className="border-b border-line last:border-b-0">
                      <RowButton
                        id={`submission-row-${sub.id}`}
                        onClick={() => void pickSubmission(sub)}
                        selected={isSelected}
                        aria-current={isSelected ? 'true' : undefined}
                        className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 px-4 py-2 leading-snug"
                      >
                        <span className="truncate text-sm font-bold text-ink" title={sub.user_name}>{sub.user_name}</span>
                        {sub.submission_window?.submissions_close_at && <span className="col-span-2 text-xs text-ink-muted">Deadline · {formatShortDateTime(sub.submission_window.submissions_close_at)}</span>}
                        {sub.extensions?.map((extension) => <span key={extension.id} className="col-span-2 text-xs text-warning-ink [overflow-wrap:anywhere]">Extension · {extension.reason}</span>)}
                        <span className={`text-right text-xs font-bold tabular-nums ${waiting && (sub.review_sla?.overdue ?? waitingTooLong(sub.created_at)) ? 'text-danger-ink' : 'text-ink-muted'}`}>
                          {waiting ? (
                            <><span className="sr-only">Waiting </span>{waitingLabel(sub.created_at)}</>
                          ) : !latest ? 'Previous' : gradeLabel(sub.grade)}
                        </span>
                        <span className="col-span-2 truncate text-[13px] text-ink-secondary" title={where}>
                          {where}{sub.num_submissions > 1 ? ` · attempt ${sub.num_submissions}` : ''}
                        </span>
                        {context && <span className="col-span-2 truncate text-xs text-ink-muted">{context}</span>}
                        {suggestionBadge && rowSuggestion && (
                          <span className="col-span-2 mt-1 flex flex-wrap items-center gap-1.5" data-queue-suggestion={rowSuggestion.outcome}>
                            <Badge tone={suggestionBadge.tone}>{suggestionBadge.label}</Badge>
                          </span>
                        )}
                        {sub.review_sla?.overdue === true && <span className="col-span-2 mt-1"><PastReviewTargetBadge /></span>}
                      </RowButton>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          {/* The queue is paged on the server (50 a page, in the chosen order). */}
          {meta && meta.total_pages > 1 && (
            <nav aria-label="Queue pages" className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-ink-muted">
              <span className="tabular-nums" aria-live="polite">
                {offset + 1}–{offset + queue.length} of {total}
              </span>
              <span className="flex items-center gap-1">
                <Button variant="quiet" size="sm" aria-label="Previous page" disabled={!meta.has_prev_page || loading} onClick={() => setUrlState({ page: meta.page - 1 })}>
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <span className="tabular-nums">Page {meta.page} of {meta.total_pages}</span>
                <Button variant="quiet" size="sm" aria-label="Next page" disabled={!meta.has_next_page || loading} onClick={() => setUrlState({ page: meta.page + 1 })}>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </span>
            </nav>
          )}
        </section>

        {/* Review: a wide area with the record header, the work, and a pinned grade bar. */}
        <section
          ref={reviewTop}
          aria-label="Review"
          className={`${selectedId ? '' : 'hidden lg:block'} min-w-0 scroll-mt-16 lg:scroll-mt-6`}
        >
          {selectedId && current ? (
            <div className="space-y-4">
              <RecordHeader
                className="lg:[&_[data-back-link]]:hidden"
                back={{ to: queuePath, label: 'Back to queue', fallback: true }}
                onBack={(event, to) => {
                  // Breadcrumb steps leave the page; Back to queue (phones) closes the review.
                  if (to !== queuePath) return void guardedNavigate(event, to)
                  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  void leaveReview().then((ok) => {
                    if (!ok) return
                    setUrlState({ submission: null }, { history: 'replace' })
                    requestAnimationFrame(() => document.getElementById(`submission-row-${selectedId}`)?.focus())
                  })
                }}
                headingLevel={2}
                breadcrumb={[
                  ...(reviewCohortName && reviewCohortId ? [{ label: reviewCohortName, to: cohortPath(reviewCohortId) }] : []),
                  { label: current.user_name, to: reviewCohortId ? cohortStudentPath(reviewCohortId, current.user_id) : null },
                  { label: current.lesson_title, to: current.lesson_id ? recordPath({ type: 'lesson', id: current.lesson_id, cohortId: reviewCohortId }, { viewer, returnTo: here }) : null },
                ]}
                type={<span className="tabular-nums">Submission #{current.id} · attempt {current.num_submissions}</span>}
                title={current.lesson_title}
                status={current.grade === null && currentIsLatest
                  ? queueItem?.review_sla?.overdue === true
                    ? <PastReviewTargetBadge />
                    : <Badge tone={!queueItem?.review_sla && waitingTooLong(current.created_at) ? 'danger' : 'warning'}><Clock className="h-3.5 w-3.5" aria-hidden="true" />{waitingSentence(current.created_at)}</Badge>
                  : <SubmissionStatus grade={current.grade} />}
                context={<>
                  {/* Phones hide the breadcrumb, so the cohort leads the context line there. */}
                  {reviewCohortName && reviewCohortId && <span className="inline-flex items-center gap-1.5 sm:hidden"><RecordLink record={{ type: 'cohort', id: reviewCohortId }} variant="plain" touchTarget onClick={guardLeave} className="font-normal text-ink-muted">{reviewCohortName}</RecordLink><span aria-hidden="true">·</span></span>}
                  <RecordLink record={{ type: 'student', id: current.user_id, cohortId: reviewCohortId }} variant="plain" touchTarget onClick={guardLeave}>{current.user_name}</RecordLink>
                  {current.content_block_title && current.content_block_title !== current.lesson_title && <><span aria-hidden="true">·</span><span>{current.content_block_title}</span></>}
                  {/* Phones reach the module grid from Related; the context line stays short there. */}
                  {current.module_id && reviewCohortId && <span className="hidden items-center gap-1.5 sm:inline-flex"><span aria-hidden="true">·</span><Link to={cohortModuleGradingPath(reviewCohortId, current.module_id)} state={inboxOrigin} onClick={(event) => guardLeave(event, cohortModuleGradingPath(reviewCohortId, current.module_id), inboxOrigin)} className="inline-flex items-center gap-1 font-semibold text-ink-secondary hover:text-ink hover:underline"><Table2 className="h-3.5 w-3.5" aria-hidden="true" />{current.module_name} grid</Link></span>}
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">submitted {formatShortDateTime(current.created_at)}</span>
                </>}
                copyPath={`/admin/submissions/${current.id}`}
                queue={queuePosition ? {
                  position: queuePosition,
                  onPrevious: step(previousInQueue),
                  onNext: step(nextInQueue),
                  previousLabel: 'Previous submission',
                  nextLabel: 'Next submission',
                } : undefined}
                actions={<>
                  {reviewCohortId && <Button variant="secondary" size="sm" onClick={() => setShowContext(true)}>
                    <UserRound className="h-4 w-4" aria-hidden="true" />
                    Student context
                  </Button>}
                  {reviewCohortId && <Button variant="secondary" size="sm" onClick={() => void openMessage()} disabled={openingMessage}>
                    <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                    {openingMessage ? 'Opening…' : 'Message'}
                  </Button>}
                  {submissionRecordPath && <LinkButton variant="quiet" size="sm" to={submissionRecordPath} onClick={(event) => void guardedNavigate(event, submissionRecordPath)}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    Open submission
                  </LinkButton>}
                </>}
              />
              <div className="@container min-w-0">
                <div className="grid min-w-0 gap-4 @4xl:grid-cols-[minmax(0,1fr)_16rem] @4xl:items-start">
                  <div className="app-surface min-w-0 p-4 sm:p-6">
                    <SubmissionReviewPanel
                      // Keyed by scope too: a cohort change replaces the review, so it guards that as well.
                      selectionParam={SELECTION_PARAMS}
                      key={`${cohortId}:${selectedId}`}
                      ref={panel}
                      submissionId={selectedId}
                      showHeader={false}
                      showRecordLink={false}
                      taskOpen
                      active={!showContext}
                      navigationContext={{
                        // The submission's own cohort, so links keep the workspace, context and Message (L-2.1).
                        cohortId: current.cohort_id ?? cohortId,
                        returnTo: here,
                        queue: queueFilter,
                        queueCohortId: cohortId,
                      }}
                      previousId={previousInQueue?.id}
                      nextId={nextInQueue?.id}
                      followingAfterSave={() => followingAfterSave()?.id}
                      position={queuePosition}
                      onNavigate={select}
                      onSaved={saved}
                      onLoaded={setLoaded}
                    />
                  </div>
                  <RelatedPanel
                    rows={relatedPanelRows}
                    loading={related.loading}
                    error={related.error}
                    onRetry={related.retry}
                    returnLabel="Grading"
                    onNavigate={(event, to, state) => void guardedNavigate(event, to, state)}
                    className="@4xl:sticky @4xl:top-6"
                  />
                </div>
              </div>
              {reviewCohortId && (
                <StudentContextDrawer
                  open={showContext}
                  cohortId={reviewCohortId}
                  studentId={current.user_id}
                  source={{ type: 'submission', id: current.id, label: current.content_block_title }}
                  onClose={() => setShowContext(false)}
                />
              )}
            </div>
          ) : selectedId ? (
            <div className="app-surface p-4 sm:p-6">
              <SubmissionReviewPanel
                selectionParam={SELECTION_PARAMS}
                key={`${cohortId}:${selectedId}`}
                ref={panel}
                submissionId={selectedId}
                taskOpen
                navigationContext={{ cohortId, returnTo: here, queue: queueFilter, queueCohortId: cohortId }}
                onLoaded={setLoaded}
                onReturn={() => setUrlState({ submission: null }, { history: 'replace' })}
                returnLabel="Back to queue"
              />
            </div>
          ) : (
            <div className="hidden min-h-[24rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-surface-sunken p-6 text-center lg:flex">
              <Check className="h-10 w-10 text-ink-muted" aria-hidden="true" />
              <p className="text-sm font-semibold text-ink-secondary">
                {queue.length ? 'Choose a submission to review' : 'Nothing to review here'}
              </p>
              {queue[0] && (
                <Button variant="secondary" size="sm" onClick={() => select(queue[0].id)}>
                  {filters.sort === 'oldest' ? 'Start with the oldest' : 'Start with the newest'}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
