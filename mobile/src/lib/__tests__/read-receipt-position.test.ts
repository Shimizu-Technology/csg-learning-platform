import type { Message } from '../types';
import { latestReaderPositions } from '../read-receipt-position';

const reader = (id: number) => ({ id, full_name: `Reader ${id}`, avatar_url: null });
const message = (id: number, readers: number[]): Message => ({ id, channel_id: 1, direct_conversation_id: null, parent_message_id: null, body: 'Hello', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: `2026-09-27T00:00:0${id}Z`, updated_at: `2026-09-27T00:00:0${id}Z`, mine: true, reactions: [], attachments: [], author: { id: 1, full_name: 'Sender', email: 'sender@example.com', role: 'student', avatar_url: null }, read_receipts: { count: readers.length, users: readers.map(reader) } });

it('shows each reader only at the latest outgoing message they reached', () => {
  const positions = latestReaderPositions([message(1, [2, 3]), message(2, [2]), message(3, [])]);
  expect([...positions]).toEqual([[2, 'Read by Reader 2'], [1, 'Read by Reader 3']]);
});
