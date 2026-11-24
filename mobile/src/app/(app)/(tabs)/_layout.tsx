import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';
import { useCohort } from '@/providers/cohort-provider';
import { Tabs } from 'expo-router';
import { Bell, BookOpen, CalendarDays, ClipboardCheck, LifeBuoy, MessagesSquare, UserRound } from 'lucide-react-native';
import { AppState, View } from 'react-native';
import { fonts } from '@/constants/csg-theme';
import { inboxUnreadCount, tabBadgeLabel, useInboxQuery } from '@/hooks/use-inbox';
import { notificationsUnreadCount, useNotificationsQuery } from '@/hooks/use-notifications';
import { updatesKeys } from '@/lib/updates-cache';

export default function TabsLayout() {
  const { colors: c } = useTheme();
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
  const badgeStyle = { backgroundColor: c.selection.bg, color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 };
  return (
    <Tabs screenOptions={{ headerShown: false, animation: 'none', tabBarActiveBackgroundColor: c.selection.bg, sceneStyle: { backgroundColor: c.surface.page }, tabBarStyle: { backgroundColor: c.surface.raised, borderTopColor: c.border.subtle, height: 82, paddingTop: 8 }, tabBarActiveTintColor: c.text.body, tabBarInactiveTintColor: c.text.muted, tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 12, paddingBottom: 7 } }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><CalendarDays color={color} size={23} /></View> }} />
      <Tabs.Screen name="learn" options={{ href: staff ? null : undefined, title: 'Learn', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><BookOpen color={color} size={23} /></View> }} />
      <Tabs.Screen name="grading" options={{ href: staff ? undefined : null, title: 'Grading', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><ClipboardCheck color={color} size={23} /></View> }} />
      <Tabs.Screen name="support" options={{ href: staff ? undefined : null, title: 'Support', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><LifeBuoy color={color} size={23} /></View> }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><MessagesSquare color={color} size={23} /></View>, tabBarBadge: unreadBadge, tabBarBadgeStyle: badgeStyle }} />
      <Tabs.Screen name="updates" options={{ href: user?.role === 'student' && selectedCohort?.features?.announcements === false ? null : undefined, title: 'Updates', tabBarAccessibilityLabel: updatesAccessibilityLabel, tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><Bell color={color} size={23} /></View>, tabBarBadge: updatesBadge, tabBarBadgeStyle: badgeStyle }} />
      <Tabs.Screen name="profile" options={{ title: 'You', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><UserRound color={color} size={23} /></View> }} />
    </Tabs>
  );
}
