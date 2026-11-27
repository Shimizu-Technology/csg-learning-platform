import { useContext, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';
import { useCohort } from '@/providers/cohort-provider';
import { Tabs } from 'expo-router';
import { Bell, BookOpen, CalendarDays, ClipboardCheck, LifeBuoy, MessagesSquare, UserRound } from 'lucide-react-native';
import { AppState, StyleSheet, View, type ColorValue } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { fonts, tabularNums } from '@/constants/csg-theme';
import { haptic } from '@/lib/haptics';
import { inboxUnreadCount, tabBadgeLabel, useInboxQuery } from '@/hooks/use-inbox';
import { notificationsUnreadCount, useNotificationsQuery } from '@/hooks/use-notifications';
import { updatesKeys } from '@/lib/updates-cache';

export default function TabsLayout() {
  const { colors: c } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const bottomInset = Math.max(insets?.bottom ?? 16, 10);
  const auth = useCsgAuth();
  const { user } = useSession();
  const { selectedCohort } = useCohort();
  const queryClient = useQueryClient();
  const userId = user?.id ?? 0;
  const inbox = useInboxQuery({ refetchInterval: 60_000 });
  const notifications = useNotificationsQuery({ refetchInterval: 60_000 });
  const unreadBadge = tabBadgeLabel(inboxUnreadCount(inbox.data));
  const notificationUnread = notificationsUnreadCount(notifications.data);
  const updatesBadge = tabBadgeLabel(notificationUnread);
  const updatesAccessibilityLabel = notificationUnread > 0
    ? `Updates, ${notificationUnread} unread ${notificationUnread === 1 ? 'notification' : 'notifications'}`
    : 'Updates';

  useEffect(() => {
    if (auth.demo || !userId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void queryClient.refetchQueries(
        { queryKey: updatesKeys.notifications(userId), type: 'active', stale: true },
        { cancelRefetch: false },
      );
    });
    return () => subscription.remove();
  }, [auth.demo, queryClient, userId]);

  const staff = Boolean(user?.is_staff);
  const badgeStyle = {
    backgroundColor: c.action.primary,
    color: c.text.onAction,
    fontFamily: fonts.bold,
    fontSize: 12,
    ...tabularNums,
  };
  const renderTabIcon = (Icon: typeof CalendarDays, color: ColorValue, focused: boolean) => (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ height: 3, width: 22, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} />
      <Icon color={typeof color === 'string' ? color : c.text.muted} size={22} strokeWidth={focused ? 2.25 : 1.9} />
    </View>
  );

  return (
    <Tabs
      screenListeners={{ tabPress: () => haptic('selection') }}
      screenOptions={{
        headerShown: false,
        animation: 'none',
        sceneStyle: { backgroundColor: c.surface.page },
        tabBarStyle: {
          backgroundColor: c.surface.raised,
          borderTopColor: c.border.subtle,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 54 + bottomInset,
          paddingTop: 6,
          paddingBottom: bottomInset,
        },
        tabBarActiveTintColor: c.text.strong,
        tabBarInactiveTintColor: c.text.muted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 12, marginTop: 1 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: ({ color, focused }) => renderTabIcon(CalendarDays, color, focused) }} />
      <Tabs.Screen name="learn" options={{ href: staff ? null : undefined, title: 'Learn', tabBarIcon: ({ color, focused }) => renderTabIcon(BookOpen, color, focused) }} />
      <Tabs.Screen name="grading" options={{ href: staff ? undefined : null, title: 'Grading', tabBarIcon: ({ color, focused }) => renderTabIcon(ClipboardCheck, color, focused) }} />
      <Tabs.Screen name="support" options={{ href: staff ? undefined : null, title: 'Support', tabBarIcon: ({ color, focused }) => renderTabIcon(LifeBuoy, color, focused) }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: ({ color, focused }) => renderTabIcon(MessagesSquare, color, focused), tabBarBadge: unreadBadge, tabBarBadgeStyle: badgeStyle }} />
      <Tabs.Screen name="updates" options={{ href: user?.role === 'student' && selectedCohort?.features?.announcements === false ? null : undefined, title: 'Updates', tabBarAccessibilityLabel: updatesAccessibilityLabel, tabBarIcon: ({ color, focused }) => renderTabIcon(Bell, color, focused), tabBarBadge: updatesBadge, tabBarBadgeStyle: badgeStyle }} />
      <Tabs.Screen name="profile" options={{ title: 'You', tabBarIcon: ({ color, focused }) => renderTabIcon(UserRound, color, focused) }} />
    </Tabs>
  );
}
