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
  it('retries and surfaces unregister failures when the token cannot be persisted', async () => {
    const storageError = new Error('storage unavailable');
    const unregisterError = new Error('unregister unavailable');
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(storageError);
    const api = {
      registerDevice: jest.fn().mockResolvedValue(undefined),
      unregisterDevice: jest.fn().mockRejectedValue(unregisterError),
    } as unknown as CsgApi;

    await expect(registerPushNotifications(api)).rejects.toBe(unregisterError);
    expect(api.unregisterDevice).toHaveBeenCalledTimes(3);
  });

  it('returns the storage failure after successfully undoing server registration', async () => {
    const storageError = new Error('storage unavailable');
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(storageError);
    const api = {
      registerDevice: jest.fn().mockResolvedValue(undefined),
      unregisterDevice: jest.fn().mockResolvedValue(undefined),
    } as unknown as CsgApi;

    await expect(registerPushNotifications(api)).rejects.toBe(storageError);
    expect(api.unregisterDevice).toHaveBeenCalledTimes(1);
  });
});
