import * as Application from 'expo-application';
import { useRouter, type Href } from 'expo-router';
import { BellRing, ChevronRight, LogOut, Settings2, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { fonts, palette } from '@/constants/csg-theme';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function ProfileScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user, signOut: endSession } = useSession();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loadingPreference, setLoadingPreference] = useState(!auth.demo);
  useEffect(() => { if (auth.demo) return; void api.pushConfig().then((value) => setNotificationsEnabled(value.notifications_enabled)).catch(() => undefined).finally(() => setLoadingPreference(false)); }, [api, auth.demo]);
  const toggleNotifications = async (enabled: boolean) => { const previous = notificationsEnabled; setNotificationsEnabled(enabled); try { if (!auth.demo) await api.updateGlobalNotifications(enabled); } catch (requestError) { setNotificationsEnabled(previous); Alert.alert('Could not update notifications', (requestError as Error).message); } };
  const signOut = () => Alert.alert('Sign out?', 'You can sign back in at any time.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void endSession() }]);
  return (
    <SafeAreaView edges={['top']} style={styles.safe}><ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>YOUR ACCOUNT</Text><Text style={styles.heading}>You</Text>
      <View style={styles.person}><Avatar name={user?.full_name || 'CSG User'} size={62} /><View style={{ flex: 1 }}><Text style={styles.name}>{user?.full_name || 'Code School member'}</Text><Text style={styles.email}>{user?.email}</Text><View style={styles.role}><ShieldCheck color={palette.success} size={13} /><Text style={styles.roleText}>{user?.role || 'member'}</Text></View></View></View>
      {auth.demo && <View style={styles.demo}><Text style={styles.demoTitle}>Simulator walkthrough</Text><Text style={styles.demoCopy}>Local sample data is active. This mode is compiled out of production behavior.</Text></View>}
      <Text style={styles.sectionLabel}>PREFERENCES</Text>
      <View style={styles.group}><View style={styles.setting}><View style={styles.settingIcon}><BellRing color={palette.rubySoft} size={19} /></View><View style={{ flex: 1 }}><Text style={styles.settingTitle}>Push notifications</Text><Text style={styles.settingCopy}>Conversation mute settings still take priority.</Text></View><Switch accessibilityLabel="Push notifications" disabled={loadingPreference} value={notificationsEnabled} onValueChange={(value) => void toggleNotifications(value)} trackColor={{ false: palette.line, true: '#6A2A36' }} thumbColor={notificationsEnabled ? palette.rubySoft : palette.muted} /></View></View>
      {user?.is_staff && <Pressable accessibilityRole="button" accessibilityLabel="Manage communication workspaces" onPress={() => router.push('/manage-communications' as Href)} style={styles.manage}><View style={styles.settingIcon}><Settings2 color={palette.rubySoft} size={19} /></View><View style={{ flex: 1 }}><Text style={styles.settingTitle}>Communication settings</Text><Text style={styles.settingCopy}>Manage workspaces, members, and channels.</Text></View><ChevronRight color={palette.quiet} size={18} /></Pressable>}
      <Pressable accessibilityRole="button" onPress={signOut} style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}><LogOut color={palette.rubySoft} size={19} /><Text style={styles.signOutText}>Sign out</Text></Pressable>
      <Text style={styles.version}>CSG Connect · Version {Application.nativeApplicationVersion || 'development'}</Text>
    </ScrollView></SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }, eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.8 }, heading: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 34, letterSpacing: -1.2 }, person: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 22, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, marginTop: 22 }, name: { color: palette.text, fontFamily: fonts.bold, fontSize: 18 }, email: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 }, role: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }, roleText: { color: palette.success, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }, demo: { marginTop: 14, padding: 16, borderRadius: 16, backgroundColor: '#2A2112', borderWidth: 1, borderColor: '#594522' }, demoTitle: { color: '#F0C56B', fontFamily: fonts.bold, fontSize: 13 }, demoCopy: { color: '#C8AE78', fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 4 }, sectionLabel: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.5, marginTop: 30, marginBottom: 8 }, group: { borderRadius: 20, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, overflow: 'hidden' }, setting: { minHeight: 76, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 13 }, settingIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, settingTitle: { color: palette.text, fontFamily: fonts.semibold, fontSize: 14 }, settingCopy: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 }, signOut: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 28 }, signOutText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 14 }, version: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 11, textAlign: 'center', marginTop: 20 },
  manage: { minHeight: 76, marginTop: 12, paddingHorizontal: 16, borderRadius: 20, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', gap: 13 },
});
