import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import type { CsgApi } from '../api';
import { getPushPermissionStatus, registerPushNotifications, requestPushPermission } from '../push-notifications';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-application', () => ({
  getIosIdForVendorAsync: jest.fn().mockResolvedValue('ios-device'),
  getAndroidId: jest.fn().mockReturnValue('android-device'),
  nativeApplicationVersion: '1.0.0',
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'project-id' } } } },
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExpoPushToken[test]' }),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationHandler: jest.fn(),
}));

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted' } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ status: 'granted' } as Awaited<ReturnType<typeof Notifications.requestPermissionsAsync>>);
  await AsyncStorage.clear();
});

function enabledApi(overrides: Partial<CsgApi> = {}) {
  return {
    mobilePushConfig: jest.fn().mockResolvedValue({ notifications_enabled: true, active_device_count: 0 }),
    registerDevice: jest.fn().mockResolvedValue(undefined),
    unregisterDevice: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as CsgApi;
}

describe('push permission intent', () => {
  it('preserves provisional iOS authorization as a deliverable state', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ status: 'denied', ios: { status: Notifications.IosAuthorizationStatus.PROVISIONAL } } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);

    await expect(getPushPermissionStatus()).resolves.toBe('provisional');
  });

  it('does not prompt again for provisional iOS authorization', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ status: 'denied', ios: { status: Notifications.IosAuthorizationStatus.PROVISIONAL } } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);

    await expect(requestPushPermission()).resolves.toBe('provisional');

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('never asks for OS permission during silent registration', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ status: 'undetermined' } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
    const api = enabledApi();

    await expect(registerPushNotifications(api)).resolves.toBeNull();

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('does not inspect OS permissions when the account preference is off', async () => {
    const api = enabledApi({ mobilePushConfig: jest.fn().mockResolvedValue({ notifications_enabled: false, active_device_count: 1 }) } as Partial<CsgApi>);

    await expect(registerPushNotifications(api)).resolves.toBeNull();

    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests permission only through the explicit permission action', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ status: 'undetermined' } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({ status: 'granted' } as Awaited<ReturnType<typeof Notifications.requestPermissionsAsync>>);

    await expect(requestPushPermission()).resolves.toBe('granted');

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

describe('push registration cleanup', () => {
  it('does nothing when the session is already inactive', async () => {
    const api = enabledApi();

    await expect(registerPushNotifications(api, () => false)).resolves.toBeNull();
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('csg.push.token')).toBeNull();
  });

  it('removes a locally persisted token if the session ends before registration', async () => {
    let activeChecks = 0;
    const api = enabledApi();

    await expect(registerPushNotifications(api, () => ++activeChecks < 2)).resolves.toBeNull();
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('csg.push.token')).toBeNull();
  });

  it('does not register a token that cannot be persisted for later cleanup', async () => {
    const storageError = new Error('storage unavailable');
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(storageError);
    const api = enabledApi();

    await expect(registerPushNotifications(api)).rejects.toBe(storageError);
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(api.unregisterDevice).not.toHaveBeenCalled();
  });

  it('retains the persisted token when device registration rejects', async () => {
    const registrationError = new Error('registration unavailable');
    const api = enabledApi({ registerDevice: jest.fn().mockRejectedValue(registrationError) } as Partial<CsgApi>);

    await expect(registerPushNotifications(api)).rejects.toBe(registrationError);
    expect(api.unregisterDevice).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('csg.push.token')).toBe('ExpoPushToken[test]');
  });

  it('retains the persisted token when an inactive session cannot unregister it', async () => {
    const unregisterError = new Error('unregister unavailable');
    let activeChecks = 0;
    const api = enabledApi({ unregisterDevice: jest.fn().mockRejectedValue(unregisterError) } as Partial<CsgApi>);

    await expect(registerPushNotifications(api, () => ++activeChecks < 4)).rejects.toBe(unregisterError);
    expect(api.registerDevice).toHaveBeenCalledTimes(1);
    expect(api.unregisterDevice).toHaveBeenCalledTimes(3);
    expect(await AsyncStorage.getItem('csg.push.token')).toBe('ExpoPushToken[test]');
  });

  it('removes the persisted token after an inactive session unregisters successfully', async () => {
    let activeChecks = 0;
    const api = enabledApi();

    await expect(registerPushNotifications(api, () => ++activeChecks < 4)).resolves.toBeNull();
    expect(api.unregisterDevice).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('csg.push.token')).toBeNull();
  });
});
