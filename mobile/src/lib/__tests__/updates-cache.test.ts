import type { Announcement, AppNotification, PaginationMeta } from '../types';
import { readAllNotifications, readAnnouncement, readAnnouncementNotification, readNotification, upsertAnnouncement } from '../updates-cache';

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

  it('updates the global count when an announcement notification is beyond the cached page', () => {
    const payload = readAnnouncementNotification({ notifications: [], unread_count: 4, meta }, announcement.id, '2026-09-06T01:00:00Z');

    expect(payload?.unread_count).toBe(3);
  });

  it('uses authoritative counts for one read and clears every cached notification', () => {
    const readAt = '2026-09-06T01:00:00Z';
    const read = { ...notification, read_at: readAt };
    const payload = readNotification({ notifications: [notification], unread_count: 4, meta }, read, 3);

    expect(payload?.unread_count).toBe(3);
    expect(readAllNotifications(payload, readAt)?.unread_count).toBe(0);
  });
});
