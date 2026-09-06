import { QueryClient } from '@tanstack/react-query';

import { demoChannels, demoDms, demoMessages, demoUser } from '../demo-data';
import { markInboxConversationRead, messagingKeys, syncThreadSnapshot, type InboxSnapshot, type ThreadSnapshot } from '../messaging-cache';

const inbox = (): InboxSnapshot => ({ channels: demoChannels.map((channel) => ({ ...channel })), dms: demoDms.map((conversation) => ({ ...conversation })) });

describe('messaging cache', () => {
  it('clears only the opened channel unread state', () => {
    const readAt = '2026-09-06T00:00:00.000Z';
    const next = markInboxConversationRead(inbox(), 'channel', demoChannels[0].id, readAt)!;

    expect(next.channels[0]).toMatchObject({ unread_count: 0, last_read_at: readAt });
    expect(next.channels[1].unread_count).toBe(demoChannels[1].unread_count);
    expect(next.dms[0].unread_count).toBe(demoDms[0].unread_count);
  });

  it('clears only the opened direct conversation unread state', () => {
    const readAt = '2026-09-06T00:00:00.000Z';
    const next = markInboxConversationRead(inbox(), 'dm', demoDms[0].id, readAt)!;

    expect(next.dms[0]).toMatchObject({ unread_count: 0, last_read_at: readAt });
    expect(next.channels[0].unread_count).toBe(demoChannels[0].unread_count);
  });

  it('does not create an inbox cache while one is unavailable', () => {
    expect(markInboxConversationRead(undefined, 'channel', 1, new Date().toISOString())).toBeUndefined();
  });

  it('removes a deleted thread root and its replies from the exact cache entry', () => {
    const queryClient = new QueryClient();
    const root = demoMessages['channel:12'][0];
    const key = messagingKeys.thread(7, root.id);
    const snapshot: ThreadSnapshot = { root, replies: [{ ...root, id: 102, parent_message_id: root.id }], users: [demoUser] };
    queryClient.setQueryData(key, snapshot);

    syncThreadSnapshot(queryClient, key, null, snapshot.replies, snapshot.users);

    expect(queryClient.getQueryData(key)).toBeUndefined();
  });
});
