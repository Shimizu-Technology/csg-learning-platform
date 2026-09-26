import * as Notifications from 'expo-notifications';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { isAllowedNotificationPath, mobileNotificationPath } from '@/lib/notification-path';

export function NotificationObserver() {
  const router = useRouter();
  const handled = useRef<string | null>(null);
  const navigation = useRef(0);
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || handled.current === response.notification.request.identifier) return;
      const data = response.notification.request.content.data;
      const path = mobileNotificationPath(data?.path, data?.message_id ?? data?.messageId);
      if (isAllowedNotificationPath(path)) {
        handled.current = response.notification.request.identifier;
        const request = ++navigation.current;
        if (path.startsWith('/conversation/')) {
          // Rebuild the stack under a push so iOS back swipe always returns to Messages.
          router.dismissTo('/messages');
          requestAnimationFrame(() => {
            if (navigation.current === request) router.push(path as Href);
          });
        } else {
          router.dismissTo(path as Href);
        }
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => { navigation.current += 1; subscription.remove(); };
  }, [router]);
  return null;
}
