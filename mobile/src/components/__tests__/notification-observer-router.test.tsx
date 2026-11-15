import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Redirect, Stack, Tabs, useLocalSearchParams } from 'expo-router';
import { createContext, useContext, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { NotificationObserver, HELD_NOTIFICATION_KEY } from '../notification-observer';
const mockGate = createContext({ signedIn: true, loading: false, accepted: true, id: 1 });
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ loaded: true, ...require('react').useContext(mockGate) }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => {
  const gate = require('react').useContext(mockGate);
  return { loading: gate.loading, accessDenied: false, user: gate.signedIn ? { id: gate.id, community_policy: { accepted: gate.accepted } } : null };
} }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockLast: unknown;
let mockReceive: (value: unknown) => void;
const mockClear = jest.fn(async () => { mockLast = null; });
jest.mock('expo-notifications', () => ({ getLastNotificationResponseAsync: async () => mockLast, clearLastNotificationResponseAsync: () => mockClear(), addNotificationResponseReceivedListener: (fn: typeof mockReceive) => { mockReceive = fn; return { remove: jest.fn() }; } }));
const tap = { notification: { request: { identifier: 'held', content: { data: { path: '/lesson/42' } } } } };
let initial = { signedIn: true, loading: false, accepted: true, id: 1 };
function Layout() {
  const [gate, setGate] = useState(initial);
  return <mockGate.Provider value={gate}><NotificationObserver /><Pressable accessibilityLabel="Finish gate" onPress={() => setGate({ ...gate, signedIn: true, loading: false, accepted: true })}><Text>Finish gate</Text></Pressable><Pressable accessibilityLabel="Other account" onPress={() => setGate({ ...gate, signedIn: true, id: 2 })}><Text>Other account</Text></Pressable><Stack screenOptions={{ headerShown: false }} /></mockGate.Provider>;
}
function AppLayout() {
  const gate = useContext(mockGate);
  if (!gate.signedIn) return <Redirect href="/sign-in" />;
  if (gate.loading || !gate.accepted) return <Text>Gate</Text>;
  return <Stack screenOptions={{ headerShown: false }} />;
}
function AuthLayout() {
  const gate = useContext(mockGate);
  if (gate.signedIn && !gate.loading) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
function Target() { return <Text>Lesson {useLocalSearchParams().id}</Text>; }
function mount() {
  return renderRouter({ _layout: Layout, '(app)/_layout': AppLayout, '(app)/(tabs)/_layout': () => <Tabs />, '(app)/(tabs)/index': () => <Text>Today home</Text>, '(app)/lesson/[id]': Target, '(auth)/_layout': AuthLayout, '(auth)/sign-in': () => <Text>Sign in</Text> }, { initialUrl: '/' });
}
beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); await AsyncStorage.setItem('csg.notification.last-user.v1', '1'); mockLast = null; });
it.each(['sign-in', 'session', 'policy'])('finishes %s, arrives, clears and does not replay on relaunch', async gate => {
  initial = { signedIn: gate !== 'sign-in', loading: gate === 'session', accepted: gate !== 'policy', id: 1 };
  mockLast = tap;
  const result = mount();
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Finish gate'));
  await waitFor(() => expect(result.getPathname()).toBe('/lesson/42'));
  await waitFor(() => expect(mockClear).toHaveBeenCalled());
  await waitFor(async () => expect(await AsyncStorage.getItem(HELD_NOTIFICATION_KEY)).toBeNull());
  result.unmount();
  initial = { signedIn: true, loading: false, accepted: true, id: 1 };
  const relaunched = mount();
  await act(async () => {});
  expect(relaunched.getPathname()).toBe('/');
});
it('does not carry a signed-out tap from A to B', async () => {
  initial = { signedIn: false, loading: false, accepted: true, id: 1 };
  const result = mount();
  await act(async () => mockReceive(tap));
  fireEvent.press(screen.getByLabelText('Other account'));
  await act(async () => {});
  expect(result.getPathname()).toBe('/');
  await waitFor(async () => expect(await AsyncStorage.getItem(HELD_NOTIFICATION_KEY)).toBeNull());
});
