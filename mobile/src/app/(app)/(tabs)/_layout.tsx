import { Tabs } from 'expo-router';
import { BookOpen, CalendarDays, MessagesSquare, UserRound } from 'lucide-react-native';
import { fonts, palette } from '@/constants/csg-theme';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: palette.ink }, tabBarStyle: { backgroundColor: palette.panel, borderTopColor: palette.line, height: 82, paddingTop: 8 }, tabBarActiveTintColor: palette.rubySoft, tabBarInactiveTintColor: palette.quiet, tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, paddingBottom: 7 } }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: ({ color }) => <CalendarDays color={color} size={23} /> }} />
      <Tabs.Screen name="learn" options={{ title: 'Learn', tabBarIcon: ({ color }) => <BookOpen color={color} size={23} /> }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: ({ color }) => <MessagesSquare color={color} size={23} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'You', tabBarIcon: ({ color }) => <UserRound color={color} size={23} /> }} />
      <Tabs.Screen name="updates" options={{ href: null }} />
    </Tabs>
  );
}
