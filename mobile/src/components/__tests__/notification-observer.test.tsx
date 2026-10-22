import { act, render } from '@testing-library/react-native';

import { NotificationObserver } from '../notification-observer';

const mockReset = jest.fn();
const mockPush = jest.fn();
const mockDismissTo = jest.fn();
let mockNavigatorKey = 'application-layout';
const mockNavigationState = () => ({ key: 'router-wrapper', routeNames: ['__root'], routes: [{ name: '__root', state: { key: mockNavigatorKey, routeNames: ['index', '(auth)', '(app)'], routes: [] } }] });
let mockLastResponse: unknown = null;
let receive: ((response: unknown) => void) | undefined;

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, dismissTo: mockDismissTo }), useNavigationContainerRef: () => ({ dispatch: mockReset, getRootState: () => mockNavigationState() }), useRootNavigationState: () => mockNavigationState() }));
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: () => Promise.resolve(mockLastResponse),
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => { receive = listener; return { remove: jest.fn() }; },
  clearLastNotificationResponseAsync: () => Promise.resolve(),
}));

it('puts Messages behind an anchored notification conversation and ignores a duplicate response', () => {
  mockReset.mockClear();
  render(<NotificationObserver />);
  const response = { notification: { request: { identifier: 'push-1', content: { data: { path: '/messages/dm/12', message_id: 45 } } } } };
  act(() => { receive?.(response); receive?.(response); });
  expect(mockReset).toHaveBeenCalledTimes(1);
  const app = mockReset.mock.calls[0][0].payload.routes[0].state;
  expect(app.routes[0].state.routes[0].name).toBe('messages');
  expect(app.routes[1].params).toEqual({ kind: 'dm', id: '12', messageId: '45' });
});
it('prefers the additive exact destination and still accepts a legacy-only push', () => {
  mockDismissTo.mockClear();
  render(<NotificationObserver />);
  act(() => receive?.({ notification: { request: { identifier: 'exact', content: { data: { path: '/lesson/42', destination_path: '/lesson/42?cohort_id=2&block_id=8' } } } } }));
  expect(mockDismissTo).toHaveBeenLastCalledWith('/lesson/42?cohort_id=2&block_id=8');
  act(() => receive?.({ notification: { request: { identifier: 'legacy', content: { data: { path: '/lesson/42' } } } } }));
  expect(mockDismissTo).toHaveBeenLastCalledWith('/lesson/42');
});

beforeEach(() => { mockLastResponse = null; mockNavigatorKey = 'application-layout'; });
it.each(['warm', 'cold'])('atomically puts the Messages tab behind a community notification (%s)', async (start) => {
  mockReset.mockClear();
  const response = { notification: { request: { identifier: `community-${start}`, content: { data: { destination_path: '/messages/3', message_id: 650 } } } } };
  if (start === 'cold') mockLastResponse = response;
  render(<NotificationObserver />);
  await act(async () => { if (start === 'warm') receive?.(response); });
  expect(mockReset).toHaveBeenCalledWith({ type: 'RESET', target: 'application-layout', payload: { index: 0, routes: [{ name: '(app)', state: { index: 1, routes: [{ name: '(tabs)', state: { index: 0, routes: [{ name: 'messages' }] } }, { name: 'conversation/[kind]/[id]', params: { kind: 'channel', id: '3', messageId: '650' } }] } }] } });
});

it('uses the current layout navigator after a prior notification rebuild', () => {
  render(<NotificationObserver />);
  const response = (identifier: string) => ({ notification: { request: { identifier, content: { data: { path: '/messages/3' } } } } });
  act(() => receive?.(response('first')));
  mockNavigatorKey = 'rebuilt-layout';
  act(() => receive?.(response('second')));
  expect(mockReset).toHaveBeenLastCalledWith(expect.objectContaining({ target: 'rebuilt-layout' }));
});
