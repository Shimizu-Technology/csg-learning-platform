import { brand } from './brand';
import type { MessageSearchResult } from './types';

export function messageSearchRoute(result: MessageSearchResult) {
  const kind = result.context.type === 'channel' ? 'channel' : 'dm';
  if (result.parent_message_id) {
    return {
      pathname: '/thread/[id]' as const,
      params: {
        id: String(result.parent_message_id),
        kind,
        conversationId: String(result.context.id),
        workspaceId: String(result.context.workspace_id),
        messageId: String(result.id),
      },
    };
  }

  return {
    pathname: '/conversation/[kind]/[id]' as const,
    params: { kind, id: String(result.context.id), messageId: String(result.id) },
  };
}

/**
 * A web link to one message (L-5.2 "message permalink"), the same address web
 * Messages copies: the conversation, scrolled to the message and highlighted.
 * Opening it still goes through sign-in and the conversation's own access
 * check, so it shows the message only to people who can already read it.
 * Null for a message that isn't saved yet or a malformed conversation id.
 */
export function messagePermalink(kind: 'channel' | 'dm', conversationId: number, messageId: number) {
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0 || !Number.isSafeInteger(messageId) || messageId <= 0) return null;
  return `${brand.appUrl}${kind === 'dm' ? '/messages/dm/' : '/messages/'}${conversationId}?message_id=${messageId}`;
}
