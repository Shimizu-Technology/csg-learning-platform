import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { CsgApi } from './api';

export const PUSH_TOKEN_KEY = 'csg.push.token';
const PUSH_UNREGISTER_ATTEMPTS = 3;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

async function unregisterPushToken(api: CsgApi, token: string) {
  let finalError: unknown;
  for (let attempt = 0; attempt < PUSH_UNREGISTER_ATTEMPTS; attempt += 1) {
    try {
      await api.unregisterDevice(token);
      return;
    } catch (error) {
      finalError = error;
    }
  }
  throw finalError;
}

export async function registerPushNotifications(api: CsgApi, isActive: () => boolean = () => true) {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('messages', { name: 'Messages', importance: Notifications.AndroidImportance.HIGH });
  }
  let permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') permissions = await Notifications.requestPermissionsAsync();
  if (permissions.status !== 'granted') return null;
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const deviceId = Platform.OS === 'ios' ? await Application.getIosIdForVendorAsync() : Application.getAndroidId();
  if (!isActive()) return null;
  // Store the cleanup handle before the server can accept the registration.
  // A rejected request may still have committed remotely, so retain the token
  // until a confirmed unregister succeeds.
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  if (!isActive()) {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    return null;
  }
  await api.registerDevice(token, Platform.OS, deviceId, Application.nativeApplicationVersion);
  if (!isActive()) {
    await unregisterPushToken(api, token);
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    return null;
  }
  return token;
}
