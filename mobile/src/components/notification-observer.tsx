import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useNavigationContainerRef, useRootNavigationState } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { isAllowedNotificationPath, mobileNotificationPath } from '@/lib/notification-path';
import { applicationNavigator, notificationArrived, notificationStack } from '@/lib/notification-navigation';
import { fromWebPath, toWebPath, toNativeHref } from '@/lib/record-destination';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

import { HELD_NOTIFICATION_KEY, LAST_NOTIFICATION_USER_KEY, notificationGeneration, onNotificationSignOut, queueNotificationStorage } from '@/lib/held-notification';
export { HELD_NOTIFICATION_KEY } from '@/lib/held-notification';
export const HELD_NOTIFICATION_TTL = 15 * 60 * 1000;
type Pending = { id: string; path: string; expires: number; userId: number | null; subject?: string | null; destination?: unknown };

export function NotificationObserver() {
  const navigation = useNavigationContainerRef();
  const state = useRootNavigationState();
  const [navigationTick, setNavigationTick] = useState(0);
  useEffect(() => navigation.addListener('state', () => setNavigationTick(tick => tick + 1)), [navigation]);
  const auth = useCsgAuth();
  const session = useSession();
  const ready = auth.loaded && auth.signedIn && !session.loading && !session.accessDenied && !!session.user && (!session.user.community_policy || session.user.community_policy.accepted);
  const [pending, setPending] = useState<Pending | null>(null);
  const handled = useRef<string | null>(null);
  const inFlight = useRef<string | null>(null);
  const currentUserId = session.user?.id ?? null;
  const identity = useRef(auth);
  useLayoutEffect(() => { identity.current = auth; }, [auth]);
  const userId = useRef(currentUserId);
  useLayoutEffect(() => { userId.current = currentUserId; }, [currentUserId]);
  useEffect(() => {
    if (auth.signedIn && currentUserId) void queueNotificationStorage(() => AsyncStorage.setItem(LAST_NOTIFICATION_USER_KEY, String(currentUserId)));
  }, [auth.signedIn, currentUserId]);
  useEffect(() => onNotificationSignOut(() => {
    handled.current = pending?.id ?? null;
    inFlight.current = null;
    setPending(null);
  }), [pending]);
  const finish = useCallback((id: string) => {
    handled.current = id;
    inFlight.current = null;
    void queueNotificationStorage(() => AsyncStorage.removeItem(HELD_NOTIFICATION_KEY)).then(() => {
      setPending(current => current?.id === id ? null : current);
    });
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    let received = false;
    const open = async (response: Notifications.NotificationResponse | null) => {
      const generation = notificationGeneration();
      const subject = identity.current.signedIn ? identity.current.subject : null;
      const data = response?.notification.request.content.data;
      const recipient = typeof data?.recipient_user_id === 'number' && Number.isSafeInteger(data.recipient_user_id) && data.recipient_user_id > 0 ? data.recipient_user_id : null;
      const owner = recipient ?? userId.current ?? (Number(await AsyncStorage.getItem(LAST_NOTIFICATION_USER_KEY).catch(() => null)) || null);
      if (generation !== notificationGeneration()) return;
      if (!active || !response || handled.current === response.notification.request.identifier) return;
      received = true;
      const destination = fromWebPath(toWebPath(data?.destination));
      const path = mobileNotificationPath(data?.destination, data?.message_id ?? data?.messageId, data?.destination_path ?? data?.path);
      setPending(current => {
        if (current?.id === response.notification.request.identifier) return current;
        return { id: response.notification.request.identifier, path, expires: Date.now() + HELD_NOTIFICATION_TTL, userId: owner, subject, ...(destination ? { destination } : {}) };
      });
    };
    const generation = notificationGeneration();
    void AsyncStorage.getItem(HELD_NOTIFICATION_KEY).then(raw => {
      if (!active || generation !== notificationGeneration() || received || !raw) return;
      try {
        const saved = JSON.parse(raw);
        const path = isAllowedNotificationPath(saved.path) ? saved.path : toNativeHref(saved.destination);
        if (path && typeof saved.id === 'string' && saved.expires > Date.now() && saved.expires <= Date.now() + HELD_NOTIFICATION_TTL) setPending({ id: saved.id, path, expires: saved.expires, userId: typeof saved.userId === 'number' ? saved.userId : null, subject: typeof saved.subject === 'string' ? saved.subject : null, ...(toNativeHref(saved.destination) ? { destination: saved.destination } : {}) });
        else { if (typeof saved.id === 'string') handled.current = saved.id; queueNotificationStorage(() => AsyncStorage.removeItem(HELD_NOTIFICATION_KEY)); }
      } catch { queueNotificationStorage(() => AsyncStorage.removeItem(HELD_NOTIFICATION_KEY)); }
    }).catch(() => undefined).then(() => generation === notificationGeneration() ? Notifications.getLastNotificationResponseAsync() : null).then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(response => { void open(response); });
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!pending) return;
    void queueNotificationStorage(() => AsyncStorage.setItem(HELD_NOTIFICATION_KEY, JSON.stringify({ id: pending.id, expires: pending.expires, userId: pending.userId, subject: pending.subject, path: pending.path, ...(pending.destination ? { destination: pending.destination } : {}) })));
    const remaining = pending.expires - Date.now();
    const expire = () => finish(pending.id);
    if (remaining <= 0) { expire(); return; }
    const timer = setTimeout(expire, remaining);
    return () => clearTimeout(timer);
  }, [pending, finish]);

  useEffect(() => {
    if (!pending || handled.current === pending.id || !ready || pending.expires <= Date.now()) return;
    if (pending.userId ? pending.userId !== session.user?.id : !pending.subject || pending.subject !== auth.subject) {
      finish(pending.id);
      return;
    }
    const current = navigation.getRootState();
    // Wait for the auth redirect and policy gate to mount the app navigator.
    const navigator = applicationNavigator(current);
    if (!navigator || navigator.routes[navigator.index ?? 0]?.name !== '(app)') return;
    const appStackKey = navigator.routes[navigator.index ?? 0]?.state?.key;
    if (!appStackKey) return;
    if (inFlight.current === pending.id && notificationArrived(current, pending.path)) {
      finish(pending.id);
      return;
    }
    if (inFlight.current === pending.id) return;
    inFlight.current = pending.id;
    try {
      navigation.dispatch({ type: 'RESET', target: appStackKey, payload: { ...navigator.routes[navigator.index ?? 0].state, ...notificationStack(pending.path, navigator.routes[navigator.index ?? 0].state) } });
    } catch { inFlight.current = null; }
  }, [navigation, pending, ready, auth.subject, state, navigationTick, session.user?.id, finish]);
  return null;
}
