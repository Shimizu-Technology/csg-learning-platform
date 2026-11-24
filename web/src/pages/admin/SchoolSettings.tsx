import { Building2, History, KeyRound, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { AgentPostingTokens } from '../../components/admin/AgentPostingTokens'
import { FeatureSettings } from '../../components/admin/FeatureSettings'
import { FeatureSwitchChanges } from '../../components/admin/FeatureSwitchChanges'
import { SchoolIdentityPreview } from '../../components/admin/SchoolIdentityPreview'
import { SegmentButton, SegmentedControl } from '../../components/ui/Choice'
import { PageHeader } from '../../components/ui/PageHeader'
import { urlParsers, useUrlParam } from '../../lib/useUrlState'

const SETTINGS_TAB = urlParsers.oneOf(['features', 'identity', 'changes', 'tokens'] as const, 'features')

export function SchoolSettings() {
  const [tab, setTab] = useUrlParam('tab', SETTINGS_TAB)
  const [searchParams, setSearchParams] = useSearchParams()
  const rawCohortId = Number(searchParams.get('cohort_id'))
  const cohortId = Number.isInteger(rawCohortId) && rawCohortId > 0 ? rawCohortId : undefined

  const clearCohortFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('cohort_id')
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="app-page-wide space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="School settings"
        description="Manage school-wide feature defaults, verify white-label identity, review switch changes, and manage assistant posting tokens."
      />

      <SegmentedControl label="School settings section" className="max-sm:flex max-sm:flex-wrap">
        <SegmentButton dense selected={tab === 'features'} onClick={() => setTab('features')}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Feature switches
        </SegmentButton>
        <SegmentButton dense selected={tab === 'identity'} onClick={() => setTab('identity')}>
          <Building2 className="h-4 w-4" aria-hidden="true" />
          School identity
        </SegmentButton>
        <SegmentButton dense selected={tab === 'changes'} onClick={() => setTab('changes')}>
          <History className="h-4 w-4" aria-hidden="true" />
          Change history
        </SegmentButton>
        <SegmentButton dense selected={tab === 'tokens'} onClick={() => setTab('tokens')}>
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          Assistant tokens
        </SegmentButton>
      </SegmentedControl>

      {tab === 'features' && <FeatureSettings />}
      {tab === 'identity' && <SchoolIdentityPreview />}
      {tab === 'changes' && (
        <div className="space-y-4">
          {cohortId && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary">
              <span>Showing feature switch changes for cohort #{cohortId}.</span>
              <button
                type="button"
                onClick={clearCohortFilter}
                className="app-link min-h-11 font-semibold sm:min-h-0"
              >
                Show all school changes
              </button>
            </div>
          )}
          <FeatureSwitchChanges cohortId={cohortId} />
        </div>
      )}
      {tab === 'tokens' && <AgentPostingTokens />}
    </div>
  )
}
