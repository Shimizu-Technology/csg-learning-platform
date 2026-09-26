import type { ChannelSummary, DirectConversationSummary } from './types';

export type RecentConversation =
  | { kind: 'channel'; item: ChannelSummary }
  | { kind: 'dm'; item: DirectConversationSummary };

export function recentConversations(channels: ChannelSummary[], dms: DirectConversationSummary[]): RecentConversation[] {
  return [
    ...channels.map((item) => ({ kind: 'channel' as const, item })),
    ...dms.map((item) => ({ kind: 'dm' as const, item })),
  ].sort((left, right) => {
    // Empty conversations belong after active ones, regardless of when created.
    if (!left.item.latest_message) return right.item.latest_message ? 1 : left.item.created_at.localeCompare(right.item.created_at);
    if (!right.item.latest_message) return -1;
    const byActivity = Date.parse(right.item.latest_message.created_at) - Date.parse(left.item.latest_message.created_at);
    return byActivity || `${left.kind}:${left.item.id}`.localeCompare(`${right.kind}:${right.item.id}`);
  });
}

export function conversationActivityTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(date);
  if (date.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
