import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Alert, AppState, Platform, Text, TextInput, type AppStateStatus } from 'react-native';

import { OTA_CHECK_INTERVAL_MS, useOtaUpdates } from '../use-ota-updates';
import { OtaUpdateNotice } from '@/components/ota-update-notice';
import { loadSubmissionDraft, saveSubmissionDraft } from '@/lib/submission-storage';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-updates', () => ({ isEnabled: true, checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient', Standalone: 'standalone' } }));

const check = jest.mocked(Updates.checkForUpdateAsync);
const fetchUpdate = jest.mocked(Updates.fetchUpdateAsync);
const noUpdate = { isAvailable: false, isRollBackToEmbedded: false } as Updates.UpdateCheckResult;
const available = { isAvailable: true, isRollBackToEmbedded: false } as Updates.UpdateCheckResult;
const downloaded = { isNew: true, isRollBackToEmbedded: false } as Updates.UpdateFetchResult;
let now: number;
let change: (state: AppStateStatus) => void;
let remove: jest.Mock;
const originalCurrentState = AppState.currentState;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(globalThis, '__DEV__', { value: false, writable: true, configurable: true });
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  AppState.currentState = 'active';
  jest.replaceProperty(Constants, 'executionEnvironment', ExecutionEnvironment.Standalone);
  jest.replaceProperty(Updates, 'isEnabled', true);
  remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    change = listener;
    return { remove };
  });
  check.mockResolvedValue(noUpdate);
  fetchUpdate.mockResolvedValue(downloaded);
});

afterEach(() => {
  jest.restoreAllMocks();
  AppState.currentState = originalCurrentState;
  Object.defineProperty(globalThis, '__DEV__', { value: true, writable: true, configurable: true });
});

async function foreground() {
  await act(async () => { change('background'); change('active'); });
}

it('checks on launch, then throttles foreground returns for 30 minutes', async () => {
  renderHook(useOtaUpdates);
  await act(async () => {});
  expect(check).toHaveBeenCalledTimes(1);
  now += OTA_CHECK_INTERVAL_MS - 1;
  await foreground();
  expect(check).toHaveBeenCalledTimes(1);
  now += 1;
  await foreground();
  expect(check).toHaveBeenCalledTimes(2);
  expect(fetchUpdate).not.toHaveBeenCalled();
});

it('only checks on actual foreground transitions and waits if launched in the background', async () => {
  AppState.currentState = 'background';
  renderHook(useOtaUpdates);
  expect(check).not.toHaveBeenCalled();
  await act(async () => { change('active'); });
  now += OTA_CHECK_INTERVAL_MS;
  await act(async () => { change('active'); });
  expect(check).toHaveBeenCalledTimes(1);
});

it.each(['development', 'Expo Go', 'disabled', 'web'])('does nothing in %s', async environment => {
  if (environment === 'development') Object.defineProperty(globalThis, '__DEV__', { value: true });
  if (environment === 'Expo Go') jest.replaceProperty(Constants, 'executionEnvironment', ExecutionEnvironment.StoreClient);
  if (environment === 'disabled') jest.replaceProperty(Updates, 'isEnabled', false);
  if (environment === 'web') jest.replaceProperty(Platform, 'OS', 'web');
  const { result } = renderHook(useOtaUpdates);
  await act(async () => {});
  expect(result.current).toBe(false);
  expect(check).not.toHaveBeenCalled();
  expect(fetchUpdate).not.toHaveBeenCalled();
  expect(AppState.addEventListener).not.toHaveBeenCalled();
});

it('never overlaps checks even when another foreground return is past the throttle', async () => {
  let finish!: (value: Updates.UpdateCheckResult) => void;
  check.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  renderHook(useOtaUpdates);
  now += OTA_CHECK_INTERVAL_MS;
  await foreground();
  expect(check).toHaveBeenCalledTimes(1);
  await act(async () => finish(noUpdate));
  await foreground();
  expect(check).toHaveBeenCalledTimes(2);
});

it('downloads without reloading, including when completion happens in the background', async () => {
  let finish!: (value: Updates.UpdateFetchResult) => void;
  check.mockResolvedValue(available);
  fetchUpdate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(useOtaUpdates);
  await act(async () => {});
  expect(result.current).toBe(false);
  await act(async () => { change('background'); finish(downloaded); });
  expect(result.current).toBe(true);
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
  await foreground();
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
});

it('fetches rollback-to-embedded directives even though isAvailable is false', async () => {
  check.mockResolvedValue({ isAvailable: false, isRollBackToEmbedded: true, manifest: undefined, reason: undefined });
  fetchUpdate.mockResolvedValue({ isNew: false, isRollBackToEmbedded: true, manifest: undefined });
  const { result } = renderHook(useOtaUpdates);
  await act(async () => {});
  expect(fetchUpdate).toHaveBeenCalledTimes(1);
  expect(result.current).toBe(true);
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
});

it.each(['check', 'download'])('logs a failed %s silently and throttles retries', async step => {
  const error = new Error('offline');
  const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const alert = jest.spyOn(Alert, 'alert');
  if (step === 'check') check.mockRejectedValueOnce(error);
  else { check.mockResolvedValue(available); fetchUpdate.mockRejectedValueOnce(error); }
  const { result } = renderHook(useOtaUpdates);
  await act(async () => {});
  expect(result.current).toBe(false);
  expect(log).toHaveBeenCalledWith('[OTA] Update check/download failed', error);
  expect(alert).not.toHaveBeenCalled();
  await foreground();
  expect(check).toHaveBeenCalledTimes(1);
  now += OTA_CHECK_INTERVAL_MS;
  await foreground();
  expect(check).toHaveBeenCalledTimes(2);
});

it('does not announce a fetch that returned no new update', async () => {
  check.mockResolvedValue(available);
  fetchUpdate.mockResolvedValue({ isNew: false, isRollBackToEmbedded: false, manifest: undefined });
  const { result } = renderHook(useOtaUpdates);
  await act(async () => {});
  expect(result.current).toBe(false);
});

it('removes its listener on unmount while an update is pending', async () => {
  let finish!: (value: Updates.UpdateFetchResult) => void;
  check.mockResolvedValue(available);
  fetchUpdate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { unmount } = renderHook(useOtaUpdates);
  await act(async () => {});
  unmount();
  await act(async () => finish(downloaded));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
});

it('offers a dismissible restart notice without interrupting a draft or pending submission', async () => {
  await AsyncStorage.clear();
  let finishUpdate!: (value: Updates.UpdateFetchResult) => void;
  let finishSubmission!: () => void;
  const submission = new Promise<void>(resolve => { finishSubmission = resolve; });
  check.mockResolvedValue(available);
  fetchUpdate.mockReturnValue(new Promise(resolve => { finishUpdate = resolve; }));

  // An adjacent task stays mounted throughout the real hook/notice lifecycle.
  function Task() {
    const [draft, setDraft] = useState('');
    const [submitted, setSubmitted] = useState(false);
    return <>
      <OtaUpdateNotice />
      <TextInput accessibilityLabel="Draft" value={draft} onChangeText={value => { setDraft(value); void saveSubmissionDraft(42, 17, value, null, null, 3); }} />
      <Text onPress={() => void submission.then(() => setSubmitted(true))}>Submit</Text>
      <Text>{submitted ? 'Submitted' : 'Not submitted'}</Text>
    </>;
  }
  const ui = render(<Task />);
  await act(async () => {});
  expect(ui.queryByText('Update ready — restart')).toBeNull();
  await act(async () => fireEvent.changeText(ui.getByLabelText('Draft'), 'My unfinished answer'));
  fireEvent.press(ui.getByText('Submit'));
  await act(async () => finishUpdate(downloaded));
  expect(ui.getByText('Update ready — restart')).toBeTruthy();
  expect(ui.getByText(/Finish any message or submission/)).toBeTruthy();
  expect(ui.getByText('Not submitted')).toBeTruthy();
  fireEvent.press(ui.getByRole('button', { name: 'Later' }));
  expect(ui.queryByText('Update ready — restart')).toBeNull();
  expect(ui.getByLabelText('Draft').props.value).toBe('My unfinished answer');
  expect((await loadSubmissionDraft(42, 17, 3))?.text).toBe('My unfinished answer');
  await foreground();
  expect(ui.queryByText('Update ready — restart')).toBeNull();
  await act(async () => finishSubmission());
  expect(ui.getByText('Submitted')).toBeTruthy();
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
  await AsyncStorage.clear();
});
