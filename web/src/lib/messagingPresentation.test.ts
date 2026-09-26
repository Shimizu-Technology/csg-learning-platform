import { describe, expect, it } from 'vitest'
import { firstUnreadMessageId, latestVisibleReadReceipts, mergeConversationSummary, recentConversations } from './messagingPresentation'
import type { ChannelMessage, ChannelSummary, DirectConversationSummary } from '../types/api'

const latest = (id: number, created_at: string) => ({ id, created_at, body: 'Hello', author_name: 'Ada' })
const channel = (id: number, name: string, createdAt?: string): ChannelSummary => ({
  id, name, workspace_id: 1, workspace_name: 'CSG', workspace_type: 'community', cohort_id: null,
  cohort_name: null, description: null, visibility: 'cohort', status: 'active', position: 0,
  muted: false, unread_count: 0, last_read_at: null, latest_message: createdAt ? latest(id, createdAt) : null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
})
const dm = (id: number, title: string, createdAt?: string): DirectConversationSummary => ({
  id, title, workspace_id: 1, workspace_name: 'CSG', workspace_type: 'community', cohort_id: null,
  cohort_name: null, status: 'active', muted: false, unread_count: 0, last_read_at: null,
  latest_message: createdAt ? latest(id, createdAt) : null, users: [],
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
})
const message = (id: number, readerIds: number[], mine = true): ChannelMessage => ({
  id, channel_id: 1, direct_conversation_id: null, parent_message_id: null, body: 'Hello',
  mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, pinned_by_id: null,
  created_at: `2026-09-01T00:0${id}:00Z`, updated_at: `2026-09-01T00:0${id}:00Z`, mine,
  attachments: [], reactions: [],
  read_receipts: { count: readerIds.length, users: readerIds.map((readerId) => ({ id: readerId, full_name: `Reader ${readerId}`, avatar_url: null })) },
  author: { id: 10, full_name: 'Sender', email: 'sender@example.com', role: 'student', avatar_url: null },
})

describe('recentConversations', () => {
  it('sorts channels and DMs together by actual last-message time and puts empty conversations last', () => {
    const result = recentConversations(
      [channel(1, 'General', '2026-09-01T11:00:00Z'), channel(2, 'Empty')],
      [dm(3, 'Ada', '2026-09-01T12:00:00Z'), dm(4, 'Zed')],
    )
    expect(result.map(({ type, summary }) => `${type}:${summary.id}`)).toEqual(['dm:3', 'channel:1', 'channel:2', 'dm:4'])
  })
})

describe('latestVisibleReadReceipts', () => {
  it('places each group reader at the latest outgoing message they reached', () => {
    const result = latestVisibleReadReceipts([message(1, [1, 2]), message(2, [1]), message(3, [], false)])
    expect(result.get(1)?.users.map((user) => user.id)).toEqual([2])
    expect(result.get(2)?.users.map((user) => user.id)).toEqual([1])
    expect(result.has(3)).toBe(false)
  })

  it('ignores removed and local messages when finding the latest read position', () => {
    const result = latestVisibleReadReceipts([message(1, [1]), { ...message(2, [1]), deleted_at: '2026-09-01T00:03:00Z' }, message(-1, [1])])
    expect([...result.keys()]).toEqual([1])
  })
})

describe('firstUnreadMessageId', () => {
  it('places the boundary before the first unread root message', () => {
    const messages = [message(1, [], false), message(2, [], false), { ...message(3, [], false), parent_message_id: 2 }]
    expect(firstUnreadMessageId(messages, messages[0].created_at, 2)).toBe(2)
    expect(firstUnreadMessageId(messages, messages[0].created_at, 0)).toBeNull()
    expect(firstUnreadMessageId([message(1, [], false), { ...message(2, [], false), created_at: message(1, []).created_at }], message(1, []).created_at, 1, 1)).toBe(2)
  })
})

describe('mergeConversationSummary', () => {
  it('does not revive unread messages when an older read response arrives last', () => {
    const current = { ...dm(1, 'Ada', '2026-09-01T12:00:00Z'), unread_count: 0, last_read_at: '2026-09-01T12:00:00Z', last_read_message_id: 12 }
    const stale = { ...dm(1, 'Ada', '2026-09-01T11:00:00Z'), unread_count: 2, last_read_at: '2026-09-01T11:00:00Z', last_read_message_id: 11 }
    expect(mergeConversationSummary(current, stale)).toMatchObject({ unread_count: 0, last_read_message_id: 12, latest_message: latest(1, '2026-09-01T12:00:00Z') })
  })
})
