import { isAllowedNotificationPath, mobileNotificationPath } from '../notification-path';

describe('isAllowedNotificationPath', () => {
  it('allows only the mobile notification destinations', () => {
    expect(isAllowedNotificationPath('/updates')).toBe(true);
    expect(isAllowedNotificationPath('/conversation/channel/12')).toBe(true);
    expect(isAllowedNotificationPath('/conversation/dm/31')).toBe(true);
  });

  it('rejects unknown, malformed, and non-string paths', () => {
    expect(isAllowedNotificationPath('/profile')).toBe(false);
    expect(isAllowedNotificationPath('/conversation/channel/not-an-id')).toBe(false);
    expect(isAllowedNotificationPath('https://example.com')).toBe(false);
    expect(isAllowedNotificationPath(null)).toBe(false);
  });

  it('maps backend web destinations onto safe native routes', () => {
    expect(mobileNotificationPath('/messages/12')).toBe('/conversation/channel/12');
    expect(mobileNotificationPath('/messages/dm/31')).toBe('/conversation/dm/31');
    expect(mobileNotificationPath('/announcements/8')).toBe('/updates');
    expect(mobileNotificationPath('https://example.com')).toBe('/updates');
  });
});
