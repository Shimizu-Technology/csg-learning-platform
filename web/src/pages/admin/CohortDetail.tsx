import { schoolTimeDescription, schoolTimeGenericLabel, schoolTimeLabel, schoolTimeZone, schoolWallTimeToIso } from '../../lib/schoolTime'
import { UnsavedChangesGuard } from '../../components/shared/UnsavedChangesGuard'
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useParams, Link } from 'react-router-dom'
import { Save, Lock, Unlock, Link2, Plus, Trash2, CalendarDays, ExternalLink, Github, Keyboard } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortPath, cohortModuleGradingPath } from '../../lib/routes'
import { listLinkState } from '../../lib/navigationContext'
import { originLabel } from '../../lib/recordOrigin'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Modal } from '../../components/shared/Modal'
import { FeatureSettings } from '../../components/admin/FeatureSettings'
import { CourseOfferingSettings } from '../../components/admin/CourseOfferingSettings'
import { useAuthContext } from '../../contexts/AuthContext'
import type { CourseOfferingTerms } from '../../types/api'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { toDateTimeInputValueInTimeZone } from '../../lib/dateTime'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import type { InviteState } from '../../types/api'
import { Button, LinkButton } from '../../components/ui/Button'
import { SegmentButton, SegmentedControl } from '../../components/ui/Choice'
import type { OfficeHour, OfficeHourOccurrence } from '../../types/api'
import { RecordLink } from '../../components/shared/RecordLink'

interface ClassResource {
  title: string
  url: string
  category?: string
  description?: string
}

interface SubmissionWindowForm {
  week_number: number
  submissions_close_at: string
  submissions_closed: boolean
  status: 'open' | 'scheduled' | 'closed'
  starts_on?: string | null
  ends_on?: string | null
  lessons_count?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CohortData = Record<string, any> & CourseOfferingTerms & {
  id: number
  name: string
  curriculum_id: number
  curriculum_name: string
  start_date: string
  status: string
  active_count: number
  uploaded_recordings_count?: number
  recording_library_count?: number
  requires_github?: boolean
  repository_name?: string | null
  github_organization_name?: string | null
  course_delivery?: 'program' | 'guided' | 'self_paced'
  guided_access_ends_on?: string | null
  guided_support_ends_on?: string | null
  class_resources?: ClassResource[]
  office_hours?: OfficeHour[]
  office_hour_occurrences?: OfficeHourOccurrence[]
  students: Array<{
    enrollment_id: number
    user_id: number
    full_name: string
    email: string
    status: string
    last_sign_in_at?: string | null
    last_seen_at?: string | null
    invite_pending?: boolean
    invite_delivery_status?: 'not_sent' | 'queued' | 'sent' | 'failed' | 'accepted'
    invite_state?: InviteState
    invite_sent_at?: string | null
    invite_expires_at?: string | null
    invite_last_error?: string | null
  }>
  modules: Array<{
    id: number
    name: string
    module_type: string
    position: number
    lessons_count: number
    assigned_count: number
    assigned: boolean
    default_unlocked?: boolean
    unlocked_count: number
    accessible_count: number
    module_start_date: string
    uses_default_start_date: boolean
    requires_github?: boolean
    repository_name?: string | null
    week_count?: number
    submission_windows?: Array<{
      week_number: number
      submissions_close_at: string | null
      submissions_closed: boolean
      status: 'open' | 'scheduled' | 'closed'
      starts_on?: string | null
      ends_on?: string | null
      lessons_count?: number
    }>
  }>
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function dateFromDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toDateInputValue(dateStr?: string | null): string {
  if (!dateStr) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr

  return formatDateInputValue(new Date(dateStr))
}

// Submission close times use the school zone, independent of the device zone.
function dateTimeInputToIso(value?: string | null): string | null {
  if (!value) return null

  return schoolWallTimeToIso(value)
}

function formatDateLabel(value?: string | null) { return value ? formatShortDate(toDateInputValue(value), '') : '' }

function nowDateTimeInputValue(): string {
  return toDateTimeInputValueInTimeZone(new Date().toISOString(), schoolTimeZone)
}

function submissionWindowStatusForForm(window: SubmissionWindowForm): SubmissionWindowForm['status'] {
  if (!window.submissions_close_at) return 'open'

  const closeAtIso = dateTimeInputToIso(window.submissions_close_at)
  if (!closeAtIso) return 'scheduled'

  return new Date(closeAtIso) <= new Date() ? 'closed' : 'scheduled'
}

const COHORT_STATUS_OPTIONS = [
  { value: 'upcoming', label: 'Upcoming', description: 'Planned cohort. The offering leaves the catalog and checkout. Students do not appear in attention lists.' },
  { value: 'active', label: 'Active', description: 'Running cohort. Class chat and direct messages accept messages, self-paced instructor help is available during the help period, students appear in attention lists, and eligible offerings can appear in the catalog and checkout.' },
  { value: 'completed', label: 'Completed', description: 'Finished cohort kept for reference and replays. Class chat and direct messages become read-only. Self-paced instructor help stops. The offering leaves the catalog and checkout. Students drop out of attention lists.' },
  { value: 'archived', label: 'Archived', description: 'Moves to Past cohorts. Class chat and direct messages become read-only. Self-paced instructor help stops. The offering leaves the catalog and checkout. Students drop out of attention lists.' },
] as const

const RESOURCE_CATEGORY_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'meeting', label: 'Meeting link' },
  { value: 'github', label: 'GitHub' },
  { value: 'communication', label: 'Communication' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'hotkeys', label: 'Keyboard shortcuts' },
]

const RESOURCE_CATEGORY_LABELS = RESOURCE_CATEGORY_OPTIONS.reduce<Record<string, string>>((labels, option) => {
  labels[option.value] = option.label
  return labels
}, {})




export function CohortSettings({ onSaved }: { onSaved?: () => Promise<unknown> } = {}) {
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
  const [featureDraft, setFeatureDraft] = useState<Record<string, boolean | null> | null>(null)
  const [savedRevision, setSavedRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const savingResources = saving
  const [forms, setForms] = useState<Record<number, { unlocked: boolean; module_start_date: string; requires_github: boolean; repository_name: string }>>({})
  const [submissionWindows, setSubmissionWindows] = useState<Record<number, SubmissionWindowForm[]>>({})
  const [classResources, setClassResources] = useState<ClassResource[]>([])
  const [editCourseDelivery, setEditCourseDelivery] = useState<'program' | 'guided' | 'self_paced'>('program')
  const [editAccessEnd, setEditAccessEnd] = useState('')
  const [editSupportEnd, setEditSupportEnd] = useState('')
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
    const nextForms: Record<number, { unlocked: boolean; module_start_date: string; requires_github: boolean; repository_name: string }> = {}
    nextCohort.modules.forEach((mod: CohortData['modules'][0]) => {
      nextForms[mod.id] = {
        unlocked: mod.assigned && (mod.default_unlocked ?? (nextCohort.active_count > 0 ? mod.unlocked_count === nextCohort.active_count : false)),
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

  const applyCohort = useCallback((nextCohort: CohortData) => {
    setCohort(nextCohort)
    setClassResources(nextCohort.class_resources || [])
    setEditCourseDelivery(nextCohort.course_delivery || 'program')
    setEditAccessEnd(nextCohort.guided_access_ends_on || '')
    setEditSupportEnd(nextCohort.guided_support_ends_on || '')
    setEditStartDate(toDateInputValue(nextCohort.start_date))
    setEditGithubOrganization(nextCohort.github_organization_name || '')
    setEditStatus(nextCohort.status)
    setForms(buildFormsFromCohort(nextCohort))
    setSubmissionWindows(buildSubmissionWindowsFromCohort(nextCohort))
  }, [buildFormsFromCohort, buildSubmissionWindowsFromCohort])

  const reloadCohort = useCallback(async () => {
    if (!id) return null

    setLoadError('')
    let res
    try { res = await api.getCohort(Number(id)) } catch { setLoadError('Could not load cohort settings.'); setLoading(false); return null }
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
    setSaving(true)
    try {
      const candidates = {
        start_date: editStartDate, github_organization_name: editGithubOrganization.trim() || null,
        status: editStatus, course_delivery: editCourseDelivery,
        // Guided dates only exist for guided delivery; leaving guided clears them.
        guided_access_ends_on: editCourseDelivery === 'guided' ? editAccessEnd || null : null,
        guided_support_ends_on: editCourseDelivery === 'guided' ? editSupportEnd || null : null,
      }
      const baseline = { start_date: toDateInputValue(cohort.start_date), github_organization_name: cohort.github_organization_name || null,
        status: cohort.status, course_delivery: cohort.course_delivery || 'program',
        guided_access_ends_on: cohort.guided_access_ends_on || null, guided_support_ends_on: cohort.guided_support_ends_on || null }
      const patch = { ...Object.fromEntries(Object.entries(candidates).filter(([key, value]) => value !== baseline[key as keyof typeof baseline])), ...offeringDraft }
      const res = Object.keys(patch).length ? await api.updateCohort(Number(id), patch) : { data: { cohort }, error: undefined }
      if (res.error || !res.data?.cohort) notifyError(res.error || 'Could not save settings. Your edits are preserved.')
      else {
        // Keep every local draft on partial failure; retry is idempotent.
        for (const mod of cohort.modules) {
          const form = forms[mod.id]
          if (mod.id in assignedChanges || JSON.stringify(form) !== JSON.stringify(buildFormsFromCohort(cohort)[mod.id])) {
            const result = await api.updateCohortModuleAccess(Number(id), { module_id: mod.id, assigned: assignedChanges[mod.id] ?? mod.assigned, unlocked: form.unlocked, ...(form.module_start_date !== toDateInputValue(mod.module_start_date) ? { module_start_date: form.module_start_date || null } : {}), requires_github: form.requires_github, repository_name: form.repository_name })
            if (result.error) throw new Error(result.error)
          }
          if (JSON.stringify(submissionWindows[mod.id]) !== JSON.stringify(buildSubmissionWindowsFromCohort(cohort)[mod.id])) {
            const result = await api.updateCohortModuleSubmissionWindows(Number(id), mod.id, (submissionWindows[mod.id] || []).map(window => ({ week_number: window.week_number, submissions_close_at: dateTimeInputToIso(window.submissions_close_at) })))
            if (result.error) throw new Error(result.error)
          }
        }
        if (JSON.stringify(classResources) !== JSON.stringify(cohort.class_resources || [])) {
          const result = await api.updateCohortClassResources(Number(id), classResources)
          if (result.error) throw new Error(result.error)
        }
        if (featureDraft || reviewResponseDraft !== undefined) {
          const result = await api.saveFeatureSettings({ ...(featureDraft ? { features: featureDraft } : {}), ...(reviewResponseDraft !== undefined ? { review_response_time: reviewResponseDraft } : {}) }, Number(id))
          if (result.error || !result.data) throw new Error('Could not save features')
        }
        const fresh = await reloadCohort()
        if (!fresh) throw new Error('Could not refresh settings')
        setOfferingDraft({}); setFeatureDraft(null); setReviewResponseDraft(undefined); setAssignedChanges({}); setSavedRevision(v => v + 1); notifySuccess('Cohort settings saved'); await onSaved?.()
      }
    } catch { notifyError('Some settings may have saved. Your edits are preserved; retry Save settings to finish.') }
    finally { try { await refreshCohorts() } catch { notifyError('Could not refresh the cohort list. Reload to see the latest status.') } finally { setSaving(false) } }
  }
  const chooseStatus = async (value: string) => {
    if (value === editStatus) return
    const approved = await confirm({ title: value === 'archived' ? 'Archive cohort?' : `Mark cohort ${value}?`, tone: value === 'archived' ? 'danger' : 'default', description: `${COHORT_STATUS_OPTIONS.find(option => option.value === value)?.description} Students, submissions, progress and recordings are kept. Existing course access dates are unchanged. Save settings to apply this change.`, confirmLabel: 'Change status', cancelLabel: 'Keep status' })
    if (approved) setEditStatus(value)
  }

  const updateForm = (moduleId: number, patch: Partial<{ unlocked: boolean; module_start_date: string; requires_github: boolean; repository_name: string }>) => {
    setForms((prev) => ({
      ...prev,
      [moduleId]: {
        ...prev[moduleId],
        ...patch,
      },
    }))
  }

  const saveClassResources = async () => { setShowResourcesModal(false) }

  const updateSubmissionWindow = (moduleId: number, weekNumber: number, closeAt: string) => {
    setSubmissionWindows((prev) => ({
      ...prev,
      [moduleId]: (prev[moduleId] || []).map((window) => (
        window.week_number === weekNumber ? { ...window, submissions_close_at: closeAt } : window
      )),
    }))
  }

  const saveModuleConfiguration = async () => { setConfigureModuleId(null) }
  const saveOnlySubmissionWindows = saveModuleConfiguration
  const [assignedChanges, setAssignedChanges] = useState<Record<number, boolean>>({})
  const assignModuleToCohort = async (moduleId: number) => {
    setAssignedChanges(current => ({ ...current, [moduleId]: true }))
    setConfigureModuleId(moduleId)
  }
  const removeModuleFromCohort = async (moduleId: number) => {
    const approved = await confirm({ title: 'Remove module from this cohort?', description: 'Learners lose access after you save settings. Submissions and progress are kept.', confirmLabel: 'Remove module', cancelLabel: 'Keep module' })
    if (approved) setAssignedChanges(current => ({ ...current, [moduleId]: false }))
    return approved
  }

  if (loading) return <LoadingSpinner message="Loading cohort..." />
  if (!cohort) return <section role="alert" className="app-surface p-5"><p>{loadError || 'Could not load cohort settings.'}</p><Button onClick={() => void reloadCohort()}>Retry settings</Button></section>

  return (
    <form onKeyDown={event => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.closest('[role="dialog"]')) event.preventDefault()
    }} onSubmit={event => { event.preventDefault(); if (!(event.target as HTMLElement).closest('[role="dialog"]')) void saveSettings() }}><fieldset disabled={saving} className="min-w-0 space-y-6">
      <UnsavedChangesGuard pathnameOnly={false} dirty={reviewResponseDraft !== undefined || featureDraft !== null || Object.keys(assignedChanges).length > 0 || Object.keys(offeringDraft).length > 0 ||
        editStartDate !== toDateInputValue(cohort.start_date) ||
        editGithubOrganization !== (cohort.github_organization_name || '') ||
        editStatus !== cohort.status ||
        editCourseDelivery !== (cohort.course_delivery || 'program') ||
        editAccessEnd !== (cohort.guided_access_ends_on || '') ||
        editSupportEnd !== (cohort.guided_support_ends_on || '') ||
        JSON.stringify(classResources) !== JSON.stringify(cohort.class_resources || []) ||
        JSON.stringify(forms) !== JSON.stringify(buildFormsFromCohort(cohort)) ||
        JSON.stringify(submissionWindows) !== JSON.stringify(buildSubmissionWindowsFromCohort(cohort))
      } />
      <div className="app-surface space-y-4 p-5">
        <Link to={cohortPath(cohort.id)} className="app-link inline-flex min-h-11 items-center">Back to {cohort.name}</Link>
        <h2 className="text-lg font-bold">Cohort settings</h2>
        <div id="cohort-status"><SegmentedControl label="Cohort status">{COHORT_STATUS_OPTIONS.map(option => <SegmentButton key={option.value} disabled={option.value === 'upcoming' && editStartDate <= new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Guam' }).format(new Date())} selected={editStatus === option.value} onClick={() => void chooseStatus(option.value)} className={option.value === 'archived' ? 'text-danger-ink' : undefined}>{option.value === 'upcoming' && editStartDate <= new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Guam' }).format(new Date()) ? 'Upcoming (move start date)' : option.label}</SegmentButton>)}</SegmentedControl><p className="mt-2 text-sm text-ink-secondary">{COHORT_STATUS_OPTIONS.find(option => option.value === editStatus)?.description}</p></div>
        <label className="block text-sm font-semibold">Cohort start date<input aria-label="Cohort start date" type="date" className="app-control mt-1 block" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} /></label>
        {user?.role === 'admin' && <FeatureSettings key={`features-${cohort.id}-${savedRevision}`} cohortId={cohort.id} onDraftChange={setFeatureDraft} onReviewResponseDraftChange={setReviewResponseDraft} />}
        {user?.role === 'admin' && cohort.course_delivery === 'self_paced' && <CourseOfferingSettings key={`${cohort.id}-${savedRevision}`} cohort={cohort} onSaved={async () => {}} onDraftChange={setOfferingDraft} />}
        {cohort.course_delivery !== 'self_paced' && (
          <section className="mt-4 border-t border-line pt-4" aria-labelledby="course-access-heading">
            <h2 id="course-access-heading" className="text-base font-semibold text-ink">Course access for new enrollments</h2>
            <p className="mt-1 text-xs text-ink-secondary">Dates include the entire selected day in {schoolTimeDescription().replace(' time', '')}. Saving defaults does not change existing enrollments. Leave dates blank for ongoing access; the full program currently has indefinite lesson access.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-ink-secondary">
                Delivery
                <select value={editCourseDelivery} onChange={(e) => setEditCourseDelivery(e.target.value as 'program' | 'guided')} disabled={saving} className="app-control mt-1 w-full">
                  <option value="program">Live program</option>
                  <option value="guided">Focused course with meetings</option><option value="self_paced">Self-paced</option>
                </select>
              </label>
              {editCourseDelivery === 'guided' && (
                <>
                  <label className="text-xs font-semibold text-ink-secondary">
                    Lessons available through
                    <input type="date" value={editAccessEnd} onChange={(e) => setEditAccessEnd(e.target.value)} disabled={saving} className="app-control mt-1 w-full" />
                  </label>
                  <label className="text-xs font-semibold text-ink-secondary">
                    Help period ends
                    <input type="date" value={editSupportEnd} onChange={(e) => setEditSupportEnd(e.target.value)} disabled={saving} className="app-control mt-1 w-full" />
                  </label>
                </>
              )}
            </div>
          </section>
        )}
        <div className="mt-4 border-t border-line pt-4">
          <label htmlFor="cohort-github-organization" className="flex items-center gap-1.5 text-base font-semibold text-ink"><Github className="h-4 w-4" /> GitHub organization</label>
          <p className="mt-1 text-xs text-ink-secondary">Used to check student membership and invitations. Add the organization name from its GitHub URL; resource links are managed separately.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input id="cohort-github-organization" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={editGithubOrganization} onChange={(e) => setEditGithubOrganization(e.target.value)} disabled={saving} placeholder="e.g. Code-School-of-Guam-Alumni" className="app-control w-full max-w-md" />

          </div>
        </div>
      </div>

      <Button className="sticky bottom-4 z-20" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
      {message && (
        <div role="status" className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary">
          {message}
        </div>
      )}

      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 id="curriculum" className="scroll-mt-32 text-lg font-bold text-ink">Curriculum & access</h2>
            <LinkButton variant="secondary" to={`/admin/content?open=${cohort.modules.map(module => module.id).join(',')}`}>Edit shared curriculum in Content</LinkButton>
          </div>
          <p className="text-sm text-ink-secondary">Adding modules or editing lessons changes every cohort using this curriculum.</p>
          <div className="app-surface divide-y divide-line">
            {cohort.modules.map((savedModule) => {
              const mod = { ...savedModule, assigned: assignedChanges[savedModule.id] ?? savedModule.assigned }
              const form = forms[mod.id] || { unlocked: false, module_start_date: '', requires_github: false, repository_name: '' }
              const saving = savingModuleId === mod.id
              return (
                <div key={mod.id} className="p-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                  <div className="flex flex-1 items-center gap-3 min-w-0">
                    {(() => {
                      const isAccessible = form.unlocked || (form.module_start_date && dateFromDateOnly(form.module_start_date) <= new Date())
                      const isScheduled = !form.unlocked && form.module_start_date && dateFromDateOnly(form.module_start_date) > new Date()
                      return (
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          !mod.assigned ? 'bg-surface-sunken text-ink-muted'
                            : isAccessible ? 'bg-success-soft text-success-ink'
                            : isScheduled ? 'bg-info-soft text-info-ink'
                            : 'bg-warning-soft text-warning-ink'
                        }`}>
                          {!mod.assigned ? <Lock className="h-4 w-4" />
                            : isAccessible ? <Unlock className="h-4 w-4" />
                            : isScheduled ? <CalendarDays className="h-4 w-4" />
                            : <Lock className="h-4 w-4" />}
                        </div>
                      )
                    })()}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate" title={mod.name}><RecordLink record={{ type: 'module', id: mod.id, cohortId: cohort.id }} variant="plain" touchTarget truncate>{mod.name}</RecordLink></p>
                      <p className="text-xs tabular-nums text-ink-muted first-letter:uppercase">
                        {mod.module_type.replace('_', ' ')} · {mod.lessons_count} lesson{mod.lessons_count !== 1 ? 's' : ''} · {mod.assigned_count} assigned
                        {form.module_start_date && ` · Starts ${formatShortDate(form.module_start_date)}`}
                        {form.requires_github && ' · GitHub'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cohort.cohort_type === 'alumni' ? (
                      <Badge tone="success">
                        Always available
                      </Badge>
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
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setConfigureModuleId(mod.id)}
                        >
                          Configure
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Module Configuration Modal */}
          {(() => {
            const configureMod = cohort.modules.find((m) => m.id === configureModuleId)
            if (!configureMod) return null
            const form = forms[configureMod.id] || { unlocked: false, module_start_date: '', requires_github: false, repository_name: '' }
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
                    <Button
                      onClick={() => void saveModuleConfiguration()}
                      disabled={saving}
                    >
                      <Save className="h-4 w-4" />
                      Done editing module
                    </Button>
                  </div>
                }
              >
                <div className="space-y-5">
                  <p className="text-sm text-ink-secondary">Module selection and access settings apply to current students and students who join later. Individual student overrides stay separate.</p>
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
                      This is the first actual release day of Week 1 for this cohort. Later lessons follow the module schedule from there.
                      {configureMod.uses_default_start_date ? ' Right now this module is still using the cohort-based fallback.' : ''}
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
                        <p className="mt-1 text-xs text-ink-muted">The repo name under each student's GitHub account to sync from.</p>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-line bg-surface-raised p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-ink">Submission windows</h3>
                        <p className="mt-1 text-xs leading-5 text-ink-muted">
                          Set a close time for each week. Students can still view lessons and videos after a week closes, but submissions and redo resubmissions are blocked.
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
                          const statusTone: BadgeTone = displayStatus === 'closed'
                            ? 'warning'
                            : displayStatus === 'scheduled'
                              ? 'info'
                              : 'success'
                          const statusLabel = displayStatus === 'closed'
                            ? 'Closed'
                            : displayStatus === 'scheduled'
                              ? 'Scheduled'
                              : 'Open'

                          return (
                            <div key={window.week_number} className="rounded-xl border border-line bg-surface-sunken p-3">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold tabular-nums text-ink">Week {window.week_number}</p>
                                    <Badge tone={statusTone}>
                                      {statusLabel}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 text-xs tabular-nums text-ink-muted">
                                    {window.starts_on ? `${formatDateLabel(window.starts_on)} – ${formatDateLabel(window.ends_on)}` : 'Dates depend on module start'}
                                    {typeof window.lessons_count === 'number' ? ` · ${window.lessons_count} lesson${window.lessons_count !== 1 ? 's' : ''}` : ''}
                                  </p>
                                  <p className="mt-1 text-xs tabular-nums text-ink-muted">
                                    {window.submissions_close_at ? `Closes ${formatShortDateTime(dateTimeInputToIso(window.submissions_close_at), 'Not scheduled')}` : 'No close time set'}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    type="datetime-local"
                                    value={window.submissions_close_at}
                                    onChange={(event) => updateSubmissionWindow(configureMod.id, window.week_number, event.target.value)}
                                    aria-label={`Week ${window.week_number} submissions close (${schoolTimeDescription()}, ${window.submissions_close_at && dateTimeInputToIso(window.submissions_close_at) ? schoolTimeLabel(new Date(dateTimeInputToIso(window.submissions_close_at)!)) : schoolTimeGenericLabel()})`}
                                    className="app-control w-full sm:w-auto"
                                  />
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => updateSubmissionWindow(configureMod.id, window.week_number, nowDateTimeInputValue())}
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

          {/* Resources — compact summary card */}
          <div className="grid grid-cols-1 gap-4">
            <button
              onClick={() => setShowResourcesModal(true)}
              type="button"
              className="pressable min-h-11 rounded-2xl border border-line bg-surface-raised p-5 text-left shadow-raised hover:border-line-strong hover:bg-surface-sunken"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary">
                    <Link2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-ink">Class resources</h3>
                    <p className="text-xs tabular-nums text-ink-muted">
                      {classResources.length === 0 ? 'No resources yet' : `${classResources.length} resource${classResources.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-ink-muted" />
              </div>
            </button>
          </div>
        </div>

      </div>

      {/* Resources Modal */}
      <Modal
        open={showResourcesModal}
        onClose={() => setShowResourcesModal(false)}
        title="Class resources"
        subtitle="Open resources when you need them, or switch to edit mode to maintain the list."
        icon={<Link2 className="h-6 w-6 text-ink-secondary" />}
        size="xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="secondary"
              onClick={() => setClassResources((prev) => [...prev, { title: '', url: '', category: 'general' }])}
            >
              <Plus className="h-4 w-4" />
              Add resource
            </Button>
            <Button
              onClick={saveClassResources}
              disabled={savingResources}
            >
              <Save className="h-4 w-4" />
              Done editing resources
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <SegmentedControl label="Resources mode">
            {(['view', 'edit'] as const).map((mode) => (
              <SegmentButton
                key={mode}
                selected={resourcesMode === mode}
                onClick={() => setResourcesMode(mode)}
              >
                {mode === 'view' ? 'View' : 'Edit'}
              </SegmentButton>
            ))}
          </SegmentedControl>

          {resourcesMode === 'view' ? (
            classResources.length === 0 ? (
              <p className="text-sm text-ink-muted py-8 text-center">No resources added yet. Switch to edit mode to add the first one.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {classResources.map((resource, idx) => {
                  const isHotkey = ['hotkeys', 'shortcuts'].includes(resource.category || '')
                  return (
                    <a
                      key={`${resource.url}-${idx}`}
                      href={sanitizeUrl(resource.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`pressable rounded-2xl border p-4 hover:border-line-strong ${
                        isHotkey ? 'border-line bg-surface-sunken' : 'border-line bg-surface-raised'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {isHotkey && <Keyboard className="h-4 w-4 text-ink-secondary" />}
                            <h3 className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{resource.title || 'Untitled resource'}</h3>
                            <Badge>
                              {RESOURCE_CATEGORY_LABELS[resource.category || 'general'] || 'General'}
                            </Badge>
                          </div>
                          {resource.description && <p className="mt-1 text-sm text-ink-secondary">{resource.description}</p>}
                          <p className="mt-1 break-all text-xs text-ink-muted">{resource.url}</p>
                        </div>
                        <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-ink-muted" />
                      </div>
                    </a>
                  )
                })}
              </div>
            )
          ) : (
          <div className="space-y-3">
            {classResources.length === 0 ? (
            <p className="text-sm text-ink-muted py-8 text-center">No resources added yet. Click "Add resource" below to get started.</p>
          ) : classResources.map((res, idx) => (
            <div key={idx} className="rounded-xl border border-line p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tabular-nums text-ink-muted">Resource {idx + 1}</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setClassResources((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <input
                    type="text"
                    value={res.title}
                    onChange={(e) => setClassResources((prev) => prev.map((item, i) => i === idx ? { ...item, title: e.target.value } : item))}
                    placeholder="For example: Class Zoom link"
                    className="app-control w-full"
                  />
                </div>
                <select
                  value={res.category || 'general'}
                  onChange={(e) => setClassResources((prev) => prev.map((item, i) => i === idx ? { ...item, category: e.target.value } : item))}
                  className="app-control w-full"
                >
                  {RESOURCE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <input
                type="url"
                value={res.url}
                onChange={(e) => setClassResources((prev) => prev.map((item, i) => i === idx ? { ...item, url: e.target.value } : item))}
                placeholder="https://..."
                className="app-control w-full"
              />
              <input
                type="text"
                value={res.description || ''}
                onChange={(e) => setClassResources((prev) => prev.map((item, i) => i === idx ? { ...item, description: e.target.value } : item))}
                placeholder="Optional description"
                className="app-control w-full"
              />
            </div>
          ))}
          </div>
          )}
        </div>
      </Modal>
    </fieldset></form>
  )
}
