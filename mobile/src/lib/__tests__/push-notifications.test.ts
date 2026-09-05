import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CsgApi } from '../api';
import { registerPushNotifications } from '../push-notifications';

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
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExpoPushToken[test]' }),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationHandler: jest.fn(),
}));

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

describe('push registration cleanup', () => {
  it('does nothing when the session is already inactive', async () => {
    const api = {
      registerDevice: jest.fn().mockResolvedValue(undefined),
      unregisterDevice: jest.fn().mockResolvedValue(undefined),
    } as unknown as CsgApi;

    await expect(registerPushNotifications(api, () => false)).resolves.toBeNull();
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('csg.push.token')).toBeNull();
  });

  it('removes a locally persisted token if the session ends before registration', async () => {
    let activeChecks = 0;
    const api = {
      registerDevice: jest.fn().mockResolvedValue(undefined),
      unregisterDevice: jest.fn().mockResolvedValue(undefined),
    } as unknown as CsgApi;

    await expect(registerPushNotifications(api, () => ++activeChecks < 2)).resolves.toBeNull();
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('csg.push.token')).toBeNull();
  });

  it('does not register a token that cannot be persisted for later cleanup', async () => {
    const storageError = new Error('storage unavailable');
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(storageError);
    const api = {
      registerDevice: jest.fn().mockResolvedValue(undefined),
      unregisterDevice: jest.fn().mockResolvedValue(undefined),
    } as unknown as CsgApi;

    await expect(registerPushNotifications(api)).rejects.toBe(storageError);
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(api.unregisterDevice).not.toHaveBeenCalled();
  });

  it('retains the persisted token when device registration rejects', async () => {
    const registrationError = new Error('registration unavailable');
    const api = {
      registerDevice: jest.fn().mockRejectedValue(registrationError),
      unregisterDevice: jest.fn().mockResolvedValue(undefined),
    } as unknown as CsgApi;

    await expect(registerPushNotifications(api)).rejects.toBe(registrationError);
    expect(api.unregisterDevice).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('csg.push.token')).toBe('ExpoPushToken[test]');
  });

  it('retains the persisted token when an inactive session cannot unregister it', async () => {
    const unregisterError = new Error('unregister unavailable');
    let activeChecks = 0;
    const api = {
      registerDevice: jest.fn().mockResolvedValue(undefined),
      unregisterDevice: jest.fn().mockRejectedValue(unregisterError),
    } as unknown as CsgApi;

    await expect(registerPushNotifications(api, () => ++activeChecks < 3)).rejects.toBe(unregisterError);
    expect(api.registerDevice).toHaveBeenCalledTimes(1);
    expect(api.unregisterDevice).toHaveBeenCalledTimes(3);
    expect(await AsyncStorage.getItem('csg.push.token')).toBe('ExpoPushToken[test]');
  });

  it('removes the persisted token after an inactive session unregisters successfully', async () => {
    let activeChecks = 0;
    const api = {
      registerDevice: jest.fn().mockResolvedValue(undefined),
      unregisterDevice: jest.fn().mockResolvedValue(undefined),
    } as unknown as CsgApi;

    await expect(registerPushNotifications(api, () => ++activeChecks < 3)).resolves.toBeNull();
    expect(api.unregisterDevice).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('csg.push.token')).toBeNull();
  });
});
