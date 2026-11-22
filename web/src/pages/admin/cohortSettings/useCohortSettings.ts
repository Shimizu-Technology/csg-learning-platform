import { useCallback, useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import type { CohortDelivery } from './DeliveryChoice'
import type { SavedReviewResponse } from '../../../components/admin/ReviewResponseSettings'
import { useAuthContext } from '../../../contexts/AuthContext'
import { useCohortContext } from '../../../contexts/CohortContext'
import { useConfirm } from '../../../contexts/ConfirmContext'
import { useToast } from '../../../contexts/ToastContext'
import { api } from '../../../lib/api'
import { toDateTimeInputValueInTimeZone } from '../../../lib/dateTime'
import { schoolTimeZone } from '../../../lib/schoolTime'
import {
  type ClassResource,
  COHORT_STATUS_OPTIONS,
  type CohortData,
  dateTimeInputToIso,
  emptyGuidedTerms,
  guidedTermParams,
  type SubmissionWindowForm,
  toDateInputValue,
  formatPaceWeeks,
  parsePaceWeeks,
  paceWeeksProblem,
} from './settingsForm'

export function useCohortSettings({ onSaved }: { onSaved?: () => Promise<unknown> } = {}) {
  const { user } = useAuthContext()
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const toast = useToast()
  const confirm = useConfirm()
  const { refreshCohorts } = useCohortContext()
  const [offeringDraft, setOfferingDraft] = useState<Record<string, unknown>>({})
  const [cohort, setCohort] = useState<CohortData | null>(null)
  const [saving, setSaving] = useState(false)
  const [reviewResponseDraft, setReviewResponseDraft] = useState<string | null | undefined>(undefined)
  const [savedReviewResponse, setSavedReviewResponse] = useState<SavedReviewResponse>()
  const [featureDraft, setFeatureDraft] = useState<Record<string, boolean | null> | null>(null)
  const [savedRevision, setSavedRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const savingResources = saving
  const [forms, setForms] = useState<
    Record<number, { unlocked: boolean; module_start_date: string; requires_github: boolean; repository_name: string }>
  >({})
  const [submissionWindows, setSubmissionWindows] = useState<Record<number, SubmissionWindowForm[]>>({})
  const [classResources, setClassResources] = useState<ClassResource[]>([])
  const [editCourseDelivery, setEditCourseDelivery] = useState<CohortDelivery>('program')
  const [guidedTerms, setGuidedTerms] = useState(emptyGuidedTerms)
  const [reviewTarget, setReviewTarget] = useState('')
  // Learner-chosen pace (W9.1): '' is off; otherwise the week choices, e.g. "3, 4, 6".
  const [editPaceWeeks, setEditPaceWeeks] = useState('')
  // On/off is its own state, so clearing the text doesn't turn pace off (or hide the field).
  const [editPaceEnabled, setEditPaceEnabled] = useState(false)
  const [editStartDate, setEditStartDate] = useState('')
  const [editGithubOrganization, setEditGithubOrganization] = useState('')
  const [editStatus, setEditStatus] = useState('active')
  const [showResourcesModal, setShowResourcesModal] = useState(false)
  const [resourcesMode, setResourcesMode] = useState<'view' | 'edit'>('view')
  const [configureModuleId, setConfigureModuleId] = useState<number | null>(null)
  const savingModuleId = saving ? configureModuleId : null

  const notifySuccess = (nextMessage: string) => {
    setMessage(nextMessage)
    toast.success(nextMessage)
  }

  const notifyError = (nextMessage: string) => {
    setMessage(nextMessage)
    toast.error(nextMessage)
  }

  const buildFormsFromCohort = useCallback((nextCohort: CohortData) => {
    const nextForms: Record<
      number,
      { unlocked: boolean; module_start_date: string; requires_github: boolean; repository_name: string }
    > = {}
    nextCohort.modules.forEach((mod: CohortData['modules'][0]) => {
      nextForms[mod.id] = {
        unlocked:
          mod.assigned &&
          (mod.default_unlocked ??
            (nextCohort.active_count > 0 ? mod.unlocked_count === nextCohort.active_count : false)),
        module_start_date: toDateInputValue(mod.module_start_date),
        requires_github: mod.requires_github || false,
        repository_name: mod.repository_name || '',
      }
    })
    return nextForms
  }, [])

  const buildSubmissionWindowsFromCohort = useCallback((nextCohort: CohortData) => {
    const nextWindows: Record<number, SubmissionWindowForm[]> = {}
    nextCohort.modules.forEach((mod: CohortData['modules'][0]) => {
      nextWindows[mod.id] = (mod.submission_windows || []).map((window) => ({
        week_number: window.week_number,
        submissions_close_at: toDateTimeInputValueInTimeZone(window.submissions_close_at, schoolTimeZone),
        submissions_closed: window.submissions_closed,
        status: window.status,
        starts_on: window.starts_on,
        ends_on: window.ends_on,
        lessons_count: window.lessons_count,
      }))
    })
    return nextWindows
  }, [])

  const applyCohort = useCallback(
    (nextCohort: CohortData) => {
      setCohort(nextCohort)
      setClassResources(nextCohort.class_resources || [])
      setEditCourseDelivery(nextCohort.course_delivery || 'program')
      setGuidedTerms({
        guided_access_ends_on: nextCohort.guided_access_ends_on || '',
        guided_support_ends_on: nextCohort.guided_support_ends_on || '',
        guided_access_months: nextCohort.guided_access_months?.toString() || '',
        guided_support_weeks: nextCohort.guided_support_weeks?.toString() || '',
      })
      setReviewTarget(nextCohort.review_sla_business_days?.toString() || '')
      setEditPaceWeeks(formatPaceWeeks(nextCohort.learner_pace_weeks))
      setEditPaceEnabled(Boolean(nextCohort.learner_pace_weeks?.length))
      setEditStartDate(toDateInputValue(nextCohort.start_date))
      setEditGithubOrganization(nextCohort.github_organization_name || '')
      setEditStatus(nextCohort.status)
      setForms(buildFormsFromCohort(nextCohort))
      setSubmissionWindows(buildSubmissionWindowsFromCohort(nextCohort))
    },
    [buildFormsFromCohort, buildSubmissionWindowsFromCohort],
  )

  const reloadCohort = useCallback(async () => {
    if (!id) return null

    setLoadError('')
    let res
    try {
      res = await api.getCohort(Number(id))
    } catch {
      setLoadError('Could not load cohort settings.')
      setLoading(false)
      return null
    }
    const nextCohort = res.data?.cohort as CohortData | undefined
    if (nextCohort) applyCohort(nextCohort)
    else setLoadError(res.error || 'Could not load cohort settings.')
    setLoading(false)
    return nextCohort || null
  }, [applyCohort, id])

  useEffect(() => {
    void reloadCohort()
  }, [reloadCohort])

  const [loadError, setLoadError] = useState('')
  const saveSettings = async () => {
    if (!id || !cohort) return
    const pacing = editPaceEnabled && editCourseDelivery !== 'program'
    if (pacing && paceWeeksProblem(editPaceWeeks)) {
      notifyError(paceWeeksProblem(editPaceWeeks)!)
      return
    }
    setSaving(true)
    try {
      const candidates = {
        start_date: editStartDate,
        github_organization_name: editGithubOrganization.trim() || null,
        status: editStatus,
        course_delivery: editCourseDelivery,
        ...guidedTermParams(editCourseDelivery === 'guided' ? guidedTerms : emptyGuidedTerms),
        review_sla_business_days: reviewTarget ? Number(reviewTarget) : null,
      }
      const baseline = {
        start_date: toDateInputValue(cohort.start_date),
        github_organization_name: cohort.github_organization_name || null,
        status: cohort.status,
        course_delivery: cohort.course_delivery || 'program',
        guided_access_ends_on: cohort.guided_access_ends_on || null,
        guided_support_ends_on: cohort.guided_support_ends_on || null,
        guided_access_months: cohort.guided_access_months ?? null,
        guided_support_weeks: cohort.guided_support_weeks ?? null,
        review_sla_business_days: cohort.review_sla_business_days ?? null,
      }
      // Pace is only for guided and self-paced delivery; a live program clears it.
      const paceWeeks = pacing ? parsePaceWeeks(editPaceWeeks) : null
      const paceChange = JSON.stringify(paceWeeks) !== JSON.stringify(cohort.learner_pace_weeks?.length ? cohort.learner_pace_weeks : null)
        ? { learner_pace_weeks: paceWeeks }
        : {}
      const patch = {
        ...Object.fromEntries(
          Object.entries(candidates).filter(([key, value]) => value !== baseline[key as keyof typeof baseline]),
        ),
        ...paceChange,
        ...offeringDraft,
      }
      const res = Object.keys(patch).length
        ? await api.updateCohort(Number(id), patch)
        : { data: { cohort }, error: undefined }
      if (res.error || !res.data?.cohort) notifyError(res.error || 'Could not save settings. Your edits are preserved.')
      else {
        // Keep every local draft on partial failure; retry is idempotent.
        for (const mod of cohort.modules) {
          const form = forms[mod.id]
          if (
            mod.id in assignedChanges ||
            JSON.stringify(form) !== JSON.stringify(buildFormsFromCohort(cohort)[mod.id])
          ) {
            const result = await api.updateCohortModuleAccess(Number(id), {
              module_id: mod.id,
              assigned: assignedChanges[mod.id] ?? mod.assigned,
              unlocked: form.unlocked,
              ...(form.module_start_date !== toDateInputValue(mod.module_start_date)
                ? { module_start_date: form.module_start_date || null }
                : {}),
              requires_github: form.requires_github,
              repository_name: form.repository_name,
            })
            if (result.error) throw new Error(result.error)
          }
          if (
            JSON.stringify(submissionWindows[mod.id]) !==
            JSON.stringify(buildSubmissionWindowsFromCohort(cohort)[mod.id])
          ) {
            const result = await api.updateCohortModuleSubmissionWindows(
              Number(id),
              mod.id,
              (submissionWindows[mod.id] || []).map((window) => ({
                week_number: window.week_number,
                submissions_close_at: dateTimeInputToIso(window.submissions_close_at),
              })),
            )
            if (result.error) throw new Error(result.error)
          }
        }
        if (JSON.stringify(classResources) !== JSON.stringify(cohort.class_resources || [])) {
          const result = await api.updateCohortClassResources(Number(id), classResources)
          if (result.error) throw new Error(result.error)
        }
        if (featureDraft || reviewResponseDraft !== undefined) {
          const result = await api.saveFeatureSettings(
            {
              ...(featureDraft ? { features: featureDraft } : {}),
              ...(reviewResponseDraft !== undefined ? { review_response_time: reviewResponseDraft } : {}),
            },
            Number(id),
          )
          if (result.error || !result.data) throw new Error('Could not save features')
          if (reviewResponseDraft !== undefined)
            setSavedReviewResponse({ cohortId: Number(id), value: reviewResponseDraft })
        }
        const fresh = await reloadCohort()
        if (!fresh) throw new Error('Could not refresh settings')
        setOfferingDraft({})
        setFeatureDraft(null)
        setReviewResponseDraft(undefined)
        setSavedReviewResponse(undefined)
        setAssignedChanges({})
        setSavedRevision((v) => v + 1)
        notifySuccess('Cohort settings saved')
        await onSaved?.()
      }
    } catch {
      notifyError('Some settings may have saved. Your edits are preserved; retry Save settings to finish.')
    } finally {
      try {
        await refreshCohorts()
      } catch {
        notifyError('Could not refresh the cohort list. Reload to see the latest status.')
      } finally {
        setSaving(false)
      }
    }
  }
  const chooseStatus = async (value: string) => {
    if (value === editStatus) return
    const approved = await confirm({
      title: value === 'archived' ? 'Archive cohort?' : `Mark cohort ${value}?`,
      tone: value === 'archived' ? 'danger' : 'default',
      description: `${COHORT_STATUS_OPTIONS.find((option) => option.value === value)?.description} Students, submissions, progress and recordings are kept. Existing course access dates are unchanged. Save settings to apply this change.`,
      confirmLabel: 'Change status',
      cancelLabel: 'Keep status',
    })
    if (approved) setEditStatus(value)
  }

  const updateForm = (
    moduleId: number,
    patch: Partial<{ unlocked: boolean; module_start_date: string; requires_github: boolean; repository_name: string }>,
  ) => {
    setForms((prev) => ({
      ...prev,
      [moduleId]: {
        ...prev[moduleId],
        ...patch,
      },
    }))
  }

  const saveClassResources = async () => {
    setShowResourcesModal(false)
  }

  const updateSubmissionWindow = (moduleId: number, weekNumber: number, closeAt: string) => {
    setSubmissionWindows((prev) => ({
      ...prev,
      [moduleId]: (prev[moduleId] || []).map((window) =>
        window.week_number === weekNumber ? { ...window, submissions_close_at: closeAt } : window,
      ),
    }))
  }

  const saveModuleConfiguration = async () => {
    setConfigureModuleId(null)
  }
  const saveOnlySubmissionWindows = saveModuleConfiguration
  const [assignedChanges, setAssignedChanges] = useState<Record<number, boolean>>({})
  const assignModuleToCohort = async (moduleId: number) => {
    setAssignedChanges((current) => ({ ...current, [moduleId]: true }))
    setConfigureModuleId(moduleId)
  }
  const removeModuleFromCohort = async (moduleId: number) => {
    const approved = await confirm({
      title: 'Remove module from this cohort?',
      description: 'Learners lose access after you save settings. Submissions and progress are kept.',
      confirmLabel: 'Remove module',
      cancelLabel: 'Keep module',
    })
    if (approved) setAssignedChanges((current) => ({ ...current, [moduleId]: false }))
    return approved
  }

  return {
    user,
    id,
    location,
    offeringDraft,
    setOfferingDraft,
    cohort,
    saving,
    reviewResponseDraft,
    setReviewResponseDraft,
    savedReviewResponse,
    featureDraft,
    setFeatureDraft,
    savedRevision,
    loading,
    message,
    savingResources,
    forms,
    submissionWindows,
    classResources,
    setClassResources,
    editCourseDelivery,
    setEditCourseDelivery,
    guidedTerms,
    setGuidedTerms,
    reviewTarget,
    setReviewTarget,
    editPaceWeeks,
    setEditPaceWeeks,
    editPaceEnabled,
    setEditPaceEnabled,
    editStartDate,
    setEditStartDate,
    editGithubOrganization,
    setEditGithubOrganization,
    editStatus,
    showResourcesModal,
    setShowResourcesModal,
    resourcesMode,
    setResourcesMode,
    configureModuleId,
    setConfigureModuleId,
    savingModuleId,
    buildFormsFromCohort,
    buildSubmissionWindowsFromCohort,
    reloadCohort,
    loadError,
    saveSettings,
    chooseStatus,
    updateForm,
    saveClassResources,
    updateSubmissionWindow,
    saveModuleConfiguration,
    saveOnlySubmissionWindows,
    assignedChanges,
    assignModuleToCohort,
    removeModuleFromCohort,
  }
}
export type CohortSettingsController = ReturnType<typeof useCohortSettings> & { cohort: CohortData }
