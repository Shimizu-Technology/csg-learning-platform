import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { learnerPaths, RECORD_ROUTES, recordPath, viewerRole, type RecordRef, type RecordType, type RecordViewer, type ViewerRole } from './routes'

const viewers: Record<ViewerRole, RecordViewer> = {
  admin: { is_staff: true, is_admin: true },
  instructor: { is_staff: true, is_admin: false },
  student: { is_staff: false, is_admin: false },
}

/** One reference per record type, with every context key it can carry. */
const refs: Record<RecordType, RecordRef> = {
  student: { type: 'student', id: 12, cohortId: 7, tab: 'work' },
  enrollment: { type: 'enrollment', userId: 12, cohortId: 7 },
  user: { type: 'user', id: 3 },
  staff: { type: 'staff', id: 3 },
  cohort: { type: 'cohort', id: 7 },
  curriculum: { type: 'curriculum', id: 2 },
  module: { type: 'module', id: 31, cohortId: 7 },
  lesson: { type: 'lesson', id: 42, cohortId: 7 },
  content_block: { type: 'content_block', id: 99, lessonId: 42, cohortId: 7 },
  knowledge_check: { type: 'knowledge_check', id: 98, lessonId: 42 },
  submission: { type: 'submission', id: 812, cohortId: 7, userId: 12, lessonId: 42, contentBlockId: 99 },
  help_request: { type: 'help_request', id: 9 },
  intervention: { type: 'intervention', id: 61 },
  announcement: { type: 'announcement', id: 5 },
  channel: { type: 'channel', id: 4 },
  direct_conversation: { type: 'direct_conversation', id: 6, messageId: 300 },
  private_meeting: { type: 'private_meeting', id: 14, cohortId: 7, week: 2 },
  office_hour: { type: 'office_hour', id: 15 },
  recording: { type: 'recording', id: 21, cohortId: 7 },
  learning_plan: { type: 'learning_plan', id: 33, userId: 12, cohortId: 7 },
  recovery_plan: { type: 'recovery_plan', id: 44, userId: 12, cohortId: 7 },
  rubric: { type: 'rubric', id: 55 },
  activity_event: { type: 'activity_event', id: 66 },
  content_report: { type: 'content_report', id: 77 },
  offering: { type: 'offering', id: 8 },
}

/** Expected destination for each type × role, from a page with no return context. */
const expected: Record<RecordType, Record<ViewerRole, string | null>> = {
  student: { admin: '/admin/cohorts/7/students/12/work', instructor: '/admin/cohorts/7/students/12/work', student: null },
  enrollment: { admin: '/admin/cohorts/7/students/12/overview', instructor: '/admin/cohorts/7/students/12/overview', student: null },
  user: { admin: null, instructor: null, student: null },
  staff: { admin: '/admin/team/3', instructor: null, student: null },
  cohort: { admin: '/admin/cohorts/7', instructor: '/admin/cohorts/7', student: '/cohorts/7' },
  // L-5: staff open the content record pages; learners keep Learn.
  curriculum: { admin: '/admin/curricula/2', instructor: '/admin/curricula/2', student: null },
  module: { admin: '/admin/modules/31?cohort_id=7', instructor: '/admin/modules/31?cohort_id=7', student: '/modules/31?cohort_id=7' },
  lesson: { admin: '/admin/lessons/42?cohort_id=7', instructor: '/admin/lessons/42?cohort_id=7', student: '/lessons/42?cohort_id=7' },
  content_block: { admin: '/lessons/42?cohort_id=7#block-99', instructor: '/lessons/42?cohort_id=7#block-99', student: '/lessons/42?cohort_id=7#block-99' },
  knowledge_check: { admin: '/lessons/42#block-98', instructor: '/lessons/42#block-98', student: '/lessons/42#block-98' },
  submission: { admin: '/admin/submissions/812?cohort_id=7&student_id=12', instructor: '/admin/submissions/812?cohort_id=7&student_id=12', student: '/lessons/42?cohort_id=7#block-99' },
  help_request: { admin: '/admin/help-requests/9', instructor: '/admin/help-requests/9', student: null },
  intervention: { admin: '/admin/interventions/61', instructor: '/admin/interventions/61', student: null },
  announcement: { admin: '/announcements/5', instructor: '/announcements/5', student: '/announcements/5' },
  channel: { admin: '/messages/4', instructor: '/messages/4', student: '/messages/4' },
  direct_conversation: { admin: '/messages/dm/6?message_id=300', instructor: '/messages/dm/6?message_id=300', student: '/messages/dm/6?message_id=300' },
  // L-5.2: staff open the record pages; a learner keeps their own booking and Recordings.
  private_meeting: { admin: '/admin/meetings/14', instructor: '/admin/meetings/14', student: '/meetings?cohort_id=7&booking_id=14&week=2' },
  office_hour: { admin: '/admin/office-hours/15', instructor: '/admin/office-hours/15', student: null },
  recording: { admin: '/admin/recordings/21', instructor: '/admin/recordings/21', student: '/recordings?cohort_id=7&recording=21' },
  learning_plan: { admin: '/admin/learning-plans/33', instructor: '/admin/learning-plans/33', student: null },
  // A return plan has its own page now (L-5.2); safety and purchase pages are admin-only.
  recovery_plan: { admin: '/admin/recovery-plans/44', instructor: '/admin/recovery-plans/44', student: null },
  rubric: { admin: '/admin/rubrics/55', instructor: '/admin/rubrics/55', student: null },
  activity_event: { admin: '/admin/activity/66', instructor: '/admin/activity/66', student: null },
  content_report: { admin: '/admin/moderation/reports/77', instructor: null, student: null },
  offering: { admin: '/admin/offerings/8', instructor: null, student: null },
}

const cases = (Object.keys(refs) as RecordType[]).flatMap((type) => (Object.keys(viewers) as ViewerRole[]).map((role) => [type, role] as const))

describe('recordPath', () => {
  it.each(cases)('%s for %s', (type, role) => {
    expect(recordPath(refs[type], { viewer: viewers[role] })).toBe(expected[type][role])
  })

  it('opens nothing for a signed-out viewer', () => {
    for (const ref of Object.values(refs)) expect(recordPath(ref, { viewer: null })).toBeNull()
  })

  it('treats a staff preview of the learner view as a student', () => {
    expect(viewerRole('student')).toBe('student')
    expect(recordPath(refs.lesson, { viewer: 'student' })).toBe('/lessons/42?cohort_id=7')
    expect(recordPath(refs.help_request, { viewer: 'student' })).toBeNull()
  })

  it('adds return_to only where the destination reads it', () => {
    const returnTo = '/admin/grading?filter=redo'
    const admin = { viewer: viewers.admin, returnTo }
    expect(recordPath(refs.submission, admin)).toBe('/admin/submissions/812?cohort_id=7&student_id=12&return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo')
    expect(recordPath(refs.help_request, admin)).toBe('/admin/help-requests/9?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo')
    // An update returns to where it was opened from (L-1.5) and keeps its cohort (L-2.9).
    expect(recordPath(refs.announcement, admin)).toBe('/announcements/5?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo')
    expect(recordPath({ type: 'announcement', id: 5, cohortId: 7 }, { viewer: viewers.student, returnTo: '/dashboard' })).toBe('/announcements/5?cohort_id=7&return_to=%2Fdashboard')
    expect(recordPath(refs.intervention, admin)).toBe('/admin/interventions/61?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo')
    // The content record pages say where they were opened from (L-5).
    expect(recordPath(refs.lesson, { viewer: viewers.instructor, returnTo })).toBe('/admin/lessons/42?cohort_id=7&return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo')
    expect(recordPath(refs.module, admin)).toBe('/admin/modules/31?cohort_id=7&return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo')
    expect(recordPath(refs.curriculum, admin)).toBe('/admin/curricula/2?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo')
    // These destinations ignore return_to (or honor Activity only), so the URL stays clean.
    expect(recordPath(refs.cohort, admin)).toBe('/admin/cohorts/7')
    expect(recordPath(refs.student, admin)).toBe('/admin/cohorts/7/students/12/work')
    expect(recordPath({ type: 'lesson', id: 42, cohortId: 7, view: 'learn' }, { viewer: viewers.instructor, returnTo })).toBe('/lessons/42?cohort_id=7')
    expect(recordPath({ type: 'module', id: 31, cohortId: 7, view: 'learn' }, admin)).toBe('/modules/31?cohort_id=7')
  })

  it('carries an Activity return path to destinations that offer Back to Activity', () => {
    const fromActivity = { viewer: viewers.instructor, returnTo: '/admin/cohorts/7?tab=activity' }
    expect(recordPath(refs.student, fromActivity)).toBe('/admin/cohorts/7/students/12/work?return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dactivity')
    expect(recordPath(refs.lesson, fromActivity)).toBe('/admin/lessons/42?cohort_id=7&return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dactivity')
    expect(recordPath({ type: 'lesson', id: 42, cohortId: 7, view: 'learn' }, fromActivity)).toBe('/lessons/42?cohort_id=7&return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dactivity')
    expect(recordPath(refs.recording, fromActivity)).toBe('/admin/recordings/21?return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dactivity')
    expect(recordPath(refs.recording, { viewer: viewers.student, returnTo: '/admin/cohorts/7?tab=activity' })).toBe('/recordings?cohort_id=7&recording=21&return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dactivity')
  })

  it('opens the L-5.2 record pages with where they were opened from', () => {
    const returnTo = '/admin/cohorts/7?tab=schedule'
    const instructor = { viewer: viewers.instructor, returnTo }
    expect(recordPath(refs.office_hour, instructor)).toBe('/admin/office-hours/15?return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dschedule')
    expect(recordPath(refs.private_meeting, instructor)).toBe('/admin/meetings/14?return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dschedule')
    expect(recordPath(refs.rubric, instructor)).toBe('/admin/rubrics/55?return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dschedule')
    expect(recordPath(refs.activity_event, instructor)).toBe('/admin/activity/66?return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dschedule')
    expect(recordPath(refs.learning_plan, instructor)).toBe('/admin/learning-plans/33?return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dschedule')
    // A learner's own booking ignores staff return context.
    expect(recordPath(refs.private_meeting, { viewer: viewers.student, returnTo })).toBe('/meetings?cohort_id=7&booking_id=14&week=2')
  })

  it('keeps Messages as the channel destination and opens the channel page with view: record', () => {
    expect(recordPath({ type: 'channel', id: 4, messageId: 9 }, { viewer: viewers.instructor })).toBe('/messages/4?message_id=9')
    expect(recordPath({ type: 'channel', id: 4, view: 'record' }, { viewer: viewers.instructor, returnTo: '/admin/cohorts/7?tab=communication' })).toBe('/admin/channels/4?return_to=%2Fadmin%2Fcohorts%2F7%3Ftab%3Dcommunication')
    expect(recordPath({ type: 'channel', id: 4, view: 'record' }, { viewer: viewers.student })).toBe('/messages/4')
  })

  it('opens the workspace Learning tab for a plan without its id', () => {
    expect(recordPath({ type: 'learning_plan', userId: 12, cohortId: 7 }, { viewer: viewers.admin })).toBe('/admin/cohorts/7/students/12/learning')
  })

  it('drops an external or malformed return path', () => {
    for (const returnTo of ['//evil.example', 'https://evil.example/admin', '/\t/evil.example', '/\\evil.example']) {
      expect(recordPath(refs.help_request, { viewer: viewers.admin, returnTo })).toBe('/admin/help-requests/9')
    }
  })

  it('handles optional context', () => {
    expect(recordPath({ type: 'student', id: 12 }, { viewer: viewers.instructor })).toBe('/admin/students/12')
    expect(recordPath({ type: 'lesson', id: 42, view: 'learn' }, { viewer: viewers.admin })).toBe('/lessons/42')
    // `view: 'edit'` opens the editor for every staff member (read only without editing access).
    expect(recordPath({ type: 'lesson', id: 42, view: 'edit' }, { viewer: viewers.admin })).toBe('/admin/lessons/42/edit')
    expect(recordPath({ type: 'lesson', id: 42, view: 'edit' }, { viewer: viewers.instructor })).toBe('/admin/lessons/42/edit')
    expect(recordPath({ type: 'lesson', id: 42, view: 'edit' }, { viewer: viewers.student })).toBe('/lessons/42')
    expect(recordPath({ type: 'cohort', id: 7, tab: 'students' }, { viewer: viewers.admin })).toBe('/admin/cohorts/7?tab=students')
    expect(recordPath({ type: 'cohort', id: 7, tab: 'students' }, { viewer: viewers.student })).toBe('/cohorts/7')
    expect(recordPath({ type: 'submission', id: 812 }, { viewer: viewers.student })).toBeNull()
    expect(recordPath({ type: 'submission', id: 812, queue: 'redo', queueCohortId: 7 }, { viewer: viewers.admin })).toBe('/admin/submissions/812?queue=redo&queue_cohort_id=7')
    expect(recordPath({ type: 'module', id: 31, cohortId: null }, { viewer: viewers.student })).toBe('/modules/31')
  })

  it('returns null for a missing or invalid id rather than a broken URL', () => {
    expect(recordPath({ type: 'lesson', id: 0 }, { viewer: viewers.student })).toBeNull()
    expect(recordPath({ type: 'cohort', id: Number.NaN }, { viewer: viewers.admin })).toBeNull()
    expect(recordPath({ type: 'content_block', id: 3, lessonId: 0 }, { viewer: viewers.student })).toBeNull()
  })
})

describe('RECORD_ROUTES', () => {
  const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')
  const appRoutes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1])
  const toRegExp = (route: string) => new RegExp(`^${route.replace(/:\w+\?/g, '[^/]*').replace(/:\w+/g, '[^/]+').replace(/\*$/, '.*')}$`)

  it.each(Object.entries(RECORD_ROUTES))('%s points at routes App.tsx defines', (_type, info) => {
    for (const pattern of [info.admin, info.staff, info.student, info.staffRecord]) {
      if (!pattern) continue
      const sample = pattern.replace(/:\w+/g, '1')
      expect(appRoutes.some((route) => toRegExp(route).test(sample)), `${pattern} has no matching <Route>`).toBe(true)
    }
  })

  it('documents every query key recordPath emits', () => {
    for (const [type, ref] of Object.entries(refs) as Array<[RecordType, RecordRef]>) {
      for (const role of Object.keys(viewers) as ViewerRole[]) {
        const path = recordPath(ref, { viewer: viewers[role], returnTo: '/admin/activity' })
        if (!path) continue
        const keys = [...new URL(path, 'https://csg.local').searchParams.keys()]
        for (const key of keys) expect(RECORD_ROUTES[type].contextKeys, `${type} emits ${key}`).toContain(key)
      }
    }
  })
})

describe('learnerPaths', () => {
  it('builds learner-view links in the selected cohort', () => {
    const paths = learnerPaths(7)
    expect(paths.lesson(42)).toBe('/lessons/42?cohort_id=7')
    expect(paths.lesson(42, 'block-9')).toBe('/lessons/42?cohort_id=7#block-9')
    expect(paths.redo(42, 9)).toBe('/lessons/42?cohort_id=7#block-9')
    expect(paths.redo(42, null)).toBe('/lessons/42?cohort_id=7#redo')
    expect(paths.module(31)).toBe('/modules/31?cohort_id=7')
    expect(paths.recording(21, 3)).toBe('/recordings?cohort_id=3&recording=21')
    expect(paths.recording(21)).toBe('/recordings?recording=21')
  })

  it('omits a missing cohort and rejects unsafe anchors', () => {
    expect(learnerPaths(null).lesson(42)).toBe('/lessons/42')
    expect(learnerPaths(7).lesson(42, '"><script>')).toBe('/lessons/42?cohort_id=7')
  })
})
