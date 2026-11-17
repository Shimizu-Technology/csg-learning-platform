import { openAuthenticatedWebLesson, onWebHandoffClosed } from '../external-links';
import type { CsgApi } from '../api';
const mockOpen = jest.fn();
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (...args: unknown[]) => mockOpen(...args), WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' } }));
it('hands off to the authenticated runner in the source cohort and block', async () => {
  const webHandoff = jest.fn().mockResolvedValue({ url: 'https://accounts.example.com/one-time' });
  await openAuthenticatedWebLesson({ webHandoff } as unknown as CsgApi, 42, 2, 8);
  expect(webHandoff).toHaveBeenCalledWith('/lessons/42?cohort_id=2#block-8');
  expect(mockOpen).toHaveBeenCalledWith('https://accounts.example.com/one-time', expect.anything());
});

it('refreshes listeners only after the handoff sheet closes', async () => {
  let close!: () => void;
  mockOpen.mockImplementationOnce(() => new Promise<void>(resolve => { close = resolve; }));
  const refresh = jest.fn(); const off = onWebHandoffClosed(refresh);
  const work = openAuthenticatedWebLesson({ webHandoff: async () => ({ url: 'https://example.com' }) } as unknown as CsgApi, 1);
  await Promise.resolve(); expect(refresh).not.toHaveBeenCalled();
  close(); await work; expect(refresh).toHaveBeenCalledTimes(1); off();
});
