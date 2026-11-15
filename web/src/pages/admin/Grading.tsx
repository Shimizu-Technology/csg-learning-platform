import { useMemo, useRef } from 'react'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { useLocation } from 'react-router-dom'
import { urlParsers, useUrlState } from '../../lib/useUrlState'
import {
  RefreshCw,
  Filter,
  Check,
  RotateCcw,
  Clock,
  ChevronRight,
  Layers3,
  ExternalLink,
} from 'lucide-react'
import { api } from '../../lib/api'
import { useStaffResource } from '../../lib/useStaffResource'
import { LoadError } from '../../components/shared/LoadError'
import { submissionPath, cohortModuleGradingPath } from '../../lib/routes'
import {
  getLatestSubmissionIds,
  orderSubmissionQueue,
  type SubmissionQueueFilter,
  submissionWhereLabel,
} from '../../lib/submissionQueue'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { SubmissionStatus } from '../../components/shared/SubmissionStatus'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { FilterChip } from '../../components/ui/Choice'
import { formatShortDateTime } from '../../lib/format'
import { listLinkState, useListScrollMemory } from '../../lib/navigationContext'
import { originLabel } from '../../lib/recordOrigin'
import { RowButton } from '../../components/ui/RowButton'
import {
  SubmissionReviewPanel,
  type SubmissionReviewHandle,
} from '../../components/admin/SubmissionReviewPanel'
import type { Submission } from '../../types/api'
import { RecordLink } from '../../components/shared/RecordLink'
import { cohortScopeOptions, PageHeader, ScopeControl } from '../../components/ui/PageHeader'
import { useGuardedLinkClick } from '../../lib/useLeaveGuard'
type QueueFilter = SubmissionQueueFilter

// The inbox's view lives in the URL (L-0.6): cohort and filter push history, the open review replaces it.
const GRADING_URL = {
  cohort_id: urlParsers.id(),
  filter: urlParsers.oneOf(['ungraded', 'redo', 'all'] as const, 'ungraded'),
  submission: urlParsers.id(),
}

interface CohortSummary {
  id: number
  name: string
  curriculum_name: string
  modules?: { id: number; name: string }[]
}

export function Grading() {
  const location = useLocation()
  const [urlState, setUrlState] = useUrlState(GRADING_URL)
  const cohortId = urlState.cohort_id ?? undefined
  const {
    data: inbox,
    error: loadError,
    loading,
    reload: loadSubmissions,
  } = useStaffResource<{ submissions: Submission[]; cohorts: CohortSummary[] }>(
    String(cohortId),
    async () => {
      const [subRes, cohortRes] = await Promise.all([
        api.getSubmissions(cohortId ? { cohort_id: String(cohortId) } : undefined),
        api.getCohorts(),
      ])
      return subRes.data && cohortRes.data
        ? {
            data: { submissions: subRes.data.submissions, cohorts: cohortRes.data.cohorts },
            error: subRes.error || cohortRes.error,
            fromCache: subRes.fromCache || cohortRes.fromCache,
          }
        : { error: subRes.error || cohortRes.error }
    },
  )
  const submissions = inbox?.submissions || []
  const cohorts = inbox?.cohorts || []
  const queueFilter: QueueFilter = urlState.filter
  const selectedId = urlState.submission
  const panel = useRef<SubmissionReviewHandle>(null)
  // Links that leave the page ask about unsaved feedback in the open review first.
  const guardLeave = useGuardedLinkClick(() => panel.current?.confirmLeave())
  // Module grids opened from here come back to this list with its filter ("Grading · Redo").
  const inboxOrigin = listLinkState(location, originLabel(`${location.pathname}${location.search}`) || 'Grading')
  const panelContainer = useRef<HTMLDivElement>(null)
  const scrollOnLoad = useRef(false)
  const latestSubmissionIds = useMemo(() => getLatestSubmissionIds(submissions), [submissions])
  const queue = useMemo(
    () => orderSubmissionQueue(submissions, queueFilter),
    [submissions, queueFilter],
  )
  useListScrollMemory(!loading)
  const selectedIndex = queue.findIndex((item) => item.id === selectedId)
  const previousInQueue = queue[selectedIndex - 1]
  const nextInQueue = queue[selectedIndex + 1]

  const counts = useMemo(
    () => ({
      ungraded: orderSubmissionQueue(submissions, 'ungraded').length,
      redo: orderSubmissionQueue(submissions, 'redo').length,
      all: submissions.length,
    }),
    [submissions],
  )

  function select(id: number) {
    scrollOnLoad.current = true
    setUrlState({ submission: id }, { history: 'replace' })
  }
  async function pickSubmission(submission: { id: number }) {
    if (submission.id === selectedId || (panel.current && !(await panel.current.confirmLeave())))
      return
    select(submission.id)
  }
  async function chooseCohort(value: string) {
    if (panel.current && !(await panel.current.confirmLeave())) return
    setUrlState({ cohort_id: Number(value) || null, submission: null })
  }
  async function chooseFilter(value: QueueFilter) {
    if (panel.current && !(await panel.current.confirmLeave())) return
    setUrlState({ filter: value, submission: null })
  }
  const recordPathFor = (sub: { id: number; user_id: number }) =>
    submissionPath(sub.id, {
      userId: sub.user_id,
      returnTo: `${location.pathname}${location.search}`,
      queue: queueFilter,
      queueCohortId: cohortId,
    })
  function saved() {
    const following = nextInQueue || (queueFilter === 'all' ? null : previousInQueue)
    if (following) scrollOnLoad.current = true
    setUrlState({ submission: following?.id ?? null }, { history: 'replace' })
    void loadSubmissions()
  }

  if (loading && !inbox) return <LoadingSpinner message="Loading submissions..." />
  if (!inbox)
    return (
      <div className="app-page-wide">
        <LoadError
          error={loadError || 'Submissions unavailable.'}
          retry={() => void loadSubmissions()}
        />
      </div>
    )

  const activeCohorts = cohorts.filter((c: CohortSummary) => !cohortId || c.id === cohortId)
  return (
    <div className="app-page-wide">
      <PageHeader
        title="Grading"
        description={<>{counts.ungraded === 1 ? '1 attempt' : `${counts.ungraded} attempts`} waiting for review{cohortId ? <> in {cohorts.find((cohort) => cohort.id === cohortId)?.name || 'this cohort'}</> : ' across cohorts'} · {counts.redo} redo requested</>}
        scope={<ScopeControl value={cohortId ? String(cohortId) : ''} options={cohortScopeOptions(cohorts.some((cohort) => cohort.id === cohortId) || !cohortId ? cohorts : [...cohorts, { id: cohortId, name: `Cohort ${cohortId}` }])} onChange={(value) => void chooseCohort(value)} />}
        menu={[{ key: 'refresh', label: loading ? 'Refreshing…' : 'Refresh', icon: <RefreshCw aria-hidden="true" />, onSelect: () => void loadSubmissions() }]}
      />

      {loadError && <LoadError error={loadError} stale retry={() => void loadSubmissions()} />}
      {/* Quick links to cohort grading */}
      {activeCohorts.length > 0 && (
        <div className="app-surface p-4">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
            <Layers3 className="h-4 w-4 text-ink-muted" />
            Grade by cohort
          </h2>
          <div className="space-y-2">
            {activeCohorts.map((cohort) => (
              <div key={cohort.id} className="flex flex-wrap items-center gap-2">
                <span
                  className="min-w-[140px] max-w-full truncate text-sm font-semibold text-ink-secondary"
                  title={cohort.name}
                >
                  <RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" touchTarget truncate className="text-ink-secondary" onClick={guardLeave}>{cohort.name}</RecordLink>
                </span>
                {cohort.modules?.map((mod) => (
                  <Link
                    key={mod.id}
                    to={cohortModuleGradingPath(cohort.id, mod.id)}
                    state={inboxOrigin}
                    onClick={(event) => guardLeave(event, cohortModuleGradingPath(cohort.id, mod.id), inboxOrigin)}
                    className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-line bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors duration-150 hover:border-line-strong hover:bg-surface-sunken hover:text-ink lg:min-h-9"
                  >
                    {mod.name}
                    <ChevronRight className="h-3 w-3 text-ink-muted" />
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div role="group" aria-label="Submission queue" className="flex flex-wrap gap-2">
        <FilterChip
          selected={queueFilter === 'ungraded'}
          count={counts.ungraded}
          onClick={() => chooseFilter('ungraded')}
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          Ungraded queue
        </FilterChip>
        <FilterChip
          selected={queueFilter === 'redo'}
          count={counts.redo}
          onClick={() => chooseFilter('redo')}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Redo requested
        </FilterChip>
        <FilterChip
          selected={queueFilter === 'all'}
          count={counts.all}
          onClick={() => chooseFilter('all')}
        >
          <Clock className="h-4 w-4" aria-hidden="true" />
          All submissions
        </FilterChip>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="min-w-0 space-y-2">
          {queue.length === 0 ? (
            <EmptyState
              icon={Check}
              title={
                queueFilter === 'ungraded'
                  ? 'All caught up!'
                  : queueFilter === 'redo'
                    ? 'No redo queue'
                    : 'No submissions yet'
              }
              description={
                queueFilter === 'ungraded'
                  ? 'No ungraded submissions.'
                  : queueFilter === 'redo'
                    ? 'No redo-requested submissions right now.'
                    : 'No submissions have been made yet.'
              }
            />
          ) : (
            queue.map((sub) => {
              const isLatest = latestSubmissionIds.has(sub.id)
              const isSelected = selectedId === sub.id
              const where = submissionWhereLabel(sub.lesson_title, sub.content_block_title)
              return (
                <div
                  key={sub.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2"
                >
                  <RowButton
                    id={`submission-row-${sub.id}`}
                    onClick={() => void pickSubmission(sub)}
                    selected={isSelected}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-3 sm:p-4 ${
                      isSelected ? 'border-line-strong' : 'border-line bg-surface-raised'
                    }`}
                  >
                    <Avatar name={sub.user_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink" title={sub.user_name}>
                        {sub.user_name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-secondary" title={where}>
                        {where}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <SubmissionStatus grade={sub.grade} />
                        <Badge tone={isLatest ? 'info' : 'neutral'}>
                          {isLatest ? 'Latest' : 'Previous'}
                        </Badge>
                        <span className="text-xs tabular-nums text-ink-muted">
                          Attempt {sub.num_submissions} · {formatShortDateTime(sub.created_at)}
                        </span>
                      </div>
                    </div>
                    <ChevronRight
                      className="mt-2 hidden h-4 w-4 shrink-0 text-ink-muted sm:block"
                      aria-hidden="true"
                    />
                  </RowButton>
                  <Link
                    to={recordPathFor(sub)}
                    onClick={(event) => guardLeave(event, recordPathFor(sub))}
                    aria-label={`Open ${sub.user_name}'s submission`}
                    title="Open submission"
                    className="inline-flex h-11 w-11 items-center justify-center self-center rounded-xl text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              )
            })
          )}
        </div>

        {selectedId && (
          <div
            ref={panelContainer}
            className="app-surface min-w-0 scroll-mt-20 space-y-4 p-4 sm:p-6 lg:sticky lg:top-20 lg:self-start"
          >
            <SubmissionReviewPanel
              selectionParam="submission"
              key={`${cohortId}:${selectedId}`}
              ref={panel}
              submissionId={selectedId}
              navigationContext={{
                cohortId,
                returnTo: `${location.pathname}${location.search}`,
                queue: queueFilter,
                queueCohortId: cohortId,
              }}
              previousId={previousInQueue?.id}
              nextId={nextInQueue?.id}
              position={selectedIndex >= 0 ? `${selectedIndex + 1} of ${queue.length}` : undefined}
              onNavigate={select}
              onSaved={saved}
              onLoaded={() => {
                if (!scrollOnLoad.current) return
                scrollOnLoad.current = false
                if (!window.matchMedia('(min-width: 1024px)').matches)
                  panelContainer.current?.scrollIntoView?.({
                    block: 'start',
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                      ? 'auto'
                      : 'smooth',
                  })
              }}
              onReturn={() => {
                setUrlState({ submission: null }, { history: 'replace' })
                requestAnimationFrame(() =>
                  document.getElementById(`submission-row-${selectedId}`)?.focus(),
                )
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
