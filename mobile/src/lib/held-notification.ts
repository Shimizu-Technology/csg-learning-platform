import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

export const HELD_NOTIFICATION_KEY = 'csg.notification.destination.v1';
export const LAST_NOTIFICATION_USER_KEY = 'csg.notification.last-user.v1';
let writes: Promise<unknown> = Promise.resolve();
let generation = 0;
const listeners = new Set<() => void>();
export function notificationGeneration() { return generation; }
export function onNotificationSignOut(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function queueNotificationStorage(operation: () => Promise<unknown>) {
  writes = writes.catch(() => undefined).then(operation).catch(() => undefined);
  return writes;
}
/** Invalidate async reads and in-memory taps before waiting for disk or auth. */
export async function clearHeldNotifications() {
  generation += 1;
  for (const listener of listeners) listener();
  await Promise.all([
    queueNotificationStorage(() => AsyncStorage.multiRemove([HELD_NOTIFICATION_KEY, LAST_NOTIFICATION_USER_KEY])),
    Notifications.clearLastNotificationResponseAsync().catch(() => undefined),
  ]);
}
