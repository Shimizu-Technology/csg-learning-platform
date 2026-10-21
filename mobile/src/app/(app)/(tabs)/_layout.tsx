import { useTheme } from '@/providers/theme-provider';
import { Tabs } from 'expo-router';
import { Bell, BookOpen, CalendarDays, MessagesSquare, UserRound } from 'lucide-react-native';
import { View } from 'react-native';
import { fonts } from '@/constants/csg-theme';
import { inboxUnreadCount, tabBadgeLabel, useInboxQuery } from '@/hooks/use-inbox';

export default function TabsLayout() {
  const { colors: c } = useTheme();
  const inbox = useInboxQuery({ refetchInterval: 60_000 });
  const unreadBadge = tabBadgeLabel(inboxUnreadCount(inbox.data));
  return (
    <Tabs screenOptions={{ headerShown: false, animation: 'none', tabBarActiveBackgroundColor: c.selection.bg, sceneStyle: { backgroundColor: c.surface.page }, tabBarStyle: { backgroundColor: c.surface.raised, borderTopColor: c.border.subtle, height: 82, paddingTop: 8 }, tabBarActiveTintColor: c.text.body, tabBarInactiveTintColor: c.text.muted, tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 12, paddingBottom: 7 } }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><CalendarDays color={color} size={23} /></View> }} />
      <Tabs.Screen name="learn" options={{ title: 'Learn', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><BookOpen color={color} size={23} /></View> }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><MessagesSquare color={color} size={23} /></View>, tabBarBadge: unreadBadge, tabBarBadgeStyle: { backgroundColor: c.selection.bg, color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 } }} />
      <Tabs.Screen name="updates" options={{ title: 'Updates', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><Bell color={color} size={23} /></View> }} />
      <Tabs.Screen name="profile" options={{ title: 'You', tabBarIcon: ({ color, focused }) => <View style={{ alignItems: 'center', gap: 3 }}><View style={{ height: 3, width: 20, borderRadius: 2, backgroundColor: focused ? c.selection.indicator : 'transparent' }} /><UserRound color={color} size={23} /></View> }} />
    </Tabs>
  );
}
