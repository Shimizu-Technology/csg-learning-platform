import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { ApiError } from '@/lib/api';
import { activateUserConversationStorage, loadConversationDraft, saveConversationDraft } from '@/lib/conversation-storage';
import type { SessionUser } from '@/lib/types';
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

jest.mock('../auth-provider', () => ({ useCsgAuth: () => mockAuthState.current }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  CsgApi: jest.fn().mockImplementation(() => ({
    session: mockSession,
    unregisterDevice: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@/lib/push-notifications', () => ({
  PUSH_TOKEN_KEY: 'csg.push-token',
  registerPushNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

beforeEach(async () => {
  mockAuthState.current = {
    ...mockAuthState.current,
    loaded: false,
    signedIn: true,
    subject: 'account-a',
    signOut: async () => undefined,
  };
  observedSession = null;
  activateUserConversationStorage(userA.id);
  activateUserConversationStorage(userB.id);
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  mockSession.mockReset();
});

it('ignores an account A refresh that completes after account B', async () => {
  const accountA = deferred<{ user: SessionUser }>();
  mockSession
    .mockReturnValueOnce(accountA.promise)
    .mockResolvedValueOnce({ user: userB });
  const view = render(<SessionProvider><SessionObserver /></SessionProvider>);

  let staleRefresh!: Promise<void>;
  act(() => { staleRefresh = observedSession!.refresh(); });
  expect(mockSession).toHaveBeenCalledTimes(1);

  mockAuthState.current = { ...mockAuthState.current, subject: 'account-b' };
  view.rerender(<SessionProvider><SessionObserver /></SessionProvider>);
  await act(async () => { await observedSession!.refresh(); });
  expect(observedSession!.user?.id).toBe(userB.id);

  accountA.resolve({ user: userA });
  await act(async () => { await staleRefresh; });
  expect(observedSession!.user?.id).toBe(userB.id);
});

it('masks account A and rejects its response immediately after an account B render', async () => {
  const accountA = deferred<{ user: SessionUser }>();
  mockSession
    .mockResolvedValueOnce({ user: userA })
    .mockReturnValueOnce(accountA.promise)
    .mockResolvedValueOnce({ user: userB });
  const view = render(<SessionProvider><SessionObserver /></SessionProvider>);

  await act(async () => { await observedSession!.refresh(); });
  expect(observedSession!.user?.id).toBe(userA.id);

  let staleRefresh!: Promise<void>;
  act(() => { staleRefresh = observedSession!.refresh(); });
  mockAuthState.current = { ...mockAuthState.current, subject: 'account-b' };
  view.rerender(<SessionProvider><SessionObserver /></SessionProvider>);
  expect(observedSession!.user).toBeNull();

  accountA.resolve({ user: userA });
  await act(async () => { await staleRefresh; });
  expect(observedSession!.user).toBeNull();

  await act(async () => { await observedSession!.refresh(); });
  expect(observedSession!.user?.id).toBe(userB.id);
});

it('ignores an in-flight refresh after sign-out', async () => {
  const accountA = deferred<{ user: SessionUser }>();
  mockSession.mockReturnValueOnce(accountA.promise);
  const view = render(<SessionProvider><SessionObserver /></SessionProvider>);

  let staleRefresh!: Promise<void>;
  act(() => { staleRefresh = observedSession!.refresh(); });
  mockAuthState.current = { ...mockAuthState.current, signedIn: false, subject: null };
  view.rerender(<SessionProvider><SessionObserver /></SessionProvider>);
  await act(async () => { await observedSession!.refresh(); });

  accountA.resolve({ user: userA });
  await act(async () => { await staleRefresh; });
  expect(observedSession!.user).toBeNull();
});

it('does not clear account A data when account B has an invalid cache entry', async () => {
  mockSession.mockResolvedValueOnce({ user: userA });
  const view = render(<SessionProvider><SessionObserver /></SessionProvider>);
  await act(async () => { await observedSession!.refresh(); });
  await saveConversationDraft(userA.id, 'channel', 3, 'Account A draft');

  await AsyncStorage.setItem('csg.session.user.account-b', '{"id":8}');
  mockAuthState.current = { ...mockAuthState.current, subject: 'account-b' };
  mockSession.mockRejectedValueOnce(new ApiError('No access', 403, 'account_not_authorized'));
  view.rerender(<SessionProvider><SessionObserver /></SessionProvider>);
  await act(async () => { await observedSession!.refresh(); });

  expect(observedSession!.accessDenied).toBe(true);
  expect(await loadConversationDraft(userA.id, 'channel', 3)).toBe('Account A draft');
  await act(async () => { await observedSession!.signOut(); });
  expect(await loadConversationDraft(userA.id, 'channel', 3)).toBe('Account A draft');
});

it('does not clear account A when sign-out happens before account B refreshes', async () => {
  mockSession.mockResolvedValueOnce({ user: userA });
  const view = render(<SessionProvider><SessionObserver /></SessionProvider>);
  await act(async () => { await observedSession!.refresh(); });
  await saveConversationDraft(userA.id, 'channel', 3, 'Keep account A draft');

  mockAuthState.current = { ...mockAuthState.current, subject: 'account-b' };
  view.rerender(<SessionProvider><SessionObserver /></SessionProvider>);
  await act(async () => { await observedSession!.signOut(); });

  expect(await loadConversationDraft(userA.id, 'channel', 3)).toBe('Keep account A draft');
});

it('keeps a valid server session when writing its cache fails', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('Storage unavailable'));
  mockSession.mockResolvedValueOnce({ user: userA });
  render(<SessionProvider><SessionObserver /></SessionProvider>);

  await act(async () => { await observedSession!.refresh(); });

  expect(observedSession!.user?.id).toBe(userA.id);
  expect(observedSession!.accessDenied).toBe(false);
});

it('restores a matching cached session with an explicitly null community policy', async () => {
  const cachedUser: SessionUser = { ...userA, community_policy: null };
  await AsyncStorage.setItem('csg.session.user.account-a', JSON.stringify(cachedUser));
  mockSession.mockRejectedValueOnce(new ApiError('Offline'));
  render(<SessionProvider><SessionObserver /></SessionProvider>);

  await act(async () => { await observedSession!.refresh(); });

  expect(observedSession!.user).toEqual(cachedUser);
});

it('rejects an offline cache entry that belongs to another Clerk subject', async () => {
  await AsyncStorage.setItem('csg.session.user.account-a', JSON.stringify(userB));
  mockSession.mockRejectedValueOnce(new ApiError('Offline'));
  render(<SessionProvider><SessionObserver /></SessionProvider>);

  await act(async () => { await observedSession!.refresh(); });

  expect(observedSession!.user).toBeNull();
  expect(await AsyncStorage.getItem('csg.session.user.account-a')).toBeNull();
});

it('clears active account data on access denial even when its session cache is missing', async () => {
  mockSession.mockResolvedValueOnce({ user: userA });
  render(<SessionProvider><SessionObserver /></SessionProvider>);
  await act(async () => { await observedSession!.refresh(); });
  await saveConversationDraft(userA.id, 'channel', 3, 'Remove denied account draft');
  await AsyncStorage.removeItem('csg.session.user.account-a');
  mockSession.mockRejectedValueOnce(new ApiError('No access', 403, 'account_not_authorized'));

  await act(async () => { await observedSession!.refresh(); });

  expect(observedSession!.accessDenied).toBe(true);
  expect(await loadConversationDraft(userA.id, 'channel', 3)).toBe('');
});

it('reactivates authored storage after access returns for the same subject', async () => {
  mockSession.mockResolvedValueOnce({ user: userA });
  render(<SessionProvider><SessionObserver /></SessionProvider>);
  await act(async () => { await observedSession!.refresh(); });
  mockSession.mockRejectedValueOnce(new ApiError('No access', 403, 'account_not_authorized'));
  await act(async () => { await observedSession!.refresh(); });
  expect(observedSession!.accessDenied).toBe(true);

  mockSession.mockResolvedValueOnce({ user: userA });
  await act(async () => { await observedSession!.refresh(); });
  await saveConversationDraft(userA.id, 'channel', 3, 'Recovered account draft');

  expect(observedSession!.accessDenied).toBe(false);
  expect(await loadConversationDraft(userA.id, 'channel', 3)).toBe('Recovered account draft');
});

it('does not clear another account from a wrong-subject cache during sign-out', async () => {
  await saveConversationDraft(userB.id, 'channel', 3, 'Keep account B draft');
  await AsyncStorage.setItem('csg.session.user.account-a', JSON.stringify(userB));
  render(<SessionProvider><SessionObserver /></SessionProvider>);

  await act(async () => { await observedSession!.signOut(); });

  expect(await loadConversationDraft(userB.id, 'channel', 3)).toBe('Keep account B draft');
});

it('signs out of Clerk when local storage cleanup fails', async () => {
  const signOut = jest.fn().mockResolvedValue(undefined);
  mockAuthState.current = { ...mockAuthState.current, signOut };
  jest.spyOn(AsyncStorage, 'multiRemove').mockRejectedValueOnce(new Error('Storage unavailable'));
  render(<SessionProvider><SessionObserver /></SessionProvider>);

  await act(async () => { await observedSession!.signOut(); });

  expect(signOut).toHaveBeenCalledTimes(1);
});

it('does not clear account B when stale account A cache removal finishes later', async () => {
  await AsyncStorage.setItem('csg.session.user.account-a', '{"id":7}');
  let releaseRemoval = () => {};
  let markRemovalStarted = () => {};
  const removalGate = new Promise<void>((resolve) => { releaseRemoval = resolve; });
  const removalStarted = new Promise<void>((resolve) => { markRemovalStarted = resolve; });
  jest.spyOn(AsyncStorage, 'removeItem').mockImplementationOnce(async () => {
    markRemovalStarted();
    await removalGate;
  });
  mockSession.mockRejectedValueOnce(new ApiError('Offline')).mockResolvedValueOnce({ user: userB });
  const view = render(<SessionProvider><SessionObserver /></SessionProvider>);

  let staleRefresh!: Promise<void>;
  act(() => { staleRefresh = observedSession!.refresh(); });
  await removalStarted;

  mockAuthState.current = { ...mockAuthState.current, subject: 'account-b' };
  view.rerender(<SessionProvider><SessionObserver /></SessionProvider>);
  await act(async () => { await observedSession!.refresh(); });
  expect(observedSession!.user?.id).toBe(userB.id);

  releaseRemoval();
  await act(async () => { await staleRefresh; });
  expect(observedSession!.user?.id).toBe(userB.id);
});
