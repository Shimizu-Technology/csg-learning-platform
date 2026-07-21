import type { ChannelSummary, DirectConversationSummary, WorkspaceSummary } from './types';

export interface WorkspaceCard extends WorkspaceSummary {
  channelCount: number;
  directMessageCount: number;
  unreadCount: number;
}

export function resolveActiveWorkspaceId(workspaces: WorkspaceSummary[], preferredId: number | null) {
  if (preferredId && workspaces.some((workspace) => workspace.id === preferredId)) return preferredId;
  return workspaces[0]?.id ?? null;
}

export function buildWorkspaceCards(
  workspaces: WorkspaceSummary[],
  channels: ChannelSummary[],
  directConversations: DirectConversationSummary[],
): WorkspaceCard[] {
  return workspaces.map((workspace) => {
    const workspaceChannels = channels.filter((channel) => channel.workspace_id === workspace.id);
    const workspaceDms = directConversations.filter((conversation) => conversation.workspace_id === workspace.id);
    return {
      ...workspace,
      channelCount: workspaceChannels.length,
      directMessageCount: workspaceDms.length,
      unreadCount: [...workspaceChannels, ...workspaceDms].reduce((sum, conversation) => sum + conversation.unread_count, 0),
    };
  });
}
