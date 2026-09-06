import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { CsgApi } from './api';

export const PUSH_TOKEN_KEY = 'csg.push.token';
const PUSH_UNREGISTER_ATTEMPTS = 3;

export type PushPermissionStatus = 'granted' | 'provisional' | 'ephemeral' | 'denied' | 'undetermined';
export type PushRegistrationAttempt = { ok: true } | { ok: false; message: string };

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
      if (attempt < PUSH_UNREGISTER_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
      }
    }
  }
  throw finalError;
}

async function configureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  await Promise.all([
    Notifications.setNotificationChannelAsync('messages', { name: 'Messages', importance: Notifications.AndroidImportance.HIGH }),
    Notifications.setNotificationChannelAsync('learning', { name: 'Learning updates', importance: Notifications.AndroidImportance.HIGH }),
    Notifications.setNotificationChannelAsync('announcements', { name: 'Announcements', importance: Notifications.AndroidImportance.HIGH }),
  ]);
}

export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (!Device.isDevice) return 'denied';
  const permissions = await Notifications.getPermissionsAsync();
  return pushPermissionStatus(permissions);
}

export async function requestPushPermission(): Promise<PushPermissionStatus> {
  if (!Device.isDevice) return 'denied';
  await configureAndroidChannels();
  const existing = await Notifications.getPermissionsAsync();
  const existingStatus = pushPermissionStatus(existing);
  if (pushPermissionAllowsDelivery(existingStatus)) return existingStatus;
  const requested = await Notifications.requestPermissionsAsync();
  return pushPermissionStatus(requested);
}

export function pushPermissionAllowsDelivery(status: PushPermissionStatus) {
  return status === 'granted' || status === 'provisional' || status === 'ephemeral';
}

function pushPermissionStatus(permissions: Notifications.NotificationPermissionsStatus): PushPermissionStatus {
  if (Platform.OS !== 'ios' || !permissions.ios) return permissions.status;
  switch (permissions.ios.status) {
    case Notifications.IosAuthorizationStatus.AUTHORIZED: return 'granted';
    case Notifications.IosAuthorizationStatus.PROVISIONAL: return 'provisional';
    case Notifications.IosAuthorizationStatus.EPHEMERAL: return 'ephemeral';
    case Notifications.IosAuthorizationStatus.DENIED: return 'denied';
    default: return 'undetermined';
  }
}

export async function registerPushNotifications(api: CsgApi, isActive: () => boolean = () => true) {
  if (!Device.isDevice) return null;
  const config = await api.mobilePushConfig();
  if (!isActive() || !config.notifications_enabled) return null;
  await configureAndroidChannels();
  const permission = pushPermissionStatus(await Notifications.getPermissionsAsync());
  if (!pushPermissionAllowsDelivery(permission)) return null;
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

export async function attemptPushRegistration(api: CsgApi): Promise<PushRegistrationAttempt> {
  try {
    const token = await registerPushNotifications(api);
    return token
      ? { ok: true }
      : { ok: false, message: 'This device could not finish notification registration. Check your connection and try again.' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.message
        ? error.message
        : 'This device could not finish notification registration. Check your connection and try again.',
    };
  }
}
