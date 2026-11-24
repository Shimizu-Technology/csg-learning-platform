// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HelpRequest } from '../../types/api'
import { SupportQueue } from './SupportQueue'

const state = vi.hoisted(() => ({ reload: vi.fn(), confirm: vi.fn(async () => true), success: vi.fn(), error: vi.fn(), reply: vi.fn(), update: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ schoolFeatures: {}, user: { id: 1, is_staff: true, is_admin: false } }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohort: null, cohorts: [] }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: state.success, error: state.error }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => state.confirm }))
vi.mock('../../lib/analytics', () => ({ captureProductEvent: vi.fn(), analyticsAgeBucket: () => 'under_1h' }))
vi.mock('../../lib/api', () => ({ api: { replyToHelpRequest: state.reply, updateHelpRequest: state.update } }))
vi.mock('../../components/admin/StudentContextDrawer', () => ({ StudentContextDrawer: () => null }))

const request = (id: number): HelpRequest => ({
  id, cohort: { id: 3, name: 'Cohort 3' }, context_type: 'lesson', context_source: 'primary', context_id: 40, context_label: 'Loops and iteration',
  context_path: '/lessons/40?cohort_id=3', category: 'concept', urgency: 'normal', status: 'open', message: 'My loop never stops.', staff_response: null,
  acknowledged_at: null, resolved_at: null, canceled_at: null, created_at: '2026-11-12T09:00:00Z', updated_at: '2026-11-12T09:00:00Z', owner: null,
  destination: null, context_destination: null, replies: [], student: { id: 9, full_name: 'Blair Synthetic', email: 'blair@example.com' },
})
vi.mock('../../lib/useStaffResource', () => ({ useStaffResource: () => ({ loading: false, error: null, reload: state.reload, data: {
  summary: { open_help_count: 2, acknowledged_help_count: 0, urgent_help_count: 0, active_intervention_count: 0, due_follow_up_count: 0, due_recovery_check_in_count: 0 },
  help_requests: [request(4), request(5)], recently_resolved: [], students: [], interventions: [], recovery_plans: [],
} }) }))

let container: HTMLDivElement
let root: Root
beforeEach(async () => {
  vi.clearAllMocks()
  // Markdown mode renders a plain textarea in jsdom.
  window.localStorage.setItem('csg-editor-preferences:1', JSON.stringify({ mode: 'markdown', enterSends: true }))
  window.localStorage.setItem('csg-editor-preferences:signed-out', JSON.stringify({ mode: 'markdown', enterSends: true }))
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  state.reply.mockResolvedValue({ data: { help_request: request(4), reply: {} }, error: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<MemoryRouter initialEntries={['/admin/support']}><SupportQueue /></MemoryRouter>))
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const card = (id: number) => Array.from(container.querySelectorAll('article')).find((node) => node.querySelector(`a[href^="/admin/help-requests/${id}"]`))!
const actions = (node: Element) => Array.from(node.querySelectorAll('button, a')).map((item) => item.textContent?.trim()).filter((text) => text && !['Blair Synthetic', 'Cohort 3'].includes(text))
const press = async (node: Element, label: string) => {
  const target = Array.from(node.querySelectorAll('button')).find((item) => item.textContent?.trim() === label)!
  await act(async () => target.click())
}
async function type(value: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it("shows Reply, Reply & resolve, I'm on it, the request and its lesson, and nothing else (U-4.7)", () => {
  expect(actions(card(4))).toEqual(['Loops and iteration', 'Reply', 'Reply & resolve', "I'm on it", 'Open request'])
  expect(card(4).querySelector('a[href="/lessons/40?cohort_id=3"]')).toBeTruthy()
  expect(container.textContent).not.toContain('Acknowledge')
  expect(container.textContent).not.toContain('Student context')
})

it("I'm on it lets the student know without replying, then refreshes the queue", async () => {
  state.update.mockResolvedValue({ data: { help_request: { ...request(4), status: 'acknowledged' } }, error: null })
  await press(card(4), "I'm on it")
  expect(state.update).toHaveBeenCalledWith(4, { status: 'acknowledged' })
  expect(state.success).toHaveBeenCalledWith('Blair Synthetic can now see that you are on it.')
  expect(state.reload).toHaveBeenCalled()
  expect(state.reply).not.toHaveBeenCalled()
})

it("I'm on it reports a failure and reloads to show the request as it now is", async () => {
  state.update.mockResolvedValue({ data: null, error: 'Resolved or canceled help requests cannot be changed' })
  await press(card(4), "I'm on it")
  expect(state.error).toHaveBeenCalledWith('Resolved or canceled help requests cannot be changed')
  expect(state.success).not.toHaveBeenCalled()
  expect(state.reload).toHaveBeenCalled()
})

it("I'm on it says who already has the request when someone else got there first", async () => {
  state.update.mockResolvedValue({ data: { help_request: { ...request(4), status: 'acknowledged', owner: { id: 7, full_name: 'Pat Instructor' } }, status_changed: false }, error: null })
  await press(card(4), "I'm on it")
  expect(state.success).toHaveBeenCalledExactlyOnceWith('Pat Instructor is already on it.')
  expect(state.reload).toHaveBeenCalled()
})

it("I'm on it says so plainly when you already had it", async () => {
  state.update.mockResolvedValue({ data: { help_request: { ...request(4), status: 'acknowledged', owner: { id: 1, full_name: 'Me' } }, status_changed: false }, error: null })
  await press(card(4), "I'm on it")
  expect(state.success).toHaveBeenCalledExactlyOnceWith('You are already on it.')
})

it("keeps I'm on it busy for that request until the reload after it settles", async () => {
  let reloaded!: () => void
  state.reload.mockImplementationOnce(() => new Promise<void>((resolve) => { reloaded = resolve }))
  state.update.mockResolvedValue({ data: { help_request: { ...request(4), status: 'acknowledged' }, status_changed: true }, error: null })
  await press(card(4), "I'm on it")
  const busy = () => Array.from(card(4).querySelectorAll('button')).find((item) => item.textContent?.trim() === 'Marking…')
  expect(busy()?.matches(':disabled')).toBe(true)
  // Another request's button stays usable meanwhile.
  expect(Array.from(card(5).querySelectorAll('button')).find((item) => item.textContent?.trim() === "I'm on it")?.matches(':disabled')).toBe(false)
  await act(async () => reloaded())
  expect(busy()).toBeUndefined()
})

it('Reply posts the reply and keeps the request open', async () => {
  await press(card(4), 'Reply')
  await type('Check where i changes.')
  await press(card(4), 'Send reply')
  expect(state.reply).toHaveBeenCalledWith(4, { body: 'Check where i changes.', resolve: false, client_request_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) })
  expect(state.success).toHaveBeenCalledWith('Reply sent. The request stays open.')
  expect(state.reload).toHaveBeenCalled()
  expect(container.querySelector('textarea')).toBeNull()
})

it('Reply & resolve opens the box with resolve first and resolves', async () => {
  await press(card(5), 'Reply & resolve')
  const buttons = Array.from(card(5).querySelectorAll('button')).map((item) => item.textContent?.trim())
  expect(buttons.indexOf('Reply & resolve', 2)).toBeLessThan(buttons.indexOf('Send reply'))
  await type('Add i++ at the end of the loop.')
  const inBox = Array.from(card(5).querySelectorAll('button')).filter((item) => item.textContent?.trim() === 'Reply & resolve')
  await act(async () => inBox[0].click())
  expect(state.reply).toHaveBeenCalledWith(5, { body: 'Add i++ at the end of the loop.', resolve: true, client_request_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) })
  expect(state.success).toHaveBeenCalledWith('Reply sent and request resolved.')
})

it('asks before another card replaces an unsent reply', async () => {
  await press(card(4), 'Reply')
  await type('Half-written')
  state.confirm.mockResolvedValueOnce(false)
  await press(card(5), 'Reply')
  expect(state.confirm).toHaveBeenCalledTimes(1)
  expect(card(4).querySelector('textarea')?.value).toBe('Half-written')
  expect(card(5).querySelector('textarea')).toBeNull()
})

it('retries a failed send with the same attempt id, and starts a new one after it is sent', async () => {
  state.reply.mockResolvedValueOnce({ data: null, error: 'Network request failed' })
  await press(card(4), 'Reply')
  await type('Check where i changes.')
  await press(card(4), 'Send reply')
  expect(state.error).toHaveBeenCalledWith('Network request failed')
  expect(card(4).querySelector('textarea')?.value).toBe('Check where i changes.')
  await press(card(4), 'Send reply')
  const [first, second] = state.reply.mock.calls.map(([, data]) => (data as { client_request_id: string }).client_request_id)
  expect(second).toBe(first)

  await press(card(4), 'Reply')
  await type('A second, separate reply.')
  await press(card(4), 'Send reply')
  expect((state.reply.mock.calls[2][1] as { client_request_id: string }).client_request_id).not.toBe(first)
})
