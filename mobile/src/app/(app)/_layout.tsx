import { Redirect, Stack, useRouter, type Href } from 'expo-router';
import { X } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { fonts, palette } from '@/constants/csg-theme';
import { ErrorState, LoadingState } from '@/components/screen-states';

export default function AppLayout() {
  const { loaded, signedIn } = useCsgAuth();
  const { user, loading, error, accessDenied, refresh, signOut } = useSession();
  const router = useRouter();
  if (!loaded) return null;
  if (!signedIn) return <Redirect href="/(auth)/sign-in" />;
  if (loading) return <View style={styles.gate}><LoadingState label="Opening your CSG account" /></View>;
  if (accessDenied) return <Redirect href={'/(auth)/access-denied' as Href} />;
  if (!user) {
    return (
      <View style={styles.gate}>
        <ErrorState message={error || 'We could not load your CSG account.'} retry={() => void refresh()} />
        <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.signOut}><Text style={styles.signOutText}>Use a different account</Text></Pressable>
      </View>
    );
  }
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

const styles = StyleSheet.create({
  gate: { flex: 1, justifyContent: 'center', backgroundColor: palette.ink },
  signOut: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 20, marginTop: -10 },
  signOutText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 13 },
});
