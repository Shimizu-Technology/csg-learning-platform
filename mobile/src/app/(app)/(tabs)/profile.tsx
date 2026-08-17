import * as Application from 'expo-application';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { BellRing, Check, ChevronRight, FileText, GitBranch, GraduationCap, LogOut, Save, Settings2, ShieldCheck, Trash2, UserX } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { fontScaleLimits, fonts, palette, typography } from '@/constants/csg-theme';
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
  const [showBlockedUsers, setShowBlockedUsers] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<Awaited<ReturnType<typeof api.blockedUsers>>['blocked_users']>([]);
  const [loadingBlockedUsers, setLoadingBlockedUsers] = useState(false);
  const [deletionRequested, setDeletionRequested] = useState(false);
  useEffect(() => { if (auth.demo) return; void api.pushConfig().then((value) => setNotificationsEnabled(value.notifications_enabled)).catch(() => undefined).finally(() => setLoadingPreference(false)); }, [api, auth.demo]);
  const toggleNotifications = async (enabled: boolean) => { const previous = notificationsEnabled; setNotificationsEnabled(enabled); try { if (!auth.demo) await api.updateGlobalNotifications(enabled); } catch (requestError) { setNotificationsEnabled(previous); Alert.alert('Could not update notifications', (requestError as Error).message); } };
  const signOut = () => Alert.alert('Sign out?', 'You can sign back in at any time.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void endSession() }]);
  const policy = user?.community_policy;
  const openPolicy = (url: string) => void Linking.openURL(url).catch(() => Alert.alert('Could not open link', 'Please try again later.'));
  const openBlockedUsers = async () => {
    setShowBlockedUsers(true);
    if (auth.demo) return;
    setLoadingBlockedUsers(true);
    try { setBlockedUsers((await api.blockedUsers()).blocked_users); }
    catch (requestError) { Alert.alert('Could not load blocked users', (requestError as Error).message); }
    finally { setLoadingBlockedUsers(false); }
  };
  const unblock = async (blockedUserId: number) => {
    try { await api.unblockUser(blockedUserId); setBlockedUsers((current) => current.filter((blockedUser) => blockedUser.id !== blockedUserId)); }
    catch (requestError) { Alert.alert('Could not unblock user', (requestError as Error).message); }
  };
  const requestDeletion = () => Alert.alert(
    'Request account deletion?',
    'This sends a request to the Code School team. Your account and class records will not be deleted immediately.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send request', style: 'destructive', onPress: async () => {
        try { if (!auth.demo) await api.requestDataDeletion(); setDeletionRequested(true); Alert.alert('Request received', 'The Code School team will review your request and contact you about any records that must be retained.'); }
        catch (requestError) { Alert.alert('Could not send request', (requestError as Error).message); }
      } },
    ],
  );
  return (
    <SafeAreaView edges={['top']} style={styles.safe}><ScrollView contentContainerStyle={styles.content}>
      <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>YOUR ACCOUNT</Text><Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.heading}>You</Text>
      <View style={styles.person}><Avatar name={user?.full_name || 'CSG User'} size={62} /><View style={styles.flex}><Text style={styles.name}>{user?.full_name || 'Code School member'}</Text><Text style={styles.email}>{user?.email}</Text><View style={styles.role}><ShieldCheck color={palette.success} size={13} /><Text style={styles.roleText}>{user?.role || 'member'}</Text></View></View></View>
      {auth.demo && <View style={styles.demo}><Text style={styles.demoTitle}>Simulator walkthrough</Text><Text style={styles.demoCopy}>Local sample data is active. This mode is compiled out of production behavior.</Text></View>}
      {!auth.demo && <GithubEditor initialValue={profileQuery.data?.user.github_username || user?.github_username || ''} api={api} userId={user?.id || 0} afterSave={refresh} />}
      {!!profileQuery.data?.enrollments.length && <><Text style={styles.sectionLabel}>ENROLLMENTS</Text><View style={styles.group}>{profileQuery.data.enrollments.map((enrollment, index) => <View key={enrollment.id} style={[styles.enrollment, index > 0 && styles.groupDivider]}><View style={styles.settingIcon}><GraduationCap color={palette.rubySoft} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>{enrollment.cohort_name}</Text><Text style={styles.settingCopy}>{enrollment.curriculum_name}</Text></View><Text style={[styles.enrollmentStatus, enrollment.status === 'active' && styles.enrollmentActive]}>{enrollment.status}</Text></View>)}</View></>}
      <Text style={styles.sectionLabel}>PREFERENCES</Text>
      <View style={styles.group}><View style={styles.setting}><View style={styles.settingIcon}><BellRing color={palette.rubySoft} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>Message notifications</Text><Text style={styles.settingCopy}>Email and device alerts. Conversation mutes still take priority.</Text></View><View style={styles.switchSlot}>{loadingPreference ? <ActivityIndicator color={palette.rubySoft} size="small" /> : <Switch accessibilityLabel="Message notifications" value={notificationsEnabled} onValueChange={(value) => void toggleNotifications(value)} trackColor={{ false: palette.line, true: '#6A2A36' }} thumbColor={notificationsEnabled ? palette.rubySoft : palette.muted} style={styles.switch} />}</View></View></View>
      {user?.is_staff && <Pressable accessibilityRole="button" accessibilityLabel="Manage communication workspaces" onPress={() => router.push('/manage-communications' as Href)} style={styles.manage}><View style={styles.settingIcon}><Settings2 color={palette.rubySoft} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>Communication settings</Text><Text style={styles.settingCopy}>Manage workspaces, members, and channels.</Text></View><ChevronRight color={palette.quiet} size={18} /></Pressable>}
      <Text style={styles.sectionLabel}>PRIVACY & SAFETY</Text>
      <View style={styles.group}>
        <PolicyRow icon={ShieldCheck} title="Privacy policy" copy="How CSG Connect handles account and learning data." onPress={() => openPolicy(policy?.privacy_url || 'https://learn.codeschoolofguam.com/privacy')} />
        <PolicyRow icon={FileText} title="Terms & Community Guidelines" copy="Rules that keep class conversations safe." onPress={() => openPolicy(policy?.terms_url || 'https://learn.codeschoolofguam.com/terms')} divider />
        <PolicyRow icon={UserX} title="Blocked users" copy="Review and unblock people you have blocked." onPress={() => void openBlockedUsers()} divider />
        <PolicyRow icon={Trash2} title={deletionRequested ? 'Deletion request received' : 'Request account deletion'} copy="Ask the Code School team to delete your account and eligible data." onPress={requestDeletion} divider destructive />
      </View>
      <Pressable accessibilityRole="button" onPress={signOut} style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}><LogOut color={palette.rubySoft} size={19} /><Text style={styles.signOutText}>Sign out</Text></Pressable>
      <Text style={styles.version}>CSG Connect · Version {Application.nativeApplicationVersion || 'development'}</Text>
      <Modal visible={showBlockedUsers} transparent animationType="slide" onRequestClose={() => setShowBlockedUsers(false)}>
        <View style={styles.modalRoot}><Pressable accessibilityRole="button" accessibilityLabel="Close blocked users" onPress={() => setShowBlockedUsers(false)} style={StyleSheet.absoluteFill} /><View style={styles.blockedSheet}><View style={styles.sheetHandle} /><Text accessibilityRole="header" style={styles.sheetTitle}>Blocked users</Text><Text style={styles.sheetCopy}>Blocked people cannot start or continue a direct conversation with you. Their messages are hidden for you.</Text>{loadingBlockedUsers ? <ActivityIndicator color={palette.rubySoft} style={styles.sheetLoading} /> : blockedUsers.length ? blockedUsers.map((blockedUser) => <View key={blockedUser.id} style={styles.blockedRow}><Avatar name={blockedUser.full_name} size={38} /><Text numberOfLines={2} style={styles.blockedName}>{blockedUser.full_name}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Unblock ${blockedUser.full_name}`} onPress={() => void unblock(blockedUser.id)} style={styles.unblockButton}><Text style={styles.unblockText}>Unblock</Text></Pressable></View>) : <Text style={styles.emptyBlocked}>You have not blocked anyone.</Text>}<Pressable accessibilityRole="button" onPress={() => setShowBlockedUsers(false)} style={styles.doneButton}><Text style={styles.doneText}>Done</Text></Pressable></View></View>
      </Modal>
    </ScrollView></SafeAreaView>
  );
}

function PolicyRow({ icon: Icon, title, copy, onPress, divider = false, destructive = false }: { icon: typeof ShieldCheck; title: string; copy: string; onPress: () => void; divider?: boolean; destructive?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.policyRow, divider && styles.groupDivider, pressed && { opacity: 0.72 }]}><View style={styles.settingIcon}><Icon color={destructive ? palette.rubySoft : palette.rubySoft} size={19} /></View><View style={styles.flex}><Text style={[styles.settingTitle, destructive && styles.destructiveTitle]}>{title}</Text><Text style={styles.settingCopy}>{copy}</Text></View><ChevronRight color={palette.quiet} size={18} /></Pressable>;
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
  safe: { flex: 1, backgroundColor: palette.ink }, content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }, eyebrow: { ...typography.label, color: palette.rubySoft, fontFamily: fonts.bold, letterSpacing: 1.8 }, heading: { ...typography.display, color: palette.text, fontFamily: fonts.extraBold, letterSpacing: -1.2 }, person: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 22, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, marginTop: 22 }, name: { color: palette.text, fontFamily: fonts.bold, fontSize: 18 }, email: { ...typography.support, color: palette.muted, fontFamily: fonts.regular, marginTop: 2 }, role: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }, roleText: { ...typography.label, color: palette.success, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.8 }, demo: { marginTop: 14, padding: 16, borderRadius: 16, backgroundColor: '#2A2112', borderWidth: 1, borderColor: '#594522' }, demoTitle: { color: '#F0C56B', fontFamily: fonts.bold, fontSize: 13 }, demoCopy: { color: '#C8AE78', fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 4 }, sectionLabel: { ...typography.label, color: palette.subtle, fontFamily: fonts.bold, letterSpacing: 1.5, marginTop: 30, marginBottom: 8 }, group: { borderRadius: 20, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, overflow: 'hidden' }, setting: { minHeight: 82, paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 13 }, settingIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, settingTitle: { ...typography.body, color: palette.text, fontFamily: fonts.semibold }, settingCopy: { ...typography.meta, color: palette.subtle, fontFamily: fonts.regular, marginTop: 2 }, switchSlot: { width: 54, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, switch: { transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }] }, signOut: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 28 }, signOutText: { ...typography.body, color: palette.rubySoft, fontFamily: fonts.bold }, version: { ...typography.meta, color: palette.subtle, fontFamily: fonts.medium, textAlign: 'center', marginTop: 20 },
  manage: { minHeight: 76, marginTop: 12, paddingHorizontal: 16, borderRadius: 20, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', gap: 13 }, flex: { flex: 1, minWidth: 0 }, githubCard: { marginTop: 14, borderRadius: 20, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, padding: 16 }, githubHeader: { flexDirection: 'row', alignItems: 'center', gap: 13 }, githubForm: { flexDirection: 'row', gap: 9, marginTop: 14 }, githubInput: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.ink, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 13 }, save: { width: 50, minHeight: 48, borderRadius: 14, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.42 }, enrollment: { minHeight: 76, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 13 }, groupDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line }, enrollmentStatus: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11, textTransform: 'uppercase' }, enrollmentActive: { color: palette.success },
  policyRow: { minHeight: 82, paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 13 }, destructiveTitle: { color: palette.rubySoft }, modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' }, blockedSheet: { maxHeight: '75%', borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 }, sheetHandle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: palette.line, marginBottom: 18 }, sheetTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 20 }, sheetCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 18 }, sheetLoading: { marginVertical: 30 }, blockedRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line }, blockedName: { flex: 1, color: palette.text, fontFamily: fonts.semibold, fontSize: 13 }, unblockButton: { minHeight: 44, minWidth: 76, borderRadius: 12, borderWidth: 1, borderColor: '#6A2A36', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, unblockText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 }, emptyBlocked: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', paddingVertical: 30 }, doneButton: { minHeight: 48, borderRadius: 14, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center', marginTop: 14 }, doneText: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 },
});
