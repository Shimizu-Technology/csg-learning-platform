import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Stack, Tabs, useLocalSearchParams, useNavigationContainerRef } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import fixtures from '@/lib/fixtures/record-destination-contract.json';
import { applicationNavigator, notificationStack } from '@/lib/notification-navigation';
import { BackButton } from '../back-button';
jest.mock('@/components/ui/pressable-scale', () => ({ PressableScale: jest.requireActual('react-native').Pressable }));
jest.mock('lucide-react-native', () => ({ ArrowLeft: () => null }));
let path = '';
function Layout() {
  const navigation = useNavigationContainerRef();
  return <><Pressable accessibilityLabel="Tap notification" onPress={() => {
    const target = applicationNavigator(navigation.getRootState())?.routes[0].state?.key;
    navigation.dispatch({ type: 'RESET', target, payload: { ...applicationNavigator(navigation.getRootState())?.routes[0].state, ...notificationStack(path, applicationNavigator(navigation.getRootState())?.routes[0].state) } });
  }}><Text>Tap notification</Text></Pressable><Stack screenOptions={{ headerShown: false }} /></>;
}
function Home() { return <Text>Tab home</Text>; }
function TabLayout() { return <Tabs screenOptions={{ headerShown: false }}><Tabs.Screen name="index" options={{ title: 'Today' }} /><Tabs.Screen name="learn" options={{ title: 'Learn' }} /><Tabs.Screen name="messages" options={{ title: 'Messages' }} /><Tabs.Screen name="updates" options={{ title: 'Updates' }} /></Tabs>; }
function Target() { const params = useLocalSearchParams(); return <View><Text testID="target">{JSON.stringify(params)}</Text><BackButton /></View>; }
it.each(fixtures.filter(f => f.native))('keeps a tab bar reachable through Back for $native', async fixture => {
  path = fixture.native!;
  const result = renderRouter({ _layout: Layout, '(app)/_layout': () => <Stack screenOptions={{ headerShown: false }} />, '(app)/(tabs)/_layout': TabLayout, '(app)/(tabs)/index': Home, '(app)/(tabs)/learn': Home, '(app)/(tabs)/messages': Home, '(app)/(tabs)/updates': Target, '(app)/lesson/[id]': Target, '(app)/module/[id]': Target, '(app)/staff/submission/[id]': Target, '(app)/staff/support/[id]': Target, '(app)/staff/student/[id]': Target, '(app)/staff/intervention/[id]': Target, '(app)/conversation/[kind]/[id]': Target, '(app)/recording/[id]': Target, '(app)/meetings': Target, '(app)/cohort/[id]': Target }, { initialUrl: '/' });
  await act(async () => { fireEvent.press(screen.getByLabelText('Tap notification')); jest.runOnlyPendingTimers(); });
  await waitFor(() => expect(result.getPathname()).toBe(path.split('?')[0]));
  expect(result.getSearchParams()).toEqual(expect.objectContaining(Object.fromEntries(new URLSearchParams(path.split('?')[1]))));
  fireEvent.press(screen.getByRole('button', { name: /Back/ }));
  const parentTab = notificationStack(path).routes[0].state!.routes[notificationStack(path).routes[0].state!.index ?? 0].name;
  await waitFor(() => expect(result.getPathname()).toBe(parentTab === 'learn' ? '/learn' : parentTab === 'messages' ? '/messages' : '/'));
  expect(screen.getByText('Today')).toBeTruthy();
  expect(screen.getByText('Messages')).toBeTruthy();
});
