import { inboxUnreadCount, tabBadgeLabel } from '@/hooks/use-inbox';
import { notificationTitle } from '../notification-path';

jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: {}, user: null }) }));

describe('Messages tab badge', () => {
  it('counts unread messages in conversations that are not muted', () => {
    const snapshot = { channels: [{ unread_count: 2, muted: false }, { unread_count: 5, muted: true }], dms: [{ unread_count: 3, muted: false }] } as never;
    expect(inboxUnreadCount(snapshot)).toBe(5);
    expect(inboxUnreadCount(undefined)).toBe(0);
    expect(tabBadgeLabel(0)).toBeUndefined();
    expect(tabBadgeLabel(7)).toBe('7');
    expect(tabBadgeLabel(140)).toBe('99+');
  });
});

describe('notification titles', () => {
  it('fills in a missing exercise name in older redo and grade notifications', () => {
    expect(notificationTitle({ title: 'Audit Admin requested a redo on ', notification_type: 'redo' })).toBe('Audit Admin requested a redo on your exercise');
    expect(notificationTitle({ title: 'Audit Admin graded : A' })).toBe('Audit Admin graded your exercise: A');
    expect(notificationTitle({ title: 'Audit Admin requested a redo on E1', notification_type: 'redo' })).toBe('Audit Admin requested a redo on E1');
    expect(notificationTitle({ title: '', notification_type: 'redo' })).toBe('Redo requested');
  });
});
