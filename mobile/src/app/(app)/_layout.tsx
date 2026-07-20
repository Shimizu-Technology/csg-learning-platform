import { Redirect, Stack } from 'expo-router';
import { useCsgAuth } from '@/providers/auth-provider';
import { palette } from '@/constants/csg-theme';

export default function AppLayout() {
  const { loaded, signedIn } = useCsgAuth();
  if (!loaded) return null;
  if (!signedIn) return <Redirect href="/(auth)/sign-in" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: palette.ink }, headerTintColor: palette.text, headerShadowVisible: false, contentStyle: { backgroundColor: palette.ink } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="conversation/[kind]/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="compose" options={{ presentation: 'modal', title: 'New message' }} />
      <Stack.Screen name="search" options={{ presentation: 'modal', title: 'Search messages' }} />
    </Stack>
  );
}
