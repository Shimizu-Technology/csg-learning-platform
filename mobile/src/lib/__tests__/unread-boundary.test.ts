import type { MessageWindowMeta } from '../types';
import { firstUnreadMessageId } from '../unread-boundary';

const meta: MessageWindowMeta = { oldest_message_id: 1, newest_message_id: 3, has_older: false, has_newer: false };
const messages = [1, 2, 3].map((id) => ({ id, created_at: `2026-09-27T00:00:0${id}Z`, parent_message_id: null, mine: false }));

it('puts the boundary at the first unread incoming message', () => {
  expect(firstUnreadMessageId(messages, '2026-09-27T00:00:01Z', 2, meta)).toBe(2);
  expect(firstUnreadMessageId(messages, '2026-09-27T00:00:01Z', 0, meta)).toBeNull();
  expect(firstUnreadMessageId(messages, null, 3, { ...meta, has_older: true })).toBeNull();
});
