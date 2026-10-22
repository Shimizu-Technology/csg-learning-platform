import type { SessionEnrollment } from '@/lib/types';
import { ApiError } from '@/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Platform, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
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
beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

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
  mockEnrollments = [{ id: 12, cohort: { id: 2, name: 'Saved cohort', status: 'active', cohort_type: 'bootcamp', start_date: '2026-01-01' }, status: 'active', enrolled_at: null, access_expires_at: null }];
  mockApi.accessibleCohorts.mockRejectedValue(new ApiError('Could not reach Code School'));
  const screen = render(<CohortProvider><Surface /></CohortProvider>);
  await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Saved cohort (saved)'));
  screen.unmount();
});

function RefreshSurface() {
  const { refresh } = useCohort();
  return <View><Surface /><Text onPress={() => void refresh()}>Refresh cohorts</Text></View>;
}
const savedEnrollment: SessionEnrollment = { id: 12, cohort: { id: 2, name: 'Saved cohort', status: 'active', cohort_type: 'bootcamp', start_date: '2026-01-01' }, status: 'active', enrolled_at: null, access_expires_at: null };

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


it('excludes expired enrollment context during a transient outage', async () => {
  mockParams = {}; mockPath = '/learn';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockEnrollments = [{ ...savedEnrollment, access_expires_at: new Date(Date.now() - 1000).toISOString() }];
  mockApi.accessibleCohorts.mockRejectedValue(new ApiError('Offline'));
  const screen = render(<CohortProvider><Surface /></CohortProvider>);
  await screen.findByText(/Offline — changes paused/);
  expect(screen.getByTestId('selection').props.children).toBe('Loading');
  screen.unmount();
});

it.each([
  { admin: true, stored: 'all', reconnect: true },
  { admin: false, stored: null, reconnect: true },
  { admin: false, stored: null, reconnect: false },
])('revalidates unresolved startup without saved learner context: %j', async ({ admin, stored, reconnect }) => {
  mockParams = {}; mockPath = '/'; mockUser.is_admin = admin; mockUser.is_staff = true;
  mockEnrollments = [];
  await AsyncStorage.clear();
  if (stored) await AsyncStorage.setItem(selectedCohortStorageKey(9), stored);
  const foreground = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  mockApi.accessibleCohorts.mockRejectedValueOnce(new ApiError('Offline')).mockResolvedValue({ cohorts: [] });
  const screen = render(<CohortProvider><Surface /></CohortProvider>);
  try {
    await screen.findByText(/Offline — changes paused/);
    expect(mockApi.setCohortContextReadOnly).toHaveBeenLastCalledWith(true);
    expect(screen.UNSAFE_getAllByType(View).some(view => view.props.pointerEvents === 'none')).toBe(true);
    await act(async () => {
      if (reconnect) mockNetworkListener({ isConnected: true, isInternetReachable: true });
      else foreground.mock.calls[foreground.mock.calls.length - 1][1]('active');
    });
    await waitFor(() => expect(mockApi.setCohortContextReadOnly).toHaveBeenLastCalledWith(false));
    expect(screen.queryByText(/Offline — changes paused/)).toBeNull();
    if (admin) expect(await AsyncStorage.getItem(selectedCohortStorageKey(9))).toBe('all');
  } finally {
    screen.unmount(); foreground.mockRestore(); mockUser.is_admin = false; mockUser.is_staff = false;
  }
});


it('removes saved context when its access deadline passes while offline', async () => {
  mockParams = {}; mockPath = '/learn';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockEnrollments = [{ ...savedEnrollment, access_expires_at: new Date(Date.now() + 1000).toISOString() }];
  mockApi.accessibleCohorts.mockRejectedValue(new ApiError('Offline'));
  const screen = render(<CohortProvider><Surface /></CohortProvider>);
  try {
    await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Saved cohort (saved)'));
    await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Loading'), { timeout: 3000 });
    expect(mockApi.setCohortContextReadOnly).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Offline — changes paused/)).toBeTruthy();
  } finally { screen.unmount(); }
});

const otherEnrollment: SessionEnrollment = { ...savedEnrollment, id: 13, cohort: { ...savedEnrollment.cohort, id: 3, name: 'Other saved cohort' } };
function CohortChoices() {
  const { cohorts, selectCohort } = useCohort();
  return <View><Surface /><Text testID="cohort-ids">{cohorts.map(cohort => cohort.id).join(',')}</Text>
    <Text onPress={() => void selectCohort(3)}>Select other cohort</Text></View>;
}

it('expires every cached cohort even after the selected cohort expires first', async () => {
  jest.useFakeTimers();
  mockParams = {}; mockPath = '/learn';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockEnrollments = [
    { ...savedEnrollment, access_expires_at: new Date(Date.now() + 10_000).toISOString() },
    { ...otherEnrollment, access_expires_at: new Date(Date.now() + 20_000).toISOString() },
  ];
  mockApi.accessibleCohorts.mockReset().mockRejectedValueOnce(new ApiError('Offline')).mockReturnValue(new Promise(() => {}));
  const screen = render(<CohortProvider><CohortChoices /></CohortProvider>);
  try {
    await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Saved cohort (saved)'));
    expect(screen.getByTestId('cohort-ids').props.children).toBe('2,3');
    await act(async () => { jest.advanceTimersByTime(10_001); });
    expect(screen.getByTestId('selection').props.children).toBe('Loading');
    expect(screen.getByTestId('cohort-ids').props.children).toBe('3');
    fireEvent.press(screen.getByText('Select other cohort'));
    await act(async () => {});
    expect(screen.getByTestId('selection').props.children).toBe('Other saved cohort (saved)');
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(screen.getByTestId('cohort-ids').props.children).toBe('');
    expect(screen.getByTestId('selection').props.children).toBe('Loading');
  } finally { screen.unmount(); jest.useRealTimers(); }
});

function IndependentlyRenderedContext() {
  const [, renderAgain] = useState(0);
  return <View><Surface /><Text onPress={() => renderAgain(value => value + 1)}>Render context</Text></View>;
}

it.each([false, true])('checks access on a consumer render before a suspended timer (validated: %s)', async (validated) => {
  jest.useFakeTimers();
  mockParams = {}; mockPath = '/learn';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockEnrollments = [{ ...savedEnrollment, access_expires_at: new Date(Date.now() + 10_000).toISOString() }];
  mockApi.accessibleCohorts.mockReset().mockRejectedValue(new ApiError('Offline'));
  if (validated) mockApi.accessibleCohorts.mockResolvedValue({ cohorts: [savedEnrollment.cohort] });
  const screen = render(<CohortProvider><IndependentlyRenderedContext /></CohortProvider>);
  try {
    await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe(validated ? 'Saved cohort' : 'Saved cohort (saved)'));
    jest.setSystemTime(Date.now() + 10_001);
    fireEvent.press(screen.getByText('Render context'));
    expect(screen.getByTestId('selection').props.children).toBe('Loading');
  } finally { screen.unmount(); jest.useRealTimers(); }
});

it.each([false, true])('applies pending reconnect validation after a selection change (selection revoked: %s)', async (revoked) => {
  mockParams = {}; mockPath = '/learn';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockEnrollments = [savedEnrollment, otherEnrollment];
  const fresh = [savedEnrollment.cohort, ...(revoked ? [] : [otherEnrollment.cohort])];
  let resolve!: (value: { cohorts: typeof fresh }) => void;
  const validation = new Promise<{ cohorts: typeof fresh }>(done => { resolve = done; });
  mockApi.accessibleCohorts.mockReset().mockRejectedValueOnce(new ApiError('Offline')).mockReturnValue(validation);
  const screen = render(<CohortProvider><CohortChoices /></CohortProvider>);
  try {
    await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Saved cohort (saved)'));
    await act(async () => { mockNetworkListener({ isConnected: true, isInternetReachable: true }); });
    fireEvent.press(screen.getByText('Select other cohort'));
    await act(async () => { mockNetworkListener({ isConnected: true, isInternetReachable: true }); });
    expect(mockApi.accessibleCohorts).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('selection').props.children).toBe('Other saved cohort (saved)');
    await act(async () => { resolve({ cohorts: fresh }); });
    expect(mockApi.setCohortContextReadOnly).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('selection').props.children).toBe(revoked ? 'Saved cohort' : 'Other saved cohort');
    expect(await AsyncStorage.getItem(selectedCohortStorageKey(9))).toBe(revoked ? '2' : '3');
    expect(screen.queryByText(/Offline — changes paused/)).toBeNull();
  } finally { screen.unmount(); }
});

it('retries failed validation with backoff and unblocks writes without another connectivity event', async () => {
  jest.useFakeTimers();
  mockParams = {}; mockPath = '/learn';
  mockEnrollments = [savedEnrollment];
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockApi.accessibleCohorts.mockReset()
    .mockRejectedValueOnce(new ApiError('Unavailable', 503))
    .mockRejectedValueOnce(new ApiError('Still unavailable', 503))
    .mockResolvedValue({ cohorts: [savedEnrollment.cohort] });
  const screen = render(<CohortProvider><Surface /></CohortProvider>);
  try {
    await screen.findByText(/Offline — changes paused/);
    expect(mockApi.accessibleCohorts).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockApi.accessibleCohorts).toHaveBeenCalledTimes(2);
    expect(mockApi.setCohortContextReadOnly).toHaveBeenLastCalledWith(true);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockApi.accessibleCohorts).toHaveBeenCalledTimes(2);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockApi.accessibleCohorts).toHaveBeenCalledTimes(3);
    expect(mockApi.setCohortContextReadOnly).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText(/Offline — changes paused/)).toBeNull();
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(mockApi.accessibleCohorts).toHaveBeenCalledTimes(3);
  } finally { screen.unmount(); jest.useRealTimers(); }
});


it.each([false, true])('enforces known learner deadlines after successful validation, leaving staff unaffected (staff: %s)', async (staff) => {
  jest.useFakeTimers();
  mockParams = {}; mockPath = '/learn'; mockUser.is_staff = staff;
  await AsyncStorage.clear();
  await AsyncStorage.setItem(selectedCohortStorageKey(9), '2');
  mockEnrollments = [savedEnrollment, otherEnrollment].map((enrollment, index) => ({
    ...enrollment, access_expires_at: new Date(Date.now() + (index + 1) * 10_000).toISOString(),
  }));
  mockApi.accessibleCohorts.mockReset().mockResolvedValue({ cohorts: mockEnrollments.map(item => item.cohort) });
  const screen = render(<CohortProvider><CohortChoices /></CohortProvider>);
  try {
    await waitFor(() => expect(screen.getByTestId('selection').props.children).toBe('Saved cohort'));
    expect(screen.getByTestId('cohort-ids').props.children).toBe('2,3');
    await act(async () => { jest.advanceTimersByTime(10_001); });
    expect(screen.getByTestId('cohort-ids').props.children).toBe(staff ? '2,3' : '3');
    fireEvent.press(screen.getByText('Select other cohort'));
    await act(async () => {});
    expect(screen.getByTestId('selection').props.children).toBe('Other saved cohort');
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(screen.getByTestId('cohort-ids').props.children).toBe(staff ? '2,3' : '');
    expect(mockApi.accessibleCohorts).toHaveBeenCalledTimes(1);
  } finally { screen.unmount(); mockUser.is_staff = false; jest.useRealTimers(); }
});
