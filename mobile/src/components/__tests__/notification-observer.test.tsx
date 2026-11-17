import { queueIncomingLink, takeIncomingLink } from '@/lib/incoming-link';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { NotificationObserver, HELD_NOTIFICATION_KEY, HELD_NOTIFICATION_TTL } from '../notification-observer';
import fixtures from '@/lib/fixtures/record-destination-contract.json';
import { notificationStack, type NavigationState } from '@/lib/notification-navigation';

let mockState: NavigationState;
let mockAuth = { loaded: true, signedIn: true };
let mockSession: { loading: boolean; accessDenied: boolean; user: null | { id?: number; is_staff?: boolean; community_policy?: { accepted: boolean } } };
const mockDispatch = jest.fn();
const mockClear = jest.fn(async () => {});
let mockLast: unknown;
let receive: (response: unknown) => void;
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => mockAuth }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => mockSession }));
const mockNavigation = { getRootState: () => mockState, dispatch: mockDispatch, addListener: () => () => {} };
jest.mock('expo-router', () => ({ usePathname: () => '/', useNavigationContainerRef: () => mockNavigation, useRootNavigationState: () => mockState }));
jest.mock('expo-notifications', () => ({ getLastNotificationResponseAsync: async () => mockLast, addNotificationResponseReceivedListener: (fn: typeof receive) => { receive = fn; return { remove: jest.fn() }; }, dismissAllNotificationsAsync: jest.fn(async () => {}), clearLastNotificationResponseAsync: () => mockClear() }));
const response = (data: object, id = 'tap') => ({ notification: { request: { identifier: id, content: { data } } } });
function root(app: NavigationState = { routes: [{ name: '(tabs)' }] }): NavigationState {
  return { key: 'wrapper', routes: [{ name: '__root', state: { key: 'app-root', index: 0, routeNames: ['(auth)', '(app)'], routes: [{ name: '(app)', state: { ...app, key: 'app-stack' } }] } }] };
}
beforeEach(async () => {
  takeIncomingLink(); jest.clearAllMocks(); await AsyncStorage.clear(); await AsyncStorage.setItem('csg.notification.last-user.v1', '1'); mockLast = null;
  mockAuth = { loaded: true, signedIn: true }; mockSession = { loading: false, accessDenied: false, user: { id: 1, is_staff: true } };
  mockState = root(); mockDispatch.mockImplementation(() => {});
});
// Web-only kinds (staff, Safety items) have no native screen; see the Updates fallback test below.
const nativeFixtures = fixtures.filter(f => f.native);
it.each(nativeFixtures.flatMap(f => ['warm tab', 'warm deep', 'background', 'cold'].map(start => [f.descriptor.kind, start, f] as const)))('%s tap from %s builds a tab home and exact target, then clears on arrival', async (_kind, start, fixture) => {
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
  mockAuth.signedIn = true; mockSession = { loading: true, accessDenied: false, user: { id: 1, is_staff: true } };
  next.rerender(<NotificationObserver />); expect(mockDispatch).not.toHaveBeenCalled();
  mockSession = { loading: false, accessDenied: false, user: { id: 1, community_policy: { accepted: false } } };
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
it.each(fixtures.filter(f => !f.native))('offers a web fallback for a web-only $descriptor.kind alert', async fixture => {
  render(<NotificationObserver />);
  await act(async () => receive(response({ destination: fixture.descriptor, path: '/updates', destination_path: '/updates' })));
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
  expect(mockDispatch.mock.calls[0][0].payload).toEqual(expect.objectContaining(notificationStack(`/link-unavailable?path=${encodeURIComponent(fixture.web)}`)));
});
it('keeps legacy notification paths and exact anchors', async () => {
  render(<NotificationObserver />);
  await act(async () => receive(response({ path: '/lesson/42', destination_path: '/lesson/42?cohort_id=2&block_id=8' })));
  expect(mockDispatch.mock.calls[0][0].payload.routes[1].params).toEqual({ id: '42', cohort_id: '2', block_id: '8' });
});
it.each(['/updates?announcement_id=12', '/recording/recording-12', '/recording/uploaded-12', '/staff/student/12', '/', '/meetings', '/learn', '/resources', '/recordings', '/updates', '/staff/grading', '/staff/support'])('persists and restores validated legacy path %s', async path => {
  mockAuth.signedIn = false; mockSession.user = null;
  const first = render(<NotificationObserver />);
  await act(async () => receive(response({ path })));
  await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(HELD_NOTIFICATION_KEY))!).path).toBe(path));
  first.unmount();
  const next = render(<NotificationObserver />);
  await act(async () => {});
  mockAuth.signedIn = true; mockSession.user = { id: 1, is_staff: true };
  next.rerender(<NotificationObserver />);
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
  expect(mockDispatch.mock.calls[0][0].payload).toEqual(expect.objectContaining(notificationStack(path)));
});
it('drops a signed-out tap without a known prior account', async () => {
  await AsyncStorage.removeItem('csg.notification.last-user.v1');
  mockAuth.signedIn = false; mockSession.user = null;
  const next = render(<NotificationObserver />);
  await act(async () => receive(response({ path: '/lesson/42' })));
  mockAuth.signedIn = true; mockSession.user = { id: 2 };
  next.rerender(<NotificationObserver />);
  await act(async () => {});
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(HELD_NOTIFICATION_KEY)).toBeNull();
});
it('explicit sign-out clears both disk and the in-memory tap', async () => {
  mockSession.loading = true;
  const next = render(<NotificationObserver />);
  await act(async () => receive(response({ path: '/lesson/42' })));
  const { clearHeldNotifications } = require('@/lib/held-notification');
  await act(async () => clearHeldNotifications());
  mockSession.loading = false;
  next.rerender(<NotificationObserver />);
  await act(async () => {});
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(HELD_NOTIFICATION_KEY)).toBeNull();
});
it.each(nativeFixtures)('persists the validated $descriptor.kind wire descriptor across remount', async fixture => {
  mockAuth.signedIn = false; mockSession.user = null;
  const first = render(<NotificationObserver />);
  await act(async () => receive(response({ destination: fixture.descriptor })));
  await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(HELD_NOTIFICATION_KEY))!).destination.kind).toBe(fixture.descriptor.kind));
  first.unmount();
  const next = render(<NotificationObserver />);
  await act(async () => {});
  mockAuth.signedIn = true; mockSession.user = { id: 1, is_staff: true };
  next.rerender(<NotificationObserver />);
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
  expect(mockDispatch.mock.calls[0][0].payload).toEqual(expect.objectContaining(notificationStack(fixture.native!)));
});
it('rejects an untrusted restored path', async () => {
  await AsyncStorage.setItem(HELD_NOTIFICATION_KEY, JSON.stringify({ id: 'unsafe', userId: 1, path: '//evil.test', expires: Date.now() + 10000 }));
  render(<NotificationObserver />);
  await act(async () => {});
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(HELD_NOTIFICATION_KEY)).toBeNull();
});
it('binds a first-install cold tap to the signed-in Clerk subject before session ready', async () => {
  await AsyncStorage.clear();
  Object.assign(mockAuth, { subject: 'subject-a' });
  mockSession = { loading: true, accessDenied: false, user: null };
  mockLast = response({ path: '/lesson/42' });
  const screen = render(<NotificationObserver />);
  await act(async () => {});
  expect(mockDispatch).not.toHaveBeenCalled();
  mockSession = { loading: false, accessDenied: false, user: { id: 1, is_staff: true } };
  screen.rerender(<NotificationObserver />);
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
});
it('drops a cold tap when its captured subject differs after ready', async () => {
  await AsyncStorage.clear(); Object.assign(mockAuth, { subject: 'subject-a' });
  mockSession = { loading: true, accessDenied: false, user: null }; mockLast = response({ path: '/lesson/42' });
  const screen = render(<NotificationObserver />); await act(async () => {});
  Object.assign(mockAuth, { subject: 'subject-b' }); mockSession = { loading: false, accessDenied: false, user: { id: 2 } };
  screen.rerender(<NotificationObserver />); await act(async () => {});
  expect(mockDispatch).not.toHaveBeenCalled(); expect(mockClear).toHaveBeenCalled();
});
it('dismisses delivered notifications on sign-out so another account cannot tap the tray', async () => {
  const { clearHeldNotifications } = jest.requireActual('@/lib/held-notification');
  await clearHeldNotifications();
  expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalled();
});

it('rejects another recipient’s tray notification even when tapped while signed in', async () => {
  render(<NotificationObserver />);
  await act(async () => receive(response({ path: '/lesson/42', recipient_user_id: 2 })));
  expect(mockDispatch).not.toHaveBeenCalled(); expect(mockClear).toHaveBeenCalled();
});

it('never sends learners to a staff screen from a push', async () => {
  mockSession.user = { id: 1, is_staff: false };
  render(<NotificationObserver />);
  await act(async () => receive(response({ path: '/staff/student/18?cohort_id=4' })));
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
  expect(mockDispatch.mock.calls[0][0].payload).toEqual(expect.objectContaining(notificationStack('/link-unavailable')));
});

it('holds an incoming universal link across the sign-in remount and policy gate', async () => {
  mockAuth.signedIn = false; mockSession.user = null;
  queueIncomingLink('https://learn.codeschoolofguam.com/lessons/42?cohort_id=2');
  const first = render(<NotificationObserver />); await act(async () => {});
  expect(mockDispatch).not.toHaveBeenCalled(); first.unmount();
  mockAuth.signedIn = true; mockSession.user = { id: 1, community_policy: { accepted: false } };
  const next = render(<NotificationObserver />); await act(async () => {});
  expect(mockDispatch).not.toHaveBeenCalled();
  mockSession.user.community_policy!.accepted = true; next.rerender(<NotificationObserver />);
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
  expect(mockDispatch.mock.calls[0][0].payload).toEqual(expect.objectContaining(notificationStack('/lesson/42?cohort_id=2')));
  expect(takeIncomingLink()).toBeNull();
});
