import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { NotificationObserver, HELD_NOTIFICATION_KEY, HELD_NOTIFICATION_TTL } from '../notification-observer';
import fixtures from '@/lib/fixtures/record-destination-contract.json';
import { notificationStack, type NavigationState } from '@/lib/notification-navigation';

let mockState: NavigationState;
let mockAuth = { loaded: true, signedIn: true };
let mockSession: { loading: boolean; accessDenied: boolean; user: null | { community_policy?: { accepted: boolean } } };
const mockDispatch = jest.fn();
const mockClear = jest.fn(async () => {});
let mockLast: unknown;
let receive: (response: unknown) => void;
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => mockAuth }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => mockSession }));
const mockNavigation = { getRootState: () => mockState, dispatch: mockDispatch };
jest.mock('expo-router', () => ({ usePathname: () => '/', useNavigationContainerRef: () => mockNavigation, useRootNavigationState: () => mockState }));
jest.mock('expo-notifications', () => ({ getLastNotificationResponseAsync: async () => mockLast, addNotificationResponseReceivedListener: (fn: typeof receive) => { receive = fn; return { remove: jest.fn() }; }, clearLastNotificationResponseAsync: () => mockClear() }));
const response = (data: object, id = 'tap') => ({ notification: { request: { identifier: id, content: { data } } } });
function root(app: NavigationState = { routes: [{ name: '(tabs)' }] }): NavigationState {
  return { key: 'wrapper', routes: [{ name: '__root', state: { key: 'app-root', index: 0, routeNames: ['(auth)', '(app)'], routes: [{ name: '(app)', state: { ...app, key: 'app-stack' } }] } }] };
}
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear(); mockLast = null;
  mockAuth = { loaded: true, signedIn: true }; mockSession = { loading: false, accessDenied: false, user: {} };
  mockState = root(); mockDispatch.mockImplementation(() => {});
});
it.each(fixtures.flatMap(f => ['warm tab', 'warm deep', 'background', 'cold'].map(start => [f.descriptor.kind, start, f] as const)))('%s tap from %s builds a tab home and exact target, then clears on arrival', async (_kind, start, fixture) => {
  if (start === 'warm deep') mockState = root({ index: 1, routes: [{ name: '(tabs)' }, { name: 'resources' }] });
  const tap = response({ destination: fixture.descriptor });
  if (start === 'cold') mockLast = tap;
  const screen = render(<NotificationObserver />);
  await act(async () => { if (start !== 'cold') receive(tap); });
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
  const stack = mockDispatch.mock.calls[0][0].payload;
  expect(stack).toEqual(expect.objectContaining(notificationStack(fixture.native!)));
  expect(stack.routes[0].name).toBe('(tabs)');
  if (stack.index === 1) expect(stack.routes[stack.index - 1].name).toBe('(tabs)'); // Back returns to tab bar
  expect(mockClear).not.toHaveBeenCalled();
  mockState = root(stack); screen.rerender(<NotificationObserver />);
  await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
  expect(await AsyncStorage.getItem(HELD_NOTIFICATION_KEY)).toBeNull();
  act(() => receive(tap)); expect(mockDispatch).toHaveBeenCalledTimes(1);
});
it('retains signed-out taps across remount, session loading and policy acceptance', async () => {
  mockAuth.signedIn = false; mockSession.user = null;
  const screen = render(<NotificationObserver />);
  await act(async () => receive(response({ destination: fixtures[0].descriptor })));
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalled());
  expect(mockDispatch).not.toHaveBeenCalled(); expect(mockClear).not.toHaveBeenCalled();
  screen.unmount();
  const next = render(<NotificationObserver />);
  await act(async () => {});
  mockAuth.signedIn = true; mockSession = { loading: true, accessDenied: false, user: {} };
  next.rerender(<NotificationObserver />); expect(mockDispatch).not.toHaveBeenCalled();
  mockSession = { loading: false, accessDenied: false, user: { community_policy: { accepted: false } } };
  next.rerender(<NotificationObserver />); expect(mockDispatch).not.toHaveBeenCalled();
  mockSession.user!.community_policy!.accepted = true;
  next.rerender(<NotificationObserver />);
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
});
it('does not consume a tap for a denied session', async () => {
  mockSession.accessDenied = true;
  render(<NotificationObserver />);
  await act(async () => receive(response({ destination: fixtures[0].descriptor })));
  expect(mockDispatch).not.toHaveBeenCalled(); expect(mockClear).not.toHaveBeenCalled();
});
it('drops expired descriptors, including a matching OS last response', async () => {
  await AsyncStorage.setItem(HELD_NOTIFICATION_KEY, JSON.stringify({ id: 'tap', destination: fixtures[0].descriptor, expires: Date.now() - HELD_NOTIFICATION_TTL }));
  mockLast = response({ destination: fixtures[0].descriptor });
  render(<NotificationObserver />); await act(async () => {});
  expect(mockDispatch).not.toHaveBeenCalled(); expect(await AsyncStorage.getItem(HELD_NOTIFICATION_KEY)).toBeNull();
});
it('keeps legacy notification paths and exact anchors', async () => {
  render(<NotificationObserver />);
  await act(async () => receive(response({ path: '/lesson/42', destination_path: '/lesson/42?cohort_id=2&block_id=8' })));
  expect(mockDispatch.mock.calls[0][0].payload.routes[1].params).toEqual({ id: '42', cohort_id: '2', block_id: '8' });
});
