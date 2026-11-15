import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useNavigationContainerRef, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { descriptorFromPath, mobileNotificationPath } from '@/lib/notification-path';
import { applicationNavigator, notificationArrived, notificationStack } from '@/lib/notification-navigation';
import { toNativeHref } from '@/lib/record-destination';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export const HELD_NOTIFICATION_KEY = 'csg.notification.destination.v1';
export const HELD_NOTIFICATION_TTL = 15 * 60 * 1000;
type Pending = { id: string; path: string; expires: number };

export function NotificationObserver() {
  const navigation = useNavigationContainerRef();
  const state = useRootNavigationState();
  const auth = useCsgAuth();
  const session = useSession();
  const ready = auth.loaded && auth.signedIn && !session.loading && !session.accessDenied && !!session.user && (!session.user.community_policy || session.user.community_policy.accepted);
  const [pending, setPending] = useState<Pending | null>(null);
  const handled = useRef<string | null>(null);
  const inFlight = useRef<string | null>(null);
  // Serialize writes and removals so a slow save cannot resurrect a consumed tap.
  const storage = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (operation: () => Promise<unknown>) => { storage.current = storage.current.catch(() => undefined).then(operation).catch(() => undefined); };

  useEffect(() => {
    let active = true;
    let received = false;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!active || !response || handled.current === response.notification.request.identifier) return;
      received = true;
      const data = response.notification.request.content.data;
      const path = mobileNotificationPath(data?.destination, data?.message_id ?? data?.messageId, data?.destination_path ?? data?.path);
      setPending(current => {
        if (current?.id === response.notification.request.identifier) return current;
        return { id: response.notification.request.identifier, path, expires: Date.now() + HELD_NOTIFICATION_TTL };
      });
    };
    void AsyncStorage.getItem(HELD_NOTIFICATION_KEY).then(raw => {
      if (!active || received || !raw) return;
      try {
        const saved = JSON.parse(raw);
        const path = toNativeHref(saved.destination);
        if (path && typeof saved.id === 'string' && saved.expires > Date.now() && saved.expires <= Date.now() + HELD_NOTIFICATION_TTL) setPending({ id: saved.id, path, expires: saved.expires });
        else { if (typeof saved.id === 'string') handled.current = saved.id; enqueue(() => AsyncStorage.removeItem(HELD_NOTIFICATION_KEY)); }
      } catch { enqueue(() => AsyncStorage.removeItem(HELD_NOTIFICATION_KEY)); }
    }).catch(() => undefined).then(() => Notifications.getLastNotificationResponseAsync()).then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const destination = descriptorFromPath(pending.path);
    if (destination) enqueue(() => AsyncStorage.setItem(HELD_NOTIFICATION_KEY, JSON.stringify({ id: pending.id, expires: pending.expires, destination })));
    const remaining = pending.expires - Date.now();
    const expire = () => {
      handled.current = pending.id;
      inFlight.current = null;
      setPending(null);
      enqueue(() => AsyncStorage.removeItem(HELD_NOTIFICATION_KEY));
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };
    if (remaining <= 0) { expire(); return; }
    const timer = setTimeout(expire, remaining);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (!pending || !ready || pending.expires <= Date.now()) return;
    const current = navigation.getRootState();
    // Wait for the auth redirect and policy gate to mount the app navigator.
    const navigator = applicationNavigator(current);
    if (!navigator || navigator.routes[navigator.index ?? 0]?.name !== '(app)') return;
    const appStackKey = navigator.routes[navigator.index ?? 0]?.state?.key;
    if (!appStackKey) return;
    if (inFlight.current === pending.id && notificationArrived(current, pending.path)) {
      handled.current = pending.id;
      inFlight.current = null;
      setPending(null);
      enqueue(() => AsyncStorage.removeItem(HELD_NOTIFICATION_KEY));
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      return;
    }
    if (inFlight.current === pending.id) return;
    inFlight.current = pending.id;
    try {
      navigation.dispatch({ type: 'RESET', target: appStackKey, payload: { ...navigator.routes[navigator.index ?? 0].state, ...notificationStack(pending.path, navigator.routes[navigator.index ?? 0].state) } });
    } catch { inFlight.current = null; }
  }, [navigation, pending, ready, state]);
  return null;
}
