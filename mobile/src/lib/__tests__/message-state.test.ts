import { mergeMessageEvent, prependOlderMessages, reconcileOptimistic } from '../message-state';
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

  it('reconciles optimistic messages and prepends unique history', () => {
    const optimistic = { ...message(-1), client_status: 'sending' as const };
    expect(reconcileOptimistic([optimistic], -1, message(2))).toEqual([message(2)]);
    expect(prependOlderMessages([message(2)], [message(1), message(2)]).map((item) => item.id)).toEqual([1, 2]);
  });
});
