import { TestRouter as MemoryRouter } from '../../test/TestRouter'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Announcement } from '../../types/api'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), cohorts: [] as { id: number; name: string; enrolled_count?: number }[], list: vi.fn(), detail: vi.fn(), inbox: vi.fn(), read: vi.fn(), all: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, user: { id: 1, is_staff: true, role: 'instructor' }, cohort: { selectedCohortId: 4, setSelectedCohort: vi.fn() } }))
vi.mock('../../components/shared/LazyMarkdownEditor', async () => ({ LazyMarkdownEditor: (await import('../../components/shared/MarkdownEditor')).MarkdownEditor }))
vi.mock('../../lib/api', () => ({ api: { getAnnouncements: mocks.list, getAnnouncement: mocks.detail, getNotifications: mocks.inbox, markNotificationRead: mocks.read, markAllNotificationsRead: mocks.all, getCohorts: async () => ({ data: { cohorts: mocks.cohorts } }), createAnnouncement: mocks.create, updateAnnouncement: mocks.update, archiveAnnouncement: mocks.archive } }))
vi.mock('../../lib/pushNotifications', () => ({ pushSupported: () => false }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: mocks.user }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => mocks.cohort }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => mocks.toast }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
import { Announcements } from './Announcements'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output> }
const meta = { page: 1, total_pages: 1, total_count: 1, per_page: 12, has_prev_page: false, has_next_page: false }
const author = { id: 1, full_name: 'QA Author', email: 'author@example.invalid' }
// Jan 15, 2030, 9:00 AM in Guam (UTC+10).
const nineAm = '2030-01-14T23:00:00.000Z'
const scheduled = { id: 21, title: 'Lab moves', body: 'Room 2', audience: 'cohort', status: 'draft', cohort_id: 5, cohort_name: 'Cohort 3', published_at: null, unread: false, read_at: null, pinned: false, can_edit: true, can_archive: false, author, scheduled_for: nineAm, scheduled_send_push: true, schedule_time_zone: 'Pacific/Guam', read_summary: null } as Announcement
const posted = { ...scheduled, id: 22, status: 'published', published_at: '2026-10-21T10:00:00Z', scheduled_for: null, scheduled_send_push: false, can_archive: true, read_summary: { notified: 4, read: 2 } } as Announcement

describe('Scheduled updates (U-3.6)', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.inbox.mockResolvedValue({ data: { notifications: [], unread_count: 0 }, error: null })
    mocks.user.is_staff = true
    mocks.cohorts = [{ id: 4, name: 'Cohort 2', enrolled_count: 9 }, { id: 5, name: 'Cohort 3', enrolled_count: 4 }]
    mocks.confirm.mockResolvedValue(true)
    mocks.update.mockImplementation(async (id, data) => ({ data: { announcement: { ...scheduled, id, ...data } }, error: null }))
    mocks.list.mockResolvedValue({ data: { announcements: [], unread_count: 0, meta }, error: null })
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    window.localStorage.setItem('csg-editor-preferences:1', JSON.stringify({ mode: 'markdown', enterSends: true }))
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); window.localStorage.removeItem('csg-editor-preferences:1') })
  async function mount(path: string) {
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Location /><Routes><Route path="/announcements/:id?" element={<Announcements />} /></Routes></MemoryRouter>))
  }
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === text)
  async function setValue(selector: string, value: string, event = 'input') {
    await act(async () => {
      const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)!
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event(event, { bubbles: true }))
    })
  }
  const submit = () => act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

  it('schedules a new update for a day and hour in Guam time, saying it sends about then', async () => {
    mocks.create.mockResolvedValue({ data: { announcement: scheduled }, error: null })
    await mount('/announcements?scope=manage&audience=cohort&cohort_id=5')
    await setValue('input[placeholder="Title"]', 'Lab moves')
    await setValue('textarea', 'Room 2')
    await act(async () => button('Schedule')!.click())
    // Tomorrow at 9:00 AM is suggested; Save draft gives way to Schedule update.
    expect(container.querySelector<HTMLSelectElement>('select:not([aria-label])')!.value).toBe('9')
    expect(container.querySelector<HTMLInputElement>('input[type="date"]')!.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(container.querySelector('[data-testid="schedule-sends-about"]')?.textContent).toContain('9:00 AM ChST')
    expect(button('Save draft')).toBeUndefined()
    await setValue('input[type="date"]', '2030-01-15')
    expect(container.querySelector('[data-testid="schedule-sends-about"]')?.textContent).toContain('Sends about Jan 15, 2030, 9:00 AM ChST.')
    expect(container.querySelector('[data-testid="schedule-sends-about"]')?.textContent).toContain('hourly run, not to the minute')
    expect(container.textContent).toContain('Time (Guam time)')
    expect(container.querySelector('[data-testid="schedule-time-zone"]')?.textContent).toBe('Times are in Guam time, the school’s time zone, for every cohort.')
    await submit()
    // The cohort the page is scoped to: no audience check, as for posting.
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft', scheduled_for: nineAm, send_push: true, audience: 'cohort', cohort_id: 5 }))
    expect(mocks.toast.success).toHaveBeenCalledWith('Update scheduled')
    expect(container.querySelector('output')?.textContent).toContain('status=scheduled')
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'manage', status: 'scheduled', sort: 'scheduled_asc' }))
  })

  it('asks about another cohort with Schedule wording, and refuses a time that has passed', async () => {
    await mount('/announcements?scope=manage&audience=cohort&cohort_id=4')
    await setValue('input[placeholder="Title"]', 'Lab moves')
    await setValue('textarea', 'Room 2')
    await setValue('select[aria-label="Cohort for this update"]', '5', 'change')
    await act(async () => button('Schedule')!.click())
    await setValue('input[type="date"]', '2020-01-15')
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Choose a time later than now.')
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.create.mockResolvedValue({ data: { announcement: scheduled }, error: null })
    await setValue('input[type="date"]', '2030-01-15')
    await submit()
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Schedule to Cohort 3?', confirmLabel: 'Schedule to Cohort 3' }))
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('lists scheduled updates with when they send, and shows the schedule on their page', async () => {
    mocks.list.mockResolvedValue({ data: { announcements: [scheduled], unread_count: 0, meta }, error: null })
    await mount('/announcements?scope=manage&status=scheduled')
    expect(container.textContent).toContain('1 scheduled update')
    expect(container.textContent).toContain('Sends about Jan 15, 2030, 9:00 AM ChST')
    expect(container.textContent).toContain('Scheduled')
    expect(container.textContent).not.toContain('Draft · saved')
  })

  it('cancels a schedule from the update page, leaving a draft', async () => {
    mocks.detail.mockResolvedValue({ data: { announcement: scheduled }, error: null })
    mocks.update.mockResolvedValue({ data: { announcement: { ...scheduled, scheduled_for: null, scheduled_send_push: false } }, error: null })
    await mount('/announcements/21?scope=manage&status=scheduled')
    expect(container.querySelector('[data-testid="scheduled-notice"]')?.textContent).toContain('Sends about Jan 15, 2030, 9:00 AM ChST.')
    await act(async () => button('Cancel schedule')!.click())
    expect(mocks.update).toHaveBeenCalledWith(21, { scheduled_for: null })
    expect(container.querySelector('[aria-label="Update"]')?.textContent).toContain('Schedule cancelled')
    expect(container.querySelector('[data-testid="scheduled-notice"]')).toBeNull()
    expect(button('Cancel schedule')).toBeUndefined()
  })

  it('reschedules from the editor, which opens on the saved day and hour', async () => {
    mocks.detail.mockResolvedValue({ data: { announcement: scheduled }, error: null })
    await mount('/announcements/21?scope=manage&status=scheduled')
    await act(async () => button('Edit or reschedule')!.click())
    expect(container.querySelector('form[aria-label="Edit scheduled update"]')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2030-01-15')
    await setValue('select:not([aria-label])', '10', 'change')
    await act(async () => button('Save schedule')!.click())
    expect(mocks.update).toHaveBeenCalledWith(21, expect.objectContaining({ status: 'draft', scheduled_for: '2030-01-15T00:00:00.000Z', send_push: true }))
    expect(mocks.toast.success).toHaveBeenCalledWith('Update scheduled')
  })

  it('saving a scheduled update as a plain draft cancels its schedule', async () => {
    mocks.detail.mockResolvedValue({ data: { announcement: scheduled }, error: null })
    await mount('/announcements/21?scope=manage&status=scheduled&edit=1')
    await act(async () => button('Post now')!.click())
    await act(async () => button('Save draft')!.click())
    expect(mocks.update).toHaveBeenCalledWith(21, expect.objectContaining({ status: 'draft', scheduled_for: null }))
  })

  it('reconciles a replayed scheduled create when the push choice changed after the response was lost', async () => {
    // The first create committed (scheduled, with push) but its response was lost.
    mocks.create.mockResolvedValueOnce({ data: null, error: 'Response lost' })
    mocks.create.mockResolvedValue({ data: { announcement: scheduled }, error: null })
    await mount('/announcements?scope=manage&audience=cohort&cohort_id=5')
    await setValue('input[placeholder="Title"]', 'Lab moves')
    await setValue('textarea', 'Room 2')
    await act(async () => button('Schedule')!.click())
    await setValue('input[type="date"]', '2030-01-15')
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Response lost')
    const push = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => input.closest('label')?.textContent?.includes('Send push'))!
    await act(async () => push.click())
    await submit()
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ send_push: false, client_request_id: mocks.create.mock.calls[0][0].client_request_id })
    expect(mocks.update).toHaveBeenCalledWith(21, expect.objectContaining({ status: 'draft', scheduled_for: nineAm, send_push: false }))
  })

  it('a plain draft saved after a lost scheduled create cancels the replayed schedule', async () => {
    mocks.create.mockResolvedValueOnce({ data: null, error: 'Response lost' })
    mocks.create.mockResolvedValue({ data: { announcement: scheduled }, error: null })
    await mount('/announcements?scope=manage&audience=cohort&cohort_id=5')
    await setValue('input[placeholder="Title"]', 'Lab moves')
    await setValue('textarea', 'Room 2')
    await act(async () => button('Schedule')!.click())
    await setValue('input[type="date"]', '2030-01-15')
    await submit()
    await act(async () => button('Post now')!.click())
    await act(async () => button('Save draft')!.click())
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ status: 'draft', scheduled_for: null })
    // The replay came back scheduled, so PATCH clears the send time: the draft won't post later.
    expect(mocks.update).toHaveBeenCalledWith(21, expect.objectContaining({ status: 'draft', scheduled_for: null }))
    expect(mocks.toast.success).toHaveBeenCalledWith('Draft saved')
  })

  it('a slow Cancel schedule for one update never shows its notice on another', async () => {
    const other = { ...scheduled, id: 31, title: 'Other update' } as Announcement
    mocks.detail.mockImplementation(async (id: number) => ({ data: { announcement: id === 31 ? other : scheduled }, error: null }))
    let finish!: (value: unknown) => void
    mocks.update.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await act(async () => root.render(<MemoryRouter initialEntries={['/announcements/21?scope=manage']}><Location /><Link to="/announcements/31?scope=manage">Go to other</Link><Routes><Route path="/announcements/:id?" element={<Announcements />} /></Routes></MemoryRouter>))
    await act(async () => button('Cancel schedule')!.click())
    await act(async () => [...container.querySelectorAll('a')].find((link) => link.textContent === 'Go to other')!.click())
    expect(container.textContent).toContain('Other update')
    await act(async () => finish({ data: { announcement: { ...scheduled, scheduled_for: null, scheduled_send_push: false } }, error: null }))
    expect(container.textContent).not.toContain('Schedule cancelled')
    expect(container.querySelector('[data-testid="scheduled-notice"]')).not.toBeNull()
  })

  it('shows staff how many of the people it went to have read it, as counts only', async () => {
    mocks.detail.mockResolvedValue({ data: { announcement: posted }, error: null })
    await mount('/announcements/22?cohort_id=5')
    expect(container.querySelector('[data-testid="read-summary"]')?.textContent).toBe('2 of 4 people it went to have read it')
    act(() => root.unmount())
    root = createRoot(container)
    mocks.detail.mockResolvedValue({ data: { announcement: { ...posted, id: 23, read_summary: null } }, error: null })
    await mount('/announcements/23?cohort_id=5')
    expect(container.textContent).toContain('Lab moves')
    expect(container.querySelector('[data-testid="read-summary"]')).toBeNull()
  })
})
