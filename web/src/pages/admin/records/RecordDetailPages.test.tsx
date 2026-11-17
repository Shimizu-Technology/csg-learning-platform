// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ActivityEventDetail, ChannelDetail, LearningPlanDetail, OfficeHourDetail, PrivateMeetingDetail, RecordingDetail, RubricDetail } from '../../../types/api'

// L-5.2: the remaining staff record pages. Each has a stable URL, a record
// header with Back and Copy link, the record's own sections and a related
// panel, and links through the route registry. A 404 is "No access".

const mocks = vi.hoisted(() => ({
  user: { id: 1, is_staff: true, is_admin: false } as { id: number; is_staff: boolean; is_admin: boolean },
  getRecordDetail: vi.fn(),
}))
vi.mock('../../../lib/api', () => ({ api: { getRecordDetail: mocks.getRecordDetail, getRecordSummary: vi.fn() } }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: mocks.user }) }))
vi.mock('../../../components/shared/MarkdownRenderer', () => ({ MarkdownText: ({ content }: { content: string }) => <p>{content}</p> }))

import { RecordingRecord } from './RecordingRecord'
import { OfficeHourRecord } from './OfficeHourRecord'
import { PrivateMeetingRecord } from './PrivateMeetingRecord'
import { LearningPlanRecord } from './LearningPlanRecord'
import { ChannelRecord } from './ChannelRecord'
import { RubricRecord } from './RubricRecord'
import { ActivityEventRecord } from './ActivityEventRecord'

const teal = { id: 4, name: 'Cohort Teal', course_delivery: 'program', status: 'active' }
const person = (id: number, name: string) => ({ id, name })

const recording: RecordingDetail = {
  type: 'recording', id: 21, title: 'Week 2 class', description: null, status: 'published', source: 'youtube', url: 'https://www.youtube.com/watch?v=x',
  duration_seconds: 3600, recorded_date: '2026-11-10', published_at: '2026-11-10T20:00:00Z', created_at: '2026-11-10T19:00:00Z',
  uploaded_by: person(2, 'Ivy Instructor'), cohort: teal, week: 2, can_edit: true,
  lessons: [{ lesson: { id: 40, title: 'Make decisions', archived: false }, module: person(7, 'JavaScript basics'), week: 2, block: { id: 81, title: 'Class replay' },
    sections: [{ label: 'If statements', start_seconds: 60, end_seconds: 600, required: true }, { label: 'Ternaries', start_seconds: 700, end_seconds: 900, required: false }] }],
  students_count: 2, watchers_count: 1, completed_count: 0, watchers_next_after: null,
  watchers: [{ student: person(9, 'Alex Rivera'), progress_percentage: 50, completed: false, last_watched_at: '2026-11-16T09:00:00Z' }],
}
const officeHour: OfficeHourDetail = {
  type: 'office_hour', id: 15, title: 'Tuesday help', description: null, event_kind: 'office_hours', recurrence: 'weekly', active: true,
  starts_at: '2026-11-17T08:00:00Z', ends_at: '2026-11-17T09:00:00Z', timezone: 'Pacific/Guam', meeting_url: 'https://example.invalid/office',
  upcoming: [{ starts_at: '2026-11-24T08:00:00Z', ends_at: '2026-11-24T09:00:00Z' }], cohort: teal, scheduled_by: person(2, 'Ivy Instructor'),
  teaching_team: [person(2, 'Ivy Instructor')], invited_count: 12, can_edit: true,
}
const meeting: PrivateMeetingDetail = {
  type: 'private_meeting', id: 14, status: 'confirmed', starts_at: '2026-11-19T00:00:00Z', ends_at: '2026-11-19T00:30:00Z', week_number: 2, timezone: 'Pacific/Guam',
  zoom_url: 'https://zoom.example/j/1', reschedule_count: 1, cohort: teal, student: person(9, 'Alex Rivera'), host: person(2, 'Ivy Instructor'), direct_conversation_id: 12,
  history: [{ action: 'booked', actor: person(9, 'Alex Rivera'), created_at: '2026-11-12T00:00:00Z', previous_starts_at: null },
    { action: 'rescheduled', actor: person(9, 'Alex Rivera'), created_at: '2026-11-13T00:00:00Z', previous_starts_at: '2026-11-18T00:00:00Z' }],
}
const plan: LearningPlanDetail = {
  type: 'learning_plan', id: 33, title: 'Catch up', description: 'Two lessons a week', active: true, target_date: '2026-12-20', next_check_in_on: '2026-11-24',
  updated_at: '2026-11-16T00:00:00Z', cohort: teal, student: person(9, 'Alex Rivera'), enrollment_status: 'active', lesson_exceptions_count: 0,
  milestones: [{ title: 'Basics', due_on: '2026-12-01', completed_count: 1, lessons: [
    { id: 40, title: 'Make decisions', module_id: 7, module_name: 'JavaScript basics', status: 'done', completed: true, assigned: true },
    { id: 41, title: 'Loops', module_id: null, module_name: null, status: null, completed: false, assigned: false },
  ] }],
  revisions_count: 2,
  revisions: [{ id: 2, author: person(1, 'Ada Admin'), created_at: '2026-11-16T00:00:00Z', changes: ['description', 'next follow-up'] },
    { id: 1, author: person(2, 'Ivy Instructor'), created_at: '2026-11-15T00:00:00Z', changes: ['created'] }],
}
const channel: ChannelDetail = {
  type: 'channel', id: 30, name: 'Class Chat', description: 'General class discussion', visibility: 'cohort', status: 'active', cohort: teal,
  workspace: { id: 3, name: 'Cohort Teal', workspace_type: 'cohort' }, can_manage: true,
  members: { count: 5, staff_count: 2, list: null },
  activity: { messages_count: 2, last_7_days: 2, last_message_at: '2026-11-16T09:00:00Z', recent: [
    { id: 301, author: person(9, 'Alex Rivera'), created_at: '2026-11-16T09:00:00Z', hidden: true, preview: 'Message hidden' },
    { id: 300, author: person(10, 'Sam Peer'), created_at: '2026-11-16T08:00:00Z', hidden: false, preview: 'Visible hello' },
  ] },
}
const rubric: RubricDetail = {
  type: 'rubric', id: 55, title: 'Ticket rubric', description: null, active: true, curriculum: person(1, 'Detail curriculum'), can_edit: false,
  criteria: [{ id: 1, title: 'Correct', description: 'Right price', objective: { id: 5, code: 'JS.4', title: 'Choose a branch' } }],
  uses: [{ lesson: { id: 41, title: 'Loops', archived: false }, module: person(7, 'JavaScript basics'), block: { id: 82, title: 'Ticket prices', block_type: 'exercise' }, graded: 1 }],
  cohorts: [teal], other_cohorts_count: 1,
}
const event: ActivityEventDetail = {
  type: 'activity_event', id: 66, event_type: 'submission_created', category: 'work', evidence: 'server_record', created_at: '2026-11-16T09:00:00Z',
  actor: { ...person(9, 'Alex Rivera'), role: 'student' }, subject: { ...person(9, 'Alex Rivera'), role: 'student' }, cohort: teal,
  record_type: 'Submission', record_label: 'Ticket prices',
  record: { kind: 'submission', id: 812, cohort_id: 4, student_id: 9, lesson_id: 41, content_block_id: 82 },
}
const details: Record<string, unknown> = { recording, office_hour: officeHour, private_meeting: meeting, learning_plan: plan, channel, rubric, activity_event: event }

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.user = { id: 1, is_staff: true, is_admin: false }
  mocks.getRecordDetail.mockImplementation(async (type: string) => ({ data: { detail: details[type] }, error: null, status: 200 }))
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })

async function render(entry: string | { pathname: string; search?: string; state?: unknown }) {
  const router = createMemoryRouter([
    { path: '/admin/recordings/:id', element: <RecordingRecord /> },
    { path: '/admin/office-hours/:id', element: <OfficeHourRecord /> },
    { path: '/admin/meetings/:id', element: <PrivateMeetingRecord /> },
    { path: '/admin/learning-plans/:id', element: <LearningPlanRecord /> },
    { path: '/admin/channels/:id', element: <ChannelRecord /> },
    { path: '/admin/rubrics/:id', element: <RubricRecord /> },
    { path: '/admin/activity/:id', element: <ActivityEventRecord /> },
  ], { initialEntries: [entry] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await act(async () => { await Promise.resolve() })
  return router
}
const backLink = () => container.querySelector<HTMLAnchorElement>('[data-back-link]')!
const row = (key: string) => container.querySelector(`[data-related-row="${key}"]`)
const hrefs = () => [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') || '')

it('a recording shows its week, the lessons that play it with sections, who watched, and Edit', async () => {
  await render('/admin/recordings/21')
  expect(mocks.getRecordDetail).toHaveBeenCalledWith('recording', 21)
  expect(container.querySelector('h1')?.textContent).toBe('Week 2 class')
  expect(container.querySelector('[data-record-type]')?.textContent).toBe('Recording · Week 2')
  expect(backLink().textContent).toBe('Back to Cohort Teal · Recordings')
  expect(backLink().getAttribute('href')).toBe('/admin/cohorts/4?tab=recordings')
  expect(container.textContent).toContain('1:00–10:00If statements')
  expect(container.textContent).toContain('Optional')
  expect(hrefs()).toContain('/admin/cohorts/4?tab=recordings&edit_recording=21')
  expect(hrefs().some((href) => href.startsWith('/admin/lessons/40?cohort_id=4'))).toBe(true)
  expect(hrefs().some((href) => href.startsWith('/admin/cohorts/4/students/9/learning'))).toBe(true)
  expect(row('watchers')?.textContent).toContain('1')
  expect(container.querySelector('[data-copy-link]')).not.toBeNull()
})

it('an office-hour session shows when it meets, who is invited and Join', async () => {
  await render({ pathname: '/admin/office-hours/15', state: { returnTo: '/admin', returnLabel: 'Today' } })
  expect(backLink().textContent).toBe('Back to Today')
  expect(container.querySelector('[data-record-type]')?.textContent).toBe('Office hours · Weekly')
  const join = [...container.querySelectorAll('a')].find((anchor) => anchor.textContent === 'Join')
  expect(join?.getAttribute('href')).toBe('https://example.invalid/office')
  expect(join?.getAttribute('rel')).toBe('noopener noreferrer')
  expect(container.textContent).toContain('12 active learners in Cohort Teal')
  expect(container.textContent).toContain("doesn't track who joins")
})

it('a booking shows student, host, time, status and its history, with Meetings focused on it', async () => {
  await render('/admin/meetings/14?return_to=%2Fadmin%2Fmeetings%3Fcohort_id%3D4')
  expect(backLink().textContent).toBe('Back to Meetings')
  expect(container.querySelector('h1')?.textContent).toBe('Meeting with Alex Rivera')
  expect(container.textContent).toContain('Booked')
  expect(container.textContent).toContain('Moved 1 time')
  expect(container.textContent).toContain("Bookings don't have notes")
  expect(hrefs()).toContain('/admin/meetings?cohort_id=4&booking_id=14&week=2')
  expect(row('conversation')?.querySelector('a')?.getAttribute('href')).toBe('/messages/dm/12?cohort_id=4')
})

it('a learning plan shows milestones with each lesson status, revisions, and the editor link', async () => {
  await render('/admin/learning-plans/33')
  expect(backLink().textContent).toBe('Back to Alex Rivera')
  expect(container.textContent).toContain('1 of 2 done')
  expect(container.textContent).toContain('No longer assigned')
  expect(container.textContent).toContain('Changed the description, next follow-up')
  expect(container.textContent).toContain('Started the plan')
  expect(hrefs()).toContain('/admin/cohorts/4/students/9/learning#learning-plan')
  expect(hrefs().some((href) => href.startsWith('/admin/modules/7?cohort_id=4'))).toBe(true)
})

it('a channel gives instructors a member count, keeps hidden messages hidden, and opens Messages', async () => {
  await render('/admin/channels/30')
  expect(container.querySelector('[data-record-type]')?.textContent).toBe('Class chat')
  expect(container.textContent).toContain('3 learners and 2 staff are in this conversation')
  expect(container.textContent).toContain('Message hidden')
  expect(hrefs()).toContain('/messages/30?cohort_id=4')
  expect(hrefs()).toContain('/messages/30?message_id=300')
  expect(backLink().getAttribute('href')).toBe('/admin/cohorts/4?tab=communication')
})

it('a channel lists members for admins', async () => {
  mocks.user = { id: 1, is_staff: true, is_admin: true }
  mocks.getRecordDetail.mockResolvedValueOnce({ data: { detail: { ...channel, members: { count: 2, staff_count: 1, list: [{ id: 9, name: 'Alex Rivera', role: 'student' }, { id: 1, name: 'Ada Admin', role: 'admin' }] } } }, error: null, status: 200 })
  await render('/admin/channels/30')
  expect(hrefs().some((href) => href.startsWith('/admin/cohorts/4/students/9/'))).toBe(true)
  expect(hrefs()).toContain('/admin/team/1')
})

it('a rubric shows criteria, the exercises graded with it, and other cohorts only as a number', async () => {
  await render('/admin/rubrics/55')
  expect(backLink().textContent).toBe('Back to Detail curriculum')
  expect(container.textContent).toContain('JS.4')
  expect(container.textContent).toContain('1 graded')
  expect(container.textContent).toContain("1 other cohort uses this curriculum. You don't teach it")
  expect(hrefs().some((href) => href.startsWith('/admin/lessons/41'))).toBe(true)
})

it('an activity event says what happened and links its submission', async () => {
  await render('/admin/activity/66')
  expect(container.querySelector('h1')?.textContent).toBe('Submitted work · Ticket prices')
  expect(backLink().textContent).toBe('Back to Activity')
  expect(backLink().getAttribute('href')).toBe('/admin/cohorts/4?tab=activity')
  expect(row('record')?.querySelector('a')?.getAttribute('href')).toMatch(/^\/admin\/submissions\/812\?cohort_id=4&student_id=9/)
})

it('an admin goes back to School activity', async () => {
  mocks.user = { id: 1, is_staff: true, is_admin: true }
  await render('/admin/activity/66')
  expect(backLink().getAttribute('href')).toBe('/admin/activity')
})

it.each(['/admin/recordings/21', '/admin/office-hours/15', '/admin/meetings/14', '/admin/learning-plans/33', '/admin/channels/30', '/admin/rubrics/55', '/admin/activity/66'])(
  '%s shows No access when the server answers 404', async (path) => {
    mocks.getRecordDetail.mockResolvedValue({ data: null, error: 'Not found', status: 404 })
    await render(path)
    expect(container.textContent).toContain('No access')
    expect(container.querySelector('h1')?.textContent).not.toBe('Week 2 class')
  })

// Review rounds 1 and 2 (P2): watchers come a page at a time after a fixed cursor; totals come from the server.
it('a recording shows the total who watched and loads more watchers after the last one shown', async () => {
  const watcher = (id: number) => ({ student: person(id, `Learner ${id}`), progress_percentage: 100, completed: true, last_watched_at: '2026-11-16T09:00:00Z' })
  mocks.getRecordDetail.mockImplementation(async (_type: string, _id: number, options?: { watchersAfter?: number }) => ({
    data: { detail: options?.watchersAfter === 525
      ? { ...recording, watchers: [watcher(30), watcher(31)], watchers_next_after: null, watchers_count: 27, completed_count: 20 }
      : { ...recording, watchers: Array.from({ length: 25 }, (_, index) => watcher(index + 1)), watchers_next_after: 525, watchers_count: 27, completed_count: 20 } },
    error: null, status: 200,
  }))
  await render('/admin/recordings/21')
  expect(container.querySelector('#watchers')?.textContent).toContain('27 of 2 learners')
  expect(row('watchers')?.textContent).toContain('27')
  expect(row('completed')?.textContent).toContain('20')
  expect(container.querySelectorAll('#watchers li')).toHaveLength(25)
  expect(container.textContent).toContain('Showing 25 of 27')
  const more = container.querySelector<HTMLButtonElement>('[data-show-more-watchers]')!
  await act(async () => { more.click() })
  await act(async () => { await Promise.resolve() })
  expect(mocks.getRecordDetail).toHaveBeenLastCalledWith('recording', 21, { watchersAfter: 525 })
  expect(container.querySelectorAll('#watchers li')).toHaveLength(27)
  expect(container.textContent).toContain('Showing 27 of 27')
  expect(container.querySelector('[data-show-more-watchers]')).toBeNull()
})

// Review round 1 (P2): an event whose record the viewer can't open names nothing.
it('an activity event whose record is withheld says Not available', async () => {
  mocks.getRecordDetail.mockResolvedValue({ data: { detail: { ...event, record: null, record_label: null, record_type: 'Recording' } }, error: null, status: 200 })
  await render('/admin/activity/66')
  expect(container.querySelector('h1')?.textContent).toBe('Submitted work')
  expect(container.textContent).toContain('Not available')
  expect(row('record')).toBeNull()
})

// Review round 1 (P3): a failed or refused load keeps the way back.
it('a failed load keeps Back from return_to and retries', async () => {
  mocks.getRecordDetail.mockResolvedValueOnce({ data: null, error: 'Server error', status: 500 })
  await render('/admin/recordings/21?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo')
  expect(backLink().textContent).toBe('Back to Grading · Redo')
  expect(backLink().getAttribute('href')).toBe('/admin/grading?filter=redo')
  expect(container.textContent).toContain("Couldn't load this recording")
  const retry = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Try again'))!
  await act(async () => { retry.click() })
  await act(async () => { await Promise.resolve() })
  expect(container.querySelector('h1')?.textContent).toBe('Week 2 class')
})

it.each([
  ['/admin/recordings/21', 'Back to Cohorts', '/admin/cohorts'],
  ['/admin/office-hours/15', 'Back to Cohorts', '/admin/cohorts'],
  ['/admin/meetings/14', 'Back to Meetings', '/admin/meetings'],
  ['/admin/learning-plans/33', 'Back to Students', '/admin/students'],
  ['/admin/channels/30', 'Back to Messages', '/messages'],
  ['/admin/rubrics/55', 'Back to Content', '/admin/content'],
  ['/admin/activity/66', 'Back to Today', '/admin'],
])('%s keeps a Back link on No access, to where it came from or its list', async (path, label, href) => {
  mocks.getRecordDetail.mockResolvedValue({ data: null, error: 'Not found', status: 404 })
  await render(path)
  expect(container.textContent).toContain('No access')
  expect(backLink().textContent).toBe(label)
  expect(backLink().getAttribute('href')).toBe(href)
})

it('No access keeps the Back link the page was opened with', async () => {
  mocks.getRecordDetail.mockResolvedValue({ data: null, error: 'Not found', status: 404 })
  await render({ pathname: '/admin/channels/30', state: { returnTo: '/admin/support', returnLabel: 'Support' } })
  expect(container.textContent).toContain('No access')
  expect(backLink().textContent).toBe('Back to Support')
  expect(backLink().getAttribute('href')).toBe('/admin/support')
})

it('never shows another record type the server sent back', async () => {
  mocks.getRecordDetail.mockResolvedValue({ data: { detail: rubric }, error: null, status: 200 })
  await render('/admin/recordings/21')
  expect(container.textContent).toContain('No access')
  expect(container.textContent).not.toContain('Ticket rubric')
})
