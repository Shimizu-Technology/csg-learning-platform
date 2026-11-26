import {
  applyMarkdownListEnter,
  conversationSubtitle,
  directConversationPeer,
  isDirectOneToOne,
  isGroupConversation,
  isRecentlyOnline,
} from '../chat-helpers';
import { demoChannels, demoDms } from '../demo-data';
import { claimDeletedReplyDecrement, removeMessageAndUpdateReplyCount } from '../message-state';
import type { Message } from '../types';

describe('chat-helpers', () => {
  it('resolves 1:1 DM peers and classifies Direct vs Group chats accurately', () => {
    expect(directConversationPeer(demoDms[0], 7)?.full_name).toBe('Maya Santos');
    expect(directConversationPeer(demoDms[1], 7)).toBeNull();
    expect(isDirectOneToOne('dm', demoDms[0], 7)).toBe(true);
    expect(isDirectOneToOne('dm', demoDms[1], 7)).toBe(false);
    expect(isGroupConversation('dm', demoDms[1], 7)).toBe(true);
    expect(isGroupConversation('channel', demoChannels[0], 7)).toBe(true);
  });

  it('uses strict 2-minute online presence window', () => {
    const now = Date.parse('2026-11-26T12:00:00.000Z');
    expect(isRecentlyOnline('2026-11-26T11:58:30.000Z', now)).toBe(true);
    expect(isRecentlyOnline('2026-11-26T11:57:59.000Z', now)).toBe(false);
    expect(isRecentlyOnline(null, now)).toBe(false);
  });

  it('omits redundant peer name prefix on 1:1 DMs and attributes You: by author_id only', () => {
    expect(conversationSubtitle('dm', demoDms[0], 7)).toBe('Can I send you the repo before office hours?');
    expect(conversationSubtitle('dm', demoDms[1], 7)).toBe('Kai Perez: Thursday after class works for both of us.');
    expect(conversationSubtitle('channel', demoChannels[0], 7).startsWith('You: ')).toBe(true);
    expect(conversationSubtitle('channel', demoChannels[0], 99).startsWith('Leon Shimizu: ')).toBe(true);
  });

  it('continues Markdown lists on Enter, exits empty items, and indents fenced list blocks', () => {
    expect(applyMarkdownListEnter('- first', '- first\n')).toEqual({
      value: '- first\n- ',
      cursor: 10,
    });
    expect(applyMarkdownListEnter('1. step one', '1. step one\n')).toEqual({
      value: '1. step one\n2. ',
      cursor: 15,
    });
    expect(applyMarkdownListEnter('- ', '- \n')).toEqual({
      value: '',
      cursor: 0,
    });
    expect(applyMarkdownListEnter('01. ```js', '01. ```js\n')).toEqual({
      value: '01. ```js\n    ',
      cursor: 14,
    });
    expect(applyMarkdownListEnter('-\t```js', '-\t```js\n')).toEqual({
      value: '-\t```js\n    ',
      cursor: 12,
    });
    // Inside an already-open fence (including list-contained fences), do not rewrite list-like lines.
    expect(applyMarkdownListEnter('```md\n- item', '```md\n- item\n')).toBeNull();
    expect(applyMarkdownListEnter('- ```js\n  - value', '- ```js\n  - value\n')).toBeNull();
    // Exiting a noninitial empty list item preserves the separating blank line.
    expect(applyMarkdownListEnter('- first\n- ', '- first\n- \n')).toEqual({
      value: '- first\n\n',
      cursor: 9,
    });
    expect(applyMarkdownListEnter('- first\n- \nnext', '- first\n- \n\nnext', { start: 10, end: 10 })).toEqual({
      value: '- first\n\n\nnext',
      cursor: 9,
    });
    // Pre-edit selection resolves Enter inserted before an existing newline unambiguously.
    expect(applyMarkdownListEnter('- item\nnext', '- item\n\nnext', { start: 6, end: 6 })).toEqual({
      value: '- item\n- \nnext',
      cursor: 9,
    });
    // Replacing a selected range with Enter continues the list from selection.start.
    expect(applyMarkdownListEnter('- item extra', '- item\n', { start: 6, end: 12 })).toEqual({
      value: '- item\n- ',
      cursor: 9,
    });
  });

  it('decrements parent reply_count once per screen across realtime-first and HTTP-second reply deletion without cross-screen starvation', () => {
    const root: Message = {
      id: 700,
      channel_id: 1,
      direct_conversation_id: null,
      parent_message_id: null,
      body: 'Root',
      mention_user_ids: [],
      edited_at: null,
      deleted_at: null,
      pinned_at: null,
      created_at: '2026-11-26T10:00:00Z',
      updated_at: '2026-11-26T10:00:00Z',
      mine: true,
      reactions: [],
      attachments: [],
      reply_count: 2,
      author: { id: 7, full_name: 'Leon Shimizu', role: 'admin', avatar_url: null },
    };
    const reply: Message = { ...root, id: 701, parent_message_id: 700, reply_count: 0 };

    const conversationClaimed = new Set<number>();
    const threadClaimed = new Set<number>();

    const skipConvFirst = !claimDeletedReplyDecrement(conversationClaimed, reply.id);
    const afterConvRealtime = removeMessageAndUpdateReplyCount([root, reply], reply, skipConvFirst);
    expect(afterConvRealtime.find((m) => m.id === 700)?.reply_count).toBe(1);

    const skipConvSecond = !claimDeletedReplyDecrement(conversationClaimed, reply.id);
    const afterConvHttp = removeMessageAndUpdateReplyCount(afterConvRealtime, reply, skipConvSecond);
    expect(afterConvHttp.find((m) => m.id === 700)?.reply_count).toBe(1);

    // Mounted ThreadScreen maintains its own claim set and still decrements its root once.
    const skipThreadFirst = !claimDeletedReplyDecrement(threadClaimed, reply.id);
    expect(skipThreadFirst).toBe(false);
    const skipThreadSecond = !claimDeletedReplyDecrement(threadClaimed, reply.id);
    expect(skipThreadSecond).toBe(true);
  });
});
