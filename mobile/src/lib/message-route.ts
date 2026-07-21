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
      },
    };
  }

  return {
    pathname: '/conversation/[kind]/[id]' as const,
    params: { kind, id: String(result.context.id), messageId: String(result.id) },
  };
}
