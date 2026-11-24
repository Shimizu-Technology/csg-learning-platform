import { brand } from '../../lib/brand'
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { Redirect, Stack, useRouter, usePathname, type Href } from 'expo-router';
import { X } from 'lucide-react-native';
import { Linking, StyleSheet, View } from 'react-native';
import { themedAlert as Alert } from '@/lib/alerts';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { fonts } from '@/constants/csg-theme';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { CommunityStandardsGate } from '@/components/community-standards-gate';
import { requiresStaff } from '@/lib/notification-path';

// SDK 57 getRoutesCore supports initialRouteName (and the newer anchor alias).
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function AppLayout() {
  const styles = useStyles();
  const { colors: c, dark } = useTheme();
  const { loaded, signedIn } = useCsgAuth();
  const { api, user, loading, error, accessDenied, refresh, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  if (!loaded) return null;
  if (!signedIn) return <Redirect href="/(auth)/sign-in" />;
  if (loading) return <View style={styles.gate}><LoadingState label={`Opening your ${brand.schoolAbbreviation} account`} /></View>;
  if (accessDenied) return <Redirect href={'/(auth)/access-denied' as Href} />;
  if (!user) {
    return (
      <View style={styles.gate}>
        <ErrorState message={error || `We could not load your ${brand.schoolAbbreviation} account.`} retry={() => void refresh()} />
        <Button accessibilityRole="button" onPress={() => void signOut()} style={styles.signOut} variant="quiet" label="Use a different account" textStyle={styles.signOutText} />
        <Button
          accessibilityRole="button"
          onPress={() => void Linking.openURL(`mailto:${brand.supportEmail}?subject=${encodeURIComponent(`${brand.productName} account help`)}`).catch(() => Alert.alert('Contact support', `Email ${brand.supportEmail} for help.`))}
          style={styles.support}
          variant="quiet"
          label={`Contact support (${brand.supportEmail})`}
          textStyle={styles.signOutText}
        />
      </View>
    );
  }
  if (user.community_policy && !user.community_policy.accepted) {
    return <CommunityStandardsGate policy={user.community_policy} accountEmail={user.email} onSignOut={signOut} onAccept={async () => { await api.acceptCommunityPolicy(user.community_policy!.version); await refresh(); }} />;
  }
  if (!user.is_staff && requiresStaff(pathname)) return <Redirect href={'/link-unavailable' as Href} />;
  const closeButton = () => <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><X color={c.text.body} size={22} /></Pressable>;
  return (
    <Stack screenOptions={{ statusBarStyle: dark ? 'light' : 'dark', headerStyle: { backgroundColor: c.surface.page }, headerTintColor: c.text.strong, headerBackButtonDisplayMode: 'minimal', headerBackTitle: 'Back', headerShadowVisible: false, contentStyle: { backgroundColor: c.surface.page } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="activity" options={{ headerShown: false }} />
      <Stack.Screen name="conversation/[kind]/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="thread/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="module/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="lesson/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="meetings" options={{ headerShown: false }} />
      <Stack.Screen name="resources" options={{ headerShown: false }} />
      <Stack.Screen name="recordings" options={{ headerShown: false }} />
      <Stack.Screen name="recordings/link" options={{ headerShown: false }} />
      <Stack.Screen name="recordings/upload" options={{ headerShown: false }} />
      <Stack.Screen name="cohort/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="cohort/[id]/schedule" options={{ headerShown: false }} />
      <Stack.Screen name="recording/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="staff/student/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="staff/access" options={{ title: 'Student access' }} />
      <Stack.Screen name="staff/submission/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="staff/grading" options={{ headerShown: false }} />
      <Stack.Screen name="staff/curriculum/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="staff/lesson/[id]/edit" options={{ headerShown: false }} />
      <Stack.Screen name="staff/support" options={{ headerShown: false }} />
      <Stack.Screen name="staff/support/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="staff/intervention/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="compose" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, title: 'New message', headerRight: closeButton }} />
      <Stack.Screen name="search" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, headerShown: false }} />
      <Stack.Screen name="manage-communications" options={{ title: 'Communication settings' }} />
      <Stack.Screen name="link-unavailable" options={{ headerShown: false, title: 'Link unavailable' }} />
    </Stack>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  gate: { flex: 1, justifyContent: 'center', backgroundColor: c.surface.page },
  signOut: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 20, marginTop: -10 },
  support: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 20, marginTop: 2 },
  signOutText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 13 },
}));
