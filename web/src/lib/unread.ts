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

export function subscribeUnreadRefresh(refresh: () => void) {
  const whenVisible = () => { if (document.visibilityState === 'visible') refresh() }
  const onStorage = (event: StorageEvent) => { if (event.key === UNREAD_SYNC_KEY) whenVisible() }
  window.addEventListener(UNREAD_CHANGED, whenVisible)
  window.addEventListener('storage', onStorage)
  window.addEventListener('focus', whenVisible)
  document.addEventListener('visibilitychange', whenVisible)
  return () => {
    window.removeEventListener(UNREAD_CHANGED, whenVisible)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('focus', whenVisible)
    document.removeEventListener('visibilitychange', whenVisible)
  }
}

export function conversationAttentionCount(conversation: { muted?: boolean; unread_count: number }) {
  return conversation.muted ? 0 : Math.max(0, conversation.unread_count || 0)
}
