import { Redirect, Stack, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { useCsgAuth } from '@/providers/auth-provider';
import { palette } from '@/constants/csg-theme';

export default function AppLayout() {
  const { loaded, signedIn } = useCsgAuth();
  const router = useRouter();
  if (!loaded) return null;
  if (!signedIn) return <Redirect href="/(auth)/sign-in" />;
  const closeButton = () => <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X color={palette.muted} size={22} /></Pressable>;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: palette.ink }, headerTintColor: palette.text, headerShadowVisible: false, contentStyle: { backgroundColor: palette.ink } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="conversation/[kind]/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="compose" options={{ presentation: 'modal', title: 'New message', headerRight: closeButton }} />
      <Stack.Screen name="search" options={{ presentation: 'modal', title: 'Search messages', headerRight: closeButton }} />
    </Stack>
  );
}
