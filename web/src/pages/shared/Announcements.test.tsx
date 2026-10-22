// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Announcement, NotificationEntry } from '../../types/api'

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), inbox: vi.fn(), read: vi.fn(), all: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, user: { id: 1, is_staff: false }, cohort: { selectedCohortId: 4, setSelectedCohort: vi.fn() } }))
vi.mock('../../lib/api', () => ({ api: { getAnnouncements: mocks.list, getAnnouncement: mocks.detail, getNotifications: mocks.inbox, markNotificationRead: mocks.read, markAllNotificationsRead: mocks.all, getCohorts: async () => ({ data: { cohorts: [{ id: 4, name: 'Python' }] } }) } }))
vi.mock('../../lib/pushNotifications', () => ({ pushSupported: () => false }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: mocks.user }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => mocks.cohort }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => mocks.toast }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
import { Announcements } from './Announcements'
import { notificationDestination } from '../../lib/notificationDestination'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const meta = { page: 1, total_pages: 1, total_count: 1, per_page: 12, has_prev_page: false, has_next_page: false }
const announcement = { id: 8, title: 'School notice', body: 'Keep this detail visible', audience: 'global', status: 'published', read_at: null, unread: true, cohort_id: null, cohort_name: null, published_at: '2026-10-21T10:00:00Z' } as Announcement
const notification = { id: 11, notification_type: 'system', title: 'Enrollment ready', body: 'Welcome', path: '/cohorts/4?booking_id=22', read_at: null, created_at: '2026-10-21T10:00:00Z', notifiable: { type: 'Enrollment', id: 22 }, target_available: true } as NotificationEntry
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output> }

describe('Updates reader', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.is_staff = false
    mocks.list.mockResolvedValue({ data: { announcements: [announcement], unread_count: 1, meta }, error: null })
    mocks.detail.mockResolvedValue({ data: { announcement: { ...announcement, read_at: 'now', unread: false } }, error: null })
    mocks.inbox.mockResolvedValue({ data: { notifications: [notification], unread_count: 1, meta }, error: null })
    mocks.read.mockResolvedValue({ data: { notification: { ...notification, read_at: 'now' }, unread_count: 0 }, error: null })
    mocks.all.mockResolvedValue({ data: { unread_count: 0 }, error: null })
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  async function mount(path: string) {
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Location /><Routes><Route path="/announcements/:id?" element={<Announcements />} /><Route path="*" element={<p>Destination</p>} /></Routes></MemoryRouter>))
  }
  async function click(text: string) {
    const element = [...container.querySelectorAll<HTMLElement>('button,a')].find((item) => item.textContent?.trim() === text)
    expect(element, text).toBeTruthy()
    await act(async () => element!.click())
  }
  it.each(['draft', 'archived'] as const)('loads %s detail from management and returns to the same scope', async (status) => {
    mocks.user.is_staff = true
    const managed = { ...announcement, status, unread: false }
    mocks.list.mockResolvedValue({ data: { announcements: [managed], unread_count: 0, meta }, error: null })
    mocks.detail.mockResolvedValue({ data: { announcement: managed }, error: null })
    await mount(`/announcements?scope=manage&status=${status}&cohort_id=4`)
    await click('School notice')
    expect(container.querySelector('[aria-label="Announcement detail"]')?.textContent).toContain('Keep this detail visible')
    expect(mocks.detail).toHaveBeenCalledWith(8)
    await click('Back to announcements')
    expect(container.querySelector('output')?.textContent).toBe(`/announcements?scope=manage&status=${status}&cohort_id=4`)
  })
  it('retains unread-only detail when marking it read removes it from the list, and Back restores the same filters/page', async () => {
    mocks.list.mockResolvedValue({ data: { announcements: [announcement], unread_count: 13, meta: { ...meta, page: 2, total_pages: 2, total_count: 13 } }, error: null })
    await mount('/announcements?read=unread&page=2&sort=published_asc')
    expect(container.textContent).toContain('School-wide')
    mocks.list.mockResolvedValue({ data: { announcements: [], unread_count: 0, meta: { ...meta, page: 2, total_pages: 2, total_count: 13 } }, error: null })
    await click('School notice')
    expect(container.querySelector('[aria-label="Announcement detail"]')?.textContent).toContain('Keep this detail visible')
    expect(mocks.detail).toHaveBeenCalledWith(8)
    await click('Back to announcements')
    expect(container.querySelector('output')?.textContent).toBe('/announcements?read=unread&page=2&sort=published_asc')
    expect(container.textContent).toContain('You’re all caught up')
  })
  it('loads an exact record outside the current page/cohort and displays recoverable detail errors', async () => {
    mocks.list.mockResolvedValue({ data: { announcements: [], unread_count: 0, meta }, error: null })
    mocks.detail.mockResolvedValueOnce({ data: null, error: 'Announcement is no longer available' })
    mocks.list.mockResolvedValue({ data: { announcements: [], unread_count: 0, meta: { ...meta, page: 3, total_pages: 3 } }, error: null })
    await mount('/announcements/8?cohort_id=99&page=3')
    expect(container.textContent).toContain('Announcement is no longer available')
    await click('Retry announcement')
    expect(container.querySelector('[aria-label="Announcement detail"]')?.textContent).toContain('Keep this detail visible')
  })
  it('ignores a slow detail response after a newer route has loaded', async () => {
    let finishOld!: (value: unknown) => void
    mocks.detail.mockImplementation((id) => id === 8 ? new Promise((resolve) => { finishOld = resolve }) : Promise.resolve({ data: { announcement: { ...announcement, id: 9, title: 'Newest selection', body: 'New detail' } }, error: null }))
    await act(async () => root.render(<MemoryRouter initialEntries={['/announcements/8']}><Link to="/announcements/9">Select newer</Link><Routes><Route path="/announcements/:id" element={<Announcements />} /></Routes></MemoryRouter>))
    await click('Select newer')
    expect(container.querySelector('[aria-label="Announcement detail"]')?.textContent).toContain('Newest selection')
    await act(async () => finishOld({ data: { announcement }, error: null }))
    expect(container.querySelector('[aria-label="Announcement detail"]')?.textContent).toContain('New detail')
    expect(container.querySelector('[aria-label="Announcement detail"]')?.textContent).not.toContain('Keep this detail visible')
  })
  it('provides explicit exact-cohort filtering while the reader default includes school-wide', async () => {
    await mount('/announcements')
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ cohort_id: 4, audience: undefined }))
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Announcement audience"]')!
    await act(async () => { select.value = 'cohort'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ cohort_id: 4, audience: 'cohort' }))
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
    for (const path of ['https://bad.test', '//bad.test', '/\\bad.test', '/ bad']) expect(notificationDestination({ ...notification, path })).toBeNull()
  })
})
