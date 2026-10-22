import * as Notifications from 'expo-notifications';
import { type Href, useNavigationContainerRef, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { isAllowedNotificationPath, mobileNotificationPath } from '@/lib/notification-path';

export function NotificationObserver() {
  const router = useRouter();
  const rootNavigation = useNavigationContainerRef();
  const state = useRootNavigationState();
  // SDK 57 adds an internal navigator around the application layout.
  const appStackKey = state?.routeNames.includes('(app)') ? state.key
    : state?.routes.find((route) => route.state?.routeNames?.includes('(app)'))?.state?.key;
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!appStackKey) return;
    let active = true;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!active || !response || handled.current === response.notification.request.identifier) return;
      const data = response.notification.request.content.data;
      const path = mobileNotificationPath(data?.destination_path ?? data?.path, data?.message_id ?? data?.messageId);
      if (isAllowedNotificationPath(path)) {
        if (path.startsWith('/conversation/')) {
          const [pathname, query] = path.split('?');
          const [, , kind, id] = pathname.split('/');
          const messageId = new URLSearchParams(query).get('messageId');
          // One navigation transaction selects the nested Messages tab and puts
          // the conversation above it. A dismissTo + next-frame push can race
          // the tab selection (especially from Today or a cold notification).
          const current = rootNavigation.getRootState();
          const target = current?.routeNames.includes('(app)') ? current.key
            : current?.routes.find((route) => route.state?.routeNames?.includes('(app)'))?.state?.key;
          if (!target) return;
          rootNavigation.dispatch({ type: 'RESET', target, payload: { index: 0, routes: [{ name: '(app)', state: {
            index: 1,
            routes: [
              { name: '(tabs)', state: { index: 0, routes: [{ name: 'messages' }] } },
              { name: 'conversation/[kind]/[id]', params: { kind, id, ...(messageId ? { messageId } : {}) } },
            ],
          } }] } });
        } else {
          router.dismissTo(path as Href);
        }
        handled.current = response.notification.request.identifier;
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => { active = false; subscription.remove(); };
  }, [appStackKey, rootNavigation, router]);
  return null;
}
