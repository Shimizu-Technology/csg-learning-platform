import { GithubAppSettings } from '../../components/admin/GithubAppSettings'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { UnsavedChangesGuard } from '../../components/shared/UnsavedChangesGuard'
import { Button } from '../../components/ui/Button'

import { ModuleSettings } from './cohortSettings/ModuleSettings'
import { ResourceSettingsDialog } from './cohortSettings/ResourceSettingsDialog'
import { SettingsFields } from './cohortSettings/SettingsFields'
import { toDateInputValue } from './cohortSettings/settingsForm'
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
    editAccessEnd,
    editSupportEnd,
    editStartDate,
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
  return (
    <>
    {settings.user?.role === 'admin' && cohort.features?.github_app === true && <div className="mb-6"><GithubAppSettings cohortId={cohort.id} /></div>}
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
        className="min-w-0 space-y-6 max-lg:pb-20 max-lg:[&_input]:text-base max-lg:[&_select]:text-base max-lg:[&_textarea]:text-base"
      >
        <UnsavedChangesGuard
          pathnameOnly={false}
          dirty={
            reviewResponseDraft !== undefined ||
            featureDraft !== null ||
            Object.keys(assignedChanges).length > 0 ||
            Object.keys(offeringDraft).length > 0 ||
            editStartDate !== toDateInputValue(cohort.start_date) ||
            editGithubOrganization !== (cohort.github_organization_name || '') ||
            editStatus !== cohort.status ||
            editCourseDelivery !== (cohort.course_delivery || 'program') ||
            editAccessEnd !== (cohort.guided_access_ends_on || '') ||
            editSupportEnd !== (cohort.guided_support_ends_on || '') ||
            JSON.stringify(classResources) !== JSON.stringify(cohort.class_resources || []) ||
            JSON.stringify(forms) !== JSON.stringify(buildFormsFromCohort(cohort)) ||
            JSON.stringify(submissionWindows) !== JSON.stringify(buildSubmissionWindowsFromCohort(cohort))
          }
        />
        <SettingsFields settings={ready} />
        <Button
          className={
            'hide-with-keyboard fixed inset-x-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-20 ' +
            'lg:sticky lg:inset-x-auto lg:bottom-4'
          }
          type="submit"
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
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
    </>
  )
}
