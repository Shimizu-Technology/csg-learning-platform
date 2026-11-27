import { GithubAppSettings } from '../../components/admin/GithubAppSettings'
import { GithubSyncHealthPanel } from '../../components/admin/GithubSyncHealthPanel'
import { ReleaseCommunicationsPanel } from '../../components/admin/ReleaseCommunicationsPanel'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { UnsavedChangesGuard } from '../../components/shared/UnsavedChangesGuard'
import { Button } from '../../components/ui/Button'

import { ModuleSettings } from './cohortSettings/ModuleSettings'
import { ResourceSettingsDialog } from './cohortSettings/ResourceSettingsDialog'
import { SettingsFields } from './cohortSettings/SettingsFields'
import { formatPaceWeeks, toDateInputValue } from './cohortSettings/settingsForm'
import { useCohortSettings } from './cohortSettings/useCohortSettings'

export function CohortSettings({ onSaved }: { onSaved?: () => Promise<unknown> } = {}) {
  const settings = useCohortSettings({ onSaved })
  const {
    loading,
    loadError,
    reloadCohort,
    offeringDraft,
    cohort,
    saving,
    reviewResponseDraft,
    featureDraft,
    message,
    forms,
    submissionWindows,
    classResources,
    editCourseDelivery,
    guidedTerms,
    reviewTarget,
    editPaceWeeks,
    editPaceEnabled,
    editStartDate,
    editEndDate,
    editGithubOrganization,
    editStatus,
    buildFormsFromCohort,
    buildSubmissionWindowsFromCohort,
    saveSettings,
    assignedChanges,
  } = settings
  if (loading) return <LoadingSpinner message="Loading cohort..." />
  if (!cohort)
    return (
      <section role="alert" className="app-surface p-5">
        <p>{loadError || 'Could not load cohort settings.'}</p>
        <Button onClick={() => void reloadCohort()}>Retry settings</Button>
      </section>
    )
  const ready = { ...settings, cohort }
  const githubRelevant = cohort.features?.github_app === true || cohort.modules.some((mod) => mod.requires_github)
  const dirty =
    reviewResponseDraft !== undefined ||
    featureDraft !== null ||
    settings.nextStepChanged ||
    Object.keys(assignedChanges).length > 0 ||
    Object.keys(offeringDraft).length > 0 ||
    editStartDate !== toDateInputValue(cohort.start_date) ||
    editEndDate !== toDateInputValue(cohort.end_date) ||
    editGithubOrganization !== (cohort.github_organization_name || '') ||
    editStatus !== cohort.status ||
    editCourseDelivery !== (cohort.course_delivery || 'program') ||
    guidedTerms.guided_access_ends_on !== (cohort.guided_access_ends_on || '') ||
    guidedTerms.guided_support_ends_on !== (cohort.guided_support_ends_on || '') ||
    guidedTerms.guided_access_months !== (cohort.guided_access_months?.toString() || '') ||
    guidedTerms.guided_support_weeks !== (cohort.guided_support_weeks?.toString() || '') ||
    reviewTarget !== (cohort.review_sla_business_days?.toString() || '') ||
    editPaceEnabled !== Boolean(cohort.learner_pace_weeks?.length) ||
    (editPaceEnabled && editPaceWeeks !== formatPaceWeeks(cohort.learner_pace_weeks)) ||
    JSON.stringify(classResources) !== JSON.stringify(cohort.class_resources || []) ||
    JSON.stringify(forms) !== JSON.stringify(buildFormsFromCohort(cohort)) ||
    JSON.stringify(submissionWindows) !== JSON.stringify(buildSubmissionWindowsFromCohort(cohort))
  return (
    <>
    {settings.user?.role === 'admin' && githubRelevant && (
      <div className="mb-6 space-y-6">
        <GithubSyncHealthPanel cohortId={cohort.id} />
        {cohort.features?.github_app === true && <GithubAppSettings cohortId={cohort.id} />}
      </div>
    )}
    <form
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          event.target instanceof HTMLInputElement &&
          event.target.closest('[role="dialog"]')
        )
          event.preventDefault()
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (!(event.target as HTMLElement).closest('[role="dialog"]')) void saveSettings()
      }}
    >
      <fieldset
        disabled={saving}
        className={`min-w-0 space-y-6 max-lg:[&_input]:text-base max-lg:[&_select]:text-base max-lg:[&_textarea]:text-base ${dirty || saving ? 'max-lg:pb-24' : ''}`}
      >
        <UnsavedChangesGuard pathnameOnly={false} dirty={dirty} />
        <SettingsFields settings={ready} />
        {dirty || saving ? (
          <div
            data-testid="cohort-save-bar"
            className="hide-with-keyboard fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-20 flex items-center justify-between gap-3 border-t border-line bg-surface-overlay px-4 py-3 shadow-overlay lg:sticky lg:inset-x-auto lg:bottom-4 lg:rounded-2xl lg:border"
          >
            <span className="text-sm font-semibold text-ink-secondary">
              {saving ? 'Saving changes…' : 'Unsaved changes'}
            </span>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        ) : (
          <div className="hidden justify-end lg:flex">
            <Button type="submit" variant="secondary" disabled={saving}>
              Save settings
            </Button>
          </div>
        )}
        {message && (
          <div
            role="status"
            className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary"
          >
            {message}
          </div>
        )}

        <ModuleSettings settings={ready} />
        <ResourceSettingsDialog settings={ready} />
      </fieldset>
    </form>
    <div className="mt-6">
      <ReleaseCommunicationsPanel cohortId={cohort.id} />
    </div>
    </>
  )
}
