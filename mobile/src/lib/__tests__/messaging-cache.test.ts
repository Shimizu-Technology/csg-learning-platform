import { demoChannels, demoDms } from '../demo-data';
import { markInboxConversationRead, type InboxSnapshot } from '../messaging-cache';

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
});
