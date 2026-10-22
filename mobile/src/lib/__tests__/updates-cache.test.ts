import type { Announcement, AppNotification, PaginationMeta } from '../types';
import { refreshUnreadCaches, mapUpdatePages, readAllAnnouncements, readAllNotifications, readAnnouncement, readAnnouncementNotification, readAnnouncementPages, readAnnouncementNotificationPages, readNotification, uniqueUpdates, upsertAnnouncement } from '../updates-cache';

const meta: PaginationMeta = { page: 1, per_page: 50, total_count: 1, total_pages: 1, has_next_page: false, has_prev_page: false };
const announcement: Announcement = { id: 8, title: 'Update', body: 'Details', pinned: false, published_at: '2026-09-06T00:00:00Z', audience: 'cohort', status: 'published', cohort_name: 'Cohort 4', cohort_id: 4, read_at: null, archived_at: null, created_at: '2026-09-06T00:00:00Z', updated_at: '2026-09-06T00:00:00Z' };
const notification: AppNotification = { id: 11, notification_type: 'announcement', title: 'Update', body: 'Details', path: '/announcements/8', read_at: null, created_at: '2026-09-06T00:00:00Z', actor: null, notifiable: { type: 'Announcement', id: 8 } };

describe('updates cache helpers', () => {
  it('keeps archived announcements in management but removes them from the visible list', () => {
    const current = { announcements: [announcement], unread_count: 1, meta };
    const archived = { ...announcement, status: 'archived' as const };

    expect(upsertAnnouncement(current, archived, false)?.announcements).toEqual([]);
    expect(upsertAnnouncement(current, archived, true)?.announcements).toEqual([archived]);
  });

  it('keeps announcement and inbox unread state synchronized', () => {
    const readAt = '2026-09-06T01:00:00Z';
    const announcementPayload = readAnnouncement({ announcements: [announcement], unread_count: 1, meta }, { ...announcement, read_at: readAt });
    const notificationPayload = readAnnouncementNotification({ notifications: [notification], unread_count: 1, meta }, announcement.id, readAt);

    expect(announcementPayload?.unread_count).toBe(0);
    expect(notificationPayload?.notifications[0].read_at).toBe(readAt);
    expect(notificationPayload?.unread_count).toBe(0);
  });

  it('does not invent a decrement for an announcement outside the cached inbox pages', () => {
    const payload = readAnnouncementNotification({ notifications: [], unread_count: 4, meta }, announcement.id, '2026-09-06T01:00:00Z');

    expect(payload?.unread_count).toBe(4);
  });

  it('uses authoritative counts for one read and clears every cached notification', () => {
    const readAt = '2026-09-06T01:00:00Z';
    const read = { ...notification, read_at: readAt };
    const payload = readNotification({ notifications: [notification], unread_count: 4, meta }, read, 3);

    expect(payload?.unread_count).toBe(3);
    expect(readAllNotifications(payload, readAt)?.unread_count).toBe(0);
  });
});


describe('paged Updates caches', () => {
  const readAt = '2026-10-22T01:00:00Z';
  it('deduplicates offset overlaps without moving already loaded rows', () => {
    const first = Array.from({ length: 50 }, (_, id) => ({ id }));
    expect(uniqueUpdates([first, [{ id: 49 }, { id: 50 }, { id: 51 }]]).map((item) => item.id)).toEqual(Array.from({ length: 52 }, (_, id) => id));
  });
  it('marks a later-page announcement read once across all pages and repeated reads', () => {
    const current = { pages: [{ announcements: [], unread_count: 7, meta }, { announcements: [announcement], unread_count: 7, meta: { ...meta, page: 2 } }], pageParams: [1, 2] };
    const result = readAnnouncementPages(current, { ...announcement, read_at: readAt, unread: false })!;
    expect(result.pages.map((page) => page.unread_count)).toEqual([6, 6]);
    expect(readAnnouncementPages(result, { ...announcement, read_at: readAt })!.pages[0].unread_count).toBe(6);
    expect(result.pages[1].announcements[0].read_at).toBe(readAt);
    expect(result.pageParams).toEqual([1, 2]);
  });
  it('updates the total once for a later-page announcement notification, including overlapping pages', () => {
    const current = { pages: [{ notifications: [notification], unread_count: 7, meta }, { notifications: [notification], unread_count: 7, meta }], pageParams: [1, 2] };
    const result = readAnnouncementNotificationPages(current, { ...announcement, read_at: readAt })!;
    expect(result.pages.map((page) => page.unread_count)).toEqual([6, 6]);
    expect(readAnnouncementNotificationPages(result, { ...announcement, read_at: readAt })!.pages[0].unread_count).toBe(6);
  });
  it('mark-all clears every loaded announcement and notification page while preserving pagination', () => {
    const announcements = { pages: [{ announcements: [announcement], unread_count: 52, meta }, { announcements: [{ ...announcement, id: 9 }], unread_count: 52, meta: { ...meta, page: 2 } }], pageParams: [1, 2] };
    const result = mapUpdatePages(announcements, (page) => readAllAnnouncements(page, readAt))!;
    expect(result.pages.every((page) => page.unread_count === 0 && page.announcements.every((item) => item.read_at === readAt && item.unread === false))).toBe(true);
    const inbox = { pages: [{ notifications: [notification], unread_count: 52, meta }, { notifications: [{ ...notification, id: 12 }], unread_count: 52, meta }], pageParams: [1, 2] };
    expect(mapUpdatePages(inbox, (page) => readAllNotifications(page, readAt))!.pages.every((page) => page.unread_count === 0 && page.notifications.every((item) => item.read_at === readAt))).toBe(true);
  });
});

it('invalidates Updates, conversation attention and all Today cohort caches after a conversation read', () => {
  const client = { invalidateQueries: jest.fn().mockResolvedValue(undefined) };
  refreshUnreadCaches(client as never, 7);
  expect(client.invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([['messaging', 7, 'inbox'], ['updates', 7], ['learning', 7, 'dashboard']]);
});
