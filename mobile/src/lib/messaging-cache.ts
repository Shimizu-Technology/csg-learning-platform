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
