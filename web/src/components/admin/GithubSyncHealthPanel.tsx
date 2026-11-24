import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Github, RefreshCw, Settings2 } from 'lucide-react'
import { api, type CohortGithubSyncHealthResponse } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import { cohortModuleGradingPath, cohortSettingsPath } from '../../lib/routes'
import { RecordLink } from '../shared/RecordLink'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'

const STATUS_BADGE: Record<
  CohortGithubSyncHealthResponse['learners'][number]['status'],
  { label: string; tone: BadgeTone }
> = {
  healthy: { label: 'Syncing', tone: 'success' },
  sync_error: { label: 'Sync error', tone: 'danger' },
  unverified: { label: 'Needs verification', tone: 'warning' },
  not_bound: { label: 'Repo not linked', tone: 'warning' },
  identity_missing: { label: 'GitHub not connected', tone: 'pending' },
  app_not_ready: { label: 'Setup needed', tone: 'neutral' },
}

export function GithubSyncHealthPanel({
  cohortId,
  compact = false,
}: {
  cohortId: number
  compact?: boolean
}) {
  const [data, setData] = useState<CohortGithubSyncHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'attention'>('all')

  const load = useCallback(async () => {
    if (typeof api.getCohortGithubSyncHealth !== 'function') {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await api.getCohortGithubSyncHealth(cohortId)
      if (response.data && !response.error && !response.fromCache) {
        setData(response.data)
      } else {
        setError(response.error || 'Could not load GitHub sync health.')
      }
    } catch {
      setError('Could not load GitHub sync health.')
    } finally {
      setLoading(false)
    }
  }, [cohortId])

  useEffect(() => {
    void load()
  }, [load])

  if (typeof api.getCohortGithubSyncHealth !== 'function') return null

  const connectedInstallations = data?.installations.filter((row) => row.connection_state === 'connected') ?? []
  const attentionCount = data
    ? data.summary.sync_error_count +
      data.summary.unverified_count +
      data.summary.not_bound_count +
      data.summary.identity_missing_count +
      data.summary.app_not_ready_count
    : 0
  const visibleLearners = data
    ? data.learners.filter((learner) => filter === 'all' || learner.status !== 'healthy')
    : []

  return (
    <section className="app-surface space-y-4 p-5" aria-labelledby={`github-sync-health-${cohortId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`github-sync-health-${cohortId}`} className="flex items-center gap-2 text-lg font-bold text-ink">
            <Github className="h-5 w-5 text-ink-muted" aria-hidden="true" />
            GitHub sync health
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Check at a glance whether the GitHub App is ready, each learner’s repository is verified, and why any work
            isn’t syncing.
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {loading ? 'Checking…' : 'Refresh health'}
        </Button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-ink">
          {error}
        </div>
      )}

      {loading && !data && <p className="text-sm text-ink-muted">Checking GitHub sync health…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <HealthCheckCard
              ok={data.app_configured}
              label="GitHub App"
              detail={data.app_configured ? 'Deployment credentials ready' : 'Needs deployment setup'}
            />
            <HealthCheckCard
              ok={data.cohort_github_app_enabled}
              label="Cohort switch"
              detail={
                data.cohort_github_app_enabled
                  ? 'GitHub App access is On'
                  : data.school_github_app_enabled
                    ? 'Turn On in Cohort settings'
                    : 'Turn On in School settings first'
              }
              action={
                !data.cohort_github_app_enabled ? (
                  <Link
                    to={data.school_github_app_enabled ? cohortSettingsPath(cohortId) : '/admin/settings'}
                    className="app-link inline-flex min-h-11 items-center gap-1 text-xs font-semibold sm:min-h-0"
                  >
                    <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {data.school_github_app_enabled ? 'Cohort settings' : 'School settings'}
                  </Link>
                ) : undefined
              }
            />
            <HealthCheckCard
              ok={connectedInstallations.length > 0}
              label="App installation"
              detail={
                connectedInstallations.length > 0
                  ? `${connectedInstallations.length} connected (${connectedInstallations.map((i) => i.account_login).join(', ')})`
                  : data.installations.length > 0
                    ? 'Installation needs reconnection'
                    : 'No installation connected yet'
              }
            />
            <HealthCheckCard
              ok={data.reconciliation_enabled || data.webhooks_enabled}
              label="Automatic sync"
              detail={
                data.webhooks_enabled && data.reconciliation_enabled
                  ? 'Webhooks and hourly sync On'
                  : data.reconciliation_enabled
                    ? 'Hourly sync On'
                    : data.webhooks_enabled
                      ? 'Webhooks On'
                      : 'Manual sync only'
              }
            />
          </div>

          {data.github_modules.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-sunken px-4 py-3 text-xs text-ink-secondary">
              <span className="font-semibold text-ink">Manual sync by module:</span>
              {data.github_modules.map((mod) => (
                <Link
                  key={mod.id}
                  to={cohortModuleGradingPath(cohortId, mod.id)}
                  className="app-link inline-flex min-h-11 items-center font-semibold sm:min-h-0"
                >
                  Sync {mod.name}
                </Link>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold tabular-nums">
              <Badge tone="success">{data.summary.healthy_count} syncing</Badge>
              {data.summary.sync_error_count > 0 && (
                <Badge tone="danger">{data.summary.sync_error_count} sync error</Badge>
              )}
              {data.summary.unverified_count > 0 && (
                <Badge tone="warning">{data.summary.unverified_count} unverified</Badge>
              )}
              {data.summary.not_bound_count + data.summary.identity_missing_count > 0 && (
                <Badge tone="pending">
                  {data.summary.not_bound_count + data.summary.identity_missing_count} not connected
                </Badge>
              )}
            </div>
            {data.learners.length > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={filter === 'all' ? 'secondary' : 'quiet'}
                  onClick={() => setFilter('all')}
                >
                  All ({data.learners.length})
                </Button>
                <Button
                  size="sm"
                  variant={filter === 'attention' ? 'secondary' : 'quiet'}
                  onClick={() => setFilter('attention')}
                >
                  Needs attention ({attentionCount})
                </Button>
              </div>
            )}
          </div>

          {data.learners.length === 0 ? (
            <p className="text-sm text-ink-muted">No active learners enrolled in this cohort yet.</p>
          ) : visibleLearners.length === 0 ? (
            <p className="rounded-xl border border-success-line bg-success-soft px-4 py-3 text-sm text-success-ink">
              Every active learner in this cohort is verified and syncing normally.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {(compact ? visibleLearners.slice(0, 8) : visibleLearners).map((learner) => {
                const badge = STATUS_BADGE[learner.status]
                return (
                  <li key={learner.enrollment_id} className="space-y-1.5 px-4 py-3.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <RecordLink
                          record={{ type: 'student', id: learner.user_id, cohortId, tab: 'access' }}
                          returnLabel="GitHub sync health"
                          variant="plain"
                          touchTarget
                          className="font-semibold text-ink hover:underline"
                        >
                          {learner.full_name || learner.email}
                        </RecordLink>
                        {learner.github_verified_login ? (
                          <span className="text-xs text-ink-muted">@{learner.github_verified_login}</span>
                        ) : learner.github_username ? (
                          <span className="text-xs text-ink-muted">@{learner.github_username} (unverified)</span>
                        ) : null}
                      </div>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>

                    <p
                      className={`text-xs leading-5 ${
                        learner.status === 'sync_error'
                          ? 'text-danger-ink'
                          : learner.status === 'healthy'
                            ? 'text-ink-secondary'
                            : 'text-warning-ink'
                      }`}
                    >
                      {learner.plain_reason}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted tabular-nums">
                      {learner.bindings.length > 0 ? (
                        learner.bindings.map((binding) => (
                          <span key={binding.id} className="inline-flex flex-wrap items-center gap-1 break-all">
                            <span>
                              Repo: <strong className="text-ink-secondary">{binding.full_name}</strong>
                            </span>
                            {binding.curriculum_module_id && binding.module_name ? (
                              <span>
                                (
                                <RecordLink
                                  record={{ type: 'module', id: binding.curriculum_module_id }}
                                  returnLabel="GitHub sync health"
                                  variant="plain"
                                  className="underline decoration-line-strong underline-offset-2 hover:text-ink"
                                >
                                  {binding.module_name}
                                </RecordLink>
                                )
                              </span>
                            ) : null}
                          </span>
                        ))
                      ) : (
                        <span>No repository linked</span>
                      )}
                      <span>
                        Last sync: {formatShortDateTime(learner.last_synced_at, 'Not yet synced')}
                      </span>
                      {learner.next_retry_at && (
                        <span>Next retry: {formatShortDateTime(learner.next_retry_at)}</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {compact && visibleLearners.length > 8 && (
            <Link to={cohortSettingsPath(cohortId)} className="app-link inline-flex min-h-11 items-center text-sm font-semibold">
              View all {visibleLearners.length} learners in Cohort settings
            </Link>
          )}
        </>
      )}
    </section>
  )
}

function HealthCheckCard({
  ok,
  label,
  detail,
  action,
}: {
  ok: boolean
  label: string
  detail: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-sunken px-3.5 py-3">
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success-ink" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning-ink" aria-hidden="true" />
        )}
        <span className="text-xs font-bold text-ink">{label}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-ink-secondary [overflow-wrap:anywhere]">{detail}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
