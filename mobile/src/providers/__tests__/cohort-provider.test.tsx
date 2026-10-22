import type { SessionEnrollment } from '@/lib/types';
import { ApiError } from '@/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, Text, View } from 'react-native';
import { useEffect } from 'react';
import { CohortProvider, selectedCohortStorageKey, useCohort } from '../cohort-provider';

let mockParams: Record<string, string> = {};
let mockPath = '/';
let mockNetworkListener: (state: { isConnected: boolean; isInternetReachable: boolean }) => void;
jest.mock('expo-network', () => ({ addNetworkStateListener: jest.fn(listener => { mockNetworkListener = listener; return { remove: jest.fn() }; }) }));
const mockApi = { accessibleCohorts: jest.fn(), setCohortContextReadOnly: jest.fn() };
let mockEnrollments: SessionEnrollment[] = [];
const mockUser = { id: 9, is_admin: false, is_staff: false };
jest.mock('expo-router', () => ({ useGlobalSearchParams: () => mockParams, usePathname: () => mockPath }));
jest.mock('../auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('../session-provider', () => ({ useSession: () => ({ api: mockApi, user: mockUser.id ? mockUser : null, enrollments: mockEnrollments }) }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
function Surface() {
  const { selectedCohort, stale } = useCohort();
  return <Text testID="selection">{`${selectedCohort?.name ?? 'Loading'}${stale ? ' (saved)' : ''}`}</Text>;
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

it('restores the last user-scoped cohort on an offline cold start', async () => {
  mockParams = {}; mockPath = '/learn';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockEnrollments = [{ id: 12, cohort: { id: 2, name: 'Saved cohort', status: 'active', cohort_type: 'bootcamp', start_date: '2026-01-01' }, status: 'active', enrolled_at: null }];
  mockApi.accessibleCohorts.mockRejectedValue(new ApiError('Could not reach Code School'));
  const screen = render(<CohortProvider><Surface /></CohortProvider>);
  await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Saved cohort (saved)'));
  screen.unmount();
});

function RefreshSurface() {
  const { refresh } = useCohort();
  return <View><Surface /><Text onPress={() => void refresh()}>Refresh cohorts</Text></View>;
}
const savedEnrollment: SessionEnrollment = { id: 12, cohort: { id: 2, name: 'Saved cohort', status: 'active', cohort_type: 'bootcamp', start_date: '2026-01-01' }, status: 'active', enrolled_at: null };

it('revalidates and removes a revoked cached selection on reconnect', async () => {
  mockParams = {}; mockPath = '/learn';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockEnrollments = [savedEnrollment];
  mockApi.accessibleCohorts.mockRejectedValueOnce(new ApiError('Offline')).mockResolvedValue({ cohorts: [] });
  const screen = render(<CohortProvider><RefreshSurface /></CohortProvider>);
  await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Saved cohort (saved)'));
  expect(mockApi.setCohortContextReadOnly).toHaveBeenLastCalledWith(true);
  await act(async () => mockNetworkListener({ isConnected: true, isInternetReachable: true }));
  await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Loading'));
  expect(mockApi.setCohortContextReadOnly).toHaveBeenLastCalledWith(false);
  screen.unmount();
});

it('does not restore a cache after access denial or borrow another account cache', async () => {
  mockParams = {}; mockPath = '/learn';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockEnrollments = [savedEnrollment];
  mockApi.accessibleCohorts.mockRejectedValue(new ApiError('Forbidden', 403));
  const screen = render(<CohortProvider><Surface /></CohortProvider>);
  await waitFor(() => expect(mockApi.setCohortContextReadOnly).toHaveBeenLastCalledWith(true));
  await act(async () => {});
  expect(screen.getByTestId('selection').props.children).toBe('Loading');
  expect(screen.queryByText(/Saved cohort · read-only/)).toBeNull();
  screen.unmount();
  mockUser.id = 10; mockEnrollments = [];
  mockApi.accessibleCohorts.mockRejectedValue(new ApiError('Offline'));
  const other = render(<CohortProvider><Surface /></CohortProvider>);
  await act(async () => {});
  expect(other.getByTestId('selection').props.children).toBe('Loading');
  other.unmount(); mockUser.id = 9;
});


it('hides the previous account selection immediately on switch and sign-out', async () => {
  mockParams = {}; mockPath = '/learn'; mockUser.id = 9; mockEnrollments = [];
  await AsyncStorage.clear();
  mockApi.accessibleCohorts.mockResolvedValue({ cohorts: [{ id: 2, name: 'Account A cohort', status: 'active' }] });
  const screen = render(<CohortProvider><Surface /></CohortProvider>);
  await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Account A cohort'));
  mockUser.id = 10;
  mockApi.accessibleCohorts.mockRejectedValue(new ApiError('Offline'));
  screen.rerender(<CohortProvider><Surface /></CohortProvider>);
  expect(screen.getByTestId('selection').props.children).toBe('Loading');
  await act(async () => {});
  mockUser.id = 0;
  screen.rerender(<CohortProvider><Surface /></CohortProvider>);
  expect(screen.getByTestId('selection').props.children).toBe('Loading');
  screen.unmount(); mockUser.id = 9;
});
