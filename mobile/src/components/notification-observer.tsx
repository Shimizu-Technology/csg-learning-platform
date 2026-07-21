import * as Notifications from 'expo-notifications';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { isAllowedNotificationPath } from '@/lib/notification-path';

export function NotificationObserver() {
  const router = useRouter();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || handled.current === response.notification.request.identifier) return;
      const path = response.notification.request.content.data?.path;
      if (isAllowedNotificationPath(path)) {
        handled.current = response.notification.request.identifier;
        router.push(path as Href);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [router]);
  return null;
}
