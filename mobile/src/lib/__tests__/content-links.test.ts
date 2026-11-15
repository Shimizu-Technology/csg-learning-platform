import { nativeContentHref, openContentLink } from '../content-links';
import { router } from 'expo-router';
import { openExternalPage } from '../external-links';
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../external-links', () => ({ openExternalPage: jest.fn().mockResolvedValue(undefined) }));
it.each([
  ['/lessons/42?cohort_id=7#block-8', '/lesson/42?cohort_id=7&block_id=8'],
  ['https://learn.codeschoolofguam.com/modules/3', '/module/3'],
  ['/messages/dm/5?message_id=19', '/conversation/dm/5?message_id=19'],
  ['/announcements/4', '/updates?announcement_id=4'],
  ['/cohorts/2', '/cohort/2'],
])('maps %s through the allowlist', (source, target) => expect(nativeContentHref(source)).toBe(target));
it('supports a configured brand origin', () => expect(nativeContentHref('https://school.example/lessons/42', ['https://school.example'])).toBe('/lesson/42'));
it.each(['//evil.test/lessons/1', '/lessons/../lessons/1', '/lessons/%31', 'javascript:alert(1)', 'https://learn.codeschoolofguam.com.evil.test/lessons/1', 'https://x@learn.codeschoolofguam.com/lessons/1', '/staff/student/1/unknown', 'https://learn.codeschoolofguam.com/lessons/../lessons/1'])('rejects unsafe or unknown native target %s', source => expect(nativeContentHref(source)).toBeNull());
it('opens external sites in the browser sheet and native records through router', async () => {
  await openContentLink('https://example.org/docs'); expect(openExternalPage).toHaveBeenCalledWith('https://example.org/docs');
  await openContentLink('/lessons/42'); expect(router.push).toHaveBeenCalledWith('/lesson/42');
});
