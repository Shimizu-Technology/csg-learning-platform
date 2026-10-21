import { NavigationAppearance } from '@/providers/navigation-appearance';
import { ThemeProvider, useTheme } from '@/providers/theme-provider';
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


import { AppErrorBoundary } from '@/components/app-error-boundary';
import { NotificationObserver } from '@/components/notification-observer';
import { AnalyticsProvider } from '@/providers/analytics-provider';
import { ClerkAuthProvider, DemoAuthProvider, isDemoMode } from '@/providers/auth-provider';
import { SessionProvider } from '@/providers/session-provider';
import { ServerStateProvider } from '@/providers/server-state-provider';
import { WorkspaceProvider } from '@/providers/workspace-provider';
import { CohortProvider } from '@/providers/cohort-provider';
import { VoiceRecorderProvider } from '@/providers/voice-recorder-provider';

void SplashScreen.preventAutoHideAsync();

function AppProviders() {
  const { colors: c, dark } = useTheme();
  return (
    <SessionProvider>
      <AnalyticsProvider><ServerStateProvider><CohortProvider><WorkspaceProvider><VoiceRecorderProvider>
        <StatusBar style={dark ? "light" : "dark"} />
        <NotificationObserver />
        <Stack screenOptions={{ statusBarStyle: dark ? 'light' : 'dark', contentStyle: { backgroundColor: c.surface.page }, headerStyle: { backgroundColor: c.surface.page }, headerTintColor: c.text.strong, headerShadowVisible: false }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack>
      </VoiceRecorderProvider></WorkspaceProvider></CohortProvider></ServerStateProvider></AnalyticsProvider>
    </SessionProvider>
  );
}

export default function RootLayout() {
  const { colors: c } = useTheme();
  const [loaded] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold });
  useEffect(() => { void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); }, []);
  useEffect(() => { if (loaded) void SplashScreen.hideAsync(); }, [loaded]);
  if (!loaded) return <View style={{ flex: 1, backgroundColor: c.surface.page }} />;
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!isDemoMode && !publishableKey) throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required');
  const app = isDemoMode
    ? <DemoAuthProvider><AppProviders /></DemoAuthProvider>
    : <ClerkProvider publishableKey={publishableKey!} tokenCache={tokenCache}><ClerkAuthProvider><AppProviders /></ClerkAuthProvider></ClerkProvider>;
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><ThemeProvider><NavigationAppearance><AppErrorBoundary>{app}</AppErrorBoundary></NavigationAppearance></ThemeProvider></SafeAreaProvider></GestureHandlerRootView>;
}
