import { ChevronDown, Layers3 } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'

interface CohortSwitcherProps {
  compact?: boolean
  iconOnly?: boolean
}

export function CohortSwitcher({ compact = false, iconOnly = false }: CohortSwitcherProps) {
  const { user } = useAuthContext()
  const { cohorts, selectedCohort, loading, error, selectCohort } = useCohortContext()
  const current = cohorts.filter((cohort) => !['completed', 'archived'].includes(cohort.status))
  const past = cohorts.filter((cohort) => ['completed', 'archived'].includes(cohort.status))

  if (!user || (loading && cohorts.length === 0)) return null

  const accessibleLabel = iconOnly
    ? `Switch cohort workspace. Current cohort: ${selectedCohort?.name || 'All cohorts'}`
    : 'Switch cohort workspace'
  const options = <>
    {user.is_staff && <option value="">All cohorts</option>}
    {!user.is_staff && !selectedCohort && <option value="">Choose a cohort</option>}
    {current.length > 0 && <optgroup label="Current cohorts">{current.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</optgroup>}
    {past.length > 0 && <optgroup label="Past learning">{past.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</optgroup>}
  </>

  if (iconOnly) {
    return <div className="relative h-11 w-full min-w-0 max-w-full">
      <select
        aria-label={accessibleLabel}
        title={error || accessibleLabel}
        value={selectedCohort?.id ?? ''}
        onChange={(event) => selectCohort(event.target.value ? Number(event.target.value) : null)}
        className="peer absolute inset-0 z-10 h-11 w-full min-w-0 max-w-full cursor-pointer appearance-none opacity-0"
      >
        {options}
      </select>
      <span
        aria-hidden="true"
        data-cohort-switcher-visual="icon-only"
        className="pointer-events-none flex h-11 w-full items-center justify-center rounded-xl border border-line bg-surface-sunken text-ink-secondary transition-colors duration-150 peer-hover:border-line-strong peer-focus-visible:border-focus peer-focus-visible:ring-2 peer-focus-visible:ring-focus/40"
      >
        <Layers3 className="h-5 w-5" />
      </span>
      {error && <span className="sr-only" role="status">{error}</span>}
    </div>
  }

  // The visible label is a real text span (ellipsis-truncated) laid under a
  // transparent native select. Styling the select's own text clips glyphs
  // mid-letter in WebKit at narrow widths; a span truncates cleanly.
  const visibleLabel = selectedCohort?.name || (user.is_staff ? 'All cohorts' : 'Choose a cohort')
  return <div className={`relative h-11 min-w-0 ${compact ? 'flex-1' : 'w-full'}`}>
    <select
      aria-label={accessibleLabel}
      title={error || selectedCohort?.name || undefined}
      value={selectedCohort?.id ?? ''}
      onChange={(event) => selectCohort(event.target.value ? Number(event.target.value) : null)}
      className="peer absolute inset-0 z-10 h-11 w-full min-w-0 max-w-full cursor-pointer appearance-none opacity-0"
    >
      {options}
    </select>
    <span
      aria-hidden="true"
      data-cohort-switcher-visual="label"
      className={`pointer-events-none flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-line bg-surface-sunken pl-3 pr-3 text-sm font-semibold text-ink transition-colors duration-150 peer-hover:border-line-strong peer-focus-visible:border-focus peer-focus-visible:ring-2 peer-focus-visible:ring-focus/40 ${compact ? '' : 'shadow-raised'}`}
    >
      <Layers3 className="h-4 w-4 shrink-0 text-ink-muted" />
      <span data-cohort-switcher-label className="block min-w-0 flex-1 truncate py-0.5 leading-5">{visibleLabel}</span>
      <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" />
    </span>
    {error && <span className="sr-only" role="status">{error}</span>}
  </div>
}
