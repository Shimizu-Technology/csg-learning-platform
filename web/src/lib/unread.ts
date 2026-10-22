/** Inbox totals include muted notices; message attention badges exclude muted conversations. */
export const UNREAD_CHANGED = 'csg:unread-changed'

export function notifyUnreadChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(UNREAD_CHANGED))
}

export function conversationAttentionCount(conversation: { muted?: boolean; unread_count: number }) {
  return conversation.muted ? 0 : Math.max(0, conversation.unread_count || 0)
}
