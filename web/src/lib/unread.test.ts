// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, setApiCacheScope } from './api'
import { conversationAttentionCount, notifyUnreadChanged, subscribeUnreadRefresh, UNREAD_CHANGED } from './unread'

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); setApiCacheScope(null) })
describe('unread policy and refresh', () => {
  it('excludes muted conversations from attention badges', () => {
    expect([{ muted: true, unread_count: 9 }, { muted: false, unread_count: 3 }].reduce((sum, item) => sum + conversationAttentionCount(item), 0)).toBe(3)
    expect(conversationAttentionCount({ muted: true, unread_count: 9 })).toBe(0)
  })
  it('refreshes every read surface and invalidates unread lists while retaining unrelated offline content', async () => {
    const listener = vi.fn()
    window.addEventListener(UNREAD_CHANGED, listener)
    setApiCacheScope('reader')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }))
    for (const path of ['/announcements?cohort_id=4', '/notifications', '/dashboard?cohort_id=4', '/channels', '/direct_conversations', '/lessons/9', '/channels/5']) localStorage.setItem(`csg-api-cache:reader:/api/v1${path}`, 'cached')
    await api.markNotificationRead(8)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('csg-api-cache:reader:/api/v1/announcements?cohort_id=4')).toBeNull()
    expect(localStorage.getItem('csg-api-cache:reader:/api/v1/notifications')).toBeNull()
    expect(localStorage.getItem('csg-api-cache:reader:/api/v1/dashboard?cohort_id=4')).toBeNull()
    expect(localStorage.getItem('csg-api-cache:reader:/api/v1/channels')).toBeNull()
    expect(localStorage.getItem('csg-api-cache:reader:/api/v1/lessons/9')).toBe('cached')
    expect(localStorage.getItem('csg-api-cache:reader:/api/v1/channels/5')).toBe('cached')
    await api.markAllNotificationsRead()
    await api.getAnnouncement(12)
    await api.markChannelRead(5)
    await api.markDirectConversationRead(7)
    await api.updateMessagePreference('Channel', 5, true)
    expect(listener).toHaveBeenCalledTimes(6)
    await api.getAnnouncements()
    expect(listener).toHaveBeenCalledTimes(6)
    window.removeEventListener(UNREAD_CHANGED, listener)
  })
})

it('signals other tabs without putting account or message content in storage', () => {
  const set = vi.spyOn(Storage.prototype, 'setItem')
  notifyUnreadChanged()
  expect(set).toHaveBeenCalledWith('csg:unread-sync', expect.any(String))
  expect(localStorage.getItem('csg:unread-sync')).toMatch(/^[0-9.]+:/)
})


it('coalesces ten read mutations across list subscribers into one shared request per endpoint', async () => {
  vi.useFakeTimers()
  const finishes: (() => void)[] = []
  const fetch = vi.fn().mockImplementation(() => new Promise((resolve) => { finishes.push(() => resolve({ ok: true, status: 200, text: async () => '{}' })) }))
  vi.stubGlobal('fetch', fetch)
  const refresh = () => { void api.getChannels(); void api.getDirectConversations() }
  const stopLayout = subscribeUnreadRefresh(() => refresh())
  const stopMessages = subscribeUnreadRefresh(() => refresh())
  try {
    for (let i = 0; i < 10; i++) { notifyUnreadChanged(); await vi.advanceTimersByTimeAsync(20) }
    expect(fetch).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(350)
    expect(fetch).toHaveBeenCalledTimes(2)
    // The same pending endpoint is shared by both surfaces, without caching completed results.
    finishes.forEach((finish) => finish())
    await vi.advanceTimersByTimeAsync(0)
  } finally { stopLayout(); stopMessages(); vi.useRealTimers() }
})

it('invalidates a pending refresh immediately on a newer signal and cancels trailing work on unsubscribe', async () => {
  vi.useFakeTimers()
  let current!: () => boolean
  const refresh = vi.fn((isCurrent: () => boolean) => { current = isCurrent })
  const stop = subscribeUnreadRefresh(refresh)
  try {
    notifyUnreadChanged()
    await vi.advanceTimersByTimeAsync(350)
    expect(current()).toBe(true)
    window.dispatchEvent(new Event('focus'))
    expect(current()).toBe(false)
    stop()
    await vi.advanceTimersByTimeAsync(350)
    expect(refresh).toHaveBeenCalledTimes(1)
  } finally { stop(); vi.useRealTimers() }
})
