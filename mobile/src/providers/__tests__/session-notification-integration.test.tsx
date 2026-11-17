import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { NotificationObserver } from '@/components/notification-observer';
import { queueIncomingLink, takeIncomingLink, peekIncomingLink } from '@/lib/incoming-link';
import { HELD_NOTIFICATION_KEY } from '@/lib/held-notification';
import { notificationStack, type NavigationState } from '@/lib/notification-navigation';
import type { SessionUser, SessionEnrollment } from '@/lib/types';
import { SessionProvider, useSession } from '../session-provider';
const mockAuthState = {
  current: {
    loaded: false,
    signedIn: true,
    subject: 'account-a' as string | null,
    demo: false,
    getToken: async () => 'token',
    signOut: async () => undefined,
  },
};
const mockSession = jest.fn();
const mockUnregisterDevice = jest.fn().mockResolvedValue(undefined);

let mockLast: unknown = null;
const mockDispatch = jest.fn();
let mockState: NavigationState;
const mockNavigation = { getRootState: () => mockState, dispatch: mockDispatch, addListener: () => () => {} };
jest.mock('expo-router', () => ({ useNavigationContainerRef: () => mockNavigation, useRootNavigationState: () => mockState }));
jest.mock('expo-notifications', () => ({ dismissAllNotificationsAsync: jest.fn().mockResolvedValue(undefined), clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined), getLastNotificationResponseAsync: async () => mockLast, addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }) }));
jest.mock('../auth-provider', () => ({ useCsgAuth: () => mockAuthState.current }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  CsgApi: jest.fn().mockImplementation(() => ({
    session: mockSession,
    unregisterDevice: mockUnregisterDevice,
  })),
}));
jest.mock('@/lib/push-notifications', () => ({
  PUSH_TOKEN_KEY: 'csg.push-token',
  registerPushNotifications: jest.fn().mockResolvedValue(null),
}));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockedRegisterPushNotifications = jest.requireMock('@/lib/push-notifications').registerPushNotifications as jest.Mock;

const userA: SessionUser = {
  id: 7,
  full_name: 'Student A',
  email: 'a@example.com',
  role: 'student',
  avatar_url: null,
  is_admin: false,
  is_staff: false,
  clerk_id: 'account-a',
  first_name: 'Student',
  last_name: 'A',
  github_username: null,
};

const userB: SessionUser = { ...userA, id: 8, full_name: 'Student B', email: 'b@example.com', clerk_id: 'account-b', last_name: 'B' };
type ObservedSession = {
  user: SessionUser | null;
  enrollments: SessionEnrollment[];
  accessDenied: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

let observedSession: ObservedSession | null = null;

function SessionObserver() {
  const session = useSession();
  useEffect(() => { observedSession = session; }, [session]);
  return <Text>{session.user?.id || 'none'}</Text>;
}

beforeEach(async () => {
  mockAuthState.current = {
    ...mockAuthState.current,
    loaded: false,
    signedIn: false,
    subject: null,
    signOut: async () => undefined,
  };
  observedSession = null;
  takeIncomingLink();
  mockLast = null; mockDispatch.mockClear();
  mockState = { routes: [{ name: '(app)', state: { key: 'app-stack', routes: [{ name: '(tabs)' }] } }], routeNames: ['(app)'] };
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  mockSession.mockReset();
  mockedRegisterPushNotifications.mockClear();
});


const tree = () => <SessionProvider><SessionObserver /><NotificationObserver /></SessionProvider>;
async function signedOutRefresh(screen: ReturnType<typeof render>) {
  mockAuthState.current = { ...mockAuthState.current, loaded: true };
  screen.rerender(tree());
  await act(async () => { await observedSession!.refresh(); });
  expect(mockDispatch).not.toHaveBeenCalled();
}
async function signIn(screen: ReturnType<typeof render>, subject = 'account-a', user = userA) {
  mockAuthState.current = { ...mockAuthState.current, signedIn: true, subject };
  mockSession.mockResolvedValue({ user, enrollments: [] });
  screen.rerender(tree());
  await act(async () => { await observedSession!.refresh(); });
}
it('keeps a cold signed-out lesson link through Clerk loading and the real session refresh', async () => {
  queueIncomingLink('/lessons/42?cohort_id=2');
  const screen = render(tree());
  await signedOutRefresh(screen);
  expect(peekIncomingLink()).toBe('/lesson/42?cohort_id=2');
  await signIn(screen);
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
  expect(mockDispatch.mock.calls[0][0].payload).toEqual(expect.objectContaining(notificationStack('/lesson/42?cohort_id=2')));
});
it('clears a held link when a different Clerk subject replaces the signed-in account', async () => {
  const screen = render(tree()); await signedOutRefresh(screen); await signIn(screen);
  mockState = { routes: [{ name: '(auth)' }], routeNames: ['(app)', '(auth)'] };
  act(() => queueIncomingLink('/lessons/42'));
  await signIn(screen, 'account-b', userB);
  expect(peekIncomingLink()).toBeNull();
  mockState = { routes: [{ name: '(app)', state: { key: 'app-stack', routes: [{ name: '(tabs)' }] } }], routeNames: ['(app)'] };
  screen.rerender(tree()); await act(async () => {});
  expect(mockDispatch).not.toHaveBeenCalled();
});
it('keeps a tapped push held while signed out and opens it only for its recipient', async () => {
  mockLast = { notification: { request: { identifier: 'cold-push', content: { data: { recipient_user_id: userA.id, path: '/lesson/42' } } } } };
  const screen = render(tree());
  await signedOutRefresh(screen);
  await waitFor(async () => expect(await AsyncStorage.getItem(HELD_NOTIFICATION_KEY)).not.toBeNull());
  await signIn(screen);
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
  expect(mockDispatch.mock.calls[0][0].payload).toEqual(expect.objectContaining(notificationStack('/lesson/42')));
});

it('clears a held link on real sign-out even when Clerk retains the subject', async () => {
  const screen = render(tree()); await signedOutRefresh(screen); await signIn(screen);
  mockState = { routes: [{ name: '(auth)' }], routeNames: ['(app)', '(auth)'] };
  act(() => queueIncomingLink('/lessons/42'));
  mockAuthState.current = { ...mockAuthState.current, signedIn: false };
  screen.rerender(tree()); await act(async () => {});
  expect(peekIncomingLink()).toBeNull();
});
