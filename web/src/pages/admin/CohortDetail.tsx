import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Save, Lock, Unlock, UserPlus, Mail, CheckCircle, PlayCircle, Link2, Plus, Trash2, CalendarDays, ExternalLink, Github, Eye, Keyboard, Clock } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath } from '../../lib/routes'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Modal } from '../../components/shared/Modal'
import { RecordingUploadManager } from '../../components/admin/RecordingUploadManager'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { formatDateTimeRange, formatShortDate, formatShortDateTime } from '../../lib/format'
import { toDateTimeInputValueInTimeZone } from '../../lib/dateTime'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { presenceStatus, usePresenceNow } from '../../lib/presence'
import { subscribeToStaffPresence } from '../../lib/realtime'
import { PresenceBadge, PresenceDot } from '../../components/shared/PresenceBadge'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button, LinkButton } from '../../components/ui/Button'
import { SegmentButton, SegmentedControl } from '../../components/ui/Choice'
import type { OfficeHour, OfficeHourOccurrence } from '../../types/api'

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
type CohortData = Record<string, any> & {
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
    invite_sent_at?: string | null
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

function todayDateInputValue(): string {
  return formatDateInputValue(new Date())
}

// Submission close times are entered and shown in Guam time (UTC+10 all
// year), whatever time zone the staff member's device is set to.
function dateTimeInputToIso(value?: string | null): string | null {
  if (!value) return null

  const date = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}+10:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function nowDateTimeInputValue(): string {
  return toDateTimeInputValueInTimeZone(new Date().toISOString(), 'Pacific/Guam')
}

function submissionWindowStatusForForm(window: SubmissionWindowForm): SubmissionWindowForm['status'] {
  if (!window.submissions_close_at) return 'open'

  const closeAtIso = dateTimeInputToIso(window.submissions_close_at)
  if (!closeAtIso) return 'scheduled'

  return new Date(closeAtIso) <= new Date() ? 'closed' : 'scheduled'
}

function formatDateLabel(dateStr?: string | null): string {
  if (!dateStr) return ''
  return formatShortDate(toDateInputValue(dateStr), '')
}

function formatRelativeDateTime(dateStr?: string | null): string {
  if (!dateStr) return 'Never'

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'Unknown'

  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`

  return formatShortDate(date)
}

function StatusBadge({ status }: { status: string }) {
  const tones: Record<string, BadgeTone> = {
    active: 'success',
    upcoming: 'info',
    completed: 'neutral',
    archived: 'neutral',
  }
  const label = status.replaceAll('_', ' ')

  return <Badge tone={tones[status] || 'neutral'}>{label.charAt(0).toUpperCase() + label.slice(1)}</Badge>
}

const COHORT_STATUS_OPTIONS = [
  { value: 'upcoming', label: 'Upcoming', description: 'Visible as planned, but not actively running yet.' },
  { value: 'active', label: 'Active', description: 'Current live cohort for day-to-day class operations.' },
  { value: 'completed', label: 'Completed', description: 'Finished cohort that should stay visible for reference and replays.' },
  { value: 'archived', label: 'Archived', description: 'Inactive cohort kept only for records and history.' },
] as const

const RESOURCE_CATEGORY_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'meeting', label: 'Meeting Link' },
  { value: 'github', label: 'GitHub' },
  { value: 'communication', label: 'Communication' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'hotkeys', label: 'Hotkeys / Shortcuts' },
]

const RESOURCE_CATEGORY_LABELS = RESOURCE_CATEGORY_OPTIONS.reduce<Record<string, string>>((labels, option) => {
  labels[option.value] = option.label
  return labels
}, {})

type CohortStatusValue = typeof COHORT_STATUS_OPTIONS[number]['value']

interface OfficeHourFormState {
  title: string
  description: string
  starts_at: string
  ends_at: string
  meeting_url: string
  timezone: string
  recurrence: 'once' | 'weekly'
  event_kind: 'office_hours' | 'live_class'
}

function emptyOfficeHourForm(): OfficeHourFormState {
  const timezone = 'Pacific/Guam'
  const start = new Date()
  start.setHours(start.getHours() + 1, 0, 0, 0)
  const end = new Date(start)
  end.setHours(end.getHours() + 1)

  return {
    title: 'Office Hours',
    description: '',
    starts_at: toDateTimeInputValueInTimeZone(start.toISOString(), timezone),
    ends_at: toDateTimeInputValueInTimeZone(end.toISOString(), timezone),
    meeting_url: '',
    timezone,
    recurrence: 'weekly',
    event_kind: 'office_hours',
  }
}

export function CohortDetail() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const confirm = useConfirm()
  const { refreshCohorts } = useCohortContext()
  const presenceNow = usePresenceNow()
  const [cohort, setCohort] = useState<CohortData | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [savingModuleId, setSavingModuleId] = useState<number | null>(null)
  const [savingResources, setSavingResources] = useState(false)
  const [forms, setForms] = useState<Record<number, { unlocked: boolean; module_start_date: string; requires_github: boolean; repository_name: string }>>({})
  const [submissionWindows, setSubmissionWindows] = useState<Record<number, SubmissionWindowForm[]>>({})
  const [classResources, setClassResources] = useState<ClassResource[]>([])
  const [officeHours, setOfficeHours] = useState<OfficeHour[]>([])
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [addStudentEmail, setAddStudentEmail] = useState('')
  const [addStudentGithub, setAddStudentGithub] = useState('')
  const [addingStudent, setAddingStudent] = useState(false)
  const [sendInvite, setSendInvite] = useState(true)
  const [resendingInviteFor, setResendingInviteFor] = useState<number | null>(null)
  const [editCourseDelivery, setEditCourseDelivery] = useState<'program' | 'guided' | 'self_paced'>('program')
  const [editAccessEnd, setEditAccessEnd] = useState('')
  const [editSupportEnd, setEditSupportEnd] = useState('')
  const [savingAccessTerms, setSavingAccessTerms] = useState(false)
  const [editStartDate, setEditStartDate] = useState('')
  const [editGithubOrganization, setEditGithubOrganization] = useState('')
  const [editStatus, setEditStatus] = useState('active')
  const [savingStatus, setSavingStatus] = useState(false)
  const [statusPendingConfirmation, setStatusPendingConfirmation] = useState<CohortStatusValue | null>(null)
  const [savingStartDate, setSavingStartDate] = useState(false)
  const [savingGithubOrganization, setSavingGithubOrganization] = useState(false)
  const [showRecordingsModal, setShowRecordingsModal] = useState(false)
  const [showResourcesModal, setShowResourcesModal] = useState(false)
  const [resourcesMode, setResourcesMode] = useState<'view' | 'edit'>('view')
  const [showOfficeHoursModal, setShowOfficeHoursModal] = useState(false)
  const [officeHourForm, setOfficeHourForm] = useState<OfficeHourFormState>(() => emptyOfficeHourForm())
  const [editingOfficeHourId, setEditingOfficeHourId] = useState<number | null>(null)
  const [savingOfficeHour, setSavingOfficeHour] = useState(false)
  const [deletingOfficeHourId, setDeletingOfficeHourId] = useState<number | null>(null)
  const [configureModuleId, setConfigureModuleId] = useState<number | null>(null)
  const [showAddModule, setShowAddModule] = useState(false)
  const [newModuleName, setNewModuleName] = useState('')
  const [newModuleType, setNewModuleType] = useState('prework')
  const [newModuleScheduleDays, setNewModuleScheduleDays] = useState('weekdays')
  const [addingModule, setAddingModule] = useState(false)

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
        unlocked: mod.assigned && (nextCohort.active_count > 0 ? mod.unlocked_count === nextCohort.active_count : false),
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
        submissions_close_at: toDateTimeInputValueInTimeZone(window.submissions_close_at, 'Pacific/Guam'),
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
    setOfficeHours(nextCohort.office_hours || [])
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

    const res = await api.getCohort(Number(id))
    const nextCohort = res.data?.cohort as CohortData | undefined
    if (nextCohort) applyCohort(nextCohort)
    setLoading(false)
    return nextCohort || null
  }, [applyCohort, id])

  useEffect(() => {
    void reloadCohort()
  }, [reloadCohort])

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let active = true

    subscribeToStaffPresence((event) => {
      if (!active) return

      setCohort((current) => {
        if (!current?.students.some((student) => student.user_id === event.user_id)) return current

        return {
          ...current,
          students: current.students.map((student) => (
            student.user_id === event.user_id
              ? { ...student, last_seen_at: event.last_seen_at }
              : student
          )),
        }
      })
    }).then((nextUnsubscribe) => {
      if (active) unsubscribe = nextUnsubscribe
      else nextUnsubscribe()
    }).catch(() => {
      // Heartbeat data and normal refetches remain the fallback if realtime is unavailable.
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  const handleSaveAccessTerms = async () => {
    if (!id) return
    setSavingAccessTerms(true)
    try {
      const res = await api.updateCohort(Number(id), {
        course_delivery: editCourseDelivery,
        guided_access_ends_on: editCourseDelivery === 'guided' ? editAccessEnd || null : null,
        guided_support_ends_on: editCourseDelivery === 'guided' ? editSupportEnd || null : null,
      })
      if (res.error) notifyError(res.error)
      else if (res.data?.cohort) {
        applyCohort(res.data.cohort as CohortData)
        notifySuccess('Course access defaults saved for new enrollments')
      }
    } finally {
      setSavingAccessTerms(false)
    }
  }

  const handleSaveStartDate = async () => {
    if (!id || !editStartDate) return
    setSavingStartDate(true)
    setMessage('')
    const res = await api.updateCohort(Number(id), { start_date: editStartDate })
    if (res.error) {
      notifyError(res.error)
    } else if (res.data?.cohort) {
      applyCohort(res.data.cohort as CohortData)
      notifySuccess('Cohort start date updated')
    }
    setSavingStartDate(false)
  }

  const handleSaveGithubOrganization = async () => {
    if (!id || !cohort) return
    const organization = editGithubOrganization.trim()
    setSavingGithubOrganization(true)
    setMessage('')
    const res = await api.updateCohort(Number(id), { github_organization_name: organization || null })
    if (res.error) {
      notifyError(res.error)
    } else if (res.data?.cohort) {
      applyCohort(res.data.cohort as CohortData)
      notifySuccess('GitHub organization updated')
    }
    setSavingGithubOrganization(false)
  }

  const updateCohortStatus = async (nextStatus: string) => {
    if (!id || !cohort || nextStatus === cohort.status) return
    setSavingStatus(true)
    setMessage('')
    const res = await api.updateCohort(Number(id), { status: nextStatus })
    if (res.error) {
      notifyError(res.error)
    } else if (res.data?.cohort) {
      applyCohort(res.data.cohort as CohortData)
      notifySuccess(`Cohort marked ${nextStatus}`)
      await refreshCohorts()
    }
    setSavingStatus(false)
  }

  const handleSaveStatus = async () => {
    if (!cohort || editStatus === cohort.status) return

    if (editStatus === 'archived' || editStatus === 'completed') {
      setStatusPendingConfirmation(editStatus as CohortStatusValue)
      return
    }

    await updateCohortStatus(editStatus)
  }

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !addStudentEmail.trim()) return
    setAddingStudent(true)
    setMessage('')

    const createRes = await api.createUser({
      email: addStudentEmail.trim().toLowerCase(),
      role: 'student',
      github_username: addStudentGithub.trim() || undefined,
      skip_invite: true,
    })
    if (createRes.error) {
      notifyError(createRes.error)
      setAddingStudent(false)
      return
    }

    const userId = createRes.data?.user?.id
    if (!userId) {
      notifyError('Failed to create user')
      setAddingStudent(false)
      return
    }

    const enrollRes = await api.createEnrollment(Number(id), userId, sendInvite)
    if (enrollRes.error) {
      notifyError(`User created but enrollment failed: ${enrollRes.error}`)
      setAddingStudent(false)
      return
    }

    await reloadCohort()

    if (enrollRes.data?.invitation?.status === 'failed') {
      notifyError(`Added ${addStudentEmail.trim()}, but the invitation needs to be retried from the roster.`)
    } else if (enrollRes.data?.invitation?.status === 'queued') {
      notifySuccess(`Added ${addStudentEmail.trim()} and queued the invitation`)
    } else {
      notifySuccess(`Added ${addStudentEmail.trim()} to cohort`)
    }
    setAddStudentEmail('')
    setAddStudentGithub('')
    setAddingStudent(false)
    setShowAddStudent(false)
  }

  const handleResendInvite = async (userId: number, email: string) => {
    setResendingInviteFor(userId)
    setMessage('')
    const res = await api.resendInvite(userId)
    if (res.error) {
      notifyError(`Failed to resend invite: ${res.error}`)
    } else {
      await reloadCohort()
      notifySuccess(`Invite queued for ${email}`)
    }
    setResendingInviteFor(null)
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

  const saveModuleAccess = async (moduleId: number) => {
    if (!id) return false
    const form = forms[moduleId]
    if (!form) return false

    setMessage('')
    const res = await api.updateCohortModuleAccess(Number(id), {
      module_id: moduleId,
      assigned: true,
      unlocked: form.unlocked,
      module_start_date: form.module_start_date || null,
      requires_github: form.requires_github,
      repository_name: form.repository_name,
    })

    if (res.error) {
      notifyError(res.error)
      return false
    }

    return true
  }

  const saveClassResources = async () => {
    if (!id) return
    setSavingResources(true)
    setMessage('')

    const res = await api.updateCohortClassResources(Number(id), classResources)
    if (res.error) {
      notifyError(res.error)
      setSavingResources(false)
      return
    }

    const nextCohort = res.data?.cohort as CohortData | undefined
    if (nextCohort) applyCohort(nextCohort)
    notifySuccess('Updated class resources')
    setSavingResources(false)
  }

  const updateSubmissionWindow = (moduleId: number, weekNumber: number, closeAt: string) => {
    setSubmissionWindows((prev) => ({
      ...prev,
      [moduleId]: (prev[moduleId] || []).map((window) => (
        window.week_number === weekNumber ? { ...window, submissions_close_at: closeAt } : window
      )),
    }))
  }

  const saveSubmissionWindows = async (
    moduleId: number,
    options?: { silent?: boolean; windows?: SubmissionWindowForm[] },
  ) => {
    if (!id) return false
    const windows = options?.windows || submissionWindows[moduleId] || []

    const res = await api.updateCohortModuleSubmissionWindows(Number(id), moduleId, windows.map((window) => ({
      week_number: window.week_number,
      submissions_close_at: dateTimeInputToIso(window.submissions_close_at),
    })))

    if (res.error) {
      if (!options?.silent) notifyError(res.error)
      return false
    }

    await reloadCohort()
    if (!options?.silent) notifySuccess('Updated submission windows')
    return true
  }

  const saveModuleConfiguration = async (moduleId: number) => {
    const windowsSnapshot = (submissionWindows[moduleId] || []).map((window) => ({ ...window }))
    setSavingModuleId(moduleId)

    try {
      const accessSaved = await saveModuleAccess(moduleId)
      if (!accessSaved) return

      const windowsSaved = await saveSubmissionWindows(moduleId, { silent: true, windows: windowsSnapshot })
      if (!windowsSaved) {
        await reloadCohort()
        setSubmissionWindows((prev) => ({ ...prev, [moduleId]: windowsSnapshot }))
        notifyError('Module access was saved, but submission windows could not be saved. Your window edits are still here; use Save windows to retry.')
        return
      }

      const moduleName = cohort?.modules.find((mod) => mod.id === moduleId)?.name || 'module'
      notifySuccess(`Updated configuration for ${moduleName}`)
    } finally {
      setSavingModuleId(null)
    }
  }

  const saveOnlySubmissionWindows = async (moduleId: number) => {
    setSavingModuleId(moduleId)
    try {
      await saveSubmissionWindows(moduleId)
    } finally {
      setSavingModuleId(null)
    }
  }

  const resetOfficeHourForm = () => {
    setOfficeHourForm(emptyOfficeHourForm())
    setEditingOfficeHourId(null)
  }

  const editOfficeHour = (officeHour: OfficeHour) => {
    const timezone = officeHour.timezone || 'Pacific/Guam'
    setEditingOfficeHourId(officeHour.id)
    setOfficeHourForm({
      title: officeHour.title,
      description: officeHour.description || '',
      starts_at: toDateTimeInputValueInTimeZone(officeHour.starts_at, timezone),
      ends_at: toDateTimeInputValueInTimeZone(officeHour.ends_at, timezone),
      meeting_url: officeHour.meeting_url,
      timezone,
      recurrence: officeHour.recurrence,
      event_kind: officeHour.event_kind,
    })
  }

  const saveOfficeHour = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!id) return

    const startsAt = officeHourForm.starts_at.trim()
    const endsAt = officeHourForm.ends_at.trim()
    if (!startsAt || !endsAt) {
      notifyError('Office hours need a valid start and end time')
      return
    }

    setSavingOfficeHour(true)
    const payload = {
      title: officeHourForm.title.trim(),
      description: officeHourForm.description.trim() || null,
      starts_at: startsAt,
      ends_at: endsAt,
      meeting_url: officeHourForm.meeting_url.trim(),
      timezone: officeHourForm.timezone || 'Pacific/Guam',
      recurrence: officeHourForm.recurrence,
      event_kind: officeHourForm.event_kind,
      active: true,
    }

    const res = editingOfficeHourId
      ? await api.updateOfficeHour(Number(id), editingOfficeHourId, payload)
      : await api.createOfficeHour(Number(id), payload)

    if (res.error) {
      notifyError(res.error)
    } else {
      await reloadCohort()
      notifySuccess(editingOfficeHourId ? 'Updated scheduled session' : 'Added scheduled session')
      resetOfficeHourForm()
    }
    setSavingOfficeHour(false)
  }

  const deleteOfficeHour = async (officeHourId: number) => {
    if (!id) return
    const approved = await confirm({ title: 'Remove this session?', description: 'Students will no longer see it on their schedule.', confirmLabel: 'Remove session', cancelLabel: 'Keep session', tone: 'danger' })
    if (!approved) return

    setDeletingOfficeHourId(officeHourId)
    const res = await api.deleteOfficeHour(Number(id), officeHourId)
    if (res.error) {
      notifyError(res.error)
    } else {
      await reloadCohort()
      notifySuccess('Removed scheduled session')
      if (editingOfficeHourId === officeHourId) resetOfficeHourForm()
    }
    setDeletingOfficeHourId(null)
  }

  const handleAddModule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cohort || !newModuleName.trim()) return
    setAddingModule(true)
    setMessage('')

    const position = cohort.modules.length + 1
    const res = await api.createModule(cohort.curriculum_id, {
      name: newModuleName.trim(),
      module_type: newModuleType,
      position,
      schedule_days: newModuleScheduleDays,
    })
    if (res.error) {
      notifyError(`Failed to create module: ${res.error}`)
      setAddingModule(false)
      return
    }

    await reloadCohort()

    notifySuccess(`Created module "${newModuleName.trim()}"`)
    setNewModuleName('')
    setNewModuleType('prework')
    setNewModuleScheduleDays('weekdays')
    setAddingModule(false)
    setShowAddModule(false)
  }

  const assignModuleToCohort = async (moduleId: number) => {
    if (!id) return
    setSavingModuleId(moduleId)
    setMessage('')

    const res = await api.updateCohortModuleAccess(Number(id), {
      module_id: moduleId,
      assigned: true,
      unlocked: false,
    })

    if (res.error) {
      notifyError(res.error)
      setSavingModuleId(null)
      return
    }

    const nextCohort = res.data?.cohort as CohortData | undefined
    if (nextCohort) applyCohort(nextCohort)
    const moduleName = cohort?.modules.find((mod) => mod.id === moduleId)?.name || 'module'
    notifySuccess(`Assigned ${moduleName}; open Configure to adjust the start date if needed`)
    setSavingModuleId(null)
    setConfigureModuleId(moduleId)
  }

  const removeModuleFromCohort = async (moduleId: number) => {
    if (!id) return
    const name = cohort?.modules.find((mod) => mod.id === moduleId)?.name || 'this module'
    const approved = await confirm({ title: `Remove ${name} from this cohort?`, description: "Learners in this cohort lose access to its lessons. Their submissions and progress are kept, and you can assign it again later.", confirmLabel: 'Remove module', cancelLabel: 'Keep module', tone: 'danger' })
    if (!approved) return
    setSavingModuleId(moduleId)
    setMessage('')

    const res = await api.updateCohortModuleAccess(Number(id), {
      module_id: moduleId,
      assigned: false,
    })

    if (res.error) {
      notifyError(res.error)
      setSavingModuleId(null)
      return
    }

    const nextCohort = res.data?.cohort as CohortData | undefined
    if (nextCohort) applyCohort(nextCohort)
    const moduleName = cohort?.modules.find((mod) => mod.id === moduleId)?.name || 'module'
    notifySuccess(`Removed ${moduleName} from cohort assignments`)
    setSavingModuleId(null)
  }

  if (loading) return <LoadingSpinner message="Loading cohort..." />
  if (!cohort) return null

  const today = todayDateInputValue()
  const upcomingUnlocks = cohort.modules
    .filter((mod) => mod.assigned && mod.module_start_date && mod.module_start_date > today)
    .sort((a, b) => dateFromDateOnly(a.module_start_date).getTime() - dateFromDateOnly(b.module_start_date).getTime())
    .slice(0, 5)
  const signedInStudentsCount = cohort.students.filter((student) => !student.invite_pending).length
  const studentsWithPresence = cohort.students.map((student) => ({
    student,
    presence: presenceStatus(student.last_seen_at, presenceNow),
  }))
  const onlineStudentsCount = studentsWithPresence.filter(({ presence }) => presence === 'online').length

  return (
    <div className="app-page max-w-6xl">
      <div>
        <Link to="/admin/cohorts" className="app-link mb-2 inline-flex min-h-11 items-center gap-1 text-sm">
          <ArrowLeft className="h-4 w-4" />
          Cohorts
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="app-title min-w-0 [overflow-wrap:anywhere]">{cohort.name}</h1>
              <StatusBadge status={cohort.status} />
            </div>
            <p className="mt-1 text-sm tabular-nums text-ink-muted">
              {cohort.curriculum_name} · {cohort.active_count} active student{cohort.active_count !== 1 ? 's' : ''}
            </p>
          </div>

          <div className="app-surface p-4 lg:min-w-[320px]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-ink">Cohort lifecycle</p>
                <p className="mt-1 text-xs text-ink-muted">Archive or complete cohorts so old classes stay organized instead of looking active forever.</p>
              </div>
              <StatusBadge status={cohort.status} />
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-ink-secondary mb-1">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="app-control w-full"
                >
                  {COHORT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-muted">
                  {COHORT_STATUS_OPTIONS.find((option) => option.value === editStatus)?.description}
                </p>
              </div>
              {editStatus !== cohort.status && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSaveStatus}
                  disabled={savingStatus}
                >
                  <Save className="h-4 w-4" />
                  {savingStatus ? 'Saving...' : 'Update status'}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end">
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-ink-secondary">
              <CalendarDays className="h-3.5 w-3.5" />
              Cohort start date
            </label>
            <input
              type="date"
              value={editStartDate}
              onChange={(e) => setEditStartDate(e.target.value)}
              className="app-control"
            />
          </div>
          {editStartDate !== toDateInputValue(cohort.start_date) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSaveStartDate}
              disabled={savingStartDate}
            >
              <Save className="h-4 w-4" />
              {savingStartDate ? 'Saving...' : 'Update date'}
            </Button>
          )}
          <p className="pb-2 text-xs text-ink-muted">Fallback start date for modules without their own start date.</p>
        </div>
        {cohort.course_delivery !== 'self_paced' && (
          <section className="mt-4 border-t border-line pt-4" aria-labelledby="course-access-heading">
            <h2 id="course-access-heading" className="text-base font-semibold text-ink">Course access for new enrollments</h2>
            <p className="mt-1 text-xs text-ink-secondary">Dates include the entire selected day in Guam. Saving defaults does not change existing enrollments. Leave dates blank for ongoing access; the full program currently has indefinite lesson access.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-ink-secondary">
                Delivery
                <select value={editCourseDelivery} onChange={(e) => setEditCourseDelivery(e.target.value as 'program' | 'guided')} disabled={savingAccessTerms} className="app-control mt-1 w-full">
                  <option value="program">Full program</option>
                  <option value="guided">Guided focused course</option>
                </select>
              </label>
              {editCourseDelivery === 'guided' && (
                <>
                  <label className="text-xs font-semibold text-ink-secondary">
                    Lessons available through
                    <input type="date" value={editAccessEnd} onChange={(e) => setEditAccessEnd(e.target.value)} disabled={savingAccessTerms} className="app-control mt-1 w-full" />
                  </label>
                  <label className="text-xs font-semibold text-ink-secondary">
                    Instructor support through
                    <input type="date" value={editSupportEnd} onChange={(e) => setEditSupportEnd(e.target.value)} disabled={savingAccessTerms} className="app-control mt-1 w-full" />
                  </label>
                </>
              )}
            </div>
            <Button variant="secondary" onClick={() => void handleSaveAccessTerms()} disabled={savingAccessTerms} className="mt-3">
              <Save className="h-4 w-4" />
              {savingAccessTerms ? 'Saving...' : 'Save access defaults'}
            </Button>
          </section>
        )}
        <div className="mt-4 border-t border-line pt-4">
          <label htmlFor="cohort-github-organization" className="flex items-center gap-1.5 text-base font-semibold text-ink"><Github className="h-4 w-4" /> GitHub organization</label>
          <p className="mt-1 text-xs text-ink-secondary">Used to check student membership and invitations. Add the organization name from its GitHub URL; resource links are managed separately.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input id="cohort-github-organization" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={editGithubOrganization} onChange={(e) => setEditGithubOrganization(e.target.value)} disabled={savingGithubOrganization} placeholder="e.g. Code-School-of-Guam-Alumni" className="app-control w-full max-w-md" />
            {editGithubOrganization.trim() !== (cohort.github_organization_name || '') && <Button variant="secondary" onClick={() => void handleSaveGithubOrganization()} disabled={savingGithubOrganization}><Save className="h-4 w-4" />{savingGithubOrganization ? 'Saving...' : 'Save organization'}</Button>}
          </div>
        </div>
      </div>

      {message && (
        <div role="status" className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary">
          {message}
        </div>
      )}

      <nav aria-label="Cohort workspace sections" className="sticky top-16 z-30 -mx-4 flex gap-1 overflow-x-auto border-y border-line bg-surface-page/95 px-4 py-1 backdrop-blur-xl sm:mx-0 sm:rounded-xl sm:border sm:px-2 lg:top-2">
        {[
          ['#curriculum', 'Curriculum & access'],
          ['#recordings', 'Recordings'],
          ['#schedule', 'Schedule'],
          ['#students', 'Students'],
          ['#communication', 'Communication'],
        ].map(([href, label]) => (
          <a key={href} href={href} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink">{label}</a>
        ))}
      </nav>

      <div className="app-surface-muted p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-semibold text-ink">Cohort student view</p>
            <p className="mt-1 text-sm text-ink-secondary">
              Review the modules, lessons, announcements, recordings, and resources currently visible to this cohort.
            </p>
          </div>
          <LinkButton
            variant="secondary"
            className="shrink-0"
            to={`/admin/cohorts/${cohort.id}/student-view`}
          >
            <Eye className="h-4 w-4" />
            Open student view
          </LinkButton>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          <div className="app-surface space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 id="communication" className="scroll-mt-32 text-lg font-bold text-ink">Announcements</h2>
                <p className="text-sm text-ink-muted mt-1">Manage this cohort's announcements in the shared announcement center so sender, read state, and history stay consistent.</p>
              </div>
              <LinkButton
                variant="secondary"
                size="sm"
                to={`/announcements?scope=manage&audience=cohort&cohort_id=${cohort.id}`}
              >
                Open announcement center
              </LinkButton>
            </div>
            <div className="rounded-xl border border-dashed border-line bg-surface-sunken px-4 py-4 text-sm text-ink-secondary">
              Cohort-specific announcements now live in the unified announcements feed.
              Students only get the notices meant for them, and staff can archive, filter, paginate, and see who posted each update.
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 id="curriculum" className="scroll-mt-32 text-lg font-bold text-ink">Curriculum & access</h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowAddModule(true)}
            >
              <Plus className="h-4 w-4" />
              Add module
            </Button>
          </div>

          <Modal
            open={showAddModule}
            onClose={() => setShowAddModule(false)}
            title="Add module"
            subtitle={`Add a new module to ${cohort.curriculum_name}`}
            size="md"
          >
            <form onSubmit={handleAddModule} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-ink-secondary mb-1">Module name</label>
                <input
                  type="text"
                  required
                  value={newModuleName}
                  onChange={(e) => setNewModuleName(e.target.value)}
                  placeholder="e.g., Live Class, Capstone Project"
                  className="app-control w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink-secondary mb-1">Module type</label>
                <select
                  value={newModuleType}
                  onChange={(e) => setNewModuleType(e.target.value)}
                  className="app-control w-full"
                >
                  <option value="prework">Prework</option>
                  <option value="live_class">Live Class</option>
                  <option value="capstone">Capstone</option>
                  <option value="advanced">Advanced</option>
                  <option value="workshop">Workshop</option>
                  <option value="recording">Recording</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-ink-secondary mb-1">Schedule pattern</label>
                <select
                  value={newModuleScheduleDays}
                  onChange={(e) => setNewModuleScheduleDays(e.target.value)}
                  className="app-control w-full"
                >
                  <option value="weekdays">MTWTF / Mon - Fri</option>
                  <option value="weekdays_sat">Mon - Sat</option>
                  <option value="mwf">Mon / Wed / Fri</option>
                  <option value="tth">Tue / Thu</option>
                  <option value="daily">Every day</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={addingModule || !newModuleName.trim()}
                >
                  {addingModule ? 'Creating...' : 'Create module'}
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => setShowAddModule(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Modal>

          <div className="app-surface divide-y divide-line">
            {cohort.modules.map((mod) => {
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
                            : isAccessible ? 'bg-success-50 text-success-700'
                            : isScheduled ? 'bg-info-50 text-info-700'
                            : 'bg-warning-50 text-warning-700'
                        }`}>
                          {!mod.assigned ? <Lock className="h-4 w-4" />
                            : isAccessible ? <Unlock className="h-4 w-4" />
                            : isScheduled ? <CalendarDays className="h-4 w-4" />
                            : <Lock className="h-4 w-4" />}
                        </div>
                      )
                    })()}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate" title={mod.name}>{mod.name}</p>
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
                          to={`/admin/cohorts/${id}/modules/${mod.id}/grading`}
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
                        removeModuleFromCohort(configureMod.id)
                        setConfigureModuleId(null)
                      }}
                      disabled={saving}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove from cohort
                    </Button>
                    <Button
                      onClick={() => void saveModuleConfiguration(configureMod.id)}
                      disabled={saving}
                    >
                      <Save className="h-4 w-4" />
                      {saving ? 'Saving...' : 'Save changes'}
                    </Button>
                  </div>
                }
              >
                <div className="space-y-5">
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
                      className="rounded border-line-strong text-primary-600 focus:ring-focus"
                    />
                    Make module accessible (lessons still follow their release-day schedule)
                  </label>

                  <div className="rounded-xl border border-line bg-surface-sunken p-3 space-y-2">
                    <label className="flex min-h-11 items-center gap-2 text-sm text-ink-secondary">
                      <input
                        type="checkbox"
                        checked={form.requires_github}
                        onChange={(e) => updateForm(configureMod.id, { requires_github: e.target.checked })}
                        className="rounded border-line-strong text-primary-600 focus:ring-focus"
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
                        onClick={() => void saveOnlySubmissionWindows(configureMod.id)}
                        disabled={saving}
                      >
                        <Save className="h-4 w-4" />
                        Save windows
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
                                    aria-label={`Week ${window.week_number} submissions close (Guam time, ChST)`}
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

          <div className="app-surface p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="recordings" className="scroll-mt-32 text-lg font-bold text-ink">Class recordings</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Manage self-hosted uploads and external video links in one place.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowRecordingsModal(true)}
                >
                  <PlayCircle className="h-4 w-4" />
                  Manage recordings
                </Button>
                <LinkButton
                  variant="secondary"
                  size="sm"
                  to={`/admin/cohorts/${id}/watch-progress`}
                >
                  <Eye className="h-4 w-4" />
                  Watch progress
                </LinkButton>
              </div>
            </div>

            <div className="app-surface-muted p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-base font-semibold text-ink">One recording library</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    Upload videos or add hosted links, review them privately, and publish only when they are ready for students.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge className="tabular-nums">
                    {cohort.recording_library_count ?? cohort.uploaded_recordings_count ?? 0} recording{(cohort.recording_library_count ?? cohort.uploaded_recordings_count ?? 0) !== 1 ? 's' : ''}
                  </Badge>
                  <Button
                    onClick={() => setShowRecordingsModal(true)}
                  >
                    <PlayCircle className="h-4 w-4" />
                    Open library
                  </Button>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-line">
              <Link
                to={`/admin/cohorts/${id}/watch-progress`}
                className="app-link inline-flex min-h-11 items-center gap-2 text-sm"
              >
                <Eye className="h-4 w-4" />
                View student watch progress
              </Link>
            </div>
          </div>

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

        <div className="space-y-4">
          <div className="app-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="schedule" className="scroll-mt-32 text-lg font-bold text-ink">Live schedule</h2>
                <p className="mt-1 text-sm text-ink-muted">Live classes and office hours appear in each student’s This Week plan.</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => setShowOfficeHoursModal(true)}
              >
                Manage
              </Button>
            </div>
            {officeHours.length === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed border-line bg-surface-sunken px-3 py-4 text-sm text-ink-muted">
                No live sessions yet. Add recurring or one-time classes or office hours for this cohort.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {(cohort.office_hour_occurrences || officeHours.flatMap((officeHour) => officeHour.occurrences)).slice(0, 3).map((occurrence, index) => (
                  <a
                    key={`${occurrence.office_hour_id}-${occurrence.starts_at}-${index}`}
                    href={sanitizeUrl(occurrence.meeting_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pressable block min-h-11 rounded-xl border border-line bg-surface-sunken px-3 py-2 hover:border-line-strong"
                  >
                    <p className="truncate text-sm font-semibold text-ink" title={occurrence.title}>{occurrence.title}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-ink-muted">{formatDateTimeRange(occurrence.starts_at, occurrence.ends_at, 'Not scheduled', occurrence.timezone)}</p>
                    <p className="mt-0.5 text-xs font-semibold text-ink-secondary">{occurrence.event_kind === 'live_class' ? 'Live class' : 'Office hours'} · {occurrence.recurrence === 'weekly' ? 'Weekly' : 'One-time'}</p>
                  </a>
                ))}
              </div>
            )}
          </div>

          {upcomingUnlocks.length > 0 && (
            <div className="app-surface p-4">
              <h2 className="text-lg font-bold text-ink">Upcoming module starts</h2>
              <div className="mt-3 space-y-2">
                {upcomingUnlocks.map((mod) => (
                  <div key={`${mod.id}-${mod.module_start_date}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-sunken px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate" title={mod.name}>{mod.name}</p>
                      <p className="text-xs tabular-nums text-ink-muted first-letter:uppercase">{mod.module_type.replace('_', ' ')} · {mod.assigned_count} assigned</p>
                    </div>
                    <span className="text-xs font-semibold tabular-nums text-ink-secondary shrink-0">
                      {formatDateLabel(mod.module_start_date)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="students" className="scroll-mt-32 text-lg font-bold text-ink">Enrolled students</h2>
              <p className="text-sm tabular-nums text-ink-muted mt-1">
                {cohort.students.length} student{cohort.students.length !== 1 ? 's' : ''} enrolled
                {cohort.students.length > 0 && (
                  <> · {signedInStudentsCount} signed in · {onlineStudentsCount} online now</>
                )}
              </p>
            </div>
            <Button
              variant={showAddStudent ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => setShowAddStudent(!showAddStudent)}
            >
              <UserPlus className="h-4 w-4" />
              Add student
            </Button>
          </div>

          {showAddStudent && (
            <form onSubmit={handleAddStudent} className="app-surface-muted p-4 space-y-3">
              <p className="text-xs text-ink-secondary">
                Enter the student's email. Their name will be filled automatically when they sign in via Clerk.
              </p>
              <div>
                <label className="block text-xs font-semibold text-ink-secondary mb-1">Email address *</label>
                <input
                  type="email"
                  required
                  value={addStudentEmail}
                  onChange={(e) => setAddStudentEmail(e.target.value)}
                  placeholder="student@example.com"
                  className="app-control w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-secondary mb-1">GitHub username (optional)</label>
                <input
                  type="text"
                  value={addStudentGithub}
                  onChange={(e) => setAddStudentGithub(e.target.value)}
                  placeholder="e.g., octocat"
                  className="app-control w-full"
                />
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  className="rounded border-line-strong text-primary-600 focus:ring-focus"
                />
                Send invite email
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={addingStudent}
                >
                  {addingStudent ? 'Adding...' : 'Add student'}
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => setShowAddStudent(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          <div className="app-surface divide-y divide-line">
            {cohort.students.length === 0 ? (
              <div className="p-6 text-center text-sm text-ink-muted">
                No students enrolled yet. Use the Add student button above.
              </div>
            ) : studentsWithPresence.map(({ student, presence }) => (
              <div
                key={student.enrollment_id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <Link
                  to={cohortStudentPath(cohort.id, student.user_id)}
                  className="group flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-xl"
                >
                  <Avatar name={student.full_name || student.email} size="sm" />
                  <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink truncate group-hover:text-ruby-700 group-hover:underline" title={student.full_name || student.email}>
                    {student.full_name || student.email}
                  </p>
                  {student.full_name && (
                    <p className="text-xs text-ink-muted truncate" title={student.email}>{student.email}</p>
                  )}
                  <div className="mt-2 grid gap-1 text-xs tabular-nums text-ink-muted">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-ink-muted" />
                      Last login: {formatRelativeDateTime(student.last_sign_in_at)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <PresenceDot status={presence} />
                      Last active: {formatRelativeDateTime(student.last_seen_at)}
                    </span>
                  </div>
                  </div>
                </Link>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {student.invite_pending ? (
                    <>
                      <span title={student.invite_last_error || undefined}>
                        <Badge tone={student.invite_delivery_status === 'failed' ? 'danger' : student.invite_delivery_status === 'not_sent' ? 'neutral' : 'pending'} icon={<Mail className="h-3 w-3" />}>
                          {student.invite_delivery_status === 'failed' ? 'Invite failed' : student.invite_delivery_status === 'queued' ? 'Invite queued' : student.invite_delivery_status === 'not_sent' ? 'Invite not sent' : 'Invite sent'}
                        </Badge>
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleResendInvite(student.user_id, student.email)}
                        disabled={resendingInviteFor === student.user_id}
                      >
                        <Mail className="h-4 w-4" />
                        {resendingInviteFor === student.user_id ? 'Sending...' : student.invite_delivery_status === 'not_sent' ? 'Send invite' : 'Retry invite'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge tone="success" icon={<CheckCircle className="h-3 w-3" />}>
                        Signed in
                      </Badge>
                      <PresenceBadge status={presence} />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(statusPendingConfirmation)}
        onClose={() => setStatusPendingConfirmation(null)}
        title={statusPendingConfirmation === 'archived' ? 'Archive cohort?' : 'Mark cohort as completed?'}
        subtitle={statusPendingConfirmation === 'archived'
          ? 'Archived cohorts stay available for records, but should be treated as inactive.'
          : 'Completed cohorts stay visible for replays and history without looking like active classes.'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setStatusPendingConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              variant={statusPendingConfirmation === 'archived' ? 'danger' : 'primary'}
              onClick={() => {
                if (!statusPendingConfirmation) return
                void updateCohortStatus(statusPendingConfirmation)
                setStatusPendingConfirmation(null)
              }}
            >
              Confirm
            </Button>
          </div>
        }
      >
        <div className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary">
          {statusPendingConfirmation === 'archived'
            ? 'Students and staff will still be able to reference this cohort when needed, but it will move into the inactive/archive flow.'
            : 'This is a good fit for finished cohorts that should remain visible without blending in with currently running classes.'}
        </div>
      </Modal>

      {/* Office Hours Modal */}
      <Modal
        open={showOfficeHoursModal}
        onClose={() => setShowOfficeHoursModal(false)}
        title="Live schedule"
        subtitle="Create one-time or weekly live classes and office hours for the shared student plan. Entered times are interpreted in the selected timezone."
        icon={<Clock className="h-6 w-6 text-ink-secondary" />}
        size="xl"
      >
        <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          <form onSubmit={saveOfficeHour} className="app-surface-muted space-y-3 p-4">
            <div>
              <h3 className="text-base font-semibold text-ink">{editingOfficeHourId ? 'Edit session' : 'Add session'}</h3>
              <p className="mt-1 text-xs text-ink-muted">Weekly recurrence repeats from the first start time.</p>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-secondary">Session type</span>
              <select
                value={officeHourForm.event_kind}
                onChange={(event) => setOfficeHourForm((current) => ({ ...current, event_kind: event.target.value as 'office_hours' | 'live_class' }))}
                className="app-control w-full"
              >
                <option value="live_class">Live class</option>
                <option value="office_hours">Office hours</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-secondary">Title</span>
              <input
                type="text"
                required
                value={officeHourForm.title}
                onChange={(event) => setOfficeHourForm((current) => ({ ...current, title: event.target.value }))}
                className="app-control w-full"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-secondary">Meeting URL</span>
              <input
                type="url"
                required
                value={officeHourForm.meeting_url}
                onChange={(event) => setOfficeHourForm((current) => ({ ...current, meeting_url: event.target.value }))}
                placeholder="https://zoom.us/j/..."
                className="app-control w-full"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-secondary">Starts</span>
                <input
                  type="datetime-local"
                  required
                  value={officeHourForm.starts_at}
                  onChange={(event) => setOfficeHourForm((current) => ({ ...current, starts_at: event.target.value }))}
                  className="app-control w-full"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-secondary">Ends</span>
                <input
                  type="datetime-local"
                  required
                  value={officeHourForm.ends_at}
                  onChange={(event) => setOfficeHourForm((current) => ({ ...current, ends_at: event.target.value }))}
                  className="app-control w-full"
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-secondary">Repeats</span>
                <select
                  value={officeHourForm.recurrence}
                  onChange={(event) => setOfficeHourForm((current) => ({ ...current, recurrence: event.target.value as 'once' | 'weekly' }))}
                  className="app-control w-full"
                >
                  <option value="once">One-time</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-secondary">Timezone</span>
                <input
                  type="text"
                  value={officeHourForm.timezone}
                  onChange={(event) => setOfficeHourForm((current) => ({ ...current, timezone: event.target.value }))}
                  className="app-control w-full"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-secondary">Description</span>
              <textarea
                value={officeHourForm.description}
                onChange={(event) => setOfficeHourForm((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                placeholder="Optional details students should know before joining."
                className="app-control w-full"
              />
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="submit"
                disabled={savingOfficeHour}
              >
                <Save className="h-4 w-4" />
                {savingOfficeHour ? 'Saving...' : editingOfficeHourId ? 'Save session' : 'Add session'}
              </Button>
              {editingOfficeHourId && (
                <Button
                  variant="quiet"
                  onClick={resetOfficeHourForm}
                >
                  Cancel edit
                </Button>
              )}
            </div>
          </form>

          <div className="space-y-3">
            <div>
              <h3 className="text-base font-semibold text-ink">Current schedule</h3>
              <p className="mt-1 text-xs text-ink-muted">The next three occurrences are shown to students on the dashboard.</p>
            </div>
            {officeHours.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-surface-sunken px-4 py-10 text-center text-sm text-ink-muted">
                No live classes or office hours have been added yet.
              </div>
            ) : (
              <div className="space-y-3">
                {officeHours.map((officeHour) => (
                  <div key={officeHour.id} className="rounded-2xl border border-line bg-surface-raised p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="min-w-0 truncate text-sm font-semibold text-ink" title={officeHour.title}>{officeHour.title}</h4>
                          <Badge>
                            {officeHour.event_kind === 'live_class' ? 'Live class' : 'Office hours'} · {officeHour.recurrence === 'weekly' ? 'Weekly' : 'One-time'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs tabular-nums text-ink-muted">{formatDateTimeRange(officeHour.starts_at, officeHour.ends_at, 'Not scheduled', officeHour.timezone)}</p>
                        {officeHour.description && <p className="mt-2 text-sm text-ink-secondary">{officeHour.description}</p>}
                        <a href={sanitizeUrl(officeHour.meeting_url)} target="_blank" rel="noopener noreferrer" className="app-link mt-1 inline-flex min-h-11 items-center gap-1 text-sm">
                          Open meeting link
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => editOfficeHour(officeHour)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => deleteOfficeHour(officeHour.id)}
                          disabled={deletingOfficeHourId === officeHour.id}
                        >
                          {deletingOfficeHourId === officeHour.id ? 'Removing...' : 'Remove'}
                        </Button>
                      </div>
                    </div>
                    {officeHour.occurrences.length > 0 && (
                      <div className="mt-3 rounded-xl border border-line bg-surface-sunken px-3 py-2">
                        <p className="text-xs font-semibold text-ink-muted">Upcoming</p>
                        <div className="mt-1 space-y-1">
                          {officeHour.occurrences.map((occurrence) => (
                            <p key={`${officeHour.id}-${occurrence.starts_at}`} className="text-xs tabular-nums text-ink-secondary">{formatShortDateTime(occurrence.starts_at, 'Not scheduled', occurrence.timezone || officeHour.timezone)}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Class Recordings Modal */}
      <Modal
        open={showRecordingsModal}
        onClose={() => setShowRecordingsModal(false)}
        title="Class recordings"
        subtitle="Manage self-hosted uploads and external video links from one place."
        icon={<PlayCircle className="h-6 w-6 text-ink-secondary" />}
        size="xl"
      >
        <RecordingUploadManager cohortId={Number(id)} onRecordingsChange={() => { void reloadCohort() }} />
      </Modal>

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
              {savingResources ? 'Saving...' : 'Save resources'}
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
                    placeholder="e.g., Class Zoom Link"
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
    </div>
  )
}
