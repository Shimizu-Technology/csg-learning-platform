import { CalendarDays, ExternalLink, Link2, Lock, Plus, Unlock } from 'lucide-react'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge } from '../../../components/ui/Badge'
import { Button, LinkButton } from '../../../components/ui/Button'
import { formatShortDate } from '../../../lib/format'
import { listLinkState } from '../../../lib/navigationContext'
import { originLabel } from '../../../lib/recordOrigin'
import { cohortModuleGradingPath } from '../../../lib/routes'
import { ModuleSettingsDialog } from './ModuleSettingsDialog'
import { dateFromDateOnly } from './settingsForm'
import type { CohortSettingsController } from './useCohortSettings'

export function ModuleSettings({ settings }: { settings: CohortSettingsController }) {
  const {
    id,
    location,
    cohort,
    forms,
    classResources,
    setShowResourcesModal,
    setConfigureModuleId,
    savingModuleId,
    assignedChanges,
    assignModuleToCohort,
  } = settings
  return (
    <>
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between max-sm:flex-col max-sm:items-start max-sm:gap-3">
            <h2 id="curriculum" className="scroll-mt-32 text-lg font-bold text-ink">
              Curriculum & access
            </h2>
            <LinkButton
              variant="secondary"
              to={`/admin/content?open=${cohort.modules.map((module) => module.id).join(',')}`}
            >
              Edit shared curriculum in Content
            </LinkButton>
          </div>
          <p className="text-sm text-ink-secondary">
            <RecordLink record={{ type: 'curriculum', id: cohort.curriculum_id }} variant="inline">
              {cohort.curriculum_name}
            </RecordLink>{' '}
            · Adding modules or editing lessons changes every cohort using this curriculum.
          </p>
          <div className="app-surface divide-y divide-line">
            {cohort.modules.map((savedModule) => {
              const mod = { ...savedModule, assigned: assignedChanges[savedModule.id] ?? savedModule.assigned }
              const form = forms[mod.id] || {
                unlocked: false,
                module_start_date: '',
                requires_github: false,
                repository_name: '',
              }
              const saving = savingModuleId === mod.id
              return (
                <div key={mod.id} className="p-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                  <div className="flex flex-1 items-center gap-3 min-w-0">
                    {(() => {
                      const isAccessible =
                        form.unlocked ||
                        (form.module_start_date && dateFromDateOnly(form.module_start_date) <= new Date())
                      const isScheduled =
                        !form.unlocked &&
                        form.module_start_date &&
                        dateFromDateOnly(form.module_start_date) > new Date()
                      return (
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                            !mod.assigned
                              ? 'bg-surface-sunken text-ink-muted'
                              : isAccessible
                                ? 'bg-success-soft text-success-ink'
                                : isScheduled
                                  ? 'bg-info-soft text-info-ink'
                                  : 'bg-warning-soft text-warning-ink'
                          }`}
                        >
                          {!mod.assigned ? (
                            <Lock className="h-4 w-4" />
                          ) : isAccessible ? (
                            <Unlock className="h-4 w-4" />
                          ) : isScheduled ? (
                            <CalendarDays className="h-4 w-4" />
                          ) : (
                            <Lock className="h-4 w-4" />
                          )}
                        </div>
                      )
                    })()}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate" title={mod.name}>
                        <RecordLink
                          record={{ type: 'module', id: mod.id, cohortId: cohort.id }}
                          variant="plain"
                          touchTarget
                          truncate
                        >
                          {mod.name}
                        </RecordLink>
                      </p>
                      <p className="text-xs tabular-nums text-ink-muted first-letter:uppercase">
                        {mod.module_type.replace('_', ' ')} · {mod.lessons_count} lesson
                        {mod.lessons_count !== 1 ? 's' : ''} · {mod.assigned_count} assigned
                        {form.module_start_date && ` · Starts ${formatShortDate(form.module_start_date)}`}
                        {form.requires_github && ' · GitHub'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cohort.cohort_type === 'alumni' ? (
                      <Badge tone="success">Always available</Badge>
                    ) : !mod.assigned ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => assignModuleToCohort(mod.id)}
                        disabled={saving}
                      >
                        <Plus className="h-4 w-4" />
                        {saving ? 'Adding...' : 'Assign'}
                      </Button>
                    ) : (
                      <>
                        <LinkButton
                          variant="secondary"
                          size="sm"
                          to={cohortModuleGradingPath(Number(id), mod.id)}
                          state={listLinkState(location, originLabel(location.pathname) || 'Cohort')}
                        >
                          Grading
                        </LinkButton>
                        <Button variant="secondary" size="sm" onClick={() => setConfigureModuleId(mod.id)}>
                          Configure
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <ModuleSettingsDialog settings={settings} />
          {/* Resources — compact summary card */}
          <div className="grid grid-cols-1 gap-4">
            <button
              onClick={() => setShowResourcesModal(true)}
              type="button"
              className={
                'pressable min-h-11 rounded-2xl border border-line bg-surface-raised p-5 text-left ' +
                'shadow-raised hover:border-line-strong hover:bg-surface-sunken'
              }
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary">
                    <Link2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-ink">Class resources</h3>
                    <p className="text-xs tabular-nums text-ink-muted">
                      {classResources.length === 0
                        ? 'No resources yet'
                        : `${classResources.length} resource${classResources.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-ink-muted" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
