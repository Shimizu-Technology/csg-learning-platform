import { isAllowedNotificationPath } from '../notification-path';

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
});
