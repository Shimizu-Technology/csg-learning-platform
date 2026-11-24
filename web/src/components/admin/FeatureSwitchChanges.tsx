import { useCallback, useEffect, useState } from 'react'
import { History, RefreshCw } from 'lucide-react'
import { api, type FeatureSwitchChangesResponse } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import { EmptyState } from '../shared/EmptyState'
import { RecordLink } from '../shared/RecordLink'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { featureSwitchLabel } from './FeatureSettings'

function formatSwitchValue(value: boolean | string | null): string {
  if (value === true) return 'On'
  if (value === false) return 'Off'
  if (value === null || value === undefined || value === '') return 'Inherit / default'
  if (value === 'automatic') return 'Automatic'
  if (value === 'always') return 'Always show'
  if (value === 'hidden') return 'Hidden'
  return String(value)
}

export function FeatureSwitchChanges({ cohortId }: { cohortId?: number }) {
  const [changes, setChanges] = useState<FeatureSwitchChangesResponse['changes']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.getFeatureSwitchChanges(cohortId)
      if (response.data && !response.error && !response.fromCache) {
        setChanges(response.data.changes)
      } else {
        setError(response.error || 'Could not load feature switch changes.')
      }
    } catch {
      setError('Could not load feature switch changes.')
    } finally {
      setLoading(false)
    }
  }, [cohortId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="app-surface overflow-hidden" aria-label="Feature switch changes">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5 sm:px-6">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
            <History className="h-5 w-5 text-ink-muted" aria-hidden="true" />
            Feature switch change history
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {cohortId
              ? 'Recent feature switch updates recorded for this cohort.'
              : 'Most recent school and cohort feature switch changes, newest first.'}
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>

      {loading && !changes.length ? (
        <p className="p-5 text-sm text-ink-muted sm:px-6">Loading change history…</p>
      ) : error ? (
        <div role="alert" className="space-y-3 p-5 text-sm text-danger-ink sm:px-6">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : changes.length === 0 ? (
        <EmptyState
          icon={History}
          title="No feature switch changes recorded yet"
          description="When an admin turns a switch on or off, who changed it and the before and after values will appear here."
        />
      ) : (
        <ol className="divide-y divide-line">
          {changes.map((entry) => (
            <li key={entry.id} className="space-y-2.5 p-5 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-ink">
                    {entry.actor ? entry.actor.full_name || entry.actor.email : 'System migration'}
                  </span>
                  <span className="text-ink-muted">updated</span>
                  {entry.cohort ? (
                    <RecordLink
                      record={{ type: 'cohort', id: entry.cohort.id, tab: 'settings' }}
                      returnLabel="Feature changes"
                      variant="app"
                      touchTarget
                    >
                      {entry.cohort.name}
                    </RecordLink>
                  ) : (
                    <Badge tone="info">School defaults</Badge>
                  )}
                </div>
                <time dateTime={entry.created_at} className="text-xs tabular-nums text-ink-muted">
                  {formatShortDateTime(entry.created_at)}
                </time>
              </div>
              {entry.diff.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {entry.diff.map((item) => (
                    <li
                      key={item.key}
                      className="rounded-xl border border-line bg-surface-sunken px-3 py-1.5 text-xs text-ink"
                    >
                      <span className="font-semibold">{featureSwitchLabel(item.key)}:</span>{' '}
                      <span className="text-ink-muted">{formatSwitchValue(item.from)}</span>{' '}
                      <span aria-hidden="true">→</span>{' '}
                      <span className="font-semibold text-ink">{formatSwitchValue(item.to)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-muted">Saved without changing effective switch values.</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
