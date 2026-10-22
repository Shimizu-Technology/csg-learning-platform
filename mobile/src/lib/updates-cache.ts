import type { QueryClient } from '@tanstack/react-query';
import { messagingKeys } from './messaging-cache';
import type { Announcement, AppNotification, PaginationMeta } from './types';

export interface AnnouncementListPayload {
  announcements: Announcement[];
  unread_count: number;
  meta: PaginationMeta;
}

export interface NotificationListPayload {
  notifications: AppNotification[];
  unread_count: number;
  meta: PaginationMeta;
}

export const updatesKeys = {
  root: (userId: number) => ['updates', userId] as const,
  announcements: (userId: number, managing: boolean, cohortId?: number | null) => ['updates', userId, 'announcements', 'pages', managing ? 'manage' : 'visible', cohortId || 'all'] as const,
  notifications: (userId: number) => ['updates', userId, 'notifications', 'pages'] as const,
};

/** Updates every cached announcement list without losing its visibility rules. */
export function upsertAnnouncement(current: AnnouncementListPayload | undefined, announcement: Announcement, managing: boolean) {
  if (!current) return current;
  const existing = current.announcements.some((item) => item.id === announcement.id);
  const belongs = managing || announcement.status === 'published';
  const announcements = belongs
    ? [announcement, ...current.announcements.filter((item) => item.id !== announcement.id)]
    : current.announcements.filter((item) => item.id !== announcement.id);
  const countDelta = Number(belongs && !existing) - Number(!belongs && existing);
  return { ...current, announcements, meta: { ...current.meta, total_count: Math.max(0, current.meta.total_count + countDelta) } };
}

/** Marks an announcement read and keeps the announcement badge locally consistent. */
export function readAnnouncement(current: AnnouncementListPayload | undefined, announcement: Announcement) {
  if (!current) return current;
  const previous = current.announcements.find((item) => item.id === announcement.id);
  return {
    ...current,
    announcements: current.announcements.map((item) => item.id === announcement.id ? announcement : item),
    unread_count: previous && (previous.unread ?? !previous.read_at) && announcement.read_at ? Math.max(0, current.unread_count - 1) : current.unread_count,
  };
}

/** Mirrors a read action into the cached inbox using the API's authoritative count. */
export function readNotification(current: NotificationListPayload | undefined, notification: AppNotification, unreadCount: number) {
  if (!current) return current;
  return {
    ...current,
    notifications: current.notifications.map((item) => item.id === notification.id ? notification : item),
    unread_count: unreadCount,
  };
}

/** Prevents opening an announcement from leaving its inbox notification unread. */
export function readAnnouncementNotification(current: NotificationListPayload | undefined, announcementId: number, readAt: string | null) {
  if (!current || !readAt) return current;
  const matching = current.notifications.find((item) => item.notifiable.type === 'Announcement' && item.notifiable.id === announcementId);
  if (!matching || matching.read_at) return current;
  const notifications = current.notifications.map((item) => {
    if (item.notifiable.type !== 'Announcement' || item.notifiable.id !== announcementId || item.read_at) return item;
    return { ...item, read_at: readAt };
  });
  return { ...current, notifications, unread_count: Math.max(0, current.unread_count - 1) };
}

/** Applies mark-all-read immediately while the server mutation completes. */
export function readAllNotifications(current: NotificationListPayload | undefined, readAt: string) {
  if (!current) return current;
  return {
    ...current,
    notifications: current.notifications.map((item) => ({ ...item, read_at: item.read_at || readAt })),
    unread_count: 0,
  };
}

export type PagedUpdates<T> = { pages: T[]; pageParams: number[] };

/** Offset pages may overlap when a new notice arrives; the newest page wins. */
export function uniqueUpdates<T extends { id: number }>(pages: T[][]): T[] {
  const seen = new Set<number>();
  return pages.flat().filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function readAllAnnouncements(current: AnnouncementListPayload | undefined, readAt: string) {
  if (!current) return current;
  return { ...current, unread_count: 0, announcements: current.announcements.map((item) => ({ ...item, read_at: item.read_at || readAt, unread: false })) };
}

export function mapUpdatePages<T>(current: PagedUpdates<T> | undefined, update: (page: T) => T | undefined) {
  if (!current) return current;
  return { ...current, pages: current.pages.map((page) => update(page) ?? page) };
}

/** One count per whole query, never one decrement per cached page. */
export function readAnnouncementPages(current: PagedUpdates<AnnouncementListPayload> | undefined, announcement: Announcement) {
  if (!current) return current;
  const previous = current.pages.flatMap((page) => page.announcements).find((item) => item.id === announcement.id);
  const count = Math.max(0, (current.pages[0]?.unread_count ?? 0) - Number(Boolean(previous && (previous.unread ?? !previous.read_at) && announcement.read_at)));
  return mapUpdatePages(current, (page) => ({ ...readAnnouncement(page, announcement)!, unread_count: count }));
}

export function readAnnouncementNotificationPages(current: PagedUpdates<NotificationListPayload> | undefined, announcement: Announcement) {
  if (!current || !announcement.read_at) return current;
  const matching = current.pages.flatMap((page) => page.notifications).filter((item) => item.notifiable.type === 'Announcement' && item.notifiable.id === announcement.id && !item.read_at);
  const count = Math.max(0, (current.pages[0]?.unread_count ?? 0) - new Set(matching.map((item) => item.id)).size);
  return mapUpdatePages(current, (page) => ({ ...readAnnouncementNotification(page, announcement.id, announcement.read_at)!, unread_count: count }));
}

/** Conversation reads clear durable notifications as well as message attention. */
export function refreshUnreadCaches(queryClient: QueryClient, userId: number) {
  if (!userId) return;
  void queryClient.invalidateQueries({ queryKey: messagingKeys.inbox(userId), exact: true });
  void queryClient.invalidateQueries({ queryKey: updatesKeys.root(userId) });
}
