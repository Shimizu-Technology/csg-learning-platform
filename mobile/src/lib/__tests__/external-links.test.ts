import { openAuthenticatedWebLesson } from '../external-links';
import type { CsgApi } from '../api';
const mockOpen = jest.fn();
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (...args: unknown[]) => mockOpen(...args), WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' } }));
it('hands off to the authenticated runner in the source cohort and block', async () => {
  const webHandoff = jest.fn().mockResolvedValue({ url: 'https://accounts.example.com/one-time' });
  await openAuthenticatedWebLesson({ webHandoff } as unknown as CsgApi, 42, 2, 8);
  expect(webHandoff).toHaveBeenCalledWith('/lessons/42?cohort_id=2#block-8');
  expect(mockOpen).toHaveBeenCalledWith('https://accounts.example.com/one-time', expect.anything());
});
