import type { ChannelSummary, DirectConversationSummary } from '../types';
import { conversationActivityTime, recentConversations } from '../recent-conversations';

const base = { workspace_id: 1, workspace_name: 'Cohort', workspace_type: 'cohort' as const, cohort_id: 1, cohort_name: 'Cohort', status: 'active' as const, muted: false, unread_count: 0, last_read_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
const latest = (id: number, date: string) => ({ id, body: 'Hi', author_name: 'Maya', created_at: date });
const channel = (id: number, date: string | null): ChannelSummary => ({ ...base, id, name: `Channel ${id}`, description: null, visibility: 'cohort', position: id, latest_message: date ? latest(id, date) : null });
const dm = (id: number, date: string | null): DirectConversationSummary => ({ ...base, id, title: `DM ${id}`, users: [], latest_message: date ? latest(id, date) : null });

it('places channels and direct messages in one stable activity order, then empty conversations', () => {
  expect(recentConversations(
    [channel(1, '2026-01-03T00:00:00Z'), channel(3, null)],
    [dm(2, '2026-01-04T00:00:00Z'), dm(4, '2026-01-02T00:00:00Z')],
  ).map(({ kind, item }) => `${kind}:${item.id}`)).toEqual(['dm:2', 'channel:1', 'dm:4', 'channel:3']);
});

it('shows a useful timestamp for recent and older activity', () => {
  expect(conversationActivityTime('2026-09-27T10:00:00Z', new Date('2026-09-27T12:00:00Z'))).toMatch(/:\d{2}/);
  expect(conversationActivityTime('2025-09-27T10:00:00Z', new Date('2026-09-27T12:00:00Z'))).toMatch(/2025/);
});
