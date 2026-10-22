import { isAllowedNotificationPath, mobileNotificationPath } from '../notification-path';

describe('isAllowedNotificationPath', () => {
  it('allows only the mobile notification destinations', () => {
    expect(isAllowedNotificationPath('/meetings')).toBe(true);
    expect(isAllowedNotificationPath('/updates')).toBe(true);
    expect(isAllowedNotificationPath('/conversation/channel/12')).toBe(true);
    expect(isAllowedNotificationPath('/conversation/dm/31')).toBe(true);
    expect(isAllowedNotificationPath('/conversation/dm/31?messageId=42')).toBe(true);
    expect(isAllowedNotificationPath('/lesson/42')).toBe(true);
    expect(isAllowedNotificationPath('/module/7')).toBe(true);
    expect(isAllowedNotificationPath('/resources')).toBe(true);
    expect(isAllowedNotificationPath('/recordings')).toBe(true);
    expect(isAllowedNotificationPath('/recording/uploaded-25')).toBe(true);
    expect(isAllowedNotificationPath('/staff/submission/31')).toBe(true);
    expect(isAllowedNotificationPath('/staff/submission/31?cohort_id=4&student_id=18')).toBe(true);
    expect(isAllowedNotificationPath('/staff/student/18')).toBe(true);
    expect(isAllowedNotificationPath('/staff/grading')).toBe(true);
    expect(isAllowedNotificationPath('/staff/support')).toBe(true);
    expect(isAllowedNotificationPath('/staff/support/41')).toBe(true);
    expect(isAllowedNotificationPath('/staff/intervention/61')).toBe(true);
  });

  it('rejects unknown, malformed, and non-string paths', () => {
    expect(isAllowedNotificationPath('/profile')).toBe(false);
    expect(isAllowedNotificationPath('/conversation/channel/not-an-id')).toBe(false);
    expect(isAllowedNotificationPath('/conversation/dm/31?messageId=0')).toBe(false);
    expect(isAllowedNotificationPath('/conversation/dm/31?messageId=42&next=/profile')).toBe(false);
    expect(isAllowedNotificationPath('/lesson/not-an-id')).toBe(false);
    expect(isAllowedNotificationPath('https://example.com')).toBe(false);
    expect(isAllowedNotificationPath('/staff/submission/31?cohort_id=4&student_id=javascript:alert(1)')).toBe(false);
    expect(isAllowedNotificationPath('/staff/submission/31?cohort_id=4&student_id=18&next=https://example.com')).toBe(false);
    expect(isAllowedNotificationPath(null)).toBe(false);
  });

  it('maps backend web destinations onto safe native routes', () => {
    expect(mobileNotificationPath('/messages/12')).toBe('/conversation/channel/12');
    expect(mobileNotificationPath('/messages/dm/31')).toBe('/conversation/dm/31');
    expect(mobileNotificationPath('/messages/dm/31', 42)).toBe('/conversation/dm/31?messageId=42');
    expect(mobileNotificationPath('/conversation/channel/12', '42')).toBe('/conversation/channel/12?messageId=42');
    expect(mobileNotificationPath('/messages/dm/31', '../42')).toBe('/conversation/dm/31');
    expect(mobileNotificationPath('/announcements/8')).toBe('/updates?announcement_id=8');
    expect(mobileNotificationPath('/admin/submissions/31')).toBe('/staff/submission/31');
    expect(mobileNotificationPath('/admin/submissions/31?cohort_id=4&student_id=18')).toBe('/staff/submission/31?cohort_id=4&student_id=18');
    expect(mobileNotificationPath('/admin/submissions/31?cohort_id=4&student_id=bad')).toBe('/staff/submission/31');
    expect(mobileNotificationPath('/admin/help-requests/41')).toBe('/staff/support/41');
    expect(mobileNotificationPath('/admin/interventions/61')).toBe('/staff/intervention/61');
    expect(mobileNotificationPath('/lessons/42')).toBe('/lesson/42');
    expect(mobileNotificationPath('/modules/7')).toBe('/module/7');
    expect(mobileNotificationPath('/dashboard')).toBe('/');
    expect(mobileNotificationPath('/admin/grading')).toBe('/staff/grading');
    expect(mobileNotificationPath('/admin/support')).toBe('/staff/support');
    expect(mobileNotificationPath('https://example.com')).toBe('/updates');
  });
});

it.each([
  ['/lessons/42?cohort_id=2#block-8', '/lesson/42?cohort_id=2&block_id=8'],
  ['/lessons/42', '/lesson/42'],
  ['/cohorts/12', '/cohort/12'],
  ['/recordings?cohort_id=2&recording=9', '/recording/9?cohort_id=2'],
  ['/recordings?cohort_id=2&recording=legacy-2-1', '/recording/legacy-2-1?cohort_id=2'],
  ['/admin/meetings?cohort_id=2&booking_id=3&week=4', '/meetings?cohort_id=2&booking_id=3&week=4'],
  ['/announcements/80', '/updates?announcement_id=80'],
])('maps %s to the exact safe destination', (source, expected) => {
  expect(mobileNotificationPath(source)).toBe(expected);
  expect(isAllowedNotificationPath(expected)).toBe(true);
});
it.each(['/lesson/4?cohort_id=1&cohort_id=2', '/lesson/4?cohort_id=bad', '/lesson/4?block_id=0', '/updates?announcement_id=1&next=https://evil.test', '/cohort/no', '/meetings?booking_id=3#https://evil.test', '/recording/legacy-2-1?cohort_id=javascript:alert(1)'])('rejects malformed context %s', (path) => expect(isAllowedNotificationPath(path)).toBe(false));
