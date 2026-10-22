/** Inbox totals include muted notices; message attention badges exclude muted conversations. */
export const UNREAD_CHANGED = 'csg:unread-changed'

export const UNREAD_SYNC_KEY = 'csg:unread-sync'

export function notifyUnreadChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(UNREAD_CHANGED))
  // A fresh, content-free value wakes other same-origin tabs. Storage events
  // do not fire in the writer, so receiving a signal never rebroadcasts it.
  try { window.localStorage.setItem(UNREAD_SYNC_KEY, `${Date.now()}:${Math.random()}`) } catch { /* Storage can be disabled. Focus refresh still works. */ }
}

// Every surface observes one trailing refresh for a burst of read/focus/storage
// signals. Invalidate pending responses immediately, before the debounce fires.
let refreshVersion = 0
let refreshTimer: ReturnType<typeof setTimeout> | undefined
const subscribers = new Set<(isCurrent: () => boolean) => void>()
export const unreadRefreshVersion = () => refreshVersion

export function requestUnreadRefresh() {
  if (document.visibilityState !== 'visible') return
  const version = ++refreshVersion
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined
    subscribers.forEach((refresh) => refresh(() => subscribers.has(refresh) && version === refreshVersion))
  }, 300)
}
function onUnreadStorage(event: StorageEvent) {
  if (event.key === UNREAD_SYNC_KEY) requestUnreadRefresh()
}

export function subscribeUnreadRefresh(refresh: (isCurrent: () => boolean) => void) {
  if (subscribers.size === 0) {
    window.addEventListener(UNREAD_CHANGED, requestUnreadRefresh)
    window.addEventListener('storage', onUnreadStorage)
    window.addEventListener('focus', requestUnreadRefresh)
    document.addEventListener('visibilitychange', requestUnreadRefresh)
  }
  subscribers.add(refresh)
  return () => {
    subscribers.delete(refresh)
    if (subscribers.size > 0) return
    ++refreshVersion
    clearTimeout(refreshTimer)
    refreshTimer = undefined
    window.removeEventListener(UNREAD_CHANGED, requestUnreadRefresh)
    window.removeEventListener('storage', onUnreadStorage)
    window.removeEventListener('focus', requestUnreadRefresh)
    document.removeEventListener('visibilitychange', requestUnreadRefresh)
  }
}

export function conversationAttentionCount(conversation: { muted?: boolean; unread_count: number }) {
  return conversation.muted ? 0 : Math.max(0, conversation.unread_count || 0)
}
