import { useInfiniteQuery } from '@tanstack/react-query';

import { UPDATES_STALE_TIME } from '@/hooks/use-updates-focus-refresh';
import { demoNotifications } from '@/lib/demo-data';
import type { PaginationMeta } from '@/lib/types';
import { updatesKeys, type NotificationListPayload } from '@/lib/updates-cache';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

function demoMeta(totalCount: number): PaginationMeta {
  return { page: 1, per_page: 50, total_count: totalCount, total_pages: totalCount ? 1 : 0, has_next_page: false, has_prev_page: false };
}

/** Signed-in user's notification inbox: shared by the Updates screen and the Updates tab badge. */
export function useNotificationsQuery(options: { refetchInterval?: number } = {}) {
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const userId = user?.id ?? 0;

  return useInfiniteQuery({
    queryKey: updatesKeys.notifications(userId),
    initialPageParam: 1,
    getNextPageParam: (last: NotificationListPayload) => last.meta.has_next_page ? last.meta.page + 1 : undefined,
    queryFn: ({ pageParam }): Promise<NotificationListPayload> => auth.demo
      ? Promise.resolve({
        notifications: demoNotifications,
        unread_count: demoNotifications.filter((item) => !item.read_at).length,
        meta: demoMeta(demoNotifications.length),
      })
      : api.notifications({ page: pageParam, per_page: 50 }),
    enabled: Boolean(user),
    staleTime: auth.demo ? Infinity : UPDATES_STALE_TIME,
    refetchInterval: auth.demo ? undefined : options.refetchInterval,
    meta: { persist: true },
  });
}

export function notificationsUnreadCount(data: { pages: NotificationListPayload[] } | undefined) {
  return Math.max(0, data?.pages[0]?.unread_count ?? 0);
}
