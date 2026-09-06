import type { QueryClient } from '@tanstack/react-query';

import type { ChannelSummary, ConversationKind, DirectConversationSummary, Message, MessageWindowMeta, UserSummary } from './types';

export type InboxSnapshot = { channels: ChannelSummary[]; dms: DirectConversationSummary[] };

export type ConversationSnapshot = {
  summary: ChannelSummary | DirectConversationSummary;
  messages: Message[];
  pinnedMessages: Message[];
  meta: MessageWindowMeta;
  mentionUsers: UserSummary[];
};

export type ThreadSnapshot = {
  root: Message;
  replies: Message[];
  users: UserSummary[];
};

export const messagingKeys = {
  all: ['messaging'] as const,
  inbox: (userId: number) => ['messaging', userId, 'inbox'] as const,
  conversation: (userId: number, kind: ConversationKind, id: number) => ['messaging', userId, 'conversation', kind, id] as const,
  thread: (userId: number, rootId: number) => ['messaging', userId, 'thread', rootId] as const,
};

export function markInboxConversationRead(snapshot: InboxSnapshot | undefined, kind: ConversationKind, id: number, readAt: string): InboxSnapshot | undefined {
  if (!snapshot) return undefined;
  if (kind === 'channel') {
    return {
      ...snapshot,
      channels: snapshot.channels.map((channel) => channel.id === id ? { ...channel, unread_count: 0, last_read_at: readAt } : channel),
    };
  }
  return {
    ...snapshot,
    dms: snapshot.dms.map((conversation) => conversation.id === id ? { ...conversation, unread_count: 0, last_read_at: readAt } : conversation),
  };
}

export function syncThreadSnapshot(queryClient: QueryClient, key: ReturnType<typeof messagingKeys.thread>, root: Message | null, replies: Message[], users: UserSummary[]) {
  if (!root) {
    queryClient.removeQueries({ queryKey: key, exact: true });
    return;
  }
  queryClient.setQueryData<ThreadSnapshot>(key, { root, replies, users });
}
