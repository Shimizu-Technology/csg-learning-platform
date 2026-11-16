export type StudentWorkspaceTab = 'overview' | 'activity' | 'work' | 'learning' | 'support' | 'communication' | 'access'
export type CohortWorkspaceTab = 'overview' | 'students' | 'learning' | 'insights' | 'schedule' | 'communication' | 'team' | 'activity' | 'recordings' | 'settings'

export function announcementPath(announcementId: number) {
  return `/announcements/${announcementId}`
}

/** A learner's cohort home. */
export function learnerCohortPath(cohortId: number) {
  return `/cohorts/${cohortId}`
}

/** Staff cohort workspace, optionally on one tab. */
export function cohortPath(cohortId: number, tab?: CohortWorkspaceTab) {
  return `/admin/cohorts/${cohortId}${tab && tab !== 'overview' ? `?tab=${tab}` : ''}`
}

/** The lesson editor itself (admins), e.g. to return to it after an upload. Links to a lesson use `recordPath`. */
export function lessonEditorPath(lessonId: number, options: { preview?: boolean } = {}) {
  return `/admin/lessons/${lessonId}/edit${options.preview ? '?preview=true' : ''}`
}

/** Cohort settings, optionally scrolled to a section (`students`, `curriculum`). */
export function cohortSettingsPath(cohortId: number, section?: string) {
  const sections: Record<string, CohortWorkspaceTab> = { students: 'students', recordings: 'recordings', schedule: 'schedule', communication: 'communication' }
  return `${cohortPath(cohortId, sections[section || ''] || 'settings')}${section === 'curriculum' ? '#curriculum' : ''}`
}

export function cohortModuleGradingPath(cohortId: number, moduleId: number) {
  return `${cohortPath(cohortId)}/modules/${moduleId}/grading`
}

export function cohortWatchProgressPath(cohortId: number) {
  return `${cohortPath(cohortId)}/watch-progress`
}

/** Staff preview of the learner view, optionally as one enrolled student. */
export function cohortStudentViewPath(cohortId: number, studentId?: number | null) {
  return `${cohortPath(cohortId)}/student-view${studentId ? `?student_id=${studentId}` : ''}`
}

export function conversationPath(target: { type: 'channel' | 'dm'; id: number }, context: { messageId?: number | null; cohortId?: number | null } = {}) {
  const params = new URLSearchParams()
  if (context.cohortId) params.set('cohort_id', String(context.cohortId))
  if (context.messageId) params.set('message_id', String(context.messageId))
  const query = params.toString()
  return `${target.type === 'channel' ? '/messages' : '/messages/dm'}/${target.id}${query ? `?${query}` : ''}`
}

/** A staff person's record page (admins only). */
export function teamMemberPath(userId: number) {
  return `/admin/team/${userId}`
}

/** A student without a chosen cohort: the page opens their first enrollment (or Access when they have none). */
export function studentPath(userId: number) {
  return `/admin/students/${userId}`
}

export function cohortStudentPath(cohortId: number, userId: number, tab: StudentWorkspaceTab = 'overview') {
  return `${cohortPath(cohortId)}/students/${userId}/${tab}`
}

export function submissionPath(
  submissionId: number,
  context: { cohortId?: number; userId?: number; returnTo?: string; queue?: 'ungraded' | 'redo' | 'all'; queueCohortId?: number } = {},
) {
  const params = new URLSearchParams()
  if (context.cohortId) params.set('cohort_id', String(context.cohortId))
  if (context.userId) params.set('student_id', String(context.userId))
  if (context.returnTo) params.set('return_to', context.returnTo)
  if (context.queue) params.set('queue', context.queue)
  // The queue's own cohort filter, so Previous/Next walk the same list the inbox showed.
  if (context.queue && context.queueCohortId) params.set('queue_cohort_id', String(context.queueCohortId))
  const query = params.toString()
  return `/admin/submissions/${submissionId}${query ? `?${query}` : ''}`
}

export function helpRequestPath(helpRequestId: number, returnTo?: string) {
  const params = new URLSearchParams()
  if (returnTo) params.set('return_to', returnTo)
  const query = params.toString()
  return `/admin/help-requests/${helpRequestId}${query ? `?${query}` : ''}`
}

export function interventionPath(interventionId: number, returnTo?: string) {
  const params = new URLSearchParams()
  if (returnTo) params.set('return_to', returnTo)
  const query = params.toString()
  return `/admin/interventions/${interventionId}${query ? `?${query}` : ''}`
}

export function directMessagePath(
  conversationId: number,
  source?: { type: 'submission' | 'help_request' | 'intervention'; id: number; label: string; returnTo?: string },
) {
  const params = new URLSearchParams()
  if (source) {
    params.set('source_type', source.type)
    params.set('source_id', String(source.id))
    params.set('source_label', source.label)
    // Where the source record itself came from (a queue), so its Back link still works.
    const returnTo = source.returnTo ? safeInternalReturnPath(source.returnTo, '') : ''
    if (returnTo) params.set('source_return_to', returnTo)
  }
  const query = params.toString()
  return `/messages/dm/${conversationId}${query ? `?${query}` : ''}`
}

/** Staff view of a message's source record (L-1.8). A follow-up plan is a staff-only source (L-2.5). */
export function staffMessageSourcePath(source: { type: 'lesson' | 'submission' | 'help_request' | 'intervention'; id: number; cohort_id?: number | null }, returnTo?: string) {
  if (source.type === 'submission') return submissionPath(source.id, { cohortId: source.cohort_id || undefined, returnTo })
  if (source.type === 'help_request') return helpRequestPath(source.id, returnTo)
  if (source.type === 'intervention') return interventionPath(source.id, returnTo)
  return lessonLearnerPath(source.id, source.cohort_id)
}

export function safeInternalReturnPath(value: string | null, fallback: string) {
  if (!value) return fallback
  const origin = 'https://csg.local'
  // Absolute Clerk handoffs are allowed only from the current frontend origin.
  if (/^https?:\/\//i.test(value)) {
    try {
      const absolute = new URL(value)
      if (typeof window === 'undefined' || absolute.origin !== window.location.origin) return fallback
      value = `${absolute.pathname}${absolute.search}${absolute.hash}`
    } catch { return fallback }
  }
  const valid = (path: string) => {
    // eslint-disable-next-line no-control-regex
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(path)) return false
    const parsed = new URL(path, origin)
    return parsed.origin === origin && parsed.pathname.startsWith('/') && !parsed.pathname.startsWith('//') && !/^\/sign-(in|up)(?:\/|$)/i.test(parsed.pathname)
  }
  try {
    if (!valid(value)) return fallback
    const parsed = new URL(value, origin)
    const result = `${parsed.pathname}${parsed.search}${parsed.hash}`
    if (!valid(result)) return fallback
    let decoded = result
    for (let depth = 0; depth < 8; depth++) {
      if (!valid(decoded)) return fallback
      // Decode components independently so a literal percent in a query cannot
      // prevent inspection of nested path encodings. Navigation keeps result.
      const url = new URL(decoded, origin)
      let pathname: string
      try { pathname = decodeURIComponent(url.pathname) } catch { return fallback }
      const decodeContext = (part: string) => {
        try { return decodeURIComponent(part) } catch { return part }
      }
      const next = `${pathname}${decodeContext(url.search)}${decodeContext(url.hash)}`
      if (!valid(next)) return fallback
      if (next === decoded) return result
      decoded = next
    }
  } catch { /* Invalid destinations use the caller's fallback. */ }
  return fallback
}

/** Only Activity feed locations may supply Activity return navigation. */
export function activityReturnPath(value: string | null): string | null {
  const path = safeInternalReturnPath(value, '')
  if (!path || /\s/.test(path)) return null
  try {
    const url = new URL(path, 'https://csg.local')
    if (url.origin !== 'https://csg.local') return null
    if (url.pathname === '/admin/activity' || (/^\/admin\/cohorts\/[1-9]\d*$/.test(url.pathname) && url.searchParams.get('tab') === 'activity')) return `${url.pathname}${url.search}${url.hash}`
  } catch { /* Invalid URL: use the normal destination fallback. */ }
  return null
}

/* -------------------------------------------------------------------------- */
/* Record-route registry (L-0.1)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Who is looking. Pass the signed-in user (`is_staff` / `is_admin`), or
 * `'student'` for a staff preview of the learner view, where links must open
 * learner pages.
 */
export type RecordViewer = { is_staff?: boolean | null; is_admin?: boolean | null } | 'student' | null | undefined
export type ViewerRole = 'admin' | 'instructor' | 'student'

export function viewerRole(viewer: RecordViewer): ViewerRole | null {
  if (!viewer) return null
  if (viewer === 'student') return 'student'
  if (viewer.is_admin) return 'admin'
  return viewer.is_staff ? 'instructor' : 'student'
}

type Id = number
type OptionalId = number | null | undefined

/** Every record the web app shows. `id` is the record's own id. */
export type RecordRef =
  /** A learner. With `cohortId` this is the enrollment workspace; without it, staff land on the student's first enrollment. */
  | { type: 'student'; id: Id; cohortId?: OptionalId; tab?: StudentWorkspaceTab }
  /** One student in one cohort (plan §5.1): the Student Workspace. */
  | { type: 'enrollment'; userId: Id; cohortId: Id; tab?: StudentWorkspaceTab }
  /** Any account without a learner page, when its role is unknown. No page. */
  | { type: 'user'; id: Id }
  /** An instructor or admin: their team member page. Only admins have one to open. */
  | { type: 'staff'; id: Id }
  | { type: 'cohort'; id: Id; tab?: CohortWorkspaceTab }
  /** Curricula are managed inside Content; there is no curriculum page yet. */
  | { type: 'curriculum'; id: Id }
  | { type: 'module'; id: Id; cohortId?: OptionalId }
  /**
   * Admins open the editor unless `view: 'learn'`; everyone else opens the lesson.
   * Learner pages pass `view: 'learn'` so admins browsing them stay in the learner view.
   * `anchor` (learner view only) scrolls to an element id such as `block-12` or `redo`.
   */
  | { type: 'lesson'; id: Id; cohortId?: OptionalId; view?: 'edit' | 'learn'; anchor?: string }
  /** Exercises, readings and videos inside a lesson: the lesson, scrolled to the block. */
  | { type: 'content_block'; id: Id; lessonId: Id; cohortId?: OptionalId }
  /** A knowledge check is a content block; same destination. */
  | { type: 'knowledge_check'; id: Id; lessonId: Id; cohortId?: OptionalId }
  /** Staff open the submission record; learners open the exercise in its lesson. */
  | { type: 'submission'; id: Id; cohortId?: OptionalId; userId?: OptionalId; lessonId?: OptionalId; contentBlockId?: OptionalId; queue?: 'ungraded' | 'redo' | 'all'; queueCohortId?: OptionalId }
  | { type: 'help_request'; id: Id }
  /** Shown to staff as "follow-up plan". */
  | { type: 'intervention'; id: Id }
  | { type: 'announcement'; id: Id }
  | { type: 'channel'; id: Id; messageId?: OptionalId }
  /** `cohortId` selects that cohort in the app while the conversation is open. */
  | { type: 'direct_conversation'; id: Id; messageId?: OptionalId; cohortId?: OptionalId }
  /** Bookings are listed on My meetings / Private meetings; there is no booking page. */
  | { type: 'private_meeting'; id: Id }
  /** Office hours are listed on the cohort and Today; there is no office-hour page. */
  | { type: 'office_hour'; id: Id }
  | { type: 'recording'; id: Id; cohortId?: OptionalId }
  /** A learner's plan for one enrollment. Staff see it in the workspace's Learning tab. */
  | { type: 'learning_plan'; userId: Id; cohortId: Id }

export type RecordType = RecordRef['type']

export interface RecordPathContext {
  viewer: RecordViewer
  /** The page the link is on (path + query). Added as `return_to` only where the destination reads it. */
  returnTo?: string | null
}

/**
 * Which return paths a destination honors through `return_to`:
 * `any` (any internal path), `activity` (only School activity / cohort Activity),
 * or `none` (the destination ignores it, so it is not added).
 */
export type ReturnSupport = 'any' | 'activity' | 'none'

export interface RecordRouteInfo {
  /** Route pattern per role, or null where the role has no page for the record. */
  staff: string | null
  admin: string | null
  student: string | null
  /** Query keys the destination reads. */
  contextKeys: readonly string[]
  returnTo: ReturnSupport
}

/**
 * The registry. `recordPath` builds every URL from this table's patterns; the
 * table is also the inventory the record-link test checks against App.tsx.
 */
export const RECORD_ROUTES: Readonly<Record<RecordType, RecordRouteInfo>> = {
  student: { staff: '/admin/cohorts/:cohortId/students/:userId/:tab', admin: '/admin/cohorts/:cohortId/students/:userId/:tab', student: null, contextKeys: ['return_to'], returnTo: 'activity' },
  enrollment: { staff: '/admin/cohorts/:cohortId/students/:userId/:tab', admin: '/admin/cohorts/:cohortId/students/:userId/:tab', student: null, contextKeys: ['return_to'], returnTo: 'activity' },
  user: { staff: null, admin: null, student: null, contextKeys: [], returnTo: 'none' },
  staff: { staff: null, admin: '/admin/team/:id', student: null, contextKeys: [], returnTo: 'none' },
  cohort: { staff: '/admin/cohorts/:id', admin: '/admin/cohorts/:id', student: '/cohorts/:id', contextKeys: ['tab'], returnTo: 'none' },
  curriculum: { staff: null, admin: null, student: null, contextKeys: [], returnTo: 'none' },
  module: { staff: '/modules/:id', admin: '/modules/:id', student: '/modules/:id', contextKeys: ['cohort_id'], returnTo: 'none' },
  lesson: { staff: '/lessons/:id', admin: '/admin/lessons/:id/edit', student: '/lessons/:id', contextKeys: ['cohort_id', 'return_to'], returnTo: 'activity' },
  content_block: { staff: '/lessons/:lessonId', admin: '/lessons/:lessonId', student: '/lessons/:lessonId', contextKeys: ['cohort_id'], returnTo: 'none' },
  knowledge_check: { staff: '/lessons/:lessonId', admin: '/lessons/:lessonId', student: '/lessons/:lessonId', contextKeys: ['cohort_id'], returnTo: 'none' },
  submission: { staff: '/admin/submissions/:id', admin: '/admin/submissions/:id', student: '/lessons/:lessonId', contextKeys: ['cohort_id', 'student_id', 'return_to', 'queue', 'queue_cohort_id'], returnTo: 'any' },
  help_request: { staff: '/admin/help-requests/:id', admin: '/admin/help-requests/:id', student: null, contextKeys: ['return_to'], returnTo: 'any' },
  intervention: { staff: '/admin/interventions/:id', admin: '/admin/interventions/:id', student: null, contextKeys: ['return_to'], returnTo: 'any' },
  announcement: { staff: '/announcements/:id', admin: '/announcements/:id', student: '/announcements/:id', contextKeys: [], returnTo: 'none' },
  channel: { staff: '/messages/:id', admin: '/messages/:id', student: '/messages/:id', contextKeys: ['message_id'], returnTo: 'none' },
  direct_conversation: { staff: '/messages/dm/:id', admin: '/messages/dm/:id', student: '/messages/dm/:id', contextKeys: ['cohort_id', 'message_id'], returnTo: 'none' },
  private_meeting: { staff: null, admin: null, student: null, contextKeys: [], returnTo: 'none' },
  office_hour: { staff: null, admin: null, student: null, contextKeys: [], returnTo: 'none' },
  recording: { staff: '/recordings', admin: '/recordings', student: '/recordings', contextKeys: ['cohort_id', 'recording', 'return_to'], returnTo: 'activity' },
  learning_plan: { staff: '/admin/cohorts/:cohortId/students/:userId/learning', admin: '/admin/cohorts/:cohortId/students/:userId/learning', student: null, contextKeys: [], returnTo: 'none' },
}

function withQuery(path: string, params: Record<string, string | number | null | undefined>, hash = '') {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') query.set(key, String(value))
  }
  const search = query.toString()
  return `${path}${search ? `?${search}` : ''}${hash}`
}

function validId(value: OptionalId): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** The `return_to` value a destination accepts, or undefined. */
function acceptedReturn(support: ReturnSupport, returnTo: string | null | undefined): string | undefined {
  if (!returnTo || support === 'none') return undefined
  if (support === 'activity') return activityReturnPath(returnTo) || undefined
  return safeInternalReturnPath(returnTo, '') || undefined
}

function lessonLearnerPath(lessonId: number, cohortId: OptionalId, anchor?: string | null, returnTo?: string) {
  const hash = anchor && /^[\w-]+$/.test(anchor) ? `#${anchor}` : ''
  return withQuery(`/lessons/${lessonId}`, { cohort_id: validId(cohortId) ? cohortId : undefined, return_to: returnTo }, hash)
}

const blockAnchor = (blockId: OptionalId) => (validId(blockId) ? `block-${blockId}` : undefined)

/**
 * The page that opens `ref` for this viewer, or null when there is no page
 * for it or the viewer can't open it. Use `<RecordLink>` to render one.
 */
export function recordPath(ref: RecordRef, context: RecordPathContext): string | null {
  const role = viewerRole(context.viewer)
  if (!role) return null
  const staff = role !== 'student'
  const routeReturn = (type: RecordType) => acceptedReturn(RECORD_ROUTES[type].returnTo, context.returnTo)

  switch (ref.type) {
    case 'student':
    case 'enrollment': {
      if (!staff) return null
      const userId = ref.type === 'student' ? ref.id : ref.userId
      if (!validId(userId)) return null
      const returnTo = routeReturn(ref.type)
      if (validId(ref.cohortId)) return withQuery(cohortStudentPath(ref.cohortId, userId, ref.tab), { return_to: returnTo })
      return studentPath(userId)
    }
    case 'staff':
      return role === 'admin' && validId(ref.id) ? teamMemberPath(ref.id) : null
    case 'cohort':
      if (!validId(ref.id)) return null
      if (!staff) return learnerCohortPath(ref.id)
      return cohortPath(ref.id, ref.tab)
    case 'module':
      return validId(ref.id) ? withQuery(`/modules/${ref.id}`, { cohort_id: validId(ref.cohortId) ? ref.cohortId : undefined }) : null
    case 'lesson':
      if (!validId(ref.id)) return null
      if (role === 'admin' && ref.view !== 'learn') return lessonEditorPath(ref.id)
      return lessonLearnerPath(ref.id, ref.cohortId, ref.anchor, routeReturn('lesson'))
    case 'content_block':
    case 'knowledge_check':
      return validId(ref.id) && validId(ref.lessonId) ? lessonLearnerPath(ref.lessonId, ref.cohortId, blockAnchor(ref.id)) : null
    case 'submission':
      if (!validId(ref.id)) return null
      if (!staff) return validId(ref.lessonId) ? lessonLearnerPath(ref.lessonId, ref.cohortId, blockAnchor(ref.contentBlockId)) : null
      return submissionPath(ref.id, {
        cohortId: validId(ref.cohortId) ? ref.cohortId : undefined,
        userId: validId(ref.userId) ? ref.userId : undefined,
        returnTo: routeReturn('submission'),
        queue: ref.queue,
        queueCohortId: validId(ref.queueCohortId) ? ref.queueCohortId : undefined,
      })
    case 'help_request':
      return staff && validId(ref.id) ? helpRequestPath(ref.id, routeReturn('help_request')) : null
    case 'intervention':
      return staff && validId(ref.id) ? interventionPath(ref.id, routeReturn('intervention')) : null
    case 'announcement':
      return validId(ref.id) ? announcementPath(ref.id) : null
    case 'channel':
      return validId(ref.id) ? conversationPath({ type: 'channel', id: ref.id }, { messageId: validId(ref.messageId) ? ref.messageId : undefined }) : null
    case 'direct_conversation':
      return validId(ref.id) ? conversationPath({ type: 'dm', id: ref.id }, { messageId: validId(ref.messageId) ? ref.messageId : undefined, cohortId: validId(ref.cohortId) ? ref.cohortId : undefined }) : null
    case 'recording':
      return validId(ref.id) ? withQuery('/recordings', { cohort_id: validId(ref.cohortId) ? ref.cohortId : undefined, recording: ref.id, return_to: routeReturn('recording') }) : null
    case 'learning_plan':
      return staff && validId(ref.userId) && validId(ref.cohortId) ? cohortStudentPath(ref.cohortId, ref.userId, 'learning') : null
    case 'user':
    case 'curriculum':
    case 'private_meeting':
    case 'office_hour':
      return null
  }
}

/**
 * Links from learner pages (Today, Learn, a module, a lesson) to lessons,
 * modules and recordings: always the learner view, in this cohort, so staff
 * browsing or previewing a learner page stay in it. Inside a staff preview,
 * `PreviewLink` maps these paths into the preview.
 */
export function learnerPaths(cohortId?: number | null) {
  const learner = (ref: RecordRef, fallback: string) => recordPath(ref, { viewer: 'student' }) || fallback
  return {
    lesson: (lessonId: number, anchor?: string) => learner({ type: 'lesson', id: lessonId, cohortId, anchor }, '/materials'),
    /** The lesson scrolled to a block, or to its redo notice when the block is unknown. */
    redo: (lessonId: number, contentBlockId?: number | null) => learner({ type: 'lesson', id: lessonId, cohortId, anchor: contentBlockId ? `block-${contentBlockId}` : 'redo' }, '/materials'),
    module: (moduleId: number) => learner({ type: 'module', id: moduleId, cohortId }, '/materials'),
    /** A recording on Recordings, in the recording's own cohort when it has one. */
    recording: (recordingId: number, recordingCohortId?: number | null) => learner({ type: 'recording', id: recordingId, cohortId: recordingCohortId }, '/recordings'),
  }
}
