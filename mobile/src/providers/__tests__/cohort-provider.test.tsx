import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, Text, View } from 'react-native';
import { useEffect } from 'react';
import { CohortProvider, selectedCohortStorageKey, useCohort } from '../cohort-provider';

let mockParams: Record<string, string> = {};
let mockPath = '/';
const mockApi = { accessibleCohorts: jest.fn() };
const mockUser = { id: 9, is_admin: false, is_staff: false };
jest.mock('expo-router', () => ({ useGlobalSearchParams: () => mockParams, usePathname: () => mockPath }));
jest.mock('../auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('../session-provider', () => ({ useSession: () => ({ api: mockApi, user: mockUser }) }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
function Surface() {
  const { selectedCohort } = useCohort();
  return <Text testID="selection">{selectedCohort?.name ?? 'Loading'}</Text>;
}
it('persists a contextual selection through Back and subsequent unscoped navigation with the real provider', async () => {
  mockParams = {}; mockPath = '/';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockApi.accessibleCohorts.mockResolvedValue({ cohorts: [{ id: 1, name: 'Cohort A', status: 'active' }, { id: 2, name: 'Cohort B', status: 'active' }] });
  const screen = render(<CohortProvider><Surface /></CohortProvider>);
  await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Cohort B'));
  mockParams = { cohort_id: '1' }; mockPath = '/lesson/42';
  screen.rerender(<CohortProvider><Surface /></CohortProvider>);
  await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Cohort A'));
  expect(screen.getByText('Switched to Cohort A')).toBeTruthy();
  expect(await AsyncStorage.getItem(selectedCohortStorageKey(9))).toBe('1');
  mockParams = {}; mockPath = '/';
  screen.rerender(<CohortProvider><Surface /></CohortProvider>);
  await act(async () => {});
  expect(screen.getByTestId('selection').props.children).toBe('Cohort A');
  mockPath = '/learn';
  screen.rerender(<CohortProvider><Surface /></CohortProvider>);
  expect(screen.getByTestId('selection').props.children).toBe('Cohort A');
  expect(await AsyncStorage.getItem(selectedCohortStorageKey(9))).toBe('1');
  screen.unmount();
});

// Updates clears its route parameter only after the provider synchronizes selection.
function UpdatesConsumer({ clearParam }: { clearParam: () => void }) {
  const { selectedCohortId } = useCohort();
  useEffect(() => {
    if (mockParams.cohort_id && selectedCohortId === Number(mockParams.cohort_id)) clearParam();
  }, [clearParam, selectedCohortId]);
  return <Surface />;
}

it('shows and announces an Updates link switch before clearing the route parameter', async () => {
  mockParams = {}; mockPath = '/updates';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockApi.accessibleCohorts.mockResolvedValue({ cohorts: [{ id: 1, name: 'Cohort A', status: 'active' }, { id: 2, name: 'Cohort B', status: 'active' }] });
  const originalOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  announce.mockClear();
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus');
  focus.mockClear();
  const clearParam = jest.fn(() => { mockParams = {}; });
  const screen = render(<CohortProvider><UpdatesConsumer clearParam={clearParam} /></CohortProvider>);
  try {
    await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Cohort B'));
    mockParams = { cohort_id: '1' };
    screen.rerender(<CohortProvider><UpdatesConsumer clearParam={clearParam} /></CohortProvider>);
    await waitFor(() => expect(clearParam).toHaveBeenCalledTimes(1));
    screen.rerender(<CohortProvider><UpdatesConsumer clearParam={clearParam} /></CohortProvider>);
    expect(screen.getByText('Switched to Cohort A')).toBeTruthy();
    expect(screen.getByTestId('selection').props.children).toBe('Cohort A');
    expect(await AsyncStorage.getItem(selectedCohortStorageKey(9))).toBe('1');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Switched to Cohort A', { queue: true });
    expect(focus).not.toHaveBeenCalled();
    expect(screen.UNSAFE_getAllByType(View).some((view) => view.props.pointerEvents === 'none')).toBe(true);
  } finally {
    screen.unmount();
    announce.mockRestore(); focus.mockRestore();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  }
});
