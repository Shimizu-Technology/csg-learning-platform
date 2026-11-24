// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UpdatesTabs } from './UpdatesTabs'

const getNotifications = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', () => ({ api: { getNotifications } }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); getNotifications.mockReset() })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
const tab = () => [...container.querySelectorAll('a')].find((link) => link.textContent?.startsWith('Notifications'))

it('badges the Notifications tab from the feed with the inbox unread count', async () => {
  getNotifications.mockResolvedValue({ data: { unread_count: 3 } })
  await act(async () => root.render(<MemoryRouter initialEntries={['/announcements']}><UpdatesTabs selected="announcements" /></MemoryRouter>))
  expect(getNotifications).toHaveBeenCalledWith({ per_page: 1 })
  expect(tab()?.textContent).toBe('Notifications3')
  expect(tab()?.getAttribute('aria-label')).toBe('Notifications, 3 unread')
})

it('uses the inbox count it is given and shows no badge at zero', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/announcements?tab=inbox']}><UpdatesTabs selected="inbox" inboxUnreadCount={0} /></MemoryRouter>))
  expect(getNotifications).not.toHaveBeenCalled()
  expect(tab()?.textContent).toBe('Notifications')
  expect(tab()?.hasAttribute('aria-label')).toBe(false)
})
