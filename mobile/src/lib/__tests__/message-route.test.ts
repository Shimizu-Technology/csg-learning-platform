import { messageSearchRoute } from '../message-route';
import type { MessageSearchResult } from '../types';

const result = (parentMessageId: number | null): MessageSearchResult => ({
  id: 8,
  channel_id: 4,
  direct_conversation_id: null,
  parent_message_id: parentMessageId,
  body: 'Found it',
  mention_user_ids: [],
  edited_at: null,
  deleted_at: null,
  pinned_at: null,
  created_at: '2026-07-21T00:00:00Z',
  updated_at: '2026-07-21T00:00:00Z',
  mine: false,
  reactions: [],
  attachments: [],
  author: { id: 2, full_name: 'Student', email: 'student@example.com', role: 'student', avatar_url: null },
  context: { type: 'channel', id: 4, label: '#class-chat', workspace_id: 3 },
});

describe('message search routes', () => {
  it('anchors root results in the conversation', () => {
    expect(messageSearchRoute(result(null))).toEqual({
      pathname: '/conversation/[kind]/[id]',
      params: { kind: 'channel', id: '4', messageId: '8' },
    });
  });

  it('opens reply results in their thread', () => {
    expect(messageSearchRoute(result(6))).toEqual({
      pathname: '/thread/[id]',
      params: { id: '6', kind: 'channel', conversationId: '4', workspaceId: '3' },
    });
  });
});
