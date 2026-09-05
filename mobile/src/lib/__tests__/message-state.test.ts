import { markOptimisticFailed, mergeMessageEvent, mergeOlderMessages, mergePinnedMessageEvent, mergeServerAndFailedMessages, prependOlderMessages, reconcileOptimistic, toggleOwnReaction } from '../message-state';
import type { Message } from '../types';

const message = (id: number, body = String(id)): Message => ({
  id, channel_id: 1, direct_conversation_id: null, parent_message_id: null, body, mention_user_ids: [], edited_at: null,
  deleted_at: null, pinned_at: null, created_at: new Date(2026, 0, id).toISOString(), updated_at: new Date(2026, 0, id).toISOString(),
  mine: false, reactions: [], attachments: [], author: { id: 2, full_name: 'Student', email: 'student@example.com', role: 'student', avatar_url: null },
});

describe('message state', () => {
  it('deduplicates created cable events and applies updates and deletes', () => {
    expect(mergeMessageEvent([message(1)], { event: 'created', channel_id: 1, direct_conversation_id: null, message: message(1) })).toHaveLength(1);
    expect(mergeMessageEvent([message(1)], { event: 'updated', channel_id: 1, direct_conversation_id: null, message: message(1, 'edited') })[0].body).toBe('edited');
    expect(mergeMessageEvent([message(1)], { event: 'deleted', channel_id: 1, direct_conversation_id: null, message: message(1) })).toEqual([]);
  });

  it('replaces an optimistic send when realtime delivers its client message id first', () => {
    const optimistic = { ...message(-1), client_message_id: 'send-1', client_status: 'sending' as const };
    const canonical = { ...message(2), client_message_id: 'send-1', mine: true };

    expect(mergeMessageEvent([optimistic], { event: 'created', channel_id: 1, direct_conversation_id: null, message: canonical })).toEqual([canonical]);
  });

  it('reconciles optimistic messages and prepends unique history', () => {
    const optimistic = { ...message(-1), client_status: 'sending' as const };
    expect(reconcileOptimistic([optimistic], -1, message(2))).toEqual([message(2)]);
    expect(prependOlderMessages([message(2)], [message(1), message(2)]).map((item) => item.id)).toEqual([1, 2]);
  });

  it('deduplicates both realtime-before-response and response-before-realtime delivery', () => {
    const optimistic = { ...message(-1), client_message_id: 'send-1', client_status: 'sending' as const };
    const canonical = { ...message(2), client_message_id: 'send-1', mine: true };
    const created = { event: 'created' as const, channel_id: 1, direct_conversation_id: null, message: canonical };

    const realtimeFirst = mergeMessageEvent([optimistic], created);
    expect(reconcileOptimistic(realtimeFirst, optimistic.id, canonical)).toEqual([canonical]);

    const responseFirst = reconcileOptimistic([optimistic], optimistic.id, canonical);
    expect(mergeMessageEvent(responseFirst, created)).toEqual([canonical]);
  });

  it('removes a stale local message with the canonical client message id', () => {
    const stale = { ...message(-2), client_message_id: 'send-2', client_status: 'failed' as const };
    const canonical = { ...message(3), client_message_id: 'send-2', mine: true };

    expect(reconcileOptimistic([stale], -1, canonical)).toEqual([canonical]);
  });

  it('hydrates canonical messages without matching persisted failures', () => {
    const canonical = { ...message(3), client_message_id: 'send-3', mine: true };
    const failed = { ...message(-3), client_message_id: 'send-3', client_status: 'failed' as const };
    const unmatched = { ...message(-4), client_message_id: 'send-4', client_status: 'failed' as const };

    expect(mergeServerAndFailedMessages([canonical], [failed, unmatched])).toEqual([unmatched, canonical]);
  });

  it('removes a matching persisted failure when an older page contains the canonical message', () => {
    const failed = { ...message(-6), client_message_id: 'send-6', client_status: 'failed' as const };
    const recent = message(9);
    const canonical = { ...message(6), client_message_id: 'send-6', mine: true };

    expect(mergeOlderMessages([failed, recent], [canonical])).toEqual([canonical, recent]);
  });

  it('does not recreate a failed copy after realtime already delivered it', () => {
    const optimistic = { ...message(-5), client_message_id: 'send-5', client_status: 'sending' as const };
    const canonical = { ...message(5), client_message_id: 'send-5', mine: true };

    expect(markOptimisticFailed([canonical], optimistic, 'Timed out')).toEqual([canonical]);
    expect(markOptimisticFailed([optimistic], optimistic, 'Timed out')).toEqual([
      { ...optimistic, client_status: 'failed', client_error: 'Timed out' },
    ]);
  });

  it('removes a pinned message when its realtime event deletes it', () => {
    const pinned = { ...message(1), pinned_at: new Date().toISOString() };
    const deleted = { ...pinned, deleted_at: new Date().toISOString() };

    expect(mergePinnedMessageEvent([pinned], { event: 'deleted', channel_id: 1, direct_conversation_id: null, message: deleted })).toEqual([]);
  });

  it('adds and removes the current user without losing other reaction participants', () => {
    const user = { id: 9, full_name: 'Leon Shimizu', email: 'leon@example.com', role: 'admin', avatar_url: null };
    const withReaction = {
      ...message(1),
      reactions: [{ emoji: '✅', count: 2, reacted: false, users: [{ id: 2, full_name: 'Student', avatar_url: null }] }],
    };

    const added = toggleOwnReaction(withReaction, '✅', user);
    expect(added.reactions[0]).toMatchObject({ count: 3, reacted: true });
    expect(added.reactions[0].users.map((person) => person.id)).toEqual([2, 9]);

    const removed = toggleOwnReaction(added, '✅', user);
    expect(removed.reactions[0]).toMatchObject({ count: 2, reacted: false });
    expect(removed.reactions[0].users.map((person) => person.id)).toEqual([2]);
  });
});
