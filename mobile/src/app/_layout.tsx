import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import {
  Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold,
  Manrope_700Bold, Manrope_800ExtraBold, useFonts,
} from '@expo-google-fonts/manrope';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { palette } from '@/constants/csg-theme';
import { NotificationObserver } from '@/components/notification-observer';
import { AnalyticsProvider } from '@/providers/analytics-provider';
import { ClerkAuthProvider, DemoAuthProvider, isDemoMode } from '@/providers/auth-provider';
import { SessionProvider } from '@/providers/session-provider';
import { ServerStateProvider } from '@/providers/server-state-provider';
import { WorkspaceProvider } from '@/providers/workspace-provider';

void SplashScreen.preventAutoHideAsync();

function AppProviders() {
  return (
    <SessionProvider>
      <AnalyticsProvider><ServerStateProvider><WorkspaceProvider>
        <StatusBar style="light" />
        <NotificationObserver />
        <Stack screenOptions={{ contentStyle: { backgroundColor: palette.ink }, headerStyle: { backgroundColor: palette.ink }, headerTintColor: palette.text, headerShadowVisible: false }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack>
      </WorkspaceProvider></ServerStateProvider></AnalyticsProvider>
    </SessionProvider>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold });
  useEffect(() => { void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); }, []);
  useEffect(() => { if (loaded) void SplashScreen.hideAsync(); }, [loaded]);
  if (!loaded) return <View style={{ flex: 1, backgroundColor: palette.ink }} />;
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!isDemoMode && !publishableKey) throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required');
  const app = isDemoMode
    ? <DemoAuthProvider><AppProviders /></DemoAuthProvider>
    : <ClerkProvider publishableKey={publishableKey!} tokenCache={tokenCache}><ClerkAuthProvider><AppProviders /></ClerkAuthProvider></ClerkProvider>;
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider>{app}</SafeAreaProvider></GestureHandlerRootView>;
}
