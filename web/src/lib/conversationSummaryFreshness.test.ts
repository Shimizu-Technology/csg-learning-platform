// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { ConversationSummaryFreshness } from './conversationSummaryFreshness'

it.each(['channel', 'dm'] as const)('replaces the complete %s snapshot when no Cable update followed request start', (kind) => {
  const freshness = new ConversationSummaryFreshness()
  freshness.recordRealtime(kind, 1)
  const started = freshness.startRequest()
  const local = { id: 1, unread_count: 3, last_read_message_id: 900, latest_message: { id: 900 }, muted: false, removed: 'local-only field' }
  const server = { id: 1, unread_count: 0, last_read_message_id: 800, latest_message: { id: 800 }, muted: true }
  expect(freshness.reconcile(kind, local, server, started)).toBe(server)
})

it('keeps only the conflicting conversation, including new Cable conversations absent from the response', () => {
  const freshness = new ConversationSummaryFreshness()
  const started = freshness.startRequest()
  const local = [{ id: 1, unread_count: 3 }, { id: 2, unread_count: 4 }, { id: 3, unread_count: 5 }]
  freshness.recordRealtime('channel', 1)
  freshness.recordRealtime('channel', 3)
  const server = [{ id: 1, unread_count: 0 }, { id: 2, unread_count: 0 }]
  expect(freshness.reconcileList('channel', local, server, started)).toEqual([local[0], server[1], local[2]])
  expect(freshness.reconcileList('dm', local, server, started)).toEqual(server)
  expect(freshness.reconcileList('channel', local, server, freshness.startRequest())).toEqual(server)
})
