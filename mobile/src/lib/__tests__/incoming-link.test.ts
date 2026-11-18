import { redirectSystemPath } from '../../app/+native-intent';
import { incomingPath, queueIncomingLink, takeIncomingLink, subscribeIncomingLink } from '../incoming-link';
import { requiresStaff, routeForViewer } from '../notification-path';
it.each(['https://learn.codeschoolofguam.com/lessons/42?cohort_id=2#block-8', 'csglearn://lessons/42?cohort_id=2#block-8', 'csgconnect:///lessons/42?cohort_id=2#block-8'])('maps trusted incoming URL %s', path => {
  expect(incomingPath(path)).toBe('/lesson/42?cohort_id=2&block_id=8');
});
it.each(['https://evil.test/lessons/42', 'javascript:alert(1)', 'https://learn.codeschoolofguam.com.evil.test/messages'])('rejects untrusted URLs %s', path => expect(incomingPath(path)).toBe('/link-unavailable'));
it('holds cold links until consumed and consumes them once', () => {
  const listener = jest.fn(); const off = subscribeIncomingLink(listener);
  queueIncomingLink('/materials'); expect(listener).toHaveBeenCalledTimes(1);
  expect(takeIncomingLink()).toBe('/learn'); expect(takeIncomingLink()).toBeNull(); off();
});
it('identifies both direct and web fallback staff destinations', () => {
  expect(requiresStaff('/staff/student/3?cohort_id=4')).toBe(true);
  expect(requiresStaff('/link-unavailable?path=%2Fadmin%2Fcohorts%2F4%2Fbulk')).toBe(true);
  expect(requiresStaff('/lesson/3')).toBe(false);
});

it('sends learners to the link fallback for every staff-only native route', () => {
  const learner = { is_staff: false };
  for (const link of ['csglearn://cohort/1/schedule', 'csglearn://admin/cohorts/1/schedule', 'csglearn://staff/student/3?cohort_id=1']) {
    expect(routeForViewer(incomingPath(link), learner)).toBe('/link-unavailable');
  }
  for (const path of ['/recordings/link', '/recordings/upload', '/manage-communications', '/staff/grading', '/staff/support']) expect(requiresStaff(path)).toBe(true);
  expect(routeForViewer('/cohort/1/schedule', { is_staff: true })).toBe('/cohort/1/schedule');
  for (const path of ['/cohort/1', '/recordings', '/recording/4?cohort_id=1', '/lesson/3?cohort_id=1', '/staffroom']) expect(routeForViewer(path, learner)).toBe(path);
});

it('ignores the development launcher URL instead of showing the link fallback', () => {
  takeIncomingLink();
  expect(redirectSystemPath({ path: 'exp+csg-connect://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8095', initial: true })).toBe('/');
  expect(takeIncomingLink()).toBeNull();
});

it('does not let the Clerk callback overwrite the content link held during sign-in', () => {
  queueIncomingLink('/lessons/42');
  expect(redirectSystemPath({ path: 'csgconnect://oauth-callback?code=test', initial: false })).toBe('/');
  expect(takeIncomingLink()).toBe('/lesson/42');
});

it('uses the configured brand app origin and rejects the old host after a rebrand', () => {
  const previous = process.env.EXPO_PUBLIC_APP_URL;
  try {
    process.env.EXPO_PUBLIC_APP_URL = 'https://learn.example.org';
    jest.isolateModules(() => {
      const { incomingPath: brandedPath } = jest.requireActual<typeof import('../incoming-link')>('../incoming-link');
      expect(brandedPath('https://learn.example.org/lessons/42')).toBe('/lesson/42');
      expect(brandedPath('https://learn.codeschoolofguam.com/lessons/42')).toBe('/link-unavailable');
    });
  } finally { if (previous === undefined) delete process.env.EXPO_PUBLIC_APP_URL; else process.env.EXPO_PUBLIC_APP_URL = previous; }
});
it('preserves a held lesson through the dev-client OAuth callback', () => {
  queueIncomingLink('/lessons/42');
  expect(redirectSystemPath({ path: 'exp+csg-connect://oauth-callback?code=test', initial: false })).toBe('/');
  expect(takeIncomingLink()).toBe('/lesson/42');
});
