// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getContentReports: vi.fn(), getContentReport: vi.fn(), getDataDeletionRequests: vi.fn(), getSafetyUserBlocks: vi.fn(),
  updateContentReport: vi.fn(), updateDataDeletionRequest: vi.fn(), getUser: vi.fn(), getRecordSummary: vi.fn(), success: vi.fn(), error: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_staff: true, is_admin: true }, enrollments: [] }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }))
import { Moderation } from './Moderation'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const person = (id: number, full_name: string, role = 'student') => ({ id, full_name, email: `${full_name.split(' ')[0].toLowerCase()}@example.invalid`, role })
const meta = (page: number, total_pages: number, total_count = total_pages) => ({ page, per_page: 25, total_count, total_pages, has_next_page: page < total_pages, has_prev_page: page > 1 })
const report = (overrides: Record<string, unknown> = {}) => ({
  id: 5, reason: 'harassment', details: null, status: 'pending', created_at: '2026-11-14T02:00:00Z', resolved_at: null,
  reporter: person(20, 'Sam Learner'), reported_user: person(21, 'Cy Classmate'), reviewed_by: null,
  message: { id: 42, body: 'A synthetic message', channel_id: 12, direct_conversation_id: null, created_at: '2026-11-14T01:00:00Z',
    conversation: { kind: 'channel', label: '#Class Chat in Cohort Teal', available: true, destination: { kind: 'channel', id: 12, context: {}, anchor: { message_id: 42 } } } },
  ...overrides,
})
const dmReport = report({ id: 6, message: { id: 43, body: 'Private note', channel_id: null, direct_conversation_id: 9, created_at: '2026-11-14T01:00:00Z', conversation: { kind: 'dm', label: 'Direct conversation in Cohort Teal', available: false, destination: null } } })
const resolved = report({ id: 7, status: 'actioned', resolved_at: '2026-11-15T03:00:00Z', reviewed_by: person(1, 'Ada Admin', 'admin') })

let container: HTMLDivElement
let root: Root
let router: ReturnType<typeof createMemoryRouter>
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const button = (name: string) => [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === name) as HTMLButtonElement

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getContentReports.mockImplementation(({ view, page }: { view: string; page?: number }) => Promise.resolve(view === 'open'
    ? { data: { content_reports: [report(), dmReport], meta: meta(1, 1, 2) }, error: null }
    : { data: { content_reports: page === 2 ? [] : [resolved], meta: meta(page ?? 1, 2, 26) }, error: null }))
  mocks.getDataDeletionRequests.mockResolvedValue({ data: { data_deletion_requests: [{ id: 3, status: 'completed', retention_note: 'Deleted the account and files.', created_at: '2026-11-10T00:00:00Z', resolved_at: '2026-11-12T00:00:00Z', user: { id: 30, full_name: 'Del Request', email: 'del@example.invalid' }, resolved_by: { id: 1, full_name: 'Ada Admin' } }] }, error: null })
  mocks.getSafetyUserBlocks.mockResolvedValue({ data: { user_blocks: [{ id: 8, blocked_at: '2026-11-13T00:00:00Z', blocker: { ...person(21, 'Cy Classmate'), archived: false }, blocked_user: { ...person(3, 'Ina Teacher', 'instructor'), archived: false } }], meta: meta(1, 1, 1) }, error: null })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

async function mount(entry = '/admin/moderation') {
  router = createMemoryRouter([{ path: '/admin/moderation', element: <Moderation /> }], { initialEntries: [entry] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await flush()
}

it('links a reported channel message to its conversation and keeps a private one as text', async () => {
  await mount()
  expect(mocks.getContentReports).toHaveBeenCalledWith({ view: 'open', per_page: 100 })
  const open = [...container.querySelectorAll<HTMLAnchorElement>('a')].find((link) => link.textContent === 'Open in #Class Chat in Cohort Teal')
  expect(open?.getAttribute('href')).toBe('/messages/12?message_id=42')
  expect(container.textContent).toContain('Posted in Direct conversation in Cohort Teal. You’re not in this conversation')
  expect(container.querySelectorAll('a[href^="/messages/dm/"]')).toHaveLength(0)
})

it('keeps the Resolved view and its page in the URL and shows who resolved each report, when and how', async () => {
  await mount()
  await act(async () => button('Resolved').click())
  await flush()
  expect(router.state.location.search).toBe('?view=resolved')
  expect(mocks.getContentReports).toHaveBeenLastCalledWith({ view: 'resolved', page: 1, per_page: 25 })
  expect(container.textContent).toContain('26 resolved, most recent first')
  expect(container.textContent).toMatch(/Actioned · by Ada Admin · /)
  expect(container.textContent).toContain('Completed · by Ada Admin')
  expect(container.textContent).toContain('Deleted the account and files.')
  // Resolved reports have no review actions.
  expect(button('Dismiss')).toBeUndefined()
  await act(async () => button('Older').click())
  await flush()
  expect(router.state.location.search).toBe('?view=resolved&page=2')
  expect(mocks.getContentReports).toHaveBeenLastCalledWith({ view: 'resolved', page: 2, per_page: 25 })
  await act(async () => router.navigate(-1))
  await flush()
  expect(router.state.location.search).toBe('?view=resolved')
})

it('lists every block read-only with links to both people', async () => {
  await mount('/admin/moderation?view=blocks')
  expect(mocks.getSafetyUserBlocks).toHaveBeenCalledWith({ page: 1, per_page: 25 })
  expect(container.textContent).toContain('Cy Classmate blocked Ina Teacher')
  expect(container.querySelector('a[href="/admin/team/3"]')?.textContent).toBe('Ina Teacher')
  // The learner resolves to an enrollment from a dialog, as elsewhere in Safety.
  expect([...container.querySelectorAll('button')].some((el) => el.textContent === 'Cy Classmate')).toBe(true)
  expect(button('Unblock')).toBeUndefined()
})

it('pins a linked report that is not in the current list, such as one already resolved', async () => {
  mocks.getContentReport.mockResolvedValue({ data: { content_report: resolved }, error: null })
  await mount('/admin/moderation#report-7')
  await flush()
  expect(mocks.getContentReport).toHaveBeenCalledWith(7)
  expect(container.textContent).toContain('The report you opened is already resolved:')
  expect(container.querySelector('#report-7')).not.toBeNull()
})

it('does not fetch a report that is already in the list', async () => {
  await mount('/admin/moderation#report-5')
  expect(mocks.getContentReport).not.toHaveBeenCalled()
  expect(container.textContent).not.toContain('The report you opened')
})
