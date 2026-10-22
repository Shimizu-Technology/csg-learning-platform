import { mobileNotificationPath as installedRouter } from '../fixtures/installed-notification-path';
import { mobileNotificationPath } from '../notification-path';

it.each([
  ['/lesson/42', '/lesson/42?cohort_id=2&block_id=8', '/lesson/42'],
  ['/recordings', '/recording/9?cohort_id=2', '/recordings'],
  ['/updates', '/updates?announcement_id=8', '/updates'],
  ['/meetings', '/meetings?cohort_id=2&booking_id=7&week=1', '/meetings'],
  ['/lessons/42', '/lessons/42?cohort_id=2#block-8', '/lesson/42'],
  ['/recordings', '/recordings?cohort_id=2&recording=9', '/recordings'],
  ['/announcements/8', '/announcements/8', '/updates'],
  ['/admin/meetings', '/admin/meetings?cohort_id=2&booking_id=7&week=1', '/updates'],
  ['/cohorts/2', '/cohorts/2', '/updates'],
])('preserves installed routing for %s while adding exact context', (path, destination_path, oldDestination) => {
  const payload = { path, destination_path };
  expect(installedRouter(payload.path)).toBe(oldDestination);
  expect(mobileNotificationPath(payload.destination_path)).not.toBe('/updates');
});
it('continues to open notifications stored before the additive field', () => {
  const item = { path: '/lessons/42' } as { path: string; destination_path?: string };
  expect(mobileNotificationPath(item.destination_path ?? item.path)).toBe('/lesson/42');
});

// Rails integration tests verify these exact JSON envelopes from /notifications.
import wireContract from '../fixtures/notification-wire-contract.json';
it.each(wireContract)('routes API envelope $path on installed and updated clients', (payload) => {
  expect(installedRouter(payload.path)).toBe(payload.installed_destination);
  expect(mobileNotificationPath(payload.destination_path)).toBe(payload.new_destination);
});
