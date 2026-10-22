// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ cohortId: 4, user: { id: 7, full_name: 'Learner', is_staff: false } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: state.user, enrollments: [{ cohort: { id: state.cohortId, course_delivery: 'self_paced' } }] }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: state.cohortId }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('@clerk/clerk-react', () => ({ useClerk: () => ({ openUserProfile: vi.fn(), signOut: vi.fn() }) }))
vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('../../components/shared/ActivityTimeline', () => ({ ActivityTimeline: () => null }))
vi.mock('../../components/shared/ContentBlockRenderer', () => ({ ContentBlockRenderer: ({ readOnly }: { readOnly: boolean }) => <div data-readonly={String(readOnly)} /> }))
vi.mock('../../components/shared/VideoPlayer', () => ({ VideoPlayer: ({ title, trackProgress }: { title: string; trackProgress: boolean }) => <div data-tracking={String(trackProgress)}>{title}</div> }))
vi.mock('../../components/shared/Modal', () => ({ Modal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role="dialog">{children}</div> : null }))
vi.mock('../../lib/api', () => ({ api: {
  getLesson: vi.fn(), getProfile: vi.fn(), getHelpRequests: vi.fn(), getPushConfig: vi.fn(), getBlockedUsers: vi.fn(),
  getRecordings: vi.fn(), getDashboard: vi.fn(), getWeeklyPlan: vi.fn(), createDirectConversation: vi.fn(), updateHelpRequest: vi.fn(),
} }))

import { api } from '../../lib/api'
import { LessonView } from './LessonView'
import { Profile } from './Profile'
import { Recordings } from './Recordings'
import { Dashboard } from './Dashboard'
import { ContextualHelp } from '../../components/student/ContextualHelp'
import { CourseSupport } from '../../components/student/CourseSupport'
import type { HelpRequest, LearnerCapabilities } from '../../types/api'
import { composerDestinationKey, readComposerDraft } from '../../lib/messageComposerState'

const capabilities: LearnerCapabilities = { can_submit: true, read_only: false, support_mode: 'guided_help', support_expires_at: null, access_expires_at: null, support_instructor_id: 9 }
const lesson = { id: 42, cohort_id: 4, module_id: 2, title: 'Lists', lesson_type: 'exercise', position: 1, release_day: 1, required: true, requires_submission: true, content_blocks_count: 1, archived_at: null, updated_at: '', capabilities, content_blocks: [{ id: 42, block_type: 'exercise', title: 'List practice' }], objectives: [], prev_lesson: null, next_lesson: null }
const profile = { user: { id: 7, email: 'student@example.test', first_name: 'Student', last_name: 'Test', full_name: 'Student Test', github_username: 'student', avatar_url: null }, enrollments: [] }
const request = (overrides: Partial<HelpRequest> = {}): HelpRequest => ({ id: 11, cohort: { id: 4, name: 'Python' }, context_type: 'lesson', context_source: 'primary', context_id: 42, context_label: 'Lists', context_path: '/lessons/42', category: 'concept', urgency: 'normal', status: 'open', message: 'Lesson question', staff_response: null, acknowledged_at: null, resolved_at: null, canceled_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', owner: null, ...overrides })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function Destination() { const location = useLocation(); return <div data-destination="">{location.pathname}{location.search}</div> }
let root: Root
let container: HTMLDivElement
async function render(node: ReactNode, path = '/lessons/42?cohort_id=4') { await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/lessons/:id" element={node} /><Route path="*" element={node} /></Routes></MemoryRouter>) }) }
async function click(label: string) { const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes(label)); expect(button, `Missing ${label}`).toBeTruthy(); await act(async () => { button!.click() }) }
beforeEach(() => {
  vi.resetAllMocks(); state.cohortId = 4; localStorage.clear()
  vi.mocked(api.getHelpRequests).mockResolvedValue({ data: { help_requests: [] }, error: null })
  vi.mocked(api.getPushConfig).mockResolvedValue({ data: { notifications_enabled: true } as never, error: null })
  vi.mocked(api.getBlockedUsers).mockResolvedValue({ data: { blocked_users: [] }, error: null })
  vi.mocked(api.getDashboard).mockResolvedValue({ data: { dashboard: { enrolled: true, capabilities } } as never, error: null })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('lesson and profile recovery', () => {
  it.each(['network', 'timeout', 'server'] as const)('offers retry for %s and keeps the course in return links', async (errorKind) => {
    vi.mocked(api.getLesson).mockResolvedValueOnce({ data: null, error: 'Oops', errorKind }).mockResolvedValueOnce({ data: { lesson } as never, error: null })
    await render(<LessonView />)
    expect(container.textContent).toContain(errorKind === 'server' ? 'service is temporarily unavailable' : 'Check your connection')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/materials?cohort_id=4')
    await click('Try again')
    expect(container.textContent).toContain('Lists')
    expect(api.getLesson).toHaveBeenLastCalledWith(42, 4)
    expect(container.querySelector('[data-readonly]')?.getAttribute('data-readonly')).toBe('false')
  })
  it.each(['forbidden', 'not_found'] as const)('distinguishes %s from a connection failure', async (errorKind) => {
    vi.mocked(api.getLesson).mockResolvedValue({ data: null, error: 'Denied', errorKind })
    await render(<LessonView />)
    expect(container.textContent).toContain('unavailable or you no longer have access')
    expect(container.textContent).not.toContain('Check your connection')
    expect(container.textContent).not.toContain('List practice')
  })
  it('identifies cached lessons and disables writes until a successful retry', async () => {
    vi.mocked(api.getLesson).mockResolvedValueOnce({ data: { lesson } as never, error: 'Offline', fromCache: true }).mockResolvedValueOnce({ data: { lesson } as never, error: null })
    await render(<LessonView />)
    expect(container.textContent).toContain('Showing a saved lesson')
    expect(container.querySelector('[data-readonly]')?.getAttribute('data-readonly')).toBe('true')
    await click('Try again')
    expect(container.querySelector('[data-readonly]')?.getAttribute('data-readonly')).toBe('false')
  })
  it('labels completed learning and disables its writes', async () => {
    vi.mocked(api.getLesson).mockResolvedValueOnce({ data: { lesson: { ...lesson, capabilities: { ...capabilities, can_submit: false, read_only: true } } } as never, error: null })
    await render(<LessonView />)
    expect(container.textContent).toContain('Past course · review only')
    expect(container.querySelector('[data-readonly]')?.getAttribute('data-readonly')).toBe('true')
  })
  it('fails closed for older lesson responses without capabilities', async () => {
    vi.mocked(api.getLesson).mockResolvedValue({ data: { lesson: { ...lesson, capabilities: undefined } } as never, error: null })
    await render(<LessonView />)
    expect(container.querySelector('[data-readonly]')?.getAttribute('data-readonly')).toBe('true')
    expect(container.textContent).not.toContain('Ask for help')
  })
  it('shows an unavailable profile without becoming a blank page', async () => {
    vi.mocked(api.getProfile).mockResolvedValue({ data: null, error: 'Denied', errorKind: 'forbidden' })
    await render(<Profile />, '/profile')
    expect(container.textContent).toContain('Profile is unavailable or you no longer have access')
    expect(container.textContent).toContain('Try again')
  })
  it('retains an edited username and notification preferences on cached-profile retry', async () => {
    vi.mocked(api.getProfile).mockResolvedValueOnce({ data: profile as never, error: 'Offline', fromCache: true }).mockResolvedValueOnce({ data: profile as never, error: null })
    await render(<Profile />, '/profile')
    const input = container.querySelector<HTMLInputElement>('#profile-github-username')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'unsaved-username')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Try again')
    expect(container.querySelector<HTMLInputElement>('#profile-github-username')!.value).toBe('unsaved-username')
    expect(api.getPushConfig).toHaveBeenCalledTimes(1)
  })
  it('shows profile failure and retries only the profile request', async () => {
    vi.mocked(api.getProfile).mockRejectedValueOnce(new Error('Timeout')).mockResolvedValueOnce({ data: profile as never, error: null })
    await render(<Profile />, '/profile')
    expect(container.textContent).toContain('Profile')
    expect(container.textContent).toContain('Check your connection')
    await click('Try again')
    expect(container.textContent).toContain('student@example.test')
    expect(api.getPushConfig).toHaveBeenCalledTimes(1)
    expect(api.getBlockedUsers).toHaveBeenCalledTimes(1)
  })
})

describe('support identity and entitlements', () => {
  it('matches cohort, type, source and ID before showing or canceling help', async () => {
    const requests = [request({ id: 90, context_type: 'exercise' }), request({ id: 91, cohort: { id: 5, name: 'Other' } }), request({ id: 92, context_source: 'legacy' }), request({ id: 93 })]
    vi.mocked(api.updateHelpRequest).mockResolvedValue({ data: { help_request: request({ id: 93, status: 'canceled' }) }, error: null })
    await render(<ContextualHelp capabilities={capabilities} cohortId={4} contextType="lesson" contextId={42} contextLabel="Lists" requests={requests} requestsLoading={false} />)
    await click('Sent to your instructor')
    await click('Cancel request')
    expect(api.updateHelpRequest).toHaveBeenCalledExactlyOnceWith(93, { status: 'canceled' })
  })
  it('does not mistake a colliding exercise request for lesson help', async () => {
    await render(<ContextualHelp capabilities={capabilities} cohortId={4} contextType="lesson" contextId={42} contextLabel="Lists" requests={[request({ context_type: 'exercise' })]} requestsLoading={false} />)
    expect(container.textContent).toContain('Ask for help')
    expect(container.textContent).not.toContain('Sent to your instructor')
  })
  it('shows expired support, account recovery and prior responses without a send/cancel action', async () => {
    await render(<ContextualHelp capabilities={{ ...capabilities, support_mode: 'none', support_expires_at: '2026-10-01T00:00:00Z' }} cohortId={4} contextType="lesson" contextId={42} contextLabel="Lists" requests={[request({ status: 'resolved', staff_response: 'Try a slice.' })]} requestsLoading={false} />)
    expect(container.textContent).toContain('Instructor support end date:')
    expect(container.querySelector('a')?.href).toContain('mailto:codeschoolofguam@gmail.com')
    await click('View previous help')
    expect(container.textContent).toContain('Try a slice.')
    expect(container.textContent).not.toContain('Send to my instructor')
    expect(container.textContent).not.toContain('Cancel request')
  })
  it('retains the lesson context when opening an instructor DM fails and allows retry', async () => {
    vi.mocked(api.createDirectConversation).mockResolvedValueOnce({ data: null, error: 'Connection lost' }).mockResolvedValueOnce({ data: { direct_conversation: { id: 20, cohort_id: 4 } } as never, error: null })
    await render(<><CourseSupport capabilities={{ ...capabilities, support_mode: 'course_question' }} cohortId={4} contextLabel="Lists" contextPath="https://learn.test/lessons/42?cohort_id=4" /><Destination /></>)
    await click('Ask a course question')
    expect(container.textContent).toContain('Connection lost')
    expect(container.querySelector('[data-destination]')?.textContent).toBe('/lessons/42?cohort_id=4')
    await click('Ask a course question')
    expect(container.querySelector('[data-destination]')?.textContent).toBe('/messages/dm/20?cohort_id=4')
  })
  it('opens the assigned instructor DM with an unsent lesson draft', async () => {
    vi.mocked(api.createDirectConversation).mockResolvedValue({ data: { direct_conversation: { id: 20, cohort_id: 4 } } as never, error: null })
    await render(<><CourseSupport capabilities={{ ...capabilities, support_mode: 'course_question' }} cohortId={4} contextLabel="Lists" contextPath="https://learn.test/lessons/42?cohort_id=4#block-42" /><Destination /></>)
    await click('Ask a course question')
    expect(api.createDirectConversation).toHaveBeenCalledExactlyOnceWith({ cohort_id: 4, user_ids: [9] })
    expect(container.querySelector('[data-destination]')?.textContent).toBe('/messages/dm/20?cohort_id=4')
    const draft = readComposerDraft(composerDestinationKey(7, { type: 'dm', id: 20 }, null), localStorage)
    expect(draft?.body).toContain('Course question: Lists\nhttps://learn.test/lessons/42?cohort_id=4#block-42')
  })
})

describe('recording request ordering', () => {
  it.each(['success', 'failure'] as const)('keeps cohort B when older A finishes with %s', async (outcome) => {
    const older = deferred<Awaited<ReturnType<typeof api.getRecordings>>>()
    vi.mocked(api.getRecordings).mockReturnValueOnce(older.promise).mockResolvedValueOnce({ data: { items: [{ id: 8, cohort_id: 5, source: 'uploaded', title: 'B recording' }] } as never, error: null })
    await render(<Recordings />, '/recordings')
    state.cohortId = 5
    await render(<Recordings />, '/recordings')
    expect(container.textContent).toContain('B recording')
    await act(async () => { if (outcome === 'failure') older.reject(new Error('A failed')); else older.resolve({ data: { items: [{ id: 9, cohort_id: 4, source: 'uploaded', title: 'A recording' }] } as never, error: null }) })
    expect(container.textContent).toContain('B recording')
    expect(container.textContent).not.toContain('A recording')
    expect(container.textContent).not.toContain('A failed')
  })
})

it('fetches a weekly plan for self-paced learners and shows their course and redo', async () => {
  vi.mocked(api.getDashboard).mockResolvedValue({ data: { dashboard: { enrolled: true, user: state.user, modules: [{ id: 2, name: 'Python', lessons: [{ id: 42, title: 'Lists', available: true, completed: false }], total_blocks: 1, completed_blocks: 0 }], resources: [], action_items: [] } } as never, error: null })
  vi.mocked(api.getWeeklyPlan).mockResolvedValue({ data: { weekly_plan: { enrolled: true, mode: 'self_paced', course_name: 'Python Fundamentals', cohort: { id: 4, name: 'Python' }, timezone: 'Pacific/Guam', capabilities, next_lesson: { lesson_id: 42, title: 'Lists', module_id: 2 }, redos: [{ id: 'redo-1', lesson_id: 42, content_block_id: 42, title: 'List redo', lesson_title: 'Lists', feedback: 'Try slicing.' }] } } as never, error: null })
  await render(<Dashboard />, '/dashboard')
  expect(api.getWeeklyPlan).toHaveBeenCalledWith(4)
  expect(container.textContent).toContain('Python Fundamentals')
  expect(container.textContent).toContain('List redo')
  expect(container.textContent).not.toContain('Alumni Learning Library')
})
