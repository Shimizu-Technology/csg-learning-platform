import { conversationAttentionCount } from '@/lib/workspaces';
import { useQuery } from '@tanstack/react-query';

import { demoChannels, demoDms } from '@/lib/demo-data';
import { messagingKeys, type InboxSnapshot } from '@/lib/messaging-cache';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

/** The signed-in user's channels and DMs: one shared query for the inbox screen and the tab badge. */
export function useInboxQuery(options: { refetchInterval?: number } = {}) {
  const auth = useCsgAuth();
  const { api, user } = useSession();
  return useQuery({
    queryKey: messagingKeys.inbox(user?.id ?? 0),
    queryFn: async (): Promise<InboxSnapshot> => {
      if (auth.demo) return { channels: demoChannels, dms: demoDms };
      const [channelResult, dmResult] = await Promise.all([api.channels(), api.directConversations()]);
      return { channels: channelResult.channels, dms: dmResult.direct_conversations };
    },
    enabled: Boolean(user),
    staleTime: 45_000,
    // Demo data is static; polling would overwrite locally marked read state.
    refetchInterval: auth.demo ? undefined : options.refetchInterval,
    meta: { persist: true },
  });
}

/** Unread messages across conversations the learner has not muted, for the Messages tab badge. */
export function inboxUnreadCount(snapshot: InboxSnapshot | undefined) {
  if (!snapshot) return 0;
  return [...snapshot.channels, ...snapshot.dms].reduce((sum, conversation) => sum + conversationAttentionCount(conversation), 0);
}

/** iOS tab badges stay short: "99+" past 99, nothing at zero. */
export function tabBadgeLabel(count: number) {
  if (count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}
