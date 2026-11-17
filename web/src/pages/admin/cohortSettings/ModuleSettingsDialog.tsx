import { CalendarDays, Github, Save, Trash2 } from 'lucide-react'
import { Modal } from '../../../components/shared/Modal'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { formatShortDateTime } from '../../../lib/format'
import { schoolTimeDescription, schoolTimeGenericLabel, schoolTimeLabel } from '../../../lib/schoolTime'
import {
  dateTimeInputToIso,
  formatDateLabel,
  nowDateTimeInputValue,
  submissionWindowStatusForForm,
} from './settingsForm'
import type { CohortSettingsController } from './useCohortSettings'

export function ModuleSettingsDialog({ settings }: { settings: CohortSettingsController }) {
  const {
    cohort,
    forms,
    submissionWindows,
    configureModuleId,
    setConfigureModuleId,
    savingModuleId,
    updateForm,
    updateSubmissionWindow,
    saveModuleConfiguration,
    saveOnlySubmissionWindows,
    removeModuleFromCohort,
  } = settings
  return (
    <>
      {/* Module Configuration Modal */}
      {(() => {
        const configureMod = cohort.modules.find((m) => m.id === configureModuleId)
        if (!configureMod) return null
        const form = forms[configureMod.id] || {
          unlocked: false,
          module_start_date: '',
          requires_github: false,
          repository_name: '',
        }
        const windowForms = submissionWindows[configureMod.id] || []
        const saving = savingModuleId === configureMod.id
        return (
          <Modal
            open
            onClose={() => setConfigureModuleId(null)}
            title={configureMod.name}
            subtitle={`${configureMod.module_type.replace('_', ' ')} · ${configureMod.lessons_count} lessons`}
            size="lg"
            footer={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  variant="danger"
                  onClick={() => {
                    // Close Configure only after a confirmed, successful removal; "Keep module" leaves it open.
                    void removeModuleFromCohort(configureMod.id).then((removed) => {
                      if (removed) setConfigureModuleId(null)
                    })
                  }}
                  disabled={saving}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove from cohort
                </Button>
                <Button onClick={() => void saveModuleConfiguration()} disabled={saving}>
                  <Save className="h-4 w-4" />
                  Done editing module
                </Button>
              </div>
            }
          >
            <div className="space-y-5 max-lg:[&_input]:text-base max-lg:[&_select]:text-base">
              <p className="text-sm text-ink-secondary">
                Module selection and access settings apply to current students and students who join later. Individual
                student overrides stay separate.
              </p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-xl bg-surface-sunken border border-line px-3 py-2">
                  <p className="text-xs text-ink-muted">Assigned</p>
                  <p className="font-semibold tabular-nums text-ink">{configureMod.assigned_count}</p>
                </div>
                <div className="rounded-xl bg-surface-sunken border border-line px-3 py-2">
                  <p className="text-xs text-ink-muted">Accessible</p>
                  <p className="font-semibold tabular-nums text-ink">{configureMod.accessible_count}</p>
                </div>
                <div className="rounded-xl bg-surface-sunken border border-line px-3 py-2">
                  <p className="text-xs text-ink-muted">Force unlocked</p>
                  <p className="font-semibold tabular-nums text-ink">{configureMod.unlocked_count}</p>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1 text-xs font-semibold text-ink-secondary mb-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Module start date
                </label>
                <input
                  type="date"
                  value={form.module_start_date}
                  onChange={(e) => updateForm(configureMod.id, { module_start_date: e.target.value })}
                  className="app-control w-full"
                />
                <p className="mt-1 text-xs text-ink-muted">
                  This is the first actual release day of Week 1 for this cohort. Later lessons follow the module
                  schedule from there.
                  {configureMod.uses_default_start_date
                    ? ' Right now this module is still using the cohort-based fallback.'
                    : ''}
                </p>
              </div>

              <label className="flex min-h-11 items-center gap-2 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={form.unlocked}
                  onChange={(e) => updateForm(configureMod.id, { unlocked: e.target.checked })}
                  className="rounded border-line-strong text-primary-ink focus:ring-focus"
                />
                Make module accessible (lessons still follow their release-day schedule)
              </label>

              <div className="rounded-xl border border-line bg-surface-sunken p-3 space-y-2">
                <label className="flex min-h-11 items-center gap-2 text-sm text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={form.requires_github}
                    onChange={(e) => updateForm(configureMod.id, { requires_github: e.target.checked })}
                    className="rounded border-line-strong text-primary-ink focus:ring-focus"
                  />
                  <Github className="h-3.5 w-3.5" />
                  Require GitHub submissions for this module
                </label>
                {form.requires_github && (
                  <div>
                    <label className="block text-xs font-semibold text-ink-secondary mb-1">Repository name</label>
                    <input
                      type="text"
                      value={form.repository_name}
                      onChange={(e) => updateForm(configureMod.id, { repository_name: e.target.value })}
                      placeholder="e.g., prework-exercises"
                      className="app-control w-full"
                    />
                    <p className="mt-1 text-xs text-ink-muted">
                      The repo name under each student's GitHub account to sync from.
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-line bg-surface-raised p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-ink">Submission windows</h3>
                    <p className="mt-1 text-xs leading-5 text-ink-muted">
                      Set a close time for each week. Students can still view lessons and videos after a week closes,
                      but submissions and redo resubmissions are blocked.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void saveOnlySubmissionWindows()}
                    disabled={saving}
                  >
                    <Save className="h-4 w-4" />
                    Done editing windows
                  </Button>
                </div>

                {windowForms.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed border-line bg-surface-sunken px-4 py-5 text-center text-sm text-ink-muted">
                    Add lessons to this module before configuring weekly submission windows.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {windowForms.map((window) => {
                      const displayStatus = submissionWindowStatusForForm(window)
                      const statusTone: BadgeTone =
                        displayStatus === 'closed' ? 'warning' : displayStatus === 'scheduled' ? 'info' : 'success'
                      const statusLabel =
                        displayStatus === 'closed' ? 'Closed' : displayStatus === 'scheduled' ? 'Scheduled' : 'Open'

                      return (
                        <div key={window.week_number} className="rounded-xl border border-line bg-surface-sunken p-3">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold tabular-nums text-ink">Week {window.week_number}</p>
                                <Badge tone={statusTone}>{statusLabel}</Badge>
                              </div>
                              <p className="mt-1 text-xs tabular-nums text-ink-muted">
                                {window.starts_on
                                  ? `${formatDateLabel(window.starts_on)} – ${formatDateLabel(window.ends_on)}`
                                  : 'Dates depend on module start'}
                                {typeof window.lessons_count === 'number'
                                  ? ` · ${window.lessons_count} lesson${window.lessons_count !== 1 ? 's' : ''}`
                                  : ''}
                              </p>
                              <p className="mt-1 text-xs tabular-nums text-ink-muted">
                                {window.submissions_close_at
                                  ? `Closes ${formatShortDateTime(dateTimeInputToIso(window.submissions_close_at), 'Not scheduled')}`
                                  : 'No close time set'}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="datetime-local"
                                value={window.submissions_close_at}
                                onChange={(event) =>
                                  updateSubmissionWindow(configureMod.id, window.week_number, event.target.value)
                                }
                                aria-label={
                                  'Week ' +
                                  window.week_number +
                                  ' submissions close (' +
                                  schoolTimeDescription() +
                                  ', ' +
                                  (window.submissions_close_at && dateTimeInputToIso(window.submissions_close_at)
                                    ? schoolTimeLabel(new Date(dateTimeInputToIso(window.submissions_close_at)!))
                                    : schoolTimeGenericLabel()) +
                                  ')'
                                }
                                className="app-control w-full sm:w-auto"
                              />
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  updateSubmissionWindow(configureMod.id, window.week_number, nowDateTimeInputValue())
                                }
                              >
                                Lock now
                              </Button>
                              <Button
                                variant="quiet"
                                size="sm"
                                onClick={() => updateSubmissionWindow(configureMod.id, window.week_number, '')}
                              >
                                Clear
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </Modal>
        )
      })()}
    </>
  )
}
