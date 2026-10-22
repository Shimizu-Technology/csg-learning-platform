import { webRecordingUrl } from '../learning-destination';
import { mobileNotificationPath } from '../notification-path';

it.each([
  [4, 18, 'primary', '18'],
  [4, 0, 'legacy', 'legacy-4-1'],
  [4, 3, 'legacy', 'legacy-4-4'],
] as const)('preserves canonical #196 recording identity (cohort=%s id=%s source=%s)', (cohortId, id, source, identity) => {
  const url = new URL(webRecordingUrl(cohortId, id, source));
  expect(url.origin).toBe('https://learn.codeschoolofguam.com');
  expect(url.pathname + url.search).toBe(`/recordings?cohort_id=${cohortId}&recording=${identity}`);
  expect(mobileNotificationPath(url.pathname + url.search)).toBe(`/recording/${identity}?cohort_id=${cohortId}`);
});
