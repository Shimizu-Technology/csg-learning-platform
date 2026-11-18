import { toDateTimeInputValueInTimeZone } from '../../../lib/dateTime'
import { formatShortDate } from '../../../lib/format'
import { schoolTimeZone, schoolWallTimeToIso } from '../../../lib/schoolTime'
import type { CourseOfferingTerms, InviteState, OfficeHour, OfficeHourOccurrence } from '../../../types/api'

export interface ClassResource {
  title: string
  url: string
  category?: string
  description?: string
}

export interface SubmissionWindowForm {
  week_number: number
  submissions_close_at: string
  submissions_closed: boolean
  status: 'open' | 'scheduled' | 'closed'
  starts_on?: string | null
  ends_on?: string | null
  lessons_count?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CohortData = Record<string, any> &
  CourseOfferingTerms & {
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
    learner_pace_weeks?: number[] | null
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

/** W9.1: the paces learners choose from when learner-chosen pace is first turned on. */
export const DEFAULT_PACE_WEEKS = '3, 4, 6'

/** "6, 3,4" -> [3, 4, 6]; anything unreadable is kept as NaN so the server explains the problem. */
export function parsePaceWeeks(value: string): number[] {
  const parts = value.split(/[\s,]+/).filter(Boolean).map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN))
  return Array.from(new Set(parts)).sort((a, b) => a - b)
}

export function formatPaceWeeks(weeks?: number[] | null): string {
  return weeks?.length ? weeks.join(', ') : ''
}

export function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

export function dateFromDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function toDateInputValue(dateStr?: string | null): string {
  if (!dateStr) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr

  return formatDateInputValue(new Date(dateStr))
}

// Submission close times use the school zone, independent of the device zone.
export function dateTimeInputToIso(value?: string | null): string | null {
  if (!value) return null

  return schoolWallTimeToIso(value)
}

export function formatDateLabel(value?: string | null) {
  return value ? formatShortDate(toDateInputValue(value), '') : ''
}

export function nowDateTimeInputValue(): string {
  return toDateTimeInputValueInTimeZone(new Date().toISOString(), schoolTimeZone)
}

export function submissionWindowStatusForForm(window: SubmissionWindowForm): SubmissionWindowForm['status'] {
  if (!window.submissions_close_at) return 'open'

  const closeAtIso = dateTimeInputToIso(window.submissions_close_at)
  if (!closeAtIso) return 'scheduled'

  return new Date(closeAtIso) <= new Date() ? 'closed' : 'scheduled'
}

export const COHORT_STATUS_OPTIONS = [
  {
    value: 'upcoming',
    label: 'Upcoming',
    description:
      'Planned cohort. The offering leaves the catalog and checkout. Students do not appear in attention lists.',
  },
  {
    value: 'active',
    label: 'Active',
    description:
      'Running cohort. Class chat and direct messages accept messages, self-paced instructor help is available during the help period, students appear in attention lists, and eligible offerings can appear in the catalog and checkout.',
  },
  {
    value: 'completed',
    label: 'Completed',
    description:
      'Finished cohort kept for reference and replays. Class chat and direct messages become read-only. Self-paced instructor help stops. The offering leaves the catalog and checkout. Students drop out of attention lists.',
  },
  {
    value: 'archived',
    label: 'Archived',
    description:
      'Moves to Past cohorts. Class chat and direct messages become read-only. Self-paced instructor help stops. The offering leaves the catalog and checkout. Students drop out of attention lists.',
  },
] as const

export const RESOURCE_CATEGORY_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'meeting', label: 'Meeting link' },
  { value: 'github', label: 'GitHub' },
  { value: 'communication', label: 'Communication' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'hotkeys', label: 'Keyboard shortcuts' },
]

export const RESOURCE_CATEGORY_LABELS = RESOURCE_CATEGORY_OPTIONS.reduce<Record<string, string>>((labels, option) => {
  labels[option.value] = option.label
  return labels
}, {})
