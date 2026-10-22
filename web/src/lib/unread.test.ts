// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, setApiCacheScope } from './api'
import { conversationAttentionCount, notifyUnreadChanged, UNREAD_CHANGED } from './unread'

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
