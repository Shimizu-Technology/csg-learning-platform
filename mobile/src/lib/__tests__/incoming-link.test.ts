import { redirectSystemPath } from '../../app/+native-intent';
import { incomingPath, queueIncomingLink, takeIncomingLink, subscribeIncomingLink } from '../incoming-link';
import { requiresStaff } from '../notification-path';
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
