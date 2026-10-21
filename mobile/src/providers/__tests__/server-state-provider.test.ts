import { dehydrate, hydrate } from '@tanstack/react-query';

import { demoChannels, demoDms, demoMessages, demoUser } from '@/lib/demo-data';
import { messagingKeys, type ConversationSnapshot, type InboxSnapshot, type ThreadSnapshot } from '@/lib/messaging-cache';
import { createServerStateClient, shouldPersistServerQuery } from '@/lib/server-state';

describe('server state messaging persistence', () => {
  it('hydrates the inbox while excluding conversation and thread bodies', async () => {
    const source = createServerStateClient();
    const inboxKey = messagingKeys.inbox(7);
    const conversationKey = messagingKeys.conversation(7, 'channel', 12);
    const root = demoMessages['channel:12'][0];
    const threadKey = messagingKeys.thread(7, root.id);
    const inbox: InboxSnapshot = { channels: demoChannels, dms: demoDms };
    const conversation: ConversationSnapshot = {
      summary: demoChannels[0],
      messages: [root],
      pinnedMessages: [],
      meta: { oldest_message_id: root.id, newest_message_id: root.id, has_older: false, has_newer: false },
      mentionUsers: [demoUser],
    };
    const thread: ThreadSnapshot = { root, replies: [], users: [demoUser] };

    await source.fetchQuery({ queryKey: inboxKey, queryFn: async () => inbox, meta: { persist: true } });
    source.setQueryData(conversationKey, conversation);
    source.setQueryData(threadKey, thread);

    const restored = createServerStateClient();
    hydrate(restored, dehydrate(source, { shouldDehydrateQuery: shouldPersistServerQuery }));

    expect(restored.getQueryData(inboxKey)).toEqual(inbox);
    expect(restored.getQueryData(conversationKey)).toBeUndefined();
    expect(restored.getQueryData(threadKey)).toBeUndefined();
    source.clear();
    restored.clear();
  });
});


describe('durable learning snapshots', () => {
  it('excludes pending promises and keeps saved meetings after an offline refresh failure', async () => {
    const source = createServerStateClient();
    const meetingsKey = ['learning', 7, 'private-meetings'];
    const pendingKey = ['learning', 7, 'not-loaded'];
    const saved = { cohorts: [{ id: 2, name: 'Python' }] };
    source.setQueryData(meetingsKey, saved);
    source.getQueryCache().build(source, { queryKey: pendingKey });
    await expect(source.fetchQuery({ queryKey: meetingsKey, queryFn: async () => { throw new Error('Offline'); }, retry: false, staleTime: 0 })).rejects.toThrow('Offline');
    const snapshot = dehydrate(source, { shouldDehydrateQuery: shouldPersistServerQuery });
    expect(snapshot.queries.map((q) => q.queryKey)).toEqual([meetingsKey]);
    const restored = createServerStateClient();
    hydrate(restored, JSON.parse(JSON.stringify(snapshot)));
    expect(restored.getQueryData(meetingsKey)).toEqual(saved);
    expect(restored.getQueryCache().find({ queryKey: pendingKey })).toBeUndefined();
    source.clear(); restored.clear();
  });
});
