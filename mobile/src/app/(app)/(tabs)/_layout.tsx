import { Tabs } from 'expo-router';
import { Bell, MessagesSquare, UserRound } from 'lucide-react-native';
import { fonts, palette } from '@/constants/csg-theme';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: palette.ink }, tabBarStyle: { backgroundColor: palette.panel, borderTopColor: palette.line, height: 82, paddingTop: 8 }, tabBarActiveTintColor: palette.rubySoft, tabBarInactiveTintColor: palette.quiet, tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, paddingBottom: 7 } }}>
      <Tabs.Screen name="index" options={{ title: 'Messages', tabBarIcon: ({ color }) => <MessagesSquare color={color} size={23} /> }} />
      <Tabs.Screen name="updates" options={{ title: 'Updates', tabBarIcon: ({ color }) => <Bell color={color} size={23} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'You', tabBarIcon: ({ color }) => <UserRound color={color} size={23} /> }} />
    </Tabs>
  );
}
