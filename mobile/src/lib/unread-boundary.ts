import type { Message, MessageWindowMeta } from './types';

export function firstUnreadMessageId(messages: Pick<Message, 'id' | 'created_at' | 'parent_message_id' | 'mine'>[], lastReadAt: string | null, unreadCount: number, meta: MessageWindowMeta, lastReadMessageId?: number | null): number | null {
  if (unreadCount < 1) return null;
  const roots = messages.filter((message) => !message.parent_message_id && message.id > 0);
  if (!roots.length || (!lastReadAt && meta.has_older)) return null;
  const cutoff = lastReadAt ? Date.parse(lastReadAt) : -Infinity;
  if (Number.isNaN(cutoff) || (meta.has_older && Date.parse(roots[0].created_at) > cutoff)) return null;
  return roots.find((message) => !message.mine && (Date.parse(message.created_at) > cutoff || (lastReadMessageId != null && Date.parse(message.created_at) === cutoff && message.id > lastReadMessageId)))?.id ?? null;
}
