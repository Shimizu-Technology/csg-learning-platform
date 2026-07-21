import * as Application from 'expo-application';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { BellRing, Check, ChevronRight, GitBranch, GraduationCap, LogOut, Save, Settings2, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { fonts, palette } from '@/constants/csg-theme';
import { learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function ProfileScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user, refresh, signOut: endSession } = useSession();
  const profileQuery = useQuery({ queryKey: learningKeys.profile(user?.id || 0), queryFn: ({ signal }) => api.profile(signal), enabled: Boolean(user && !auth.demo) });
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
      {!auth.demo && <GithubEditor initialValue={profileQuery.data?.user.github_username || user?.github_username || ''} api={api} userId={user?.id || 0} afterSave={refresh} />}
      {!!profileQuery.data?.enrollments.length && <><Text style={styles.sectionLabel}>ENROLLMENTS</Text><View style={styles.group}>{profileQuery.data.enrollments.map((enrollment, index) => <View key={enrollment.id} style={[styles.enrollment, index > 0 && styles.groupDivider]}><View style={styles.settingIcon}><GraduationCap color={palette.rubySoft} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>{enrollment.cohort_name}</Text><Text style={styles.settingCopy}>{enrollment.curriculum_name}</Text></View><Text style={[styles.enrollmentStatus, enrollment.status === 'active' && styles.enrollmentActive]}>{enrollment.status}</Text></View>)}</View></>}
      <Text style={styles.sectionLabel}>PREFERENCES</Text>
      <View style={styles.group}><View style={styles.setting}><View style={styles.settingIcon}><BellRing color={palette.rubySoft} size={19} /></View><View style={{ flex: 1 }}><Text style={styles.settingTitle}>Push notifications</Text><Text style={styles.settingCopy}>Conversation mute settings still take priority.</Text></View><Switch accessibilityLabel="Push notifications" disabled={loadingPreference} value={notificationsEnabled} onValueChange={(value) => void toggleNotifications(value)} trackColor={{ false: palette.line, true: '#6A2A36' }} thumbColor={notificationsEnabled ? palette.rubySoft : palette.muted} /></View></View>
      {user?.is_staff && <Pressable accessibilityRole="button" accessibilityLabel="Manage communication workspaces" onPress={() => router.push('/manage-communications' as Href)} style={styles.manage}><View style={styles.settingIcon}><Settings2 color={palette.rubySoft} size={19} /></View><View style={{ flex: 1 }}><Text style={styles.settingTitle}>Communication settings</Text><Text style={styles.settingCopy}>Manage workspaces, members, and channels.</Text></View><ChevronRight color={palette.quiet} size={18} /></Pressable>}
      <Pressable accessibilityRole="button" onPress={signOut} style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}><LogOut color={palette.rubySoft} size={19} /><Text style={styles.signOutText}>Sign out</Text></Pressable>
      <Text style={styles.version}>CSG Connect · Version {Application.nativeApplicationVersion || 'development'}</Text>
    </ScrollView></SafeAreaView>
  );
}

function GithubEditor({ initialValue, api, userId, afterSave }: { initialValue: string; api: ReturnType<typeof useSession>['api']; userId: number; afterSave: () => Promise<void> }) {
  const [draft, setDraft] = useState(initialValue);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const username = dirty ? draft : initialValue;
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.updateProfile({ github_username: username.trim() || null }),
    onSuccess: async () => { setSaved(true); await Promise.all([queryClient.invalidateQueries({ queryKey: learningKeys.profile(userId) }), afterSave()]); setDirty(false); },
    onError: (error) => Alert.alert('Could not update GitHub', (error as Error).message),
  });
  const unchanged = username.trim() === initialValue.trim();
  return <View style={styles.githubCard}><View style={styles.githubHeader}><View style={styles.settingIcon}><GitBranch color={palette.rubySoft} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>GitHub username</Text><Text style={styles.settingCopy}>Used for repository-based class work.</Text></View></View><View style={styles.githubForm}><TextInput accessibilityLabel="GitHub username" value={username} onChangeText={(value) => { setDraft(value); setSaved(false); setDirty(true); }} autoCapitalize="none" autoCorrect={false} placeholder="your-username" placeholderTextColor={palette.quiet} style={styles.githubInput} /><Pressable accessibilityRole="button" accessibilityLabel="Save GitHub username" disabled={mutation.isPending || unchanged} onPress={() => mutation.mutate()} style={[styles.save, (mutation.isPending || unchanged) && styles.disabled]}>{mutation.isPending ? <ActivityIndicator color={palette.text} /> : saved ? <Check color={palette.text} size={18} /> : <Save color={palette.text} size={18} />}</Pressable></View></View>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }, eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.8 }, heading: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 34, letterSpacing: -1.2 }, person: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 22, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, marginTop: 22 }, name: { color: palette.text, fontFamily: fonts.bold, fontSize: 18 }, email: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 }, role: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }, roleText: { color: palette.success, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }, demo: { marginTop: 14, padding: 16, borderRadius: 16, backgroundColor: '#2A2112', borderWidth: 1, borderColor: '#594522' }, demoTitle: { color: '#F0C56B', fontFamily: fonts.bold, fontSize: 13 }, demoCopy: { color: '#C8AE78', fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 4 }, sectionLabel: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.5, marginTop: 30, marginBottom: 8 }, group: { borderRadius: 20, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, overflow: 'hidden' }, setting: { minHeight: 76, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 13 }, settingIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, settingTitle: { color: palette.text, fontFamily: fonts.semibold, fontSize: 14 }, settingCopy: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 }, signOut: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 28 }, signOutText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 14 }, version: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 11, textAlign: 'center', marginTop: 20 },
  manage: { minHeight: 76, marginTop: 12, paddingHorizontal: 16, borderRadius: 20, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', gap: 13 }, flex: { flex: 1, minWidth: 0 }, githubCard: { marginTop: 14, borderRadius: 20, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, padding: 16 }, githubHeader: { flexDirection: 'row', alignItems: 'center', gap: 13 }, githubForm: { flexDirection: 'row', gap: 9, marginTop: 14 }, githubInput: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.ink, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 13 }, save: { width: 50, minHeight: 48, borderRadius: 14, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.42 }, enrollment: { minHeight: 76, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 13 }, groupDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line }, enrollmentStatus: { color: palette.muted, fontFamily: fonts.bold, fontSize: 9, textTransform: 'uppercase' }, enrollmentActive: { color: palette.success },
});
