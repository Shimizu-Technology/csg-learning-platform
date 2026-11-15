import { useCallback, useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BookOpen, CalendarDays, ClipboardCheck, FileText, Files, History, Layers3, LifeBuoy, ListChecks, Megaphone, MessageCircle, PlayCircle, Table2, UserRoundCheck, Users } from 'lucide-react'
import { useAuthContext } from '../contexts/AuthContext'
import { loadRecordRelated } from './recordRelatedCache'
import {
  cohortModuleGradingPath,
  cohortPath,
  cohortStudentPath,
  conversationPath,
  helpRequestPath,
  interventionPath,
  recordPath,
  type RecordViewer,
} from './routes'

/** Records with a related panel (L-0.4). `student` is one learner in one cohort. */
export type RelatedRecordType = 'submission' | 'help_request' | 'intervention' | 'lesson' | 'student' | 'cohort'

/** One related record from the server: a count or short value plus the ids a link needs. */
export interface RelatedItem {
  key: string
  count: number | null
  value: string | null
  lesson_id?: number | null
  module_id?: number | null
  cohort_id?: number | null
  user_id?: number | null
  help_request_id?: number | null
  intervention_id?: number | null
  recording_id?: number | null
  direct_conversation_id?: number | null
  content_block_id?: number | null
  work_count?: number
  open_count?: number
  last_message_at?: string | null
  starts_at?: string | null
}

export interface RecordRelated {
  type: RelatedRecordType
  id: number
  view?: 'learner' | 'staff'
  context: {
    cohort?: { id: number; name: string }
    student?: { id: number; name: string }
    lesson?: { id: number; title: string }
    module?: { id: number; name: string }
  }
  items: RelatedItem[]
}

/** A row in the related panel, ready to render. */
export interface RelatedRow {
  key: string
  icon: LucideIcon
  label: string
  /** A count shows as a number (quiet when 0); otherwise `value` shows as text. */
  count?: number | null
  value?: string | null
  /** Highlight the count (open help, waiting work). */
  attention?: boolean
  /** Where the row goes. Rows without `to` or `onSelect` render as text, never a dead link. */
  to?: string | null
  onSelect?: () => void
}

export interface RelatedRowOptions {
  viewer: RecordViewer
  /** The current page, passed on as `return_to` where the destination reads it. */
  returnTo: string
  /** Runs instead of a link for rows that act on this page. */
  actions?: {
    /** Open or start the direct conversation with the learner. */
    message?: () => void
    /** Scroll to a section of this page: `rubric`, `evidence`, `recovery-plan`, `help`. */
    scrollTo?: (section: string) => void
  }
  /** Lesson links for learner pages (inside a staff preview these stay in the preview). */
  learnerLesson?: (lessonId: number, anchor?: string) => string
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** "now", "25 min", "3 h", "2 d" for dense rows (spec §2 writing rules). */
export function shortAgo(value: string | null | undefined, now = Date.now()) {
  if (!value) return null
  const at = new Date(value).getTime()
  if (Number.isNaN(at)) return null
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 5) return 'now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

const REVIEW_VALUES: Record<string, string> = { awaiting_review: 'Waiting for review', redo_requested: 'Redo requested', reviewed: 'Reviewed' }

/**
 * Turns the server's related items into panel rows for one record type,
 * building every link through the route registry so "view all" keeps the
 * cohort, the student and this page as the place to come back to.
 */
export function relatedRows(related: RecordRelated, options: RelatedRowOptions): RelatedRow[] {
  const { viewer, returnTo, actions = {} } = options
  const staffViewer = Boolean(viewer && viewer !== 'student' && viewer.is_staff)
  const student = related.context.student
  const firstName = student?.name.split(' ')[0]
  const workspace = (item: RelatedItem, tab: 'work' | 'support' | 'overview') => {
    const cohortId = item.cohort_id ?? related.context.cohort?.id
    const userId = item.user_id ?? student?.id
    return staffViewer && cohortId && userId ? `${cohortStudentPath(cohortId, userId, tab)}?return_to=${encodeURIComponent(returnTo)}` : null
  }
  const scrollRow = (section: string) => (actions.scrollTo ? () => actions.scrollTo!(section) : undefined)

  return related.items.flatMap((item): RelatedRow[] => {
    const count = item.count ?? null
    switch (item.key) {
      case 'lesson': {
        const lessonId = item.lesson_id
        const to = lessonId ? recordPath({ type: 'lesson', id: lessonId, cohortId: related.context.cohort?.id }, { viewer, returnTo }) : null
        const admin = Boolean(viewer && viewer !== 'student' && viewer.is_admin)
        return [{ key: item.key, icon: FileText, label: 'Lesson', value: admin ? 'Edit' : 'Open', to }]
      }
      case 'module_grid': {
        const to = staffViewer && item.cohort_id && item.module_id ? cohortModuleGradingPath(item.cohort_id, item.module_id) : null
        return [{ key: item.key, icon: Table2, label: `${item.value || 'Module'} grading`, value: 'Open', to }]
      }
      case 'rubric':
        return [{ key: item.key, icon: ListChecks, label: 'Rubric', value: count ? plural(count, 'criterion', 'criteria') : null, onSelect: scrollRow('rubric') }]
      case 'other_attempts':
        return [{ key: item.key, icon: History, label: 'Other attempts', count, to: count ? workspace(item, 'work') : null }]
      case 'help':
        if (related.view === 'learner') {
          return [{ key: item.key, icon: LifeBuoy, label: 'Your help requests', count, attention: Boolean(item.open_count), onSelect: scrollRow('help') }]
        }
        return [{ key: item.key, icon: LifeBuoy, label: 'Help on this exercise', count, attention: Boolean(item.open_count), to: item.help_request_id ? helpRequestPath(item.help_request_id, returnTo) : count ? workspace(item, 'support') : null }]
      case 'conversation': {
        const cohortId = item.cohort_id ?? related.context.cohort?.id
        const to = item.direct_conversation_id ? conversationPath({ type: 'dm', id: item.direct_conversation_id }, { cohortId }) : null
        const ago = shortAgo(item.last_message_at)
        return [{ key: item.key, icon: MessageCircle, label: firstName ? `Conversation with ${firstName}` : 'Conversation', value: to ? (ago || 'Open') : 'Start', to, onSelect: to ? undefined : actions.message }]
      }
      case 'other_requests':
        return [{ key: item.key, icon: LifeBuoy, label: firstName ? `Other requests from ${firstName}` : 'Other help requests', count, to: count ? workspace(item, 'support') : null }]
      case 'recording':
        return [{ key: item.key, icon: PlayCircle, label: 'Recording', value: 'Open', to: item.recording_id ? recordPath({ type: 'recording', id: item.recording_id, cohortId: item.cohort_id }, { viewer, returnTo }) : null }]
      case 'follow_up':
        return [{ key: item.key, icon: UserRoundCheck, label: 'Follow-up plan', count, to: item.intervention_id ? interventionPath(item.intervention_id, returnTo) : null }]
      case 'evidence':
        return [{ key: item.key, icon: Files, label: 'Why this plan started', count, onSelect: scrollRow('evidence') }]
      case 'recovery_plan':
        return [{ key: item.key, icon: ClipboardCheck, label: 'Return plan', ...(item.value ? { value: item.value } : { count }), onSelect: scrollRow('recovery-plan') }]
      case 'help_request':
        return [{ key: item.key, icon: LifeBuoy, label: 'Source help request', ...(item.help_request_id ? { value: 'Open' } : { count: 0 }), to: item.help_request_id ? helpRequestPath(item.help_request_id, returnTo) : null }]
      case 'your_work': {
        const anchor = item.content_block_id ? `block-${item.content_block_id}` : undefined
        const to = options.learnerLesson && anchor ? options.learnerLesson(related.id, anchor) : null
        const value = item.work_count ? (item.value ? REVIEW_VALUES[item.value] || null : `${item.count ?? 0} of ${item.work_count} submitted`) : 'Nothing to submit'
        return [{ key: item.key, icon: FileText, label: 'Your work', value, attention: item.value === 'redo_requested', to }]
      }
      case 'recordings': {
        const cohortId = item.cohort_id
        // Staff manage recordings on the cohort; learners (and View as student) open Recordings.
        const to = cohortId ? (staffViewer && related.view !== 'learner' ? cohortPath(cohortId, 'recordings') : `/recordings?cohort_id=${cohortId}`) : null
        return [{ key: item.key, icon: PlayCircle, label: 'Class recordings', count, to }]
      }
      case 'waiting_review': {
        const cohortId = item.cohort_id
        return [{ key: item.key, icon: ClipboardCheck, label: 'Waiting for review', count, attention: Boolean(count), to: staffViewer ? `/admin/grading${cohortId ? `?cohort_id=${cohortId}` : ''}` : null }]
      }
      case 'open_help': {
        const cohortId = item.cohort_id
        return [{ key: item.key, icon: LifeBuoy, label: 'Open help requests', count, attention: Boolean(count), to: staffViewer ? `/admin/support${cohortId ? `?cohort_id=${cohortId}` : ''}` : null }]
      }
      case 'used_in':
        return [{ key: item.key, icon: Layers3, label: 'Used in cohorts', count, to: staffViewer ? '/admin/cohorts' : null }]
      case 'cohort':
        return [{ key: item.key, icon: Layers3, label: item.value || 'Cohort', value: 'Open', to: item.cohort_id ? recordPath({ type: 'cohort', id: item.cohort_id }, { viewer }) : null }]
      case 'help_requests':
        return [{ key: item.key, icon: LifeBuoy, label: 'Help requests', count, attention: Boolean(item.open_count), value: item.open_count ? `${item.open_count} open` : null, to: workspace(item, 'support') }]
      case 'follow_ups': {
        const to = related.type === 'cohort' ? `/admin/support${item.cohort_id ? `?cohort_id=${item.cohort_id}` : ''}` : workspace(item, 'support')
        return [{ key: item.key, icon: UserRoundCheck, label: 'Active follow-up plans', count, to: staffViewer ? to : null }]
      }
      case 'meetings':
        return [{ key: item.key, icon: CalendarDays, label: 'Upcoming meetings', count, to: staffViewer && item.cohort_id ? `/admin/meetings?cohort_id=${item.cohort_id}` : null }]
      case 'other_enrollments':
        return [{ key: item.key, icon: BookOpen, label: 'Other enrollments', count, to: staffViewer && count && item.cohort_id && item.user_id ? cohortStudentPath(item.cohort_id, item.user_id) : null }]
      case 'students':
        return [{ key: item.key, icon: Users, label: 'Active students', count, to: staffViewer && item.cohort_id ? cohortPath(item.cohort_id, 'students') : null }]
      case 'updates':
        return [{ key: item.key, icon: Megaphone, label: 'Updates', count, to: item.cohort_id ? `/announcements?scope=manage&audience=cohort&cohort_id=${item.cohort_id}` : null }]
      default:
        return []
    }
  })
}

export interface RelatedState {
  related: RecordRelated | null
  loading: boolean
  error: string | null
  retry: () => void
}

/** What one request answered, for the viewer, record and scope it was asked for. */
interface Resolved { key: string; attempt: number; related: RecordRelated | null; error: string | null }

/**
 * Loads a record's related panel. `id` null waits (the page hasn't loaded its
 * record yet). Failures leave the page usable: the panel shows Retry.
 *
 * An answer is kept with the viewer, record and scope it was asked for, and
 * shown only while those still match, so a different account (or record, or
 * cohort) never sees the previous one's rows, not even for the first render
 * before its own request starts.
 */
export function useRecordRelated(type: RelatedRecordType, id: number | null | undefined, params: { cohortId?: number | null; studentId?: number | null } = {}): RelatedState {
  const viewerId = useAuthContext().user?.id
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { cohortId, studentId } = params
  const key = id ? `${viewerId ?? ''}|${type}:${id}:${cohortId || ''}:${studentId || ''}` : null

  useEffect(() => {
    if (!key || !id) return
    let active = true
    // Shared per record and viewer, so StrictMode's second effect joins the first request.
    const { promise, release } = loadRecordRelated(viewerId, type, id, { cohortId, studentId })
    void promise.then((load) => {
      if (!active || load.status === 'aborted') return
      setResolved(load.status === 'ready'
        ? { key, attempt, related: load.related, error: null }
        : { key, attempt, related: null, error: load.error })
    })
    return () => { active = false; release() }
  }, [key, viewerId, type, id, cohortId, studentId, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const current = key && resolved?.key === key ? resolved : null
  // Retry keeps this record's rows on screen while it asks again; its error clears.
  const loading = Boolean(key) && current?.attempt !== attempt
  return { related: current?.related ?? null, loading, error: loading ? null : current?.error ?? null, retry }
}
