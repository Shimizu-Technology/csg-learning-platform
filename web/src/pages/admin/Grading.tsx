import { useMemo, useRef } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
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
import { submissionPath } from '../../lib/routes'
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
import { Button } from '../../components/ui/Button'
import { FilterChip } from '../../components/ui/Choice'
import { formatShortDateTime } from '../../lib/format'
import { useListScrollMemory } from '../../lib/navigationContext'
import { RowButton } from '../../components/ui/RowButton'
import {
  SubmissionReviewPanel,
  type SubmissionReviewHandle,
} from '../../components/admin/SubmissionReviewPanel'
import type { Submission } from '../../types/api'
type QueueFilter = SubmissionQueueFilter

interface CohortSummary {
  id: number
  name: string
  curriculum_name: string
  modules?: { id: number; name: string }[]
}

export function Grading() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const cohortId = Number(searchParams.get('cohort_id')) || undefined
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
  const queueFilter = (['ungraded', 'redo', 'all'] as const).includes(
    searchParams.get('filter') as QueueFilter,
  )
    ? (searchParams.get('filter') as QueueFilter)
    : 'ungraded'
  const selectedId = Number(searchParams.get('submission')) || null
  const panel = useRef<SubmissionReviewHandle>(null)
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
    const next = new URLSearchParams(searchParams)
    next.set('submission', String(id))
    setSearchParams(next, { replace: true })
  }
  async function pickSubmission(submission: { id: number }) {
    if (submission.id === selectedId || (panel.current && !(await panel.current.confirmLeave())))
      return
    select(submission.id)
  }
  async function chooseFilter(value: QueueFilter) {
    if (panel.current && !(await panel.current.confirmLeave())) return
    const next = new URLSearchParams(searchParams)
    if (value === 'ungraded') next.delete('filter')
    else next.set('filter', value)
    next.delete('submission')
    setSearchParams(next)
  }
  function saved() {
    const following = nextInQueue || (queueFilter === 'all' ? null : previousInQueue)
    const next = new URLSearchParams(searchParams)
    if (following) {
      scrollOnLoad.current = true
      next.set('submission', String(following.id))
    } else next.delete('submission')
    setSearchParams(next, { replace: true })
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
      <header>
        <Link
          to="/admin"
          className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Staff home
        </Link>
        <p className="app-eyebrow">Feedback workflow</p>
        <h1 className="app-title mt-2">Grading inbox</h1>
        <p className="app-description mt-2">
          {cohortId
            ? 'Review work for this cohort, then move through focused module queues.'
            : 'Review ungraded work across cohorts, then move through focused module queues.'}
        </p>
      </header>

      {loadError && <LoadError error={loadError} stale retry={() => void loadSubmissions()} />}
      <Button variant="secondary" disabled={loading} onClick={() => void loadSubmissions()}>
        {loading ? 'Refreshing…' : 'Refresh inbox'}
      </Button>
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
                  {cohort.name}
                </span>
                {cohort.modules?.map((mod) => (
                  <Link
                    key={mod.id}
                    to={`/admin/cohorts/${cohort.id}/modules/${mod.id}/grading`}
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
                    to={submissionPath(sub.id, {
                      userId: sub.user_id,
                      returnTo: `${location.pathname}${location.search}`,
                      queue: queueFilter,
                      queueCohortId: cohortId,
                    })}
                    aria-label={`Open ${sub.user_name}'s submission record`}
                    title="Open submission record"
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
                const next = new URLSearchParams(searchParams)
                next.delete('submission')
                setSearchParams(next, { replace: true })
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
