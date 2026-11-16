// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestRouter } from '../../test/TestRouter'
import { StudentCommunication } from './StudentCommunication'
import { api } from '../../lib/api'
vi.mock('../../lib/api', () => ({ api: { getStudentCommunication: vi.fn() } }))
let container: HTMLDivElement
let root: Root
const history = { messages: [{ id: 8, body: 'Reply **here**', author_name: 'Teacher', created_at: '2026-11-17T00:00:00Z', direct_conversation_id: 5, channel_id: null, parent_message_id: null }], channel_activity: [{ id: 9, body: 'Class reply', author_name: 'Student', created_at: '2026-11-17T00:00:00Z', direct_conversation_id: null, channel_id: 6, channel_name: 'general', parent_message_id: 7 }], meetings: [{ id: 10, starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-12-01T01:00:00Z', status: 'confirmed', instructor_name: 'Teacher' }] }
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); vi.mocked(api.getStudentCommunication).mockResolvedValue({ data: { communication: history }, error: null }) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks() })
const mount = (cohortId = 4) => act(async () => root.render(<TestRouter initialEntries={['/admin/cohorts/4/students/3/communication']}><StudentCommunication cohortId={cohortId} studentId={3} studentName="Student" opening={false} onOpen={vi.fn()} /></TestRouter>))
it('renders real recent messages, meetings and channels with exact scoped destinations', async () => {
  await mount()
  expect(api.getStudentCommunication).toHaveBeenCalledWith(3, 4)
  expect(container.textContent).toContain('Reply here')
  expect(container.querySelector('a[href^="/messages/dm/5?cohort_id=4&message_id=8&return_to="]')).not.toBeNull()
  expect(container.querySelector('a[href^="/messages/6?cohort_id=4&message_id=9&return_to="]')).not.toBeNull()
  expect(container.querySelector('a[href^="/admin/meetings?cohort_id=4&booking_id=10&return_to="]')).not.toBeNull()
})
it('keeps a communication failure distinct from empty history and retries only that section', async () => {
  vi.mocked(api.getStudentCommunication).mockResolvedValueOnce({ data: null, error: 'Unavailable' }).mockResolvedValue({ data: { communication: { messages: [], channel_activity: [], meetings: [] } }, error: null })
  await mount()
  expect(container.textContent).toContain("Couldn't load")
  expect(container.textContent).not.toContain('No messages')
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Retry'))!.click())
  expect(container.textContent).toContain('No messages in your conversations')
  expect(container.textContent).toContain('No recent class chat activity')
  expect(container.textContent).toContain('No meetings you can manage')
})
it('ignores old communication responses after switching enrollment', async () => {
  let resolve!: (value: unknown) => void
  vi.mocked(api.getStudentCommunication).mockImplementationOnce(() => new Promise(done => { resolve = done as never }))
  await mount()
  await mount(5)
  await act(async () => resolve({ data: { communication: { ...history, messages: [{ ...history.messages[0], body: 'Wrong cohort' }] } }, error: null }))
  expect(container.textContent).not.toContain('Wrong cohort')
  expect(container.querySelector('a[href*="cohort_id=5"]')).not.toBeNull()
})
