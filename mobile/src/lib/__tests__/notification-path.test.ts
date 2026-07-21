import { isAllowedNotificationPath, mobileNotificationPath } from '../notification-path';

describe('isAllowedNotificationPath', () => {
  it('allows only the mobile notification destinations', () => {
    expect(isAllowedNotificationPath('/updates')).toBe(true);
    expect(isAllowedNotificationPath('/conversation/channel/12')).toBe(true);
    expect(isAllowedNotificationPath('/conversation/dm/31')).toBe(true);
    expect(isAllowedNotificationPath('/lesson/42')).toBe(true);
    expect(isAllowedNotificationPath('/module/7')).toBe(true);
    expect(isAllowedNotificationPath('/resources')).toBe(true);
    expect(isAllowedNotificationPath('/recordings')).toBe(true);
    expect(isAllowedNotificationPath('/recording/uploaded-25')).toBe(true);
  });

  it('rejects unknown, malformed, and non-string paths', () => {
    expect(isAllowedNotificationPath('/profile')).toBe(false);
    expect(isAllowedNotificationPath('/conversation/channel/not-an-id')).toBe(false);
    expect(isAllowedNotificationPath('/lesson/not-an-id')).toBe(false);
    expect(isAllowedNotificationPath('https://example.com')).toBe(false);
    expect(isAllowedNotificationPath(null)).toBe(false);
  });

  it('maps backend web destinations onto safe native routes', () => {
    expect(mobileNotificationPath('/messages/12')).toBe('/conversation/channel/12');
    expect(mobileNotificationPath('/messages/dm/31')).toBe('/conversation/dm/31');
    expect(mobileNotificationPath('/announcements/8')).toBe('/updates');
    expect(mobileNotificationPath('/lessons/42')).toBe('/lesson/42');
    expect(mobileNotificationPath('/modules/7')).toBe('/module/7');
    expect(mobileNotificationPath('/dashboard')).toBe('/');
    expect(mobileNotificationPath('https://example.com')).toBe('/updates');
  });
});
