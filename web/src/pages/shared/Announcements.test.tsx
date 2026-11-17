import { TestRouter as MemoryRouter } from '../../test/TestRouter'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Announcement, NotificationEntry } from '../../types/api'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), cohorts: [{ id: 4, name: 'Python' }] as { id: number; name: string; enrolled_count?: number }[], list: vi.fn(), detail: vi.fn(), inbox: vi.fn(), read: vi.fn(), all: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, user: { id: 1, is_staff: false, role: 'instructor' }, cohort: { selectedCohortId: 4, setSelectedCohort: vi.fn() } }))
vi.mock('../../components/shared/LazyMarkdownEditor', async () => ({ LazyMarkdownEditor: (await import('../../components/shared/MarkdownEditor')).MarkdownEditor }))
vi.mock('../../lib/api', () => ({ api: { getAnnouncements: mocks.list, getAnnouncement: mocks.detail, getNotifications: mocks.inbox, markNotificationRead: mocks.read, markAllNotificationsRead: mocks.all, getCohorts: async () => ({ data: { cohorts: mocks.cohorts } }), createAnnouncement: mocks.create, updateAnnouncement: mocks.update, archiveAnnouncement: mocks.archive } }))
vi.mock('../../lib/pushNotifications', () => ({ pushSupported: () => false }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: mocks.user }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => mocks.cohort }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => mocks.toast }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
import { Announcements } from './Announcements'
import { notificationDestination } from '../../lib/notificationDestination'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const meta = { page: 1, total_pages: 1, total_count: 1, per_page: 12, has_prev_page: false, has_next_page: false }
const announcement = { id: 8, title: 'School notice', body: 'Keep this detail visible', audience: 'global', status: 'published', read_at: null, unread: true, cohort_id: null, cohort_name: null, published_at: '2026-10-21T10:00:00Z' } as Announcement
const notification = { destination: null, destination_path: null, actor: null, id: 11, notification_type: 'system', title: 'Enrollment ready', body: 'Welcome', path: '/cohorts/4?booking_id=22', read_at: null, created_at: '2026-10-21T10:00:00Z', notifiable: { type: 'Enrollment', id: 22 }, target_available: true } as NotificationEntry
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output> }

describe('Updates reader', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.is_staff = false
    mocks.cohort.selectedCohortId = 4
    mocks.cohorts = [{ id: 4, name: 'Python' }]
    mocks.confirm.mockResolvedValue(true)
    mocks.update.mockImplementation(async (id, data) => ({ data: { announcement: { ...announcement, id, ...data } }, error: null }))
    mocks.create.mockResolvedValue({ data: { announcement }, error: null })
    mocks.list.mockResolvedValue({ data: { announcements: [announcement], unread_count: 1, meta }, error: null })
    mocks.detail.mockResolvedValue({ data: { announcement: { ...announcement, read_at: 'now', unread: false } }, error: null })
    mocks.inbox.mockResolvedValue({ data: { notifications: [notification], unread_count: 1, meta }, error: null })
    mocks.read.mockResolvedValue({ data: { notification: { ...notification, read_at: 'now' }, unread_count: 0 }, error: null })
    mocks.all.mockResolvedValue({ data: { unread_count: 0 }, error: null })
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    // The composer's shared editor in Markdown mode is a textarea these tests type into.
    window.localStorage.setItem('csg-editor-preferences:1', JSON.stringify({ mode: 'markdown', enterSends: true }))
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); window.localStorage.removeItem('csg-editor-preferences:1') })
  async function mount(path: string) {
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Location /><Routes><Route path="/announcements/:id?" element={<Announcements />} /><Route path="*" element={<p>Destination</p>} /></Routes></MemoryRouter>))
  }
  async function click(text: string) {
    const element = [...container.querySelectorAll<HTMLElement>('button,a')].find((item) => item.textContent?.trim() === text)
    expect(element, text).toBeTruthy()
    await act(async () => element!.click())
  }
  it('links the update cohort, and the author to their team page for admins only (L-2.9)', async () => {
    mocks.user.is_staff = true
    const scoped = { ...announcement, cohort_id: 4, cohort_name: 'Python', audience: 'cohort', author: { id: 9, full_name: 'QA Author', email: 'author@example.invalid' } }
    mocks.list.mockResolvedValue({ data: { announcements: [scoped], unread_count: 1, meta } })
    await mount('/announcements?cohort_id=4')
    expect(container.querySelector('a[href="/admin/cohorts/4?tab=communication"]')).not.toBeNull()
    expect(container.querySelector('a[href^="/admin/team/9"]')).toBeNull()
    expect(container.textContent).toContain('QA Author')
    act(() => root.unmount()); root = createRoot(container)
    Object.assign(mocks.user, { is_admin: true, role: 'admin' })
    await mount('/announcements?cohort_id=4')
    expect(container.querySelector('a[href^="/admin/team/9"]')?.textContent).toBe('QA Author')
    Object.assign(mocks.user, { is_admin: false, role: 'instructor' })
  })
  it.each(['draft', 'archived'] as const)('loads %s detail from management and returns to the same scope', async (status) => {
    mocks.user.is_staff = true
    const managed = { ...announcement, status, unread: false }
    mocks.list.mockResolvedValue({ data: { announcements: [managed], unread_count: 0, meta }, error: null })
    mocks.detail.mockResolvedValue({ data: { announcement: managed }, error: null })
    await mount(`/announcements?scope=manage&status=${status}&cohort_id=4`)
    await click('School notice')
    expect(container.querySelector('[aria-label="Update"]')?.textContent).toContain('Keep this detail visible')
    expect(mocks.detail).toHaveBeenCalledWith(8)
    await click('Back to Updates')
    expect(container.querySelector('output')?.textContent).toBe(`/announcements?scope=manage&status=${status}&cohort_id=4`)
  })
  it('retains unread-only detail when marking it read removes it from the list, and Back restores the same filters/page', async () => {
    mocks.list.mockResolvedValue({ data: { announcements: [announcement], unread_count: 13, meta: { ...meta, page: 2, total_pages: 2, total_count: 13 } }, error: null })
    await mount('/announcements?read=unread&page=2&sort=published_asc')
    expect(container.textContent).toContain('School-wide')
    mocks.list.mockResolvedValue({ data: { announcements: [], unread_count: 0, meta: { ...meta, page: 2, total_pages: 2, total_count: 13 } }, error: null })
    await click('School notice')
    expect(container.querySelector('[aria-label="Update"]')?.textContent).toContain('Keep this detail visible')
    expect(mocks.detail).toHaveBeenCalledWith(8)
    await click('Back to Updates')
    expect(container.querySelector('output')?.textContent).toBe('/announcements?read=unread&page=2&sort=published_asc')
    expect(container.textContent).toContain('You’re all caught up')
  })
  it('loads an exact record outside the current page/cohort and displays recoverable detail errors', async () => {
    mocks.list.mockResolvedValue({ data: { announcements: [], unread_count: 0, meta }, error: null })
    mocks.detail.mockResolvedValueOnce({ data: null, error: 'Announcement is no longer available' })
    mocks.list.mockResolvedValue({ data: { announcements: [], unread_count: 0, meta: { ...meta, page: 3, total_pages: 3 } }, error: null })
    await mount('/announcements/8?cohort_id=99&page=3')
    expect(container.textContent).toContain('Announcement is no longer available')
    await click('Try again')
    expect(container.querySelector('[aria-label="Update"]')?.textContent).toContain('Keep this detail visible')
  })
  it('ignores a slow detail response after a newer route has loaded', async () => {
    let finishOld!: (value: unknown) => void
    mocks.detail.mockImplementation((id) => id === 8 ? new Promise((resolve) => { finishOld = resolve }) : Promise.resolve({ data: { announcement: { ...announcement, id: 9, title: 'Newest selection', body: 'New detail' } }, error: null }))
    await act(async () => root.render(<MemoryRouter initialEntries={['/announcements/8']}><Link to="/announcements/9">Select newer</Link><Routes><Route path="/announcements/:id" element={<Announcements />} /></Routes></MemoryRouter>))
    await click('Select newer')
    expect(container.querySelector('[aria-label="Update"]')?.textContent).toContain('Newest selection')
    await act(async () => finishOld({ data: { announcement }, error: null }))
    expect(container.querySelector('[aria-label="Update"]')?.textContent).toContain('New detail')
    expect(container.querySelector('[aria-label="Update"]')?.textContent).not.toContain('Keep this detail visible')
  })
  it('gives readers one feed with an Unread only toggle: no selects, sorts or explainers (U-3.6)', async () => {
    await mount('/announcements')
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ cohort_id: 4, audience: undefined, sort: undefined, read: undefined }))
    expect(container.querySelectorAll('select')).toHaveLength(0)
    for (const gone of ['Dashboard behavior', 'On Today', 'Management tip', 'Newest published', 'Clear filters']) expect(container.textContent).not.toContain(gone)
    // One unread update: the count and the marker agree, in the singular.
    expect(container.querySelector('[data-testid="updates-context"]')?.textContent).toBe('1 unread update')
    expect(container.textContent).not.toContain('caught up')
    await click('Unread only')
    expect(container.querySelector('output')?.textContent).toBe('/announcements?read=unread&page=1')
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ read: 'unread' }))
    mocks.list.mockResolvedValue({ data: { announcements: [], unread_count: 0, meta: { ...meta, total_count: 0, total_pages: 0 } }, error: null })
    await click('Unread only')
    expect(container.querySelector('[data-testid="updates-context"]')?.textContent).toBe('You’re all caught up')
    expect(container.textContent).not.toContain('unread update')
  })
  it('counts several unread updates in the plural', async () => {
    mocks.list.mockResolvedValue({ data: { announcements: [announcement, { ...announcement, id: 9 }], unread_count: 2, meta: { ...meta, total_count: 2 } }, error: null })
    await mount('/announcements')
    expect(container.querySelector('[data-testid="updates-context"]')?.textContent).toBe('2 unread updates')
  })
  it('shows Edited with the time to readers, and no edit action', async () => {
    const edited = { ...announcement, edited_at: '2026-10-22T10:00:00Z', edited_by: { id: 3, full_name: 'QA Editor' }, can_edit: false }
    mocks.list.mockResolvedValue({ data: { announcements: [edited], unread_count: 1, meta }, error: null })
    mocks.detail.mockResolvedValue({ data: { announcement: edited }, error: null })
    await mount('/announcements')
    expect(container.querySelector('[data-testid="edited-marker"]')?.textContent).toMatch(/^Edited Oct 22, 2026/)
    await click('School notice')
    expect(container.querySelector('[aria-label="Update"] [data-testid="edited-marker"]')).not.toBeNull()
    expect([...container.querySelectorAll('button')].some((item) => item.textContent?.includes('Edit'))).toBe(false)
  })
  it.each([
    [{ returnTo: '/dashboard', returnLabel: 'Today' }, '', 'Back to Today', '/dashboard'],
    [null, '?return_to=%2Fcohorts%2F4', 'Back to Cohort', '/cohorts/4'],
    [{ from: '/announcements?tab=inbox&inbox_read=unread' }, '', 'Back to Notifications', '/announcements?tab=inbox&inbox_read=unread'],
    [null, '?cohort_id=4', 'Back to Updates', '/announcements?cohort_id=4'],
  ])('returns from detail to where the reader came from (L-1.5): %j %s', async (state, search, label, destination) => {
    await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: '/announcements/8', search, state }]}><Location /><Routes><Route path="/announcements/:id?" element={<Announcements />} /><Route path="*" element={<p>Destination</p>} /></Routes></MemoryRouter>))
    const link = [...container.querySelectorAll<HTMLAnchorElement>('[aria-label="Update"] a')].find((item) => item.textContent?.trim() === label)
    expect(link, label).toBeTruthy()
    await act(async () => link!.click())
    expect(container.querySelector('output')?.textContent).toBe(destination)
  })
  it('shows general inbox notices, paging, exact navigation and a preserved return path', async () => {
    mocks.inbox.mockResolvedValue({ data: { notifications: [notification], unread_count: 7, meta: { ...meta, total_pages: 2, has_next_page: true } }, error: null })
    await mount('/announcements?tab=inbox&inbox_read=unread')
    expect(container.textContent).toContain('7 unread notifications')
    await click('Next')
    expect(mocks.inbox).toHaveBeenLastCalledWith({ page: 2, per_page: 25, read: 'unread' })
    await click('Enrollment ready')
    expect(mocks.read).toHaveBeenCalledWith(11)
    expect(container.querySelector('output')?.textContent).toBe('/cohorts/4?booking_id=22')
  })
  it('keeps deleted-target history readable and lets it be marked read; failed requests retry', async () => {
    mocks.inbox.mockResolvedValueOnce({ data: null, error: 'Offline' })
    await mount('/announcements?tab=inbox')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Offline')
    mocks.inbox.mockResolvedValue({ data: { notifications: [{ ...notification, target_available: false }], unread_count: 1, meta }, error: null })
    await click('Retry')
    expect(container.textContent).toContain('This item is no longer available.')
    expect([...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Enrollment ready'))?.disabled).toBe(true)
    await click('Mark read')
    expect(mocks.read).toHaveBeenCalledWith(11)
    await click('Mark all read')
    expect(mocks.all).toHaveBeenCalledOnce()
  })
  it('returns to the last available announcement page when reading shrinks unread history', async () => {
    mocks.list.mockImplementation(async ({ page }) => ({ data: { announcements: page === 2 ? [] : [announcement], unread_count: 12, meta: { ...meta, page, total_pages: 1, total_count: 12 } }, error: null }))
    await mount('/announcements?page=2&read=unread&cohort_id=4')
    expect(container.querySelector('output')?.textContent).toBe('/announcements?page=1&read=unread&cohort_id=4')
    expect(container.textContent).toContain('School notice')
  })
  it('recovers remaining unread Inbox records after the last page shrinks', async () => {
    mocks.inbox.mockImplementation(async ({ page }) => ({ data: { notifications: page === 2 ? [] : [notification], unread_count: 25, meta: { ...meta, page, total_count: 25, total_pages: 1 } }, error: null }))
    await mount('/announcements?tab=inbox&inbox_page=2&inbox_read=unread')
    expect(container.querySelector('output')?.textContent).toBe('/announcements?tab=inbox&inbox_page=1&inbox_read=unread')
    expect(container.textContent).toContain('Enrollment ready')
    expect(container.textContent).toContain('25 unread notifications')
  })
  it('prefers exact destinations when legacy and exact fields differ, validates the chosen path and falls back for null', async () => {
    const exact = { ...notification, destination_path: '/admin/submissions/31?cohort_id=4&student_id=18' }
    expect(notificationDestination(exact)).toBe(exact.destination_path)
    expect(notificationDestination({ ...notification, destination_path: null })).toBe(notification.path)
    expect(notificationDestination({ ...notification, destination_path: '//bad.test' })).toBeNull()
    mocks.inbox.mockResolvedValue({ data: { notifications: [exact], unread_count: 1, meta }, error: null })
    await mount('/announcements?tab=inbox')
    await click('Enrollment ready')
    expect(container.querySelector('output')?.textContent).toBe(exact.destination_path)
  })
  it('retains producer queries/anchors, adds exact legacy message ids, and rejects unsafe paths', () => {
    expect(notificationDestination(notification)).toBe('/cohorts/4?booking_id=22')
    expect(notificationDestination({ ...notification, path: '/messages/3', notifiable: { type: 'Message', id: 45 } })).toBe('/messages/3?message_id=45')
    expect(notificationDestination({ ...notification, path: '/messages/3?message_id=45&thread_id=20', notifiable: { type: 'Message', id: 45 } })).toBe('/messages/3?message_id=45&thread_id=20')
    for (const path of ['https://bad.test', '/.//evil.com', '/a/%252e%252e/%252fevil.com', '//bad.test', '/\\bad.test', '/ bad']) expect(notificationDestination({ ...notification, path })).toBeNull()
  })
})

describe('Announcement composer audience', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.is_staff = true
    mocks.cohort.selectedCohortId = 4
    mocks.cohorts = [
      { id: 4, name: 'Cohort 2', enrolled_count: 9 },
      { id: 5, name: 'Cohort 3', enrolled_count: 4 },
      { id: 6, name: 'Python self-paced', enrolled_count: 1 },
    ]
    mocks.confirm.mockResolvedValue(true)
    mocks.update.mockImplementation(async (id, data) => ({ data: { announcement: { ...announcement, id, ...data } }, error: null }))
    mocks.create.mockResolvedValue({ data: { announcement }, error: null })
    mocks.list.mockResolvedValue({ data: { announcements: [], unread_count: 0, meta }, error: null })
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    // The composer's shared editor in Markdown mode is a textarea these tests type into.
    window.localStorage.setItem('csg-editor-preferences:1', JSON.stringify({ mode: 'markdown', enterSends: true }))
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); window.localStorage.removeItem('csg-editor-preferences:1') })
  async function mount(path: string) {
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/announcements/:id?" element={<Announcements />} /></Routes></MemoryRouter>))
  }
  const field = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
  const status = () => container.querySelector('[data-testid="announcement-audience"]')!.textContent
  async function choose(select: HTMLSelectElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  async function fillAndPost() {
    await act(async () => {
      for (const [selector, value] of [['input[placeholder="Title"]', 'Class moved'], ['textarea', 'Room 4 today']] as const) {
        const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    const post = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Post update'))!
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    return post
  }

  it('defaults the audience to the cohort in the page URL over the sidebar cohort and shows who will receive it', async () => {
    await mount('/announcements?scope=manage&cohort_id=5')
    expect(field('Cohort for this update').value).toBe('5')
    expect(status()).toBe('Posting to: Cohort 3 · 4 students')
    await fillAndPost()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ audience: 'cohort', cohort_id: 5 }))
  })

  it('ignores implicit staff cohort preferences when the URL has none', async () => {
    await mount('/announcements?scope=manage')
    expect(field('Cohort for this update').value).toBe('')
    expect(status()).toBe('Choose a cohort to post to')
    await fillAndPost()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('never defaults to the first cohort: no context means an explicit choice is required', async () => {
    mocks.cohort.selectedCohortId = null as never
    await mount('/announcements?scope=manage')
    expect(field('Cohort for this update').value).toBe('')
    expect(status()).toBe('Choose a cohort to post to')
    await fillAndPost()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Choose which cohort this update is for.')
    await choose(field('Cohort for this update'), '6')
    expect(status()).toBe('Posting to: Python self-paced · 1 student')
  })

  it('treats a URL cohort the poster cannot access as no context', async () => {
    mocks.cohort.selectedCohortId = null as never
    await mount('/announcements?scope=manage&cohort_id=99')
    expect(field('Cohort for this update').value).toBe('')
    expect(status()).toBe('Choose a cohort to post to')
  })

  it('confirms before posting to a cohort other than the one being viewed, and honours cancel', async () => {
    await mount('/announcements?scope=manage&cohort_id=5')
    await choose(field('Cohort for this update'), '6')
    mocks.confirm.mockResolvedValueOnce(false)
    await fillAndPost()
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Post to Python self-paced?', description: expect.stringContaining('You are viewing Cohort 3') }))
    expect(mocks.create).not.toHaveBeenCalled()
    await fillAndPost()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ cohort_id: 6 }))
  })

  it('keeps a draft when switching between Updates and Manage', async () => {
    await mount('/announcements?scope=manage&cohort_id=5')
    await act(async () => {
      for (const [selector, value] of [['input[placeholder="Title"]', 'Draft title'], ['textarea', 'Draft body']] as const) {
        const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    const segment = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!
    await act(async () => { segment('Updates').click() })
    expect(container.querySelector('input[placeholder="Title"]')).toBeNull()
    expect(container.textContent).not.toContain('Leave without saving')
    await act(async () => { segment('Manage').click() })
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Title"]')!.value).toBe('Draft title')
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Draft body')
  })

  it('confirms school-wide posts', async () => {
    await mount('/announcements?scope=manage&cohort_id=5')
    await choose(field('Audience'), 'global')
    expect(status()).toBe('Posting to: Everyone · all students and staff')
    mocks.confirm.mockResolvedValueOnce(false)
    await fillAndPost()
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Post to everyone?' }))
    expect(mocks.create).not.toHaveBeenCalled()
    await fillAndPost()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ audience: 'global', cohort_id: null }))
  })
})

describe('Drafts and edits (U-3.6)', () => {
  let container: HTMLDivElement
  let root: Root
  const draft = { ...announcement, id: 21, title: 'Lab moves', body: 'Room 2', audience: 'cohort', status: 'draft', cohort_id: 5, cohort_name: 'Cohort 3', published_at: null, unread: false, can_edit: true, author: { id: 1, full_name: 'QA Author', email: 'author@example.invalid' } } as Announcement
  const posted = { ...draft, id: 22, status: 'published', published_at: '2026-10-21T10:00:00Z', can_archive: true } as Announcement
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.is_staff = true
    mocks.cohort.selectedCohortId = 4
    mocks.cohorts = [{ id: 4, name: 'Cohort 2', enrolled_count: 9 }, { id: 5, name: 'Cohort 3', enrolled_count: 4 }]
    mocks.confirm.mockResolvedValue(true)
    mocks.update.mockImplementation(async (id, data) => ({ data: { announcement: { ...announcement, id, ...data } }, error: null }))
    mocks.list.mockResolvedValue({ data: { announcements: [], unread_count: 0, meta }, error: null })
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    window.localStorage.setItem('csg-editor-preferences:1', JSON.stringify({ mode: 'markdown', enterSends: true }))
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); window.localStorage.removeItem('csg-editor-preferences:1') })
  async function mount(path: string) {
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Location /><Routes><Route path="/announcements/:id?" element={<Announcements />} /></Routes></MemoryRouter>))
  }
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === text)
  async function type(selector: string, value: string) {
    await act(async () => {
      const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('saves a new draft without the audience check or a push, then shows Drafts', async () => {
    mocks.create.mockResolvedValue({ data: { announcement: draft }, error: null })
    await mount('/announcements?scope=manage&audience=cohort&cohort_id=5')
    expect(container.querySelector('select[aria-label="Sent to"]')).not.toBeNull()
    expect(container.querySelector('select[aria-label="Sent to"]')!.querySelectorAll('option[value^="cohort:"]')).toHaveLength(2)
    await type('input[placeholder="Title"]', 'Lab moves')
    await act(async () => button('Save draft')!.click())
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Lab moves', body: '', status: 'draft', audience: 'cohort', cohort_id: 5 }))
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('send_push')
    expect(mocks.toast.success).toHaveBeenCalledWith('Draft saved')
    expect(container.querySelector('output')?.textContent).toContain('status=draft')
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'manage', status: 'draft', sort: 'updated_desc' }))
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Title"]')!.value).toBe('')
  })

  it('asks for a title before saving a draft', async () => {
    await mount('/announcements?scope=manage&cohort_id=5')
    await act(async () => button('Save draft')!.click())
    expect(mocks.create).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Give the draft a title')
  })

  it('reopens a draft, edits it, and posts it once after the audience check', async () => {
    mocks.list.mockResolvedValue({ data: { announcements: [draft], unread_count: 0, meta }, error: null })
    mocks.detail.mockResolvedValue({ data: { announcement: draft }, error: null })
    let finish!: (value: unknown) => void
    mocks.update.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await mount('/announcements?scope=manage&status=draft')
    expect(container.textContent).toContain('Draft · saved')
    const edit = [...container.querySelectorAll<HTMLAnchorElement>('a')].find((item) => item.textContent?.trim() === 'Edit')!
    expect(edit.getAttribute('href')).toBe('/announcements/21?scope=manage&status=draft&edit=1')
    await act(async () => edit.click())
    expect(container.querySelector('form[aria-label="Edit draft"]')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Title"]')!.value).toBe('Lab moves')
    await type('textarea', 'Room 3 instead')
    const form = container.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    // Not the cohort the page is scoped to, so the existing audience check runs (U-0.3).
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Post to Cohort 3?' }))
    // A second click while the first is in flight sends nothing.
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith(21, expect.objectContaining({ body: 'Room 3 instead', status: 'published', send_push: true, audience: 'cohort', cohort_id: 5 }))
    await act(async () => finish({ data: { announcement: { ...draft, body: 'Room 3 instead', status: 'published', published_at: '2026-10-22T10:00:00Z' } }, error: null }))
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('[aria-label="Update"]')?.textContent).toContain('Update posted.')
    expect(container.querySelector('output')?.textContent).toBe('/announcements/21?scope=manage&status=draft')
    expect(mocks.toast.success).toHaveBeenCalledWith('Update posted')
  })

  it('edits a posted update without changing its audience or notifying again', async () => {
    mocks.detail.mockResolvedValue({ data: { announcement: posted }, error: null })
    mocks.update.mockResolvedValue({ data: { announcement: { ...posted, title: 'Lab moves to room 3', edited_at: '2026-10-22T10:00:00Z', edited_by: { id: 1, full_name: 'QA Author' } } }, error: null })
    await mount('/announcements/22?cohort_id=5')
    await act(async () => button('Edit')!.click())
    expect(container.querySelector('form[aria-label="Edit update"]')).not.toBeNull()
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('[data-testid="announcement-audience"]')?.textContent).toContain('can’t change after it’s posted')
    expect(container.textContent).not.toContain('Send push')
    await type('input[placeholder="Title"]', 'Lab moves to room 3')
    await act(async () => button('Save changes')!.click())
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(22, { title: 'Lab moves to room 3', body: 'Room 2', pinned: false })
    expect(container.querySelector('[aria-label="Update"]')?.textContent).toContain('nobody was notified again')
    expect(container.querySelector('[data-testid="edited-marker"]')).not.toBeNull()
  })

  it('shows the server reason when an edit is refused', async () => {
    mocks.detail.mockResolvedValue({ data: { announcement: posted }, error: null })
    mocks.update.mockResolvedValue({ data: null, error: 'Only the author or an admin can change this update' })
    await mount('/announcements/22?edit=1')
    await act(async () => button('Save changes')!.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Only the author or an admin can change this update')
    expect(container.querySelector('form[aria-label="Edit update"]')).not.toBeNull()
  })

  it('offers no editing on an update the viewer cannot edit', async () => {
    mocks.detail.mockResolvedValue({ data: { announcement: { ...posted, can_edit: false } }, error: null })
    await mount('/announcements/22?edit=1')
    expect(container.querySelector('form')).toBeNull()
    expect(button('Edit')).toBeUndefined()
  })

  it('deletes a draft after asking, and archives posted updates', async () => {
    mocks.list.mockResolvedValue({ data: { announcements: [draft, posted], unread_count: 0, meta: { ...meta, total_count: 2 } }, error: null })
    mocks.archive.mockResolvedValue({ data: { announcement: draft }, error: null })
    await mount('/announcements?scope=manage&status=draft')
    await act(async () => button('Delete')!.click())
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete draft?', confirmLabel: 'Delete draft' }))
    expect(mocks.archive).toHaveBeenCalledWith(21)
    expect(mocks.toast.success).toHaveBeenCalledWith('Draft deleted')
    expect(button('Archive')).toBeTruthy()
  })

  it('offers Archive by can_archive, separately from Edit', async () => {
    const colleague = { ...posted, id: 23, title: 'Colleague post', can_edit: false, can_archive: true }
    const locked = { ...posted, id: 24, title: 'Other post', can_edit: false, can_archive: false }
    mocks.list.mockResolvedValue({ data: { announcements: [colleague, locked], unread_count: 0, meta: { ...meta, total_count: 2 } }, error: null })
    await mount('/announcements?scope=manage')
    const rows = [...container.querySelectorAll('article')]
    expect(rows.map((row) => [...row.querySelectorAll('button,a')].map((item) => item.textContent?.trim()).filter((text) => text === 'Edit' || text === 'Archive'))).toEqual([['Archive'], []])
  })

  async function fillNewUpdate(title: string, body: string) {
    await type('input[placeholder="Title"]', title)
    await type('textarea', body)
  }
  const submit = () => act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

  it('keeps one post pending across leaving Manage and coming back, so a second click sends nothing', async () => {
    let finish!: (value: unknown) => void
    mocks.create.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await mount('/announcements?scope=manage&cohort_id=5')
    await fillNewUpdate('Lab moves', 'Room 3')
    await submit()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    // Leaving Manage unmounts the composer; coming back mounts a new one.
    await act(async () => button('Updates')!.click())
    expect(container.querySelector('form')).toBeNull()
    await act(async () => button('Manage')!.click())
    expect(button('Posting…')?.disabled).toBe(true)
    await submit()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    await act(async () => finish({ data: { announcement: { ...posted, title: 'Lab moves', body: 'Room 3' } }, error: null }))
    expect(mocks.toast.success).toHaveBeenCalledWith('Update posted')
    expect(button('Post update')?.disabled).toBe(false)
  })

  it('locks the fields while a save is pending, so nothing typed then is lost', async () => {
    let finish!: (value: unknown) => void
    mocks.create.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await mount('/announcements?scope=manage&cohort_id=5')
    await fillNewUpdate('Lab moves', 'Room 3')
    await submit()
    const title = container.querySelector<HTMLInputElement>('input[placeholder="Title"]')!
    const body = container.querySelector<HTMLTextAreaElement>('textarea')!
    expect([title.disabled, body.disabled]).toEqual([true, true])
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Audience"]')!.disabled).toBe(true)
    await act(async () => finish({ data: { announcement: posted }, error: null }))
    expect([container.querySelector<HTMLInputElement>('input[placeholder="Title"]')!.disabled, container.querySelector<HTMLTextAreaElement>('textarea')!.disabled]).toEqual([false, false])
  })

  it('sends one client request id per new update, and keeps it for a retry', async () => {
    mocks.create.mockResolvedValueOnce({ data: null, error: 'Network request failed' })
    mocks.create.mockResolvedValue({ data: { announcement: posted }, error: null })
    await mount('/announcements?scope=manage&cohort_id=5')
    await fillNewUpdate('Lab moves', 'Room 3')
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Network request failed')
    await submit()
    await fillNewUpdate('Next update', 'Another')
    await submit()
    const ids = mocks.create.mock.calls.map(([data]) => data.client_request_id)
    expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).not.toBe(ids[0])
  })

  it('shows a rejected request, unlocks the composer, and reuses its id on retry', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Session token unavailable'))
    mocks.create.mockImplementation(async (data) => ({ data: { announcement: { ...posted, ...data } }, error: null }))
    await mount('/announcements?scope=manage&cohort_id=5')
    await fillNewUpdate('Lab moves', 'Room 3')
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Session token unavailable')
    expect(button('Post update')?.disabled).toBe(false)
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Title"]')!.value).toBe('Lab moves')
    await submit()
    expect(mocks.create.mock.calls[1][0].client_request_id).toBe(mocks.create.mock.calls[0][0].client_request_id)
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Title"]')!.value).toBe('')
  })

  it('reconciles a replayed draft with the edited snapshot and posts before clearing the form', async () => {
    mocks.create.mockResolvedValueOnce({ data: null, error: 'Response lost' })
    mocks.create.mockResolvedValue({ data: { announcement: draft }, error: null })
    let finish!: (value: unknown) => void
    mocks.update.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await mount('/announcements?scope=manage&cohort_id=5')
    await fillNewUpdate('Lab moves', 'Room 2')
    await act(async () => button('Save draft')!.click())
    await fillNewUpdate('New title', 'Room 3 plus extra words')
    await submit()
    expect(mocks.update).toHaveBeenCalledWith(21, expect.objectContaining({ title: 'New title', body: 'Room 3 plus extra words', status: 'published', send_push: true }))
    expect(mocks.create.mock.calls[1][0].client_request_id).toBe(mocks.create.mock.calls[0][0].client_request_id)
    expect(mocks.toast.success).not.toHaveBeenCalled()
    // The submitted words remain visible and locked through reconciliation.
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Title"]')!.value).toBe('New title')
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true)
    expect(button('Posting…')?.disabled).toBe(true)
    await act(async () => finish({ data: { announcement: { ...posted, id: 21, title: 'New title', body: 'Room 3 plus extra words' } }, error: null }))
    expect(mocks.toast.success).toHaveBeenCalledWith('Update posted')
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Title"]')!.value).toBe('')
    expect(button('Post update')?.disabled).toBe(false)
  })

  it('keeps the text and create id if reconciliation fails, and retries the same published record', async () => {
    mocks.create.mockResolvedValueOnce({ data: null, error: 'Response lost' })
    mocks.create.mockResolvedValue({ data: { announcement: posted }, error: null })
    mocks.update.mockResolvedValueOnce({ data: null, error: 'PATCH response lost' })
    mocks.update.mockImplementation(async (id, data) => ({ data: { announcement: { ...posted, id, ...data } }, error: null }))
    await mount('/announcements?scope=manage&cohort_id=5')
    await fillNewUpdate('Lab moves', 'Room 2')
    await submit()
    await type('textarea', 'Room 3 added after timeout')
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('PATCH response lost')
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Room 3 added after timeout')
    expect(mocks.toast.success).not.toHaveBeenCalled()
    await submit()
    expect(new Set(mocks.create.mock.calls.map(([data]) => data.client_request_id)).size).toBe(1)
    expect(mocks.update).toHaveBeenLastCalledWith(22, expect.objectContaining({ body: 'Room 3 added after timeout', status: 'published' }))
    expect(mocks.toast.success).toHaveBeenCalledWith('Update posted')
  })

  it('keeps a URL cohort as the Sent to filter when there is no audience', async () => {
    await mount('/announcements?scope=manage&cohort_id=5')
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'manage', audience: 'cohort', cohort_id: 5 }))
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Sent to"]')!.value).toBe('cohort:5')
  })

  it('after saving a draft, shows Drafts with a Sent to filter that includes it', async () => {
    mocks.create.mockResolvedValue({ data: { announcement: draft }, error: null })
    await mount('/announcements?scope=manage&audience=staff')
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>('select[aria-label="Cohort for this update"]')!
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, '5')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await type('input[placeholder="Title"]', 'Lab moves')
    await act(async () => button('Save draft')!.click())
    const search = new URLSearchParams(container.querySelector('output')!.textContent!.split('?')[1])
    expect([search.get('status'), search.get('audience'), search.get('cohort_id')]).toEqual(['draft', 'cohort', '5'])
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'draft', audience: 'cohort', cohort_id: 5 }))
  })
})
