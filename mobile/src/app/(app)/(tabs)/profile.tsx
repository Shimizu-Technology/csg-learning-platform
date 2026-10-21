import { haptic } from '@/lib/haptics';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { themedAlert as Alert } from '@/lib/alerts';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import * as Application from 'expo-application';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Activity, Bell, CalendarCheck, Check, ChevronRight, FileText, GitBranch, GraduationCap, LogOut, Mail, RefreshCw, Save, Settings2, ShieldCheck, Trash2, UserX } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { fontScaleLimits, fonts, typography } from '@/constants/csg-theme';
import { useAsyncOperationGuard } from '@/hooks/use-async-operation-guard';
import { isStudentDashboard, learningKeys } from '@/lib/learning';
import { useCohort } from '@/providers/cohort-provider';
import { disableMobilePushPreference } from '@/lib/mobile-push-preference';
import { attemptPushRegistration, getPushPermissionStatus, pushPermissionAllowsDelivery, requestPushPermission, type PushPermissionStatus } from '@/lib/push-notifications';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function ProfileScreen() {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user, refresh, signOut: endSession } = useSession();
  const profileQuery = useQuery({ queryKey: learningKeys.profile(user?.id || 0), queryFn: ({ signal }) => api.profile(signal), enabled: Boolean(user && !auth.demo) });
  const { selectedCohortId } = useCohort();
  // Same cached dashboard as Today: it says whether this course uses GitHub and offers private meetings.
  const dashboardQuery = useQuery({ queryKey: learningKeys.dashboard(user?.id || 0, selectedCohortId), queryFn: ({ signal }) => api.dashboard(signal, selectedCohortId), enabled: Boolean(user && !user.is_staff && !auth.demo) });
  const studentDashboard = dashboardQuery.data?.dashboard && isStudentDashboard(dashboardQuery.data.dashboard) ? dashboardQuery.data.dashboard : null;
  const savedGithub = profileQuery.data?.user.github_username || user?.github_username || '';
  // Learners only see the GitHub card when their course uses GitHub (or they already linked one); staff always do.
  // If the dashboard cannot load, keep the card so a learner who needs GitHub is never blocked.
  const showGithub = !auth.demo && (Boolean(user?.is_staff) || Boolean(savedGithub) || Boolean(studentDashboard?.cohort?.requires_github) || dashboardQuery.isError);

  const [deviceNotificationsEnabled, setDeviceNotificationsEnabled] = useState(auth.demo);
  const [devicePermission, setDevicePermission] = useState<PushPermissionStatus>(auth.demo ? 'granted' : 'undetermined');
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [loadingPreference, setLoadingPreference] = useState(!auth.demo);
  const [preferenceLoadError, setPreferenceLoadError] = useState<string | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const preferenceLoadGeneration = useRef(0);
  const { pending: registrationPending, begin: beginRegistration, finish: finishRegistration, isCurrent: registrationIsCurrent, invalidate: invalidateRegistration } = useAsyncOperationGuard();
  const [updatingPreference, setUpdatingPreference] = useState(false);
  const emailPreferenceUpdatePending = useRef(false);
  const emailPreferenceGeneration = useRef(0);
  const [updatingEmailPreference, setUpdatingEmailPreference] = useState(false);
  const [showBlockedUsers, setShowBlockedUsers] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<Awaited<ReturnType<typeof api.blockedUsers>>['blocked_users']>([]);
  const [loadingBlockedUsers, setLoadingBlockedUsers] = useState(false);
  const [deletionRequested, setDeletionRequested] = useState(false);
  const loadNotificationPreferences = useCallback(async () => {
    if (auth.demo) return true;
    const generation = ++preferenceLoadGeneration.current;
    const emailGeneration = emailPreferenceGeneration.current;
    const emailUpdateWasPending = emailPreferenceUpdatePending.current;
    setLoadingPreference(true);
    setPreferenceLoadError(null);
    setRegistrationError(null);
    try {
      const [mobileConfig, emailConfig, permission] = await Promise.all([api.mobilePushConfig(), api.pushConfig(), getPushPermissionStatus()]);
      if (preferenceLoadGeneration.current !== generation) return false;
      setDeviceNotificationsEnabled(mobileConfig.notifications_enabled);
      if (!emailUpdateWasPending && emailPreferenceGeneration.current === emailGeneration) setEmailNotificationsEnabled(emailConfig.notifications_enabled);
      setDevicePermission(permission);
      if (mobileConfig.notifications_enabled && pushPermissionAllowsDelivery(permission)) {
        const registration = beginRegistration();
        void attemptPushRegistration(api, () => preferenceLoadGeneration.current === generation && registrationIsCurrent(registration)).then((result) => {
          if (preferenceLoadGeneration.current === generation && finishRegistration(registration)) setRegistrationError(result.ok ? null : result.message);
        });
      }
      return true;
    } catch (requestError) {
      if (preferenceLoadGeneration.current === generation) setPreferenceLoadError((requestError as Error).message || 'Could not load notification preferences.');
      return false;
    } finally {
      if (preferenceLoadGeneration.current === generation) setLoadingPreference(false);
    }
  }, [api, auth.demo, beginRegistration, finishRegistration, registrationIsCurrent]);
  useFocusEffect(useCallback(() => {
    void loadNotificationPreferences();
    return () => {
      preferenceLoadGeneration.current += 1;
      invalidateRegistration();
      setUpdatingPreference(false);
    };
  }, [invalidateRegistration, loadNotificationPreferences]));
  const showNotificationSettingsAlert = () => Alert.alert(
    'Notifications are off',
    'Allow notifications in your device settings when you are ready.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ],
  );
  const enableDeviceNotifications = async () => {
    const generation = beginRegistration();
    let accountPreferenceEnabled = false;
    setUpdatingPreference(true);
    try {
      const permission = await requestPushPermission();
      if (!registrationIsCurrent(generation)) return;
      setDevicePermission(permission);
      if (!pushPermissionAllowsDelivery(permission)) {
        if (!auth.demo) {
          try {
            await api.updateMobilePushPreference(false);
          } catch {
            if (!registrationIsCurrent(generation)) return;
            const recovered = await loadNotificationPreferences();
            if (registrationIsCurrent(generation) && recovered) showNotificationSettingsAlert();
            return;
          }
        }
        setDeviceNotificationsEnabled(false);
        showNotificationSettingsAlert();
        return;
      }
      if (!auth.demo) {
        await api.updateMobilePushPreference(true);
        accountPreferenceEnabled = true;
        const registration = await attemptPushRegistration(api, () => registrationIsCurrent(generation));
        if (!registrationIsCurrent(generation)) return;
        if (!registration.ok) throw new Error(registration.message);
      }
      setRegistrationError(null);
      setDeviceNotificationsEnabled(true);
    } catch (requestError) {
      if (!registrationIsCurrent(generation)) return;
      if (!auth.demo && accountPreferenceEnabled) {
        try {
          await api.updateMobilePushPreference(false);
          accountPreferenceEnabled = false;
        } catch (rollbackError) {
          if (!registrationIsCurrent(generation)) return;
          const reconnectMessage = `${(requestError as Error).message} The account setting is still on because it could not be rolled back: ${(rollbackError as Error).message}`;
          setRegistrationError(reconnectMessage);
          setDeviceNotificationsEnabled(true);
          Alert.alert('Device notifications need attention', 'Notifications remain on for your account, but this device is not connected. Use Retry when your connection is stable.');
          return;
        }
      }
      setDeviceNotificationsEnabled(accountPreferenceEnabled);
      Alert.alert('Could not turn on device notifications', (requestError as Error).message);
    } finally {
      if (finishRegistration(generation)) setUpdatingPreference(false);
    }
  };
  const retryDeviceRegistration = async () => {
    const generation = beginRegistration(true);
    const registration = auth.demo ? { ok: true as const } : await attemptPushRegistration(api, () => registrationIsCurrent(generation));
    if (!finishRegistration(generation)) return;
    setRegistrationError(registration.ok ? null : registration.message);
    if (!registration.ok) Alert.alert('Could not reconnect notifications', registration.message);
  };
  const toggleDeviceNotifications = (enabled: boolean) => {
    if (enabled) {
      if (devicePermission === 'denied') {
        showNotificationSettingsAlert();
        return;
      }
      Alert.alert(
        'Turn on device notifications?',
        'Get timely alerts for messages, announcements, grades, submissions, and support updates.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: () => void enableDeviceNotifications() }],
      );
      return;
    }
    const previous = deviceNotificationsEnabled;
    void disableMobilePushPreference({
      previousEnabled: previous,
      persistDisabled: () => auth.demo ? Promise.resolve() : api.updateMobilePushPreference(false),
      invalidateRegistration,
      setEnabled: setDeviceNotificationsEnabled,
      clearRegistrationError: () => setRegistrationError(null),
      setUpdating: setUpdatingPreference,
      reloadPreferences: async () => { await loadNotificationPreferences(); },
      reportError: (requestError) => Alert.alert('Could not update device notifications', requestError.message),
    });
  };
  const toggleEmailNotifications = async (enabled: boolean) => {
    if (emailPreferenceUpdatePending.current) return;
    const generation = ++emailPreferenceGeneration.current;
    emailPreferenceUpdatePending.current = true;
    setUpdatingEmailPreference(true);
    const previous = emailNotificationsEnabled;
    setEmailNotificationsEnabled(enabled);
    try {
      if (!auth.demo) {
        const response = await api.updateGlobalNotifications(enabled);
        if (emailPreferenceGeneration.current === generation) setEmailNotificationsEnabled(response.notifications_enabled);
      }
    } catch (requestError) {
      if (emailPreferenceGeneration.current === generation) {
        setEmailNotificationsEnabled(previous);
        Alert.alert('Could not update email notifications', (requestError as Error).message);
      }
    } finally {
      if (emailPreferenceGeneration.current === generation) {
        emailPreferenceUpdatePending.current = false;
        setUpdatingEmailPreference(false);
      }
    }
  };
  const signOut = () => Alert.alert('Sign out?', 'You can sign back in at any time.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { haptic('destructive'); void endSession(); } }]);
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
        haptic('destructive');
        try { if (!auth.demo) await api.requestDataDeletion(); setDeletionRequested(true); Alert.alert('Request received', 'The Code School team will review your request and contact you about any records that must be retained.'); }
        catch (requestError) { Alert.alert('Could not send request', (requestError as Error).message); }
      } },
    ],
  );
  return (
    <SafeAreaView edges={['top']} style={styles.safe}><ScrollView contentContainerStyle={styles.content}>
      <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>YOUR ACCOUNT</Text><Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.heading}>You</Text>
      <View style={styles.person}><Avatar name={user?.full_name || 'CSG User'} size={62} /><View style={styles.flex}><Text style={styles.name}>{user?.full_name || 'Code School member'}</Text><Text style={styles.email}>{user?.email}</Text><View style={styles.role}><ShieldCheck color={c.status.success.fg} size={13} /><Text style={styles.roleText}>{user?.role || 'member'}</Text></View></View></View>
      {auth.demo && <View style={styles.demo}><Text style={styles.demoTitle}>Simulator walkthrough</Text><Text style={styles.demoCopy}>Local sample data is active. This mode is compiled out of production behavior.</Text></View>}
      {showGithub && <GithubEditor initialValue={savedGithub} api={api} userId={user?.id || 0} afterSave={refresh} />}
      {studentDashboard?.private_meetings_enabled && <Pressable accessibilityRole="button" accessibilityLabel="Book your weekly private hour" accessibilityHint="Choose or change your weekly meeting in the app" onPress={() => router.push('/meetings' as Href)} style={styles.manage} testID="profile-book-private-hour"><View style={styles.settingIcon}><CalendarCheck color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>Book your weekly private hour</Text><Text style={styles.settingCopy}>Choose or change your 60-minute Zoom hour.</Text></View><ChevronRight color={c.text.body} size={18} /></Pressable>}
      {!!profileQuery.data?.enrollments.length && <><Text style={styles.sectionLabel}>ENROLLMENTS</Text><View style={styles.group}>{profileQuery.data.enrollments.map((enrollment, index) => <View key={enrollment.id} style={[styles.enrollment, index > 0 && styles.groupDivider]}><View style={styles.settingIcon}><GraduationCap color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>{enrollment.cohort_name}</Text><Text style={styles.settingCopy}>{enrollment.curriculum_name}</Text></View><Text style={[styles.enrollmentStatus, enrollment.status === 'active' && styles.enrollmentActive]}>{enrollment.status}</Text></View>)}</View></>}
      <Pressable accessibilityRole="button" accessibilityLabel="Open your activity history" onPress={() => router.push('/activity' as Href)} style={styles.manage}><View style={styles.settingIcon}><Activity color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>Your activity history</Text><Text style={styles.settingCopy}>Review your sign-ins, learning progress, and saved work.</Text></View><ChevronRight color={c.text.muted} size={18} /></Pressable>
      <Text style={styles.sectionLabel}>PREFERENCES</Text>
      <View style={styles.group}>
        {preferenceLoadError ? <View style={styles.preferenceError}><View style={styles.settingIcon}><Bell color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>Notifications unavailable</Text><Text style={styles.settingCopy}>{preferenceLoadError}</Text></View><Button accessibilityRole="button" accessibilityLabel="Retry notification preferences" onPress={() => void loadNotificationPreferences()} style={styles.retryPreference} variant="secondary" label="Try again" textStyle={styles.retryPreferenceText} /></View> : <>
        <View style={styles.setting}><View style={styles.settingIcon}><Bell color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>Device notifications</Text><Text style={styles.settingCopy}>{registrationError ? 'On for your account, but this device needs to reconnect.' : devicePermission === 'denied' ? 'Off in device settings. Turn on to open Settings.' : devicePermission === 'provisional' ? 'Delivered quietly until you choose prominent alerts in iOS.' : devicePermission === 'ephemeral' ? 'Temporarily allowed by iOS for this app session.' : 'Messages, announcements, grades, submissions, and support updates.'}</Text></View><View style={styles.switchSlot}>{loadingPreference || updatingPreference || registrationPending ? <ActivityIndicator color={c.text.body} size="small" /> : <Switch accessibilityLabel="Device notifications" value={deviceNotificationsEnabled && pushPermissionAllowsDelivery(devicePermission)} onValueChange={toggleDeviceNotifications} trackColor={{ false: c.border.subtle, true: c.surface.sunken }} thumbColor={deviceNotificationsEnabled && pushPermissionAllowsDelivery(devicePermission) ? c.text.body : c.text.body} style={styles.switch} />}</View></View>
        {registrationError && <View style={styles.registrationWarning}><RefreshCw color={c.status.warning.fg} size={18} /><View style={styles.flex}><Text style={styles.registrationWarningTitle}>Reconnect this device</Text><Text style={styles.registrationWarningCopy}>{registrationError}</Text></View><Button accessibilityRole="button" accessibilityLabel="Retry device notification registration" disabled={registrationPending} onPress={() => void retryDeviceRegistration()} style={styles.retryPreference} variant="secondary" label="Retry" textStyle={styles.retryPreferenceText} /></View>}
        <View style={[styles.setting, styles.groupDivider]}><View style={styles.settingIcon}><Mail color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>Message emails</Text><Text style={styles.settingCopy}>Email alerts for direct messages and mentions. Conversation mutes still apply.</Text></View><View style={styles.switchSlot}>{loadingPreference || updatingEmailPreference ? <ActivityIndicator color={c.text.body} size="small" /> : <Switch accessibilityLabel="Message emails" value={emailNotificationsEnabled} onValueChange={(value) => void toggleEmailNotifications(value)} trackColor={{ false: c.border.subtle, true: c.surface.sunken }} thumbColor={emailNotificationsEnabled ? c.text.body : c.text.body} style={styles.switch} />}</View></View>
        </>}
      </View>
      {user?.is_staff && <Pressable accessibilityRole="button" accessibilityLabel="Manage communication workspaces" onPress={() => router.push('/manage-communications' as Href)} style={styles.manage}><View style={styles.settingIcon}><Settings2 color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>Communication settings</Text><Text style={styles.settingCopy}>Manage workspaces, members, and channels.</Text></View><ChevronRight color={c.text.muted} size={18} /></Pressable>}
      <Text style={styles.sectionLabel}>PRIVACY & SAFETY</Text>
      <View style={styles.group}>
        <PolicyRow icon={ShieldCheck} title="Privacy policy" copy="How CSG Learn handles account and learning data." onPress={() => openPolicy(policy?.privacy_url || 'https://learn.codeschoolofguam.com/privacy')} />
        <PolicyRow icon={FileText} title="Terms & Community Guidelines" copy="Rules that keep class conversations safe." onPress={() => openPolicy(policy?.terms_url || 'https://learn.codeschoolofguam.com/terms')} divider />
        <PolicyRow icon={UserX} title="Blocked users" copy="Review and unblock people you have blocked." onPress={() => void openBlockedUsers()} divider />
        <PolicyRow icon={Trash2} title={deletionRequested ? 'Deletion request received' : 'Request account deletion'} copy="Ask the Code School team to delete your account and eligible data." onPress={requestDeletion} divider destructive />
      </View>
      <Button variant="quiet" accessibilityRole="button" onPress={signOut} style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}><LogOut color={c.text.body} size={19} /><Text style={styles.signOutText}>Sign out</Text></Button>
      <Text style={styles.version}>CSG Learn · Version {Application.nativeApplicationVersion || 'development'}</Text>
      <Modal visible={showBlockedUsers} transparent animationType="fade" onRequestClose={() => setShowBlockedUsers(false)}>
        <View style={styles.modalRoot}><Pressable accessibilityRole="button" accessibilityLabel="Close blocked users" onPress={() => setShowBlockedUsers(false)} style={StyleSheet.absoluteFill} /><View style={styles.blockedSheet}><View style={styles.sheetHandle} /><Text accessibilityRole="header" style={styles.sheetTitle}>Blocked users</Text><Text style={styles.sheetCopy}>Blocked people cannot start or continue a direct conversation with you. Their messages are hidden for you.</Text>{loadingBlockedUsers ? <ActivityIndicator color={c.text.body} style={styles.sheetLoading} /> : blockedUsers.length ? blockedUsers.map((blockedUser) => <View key={blockedUser.id} style={styles.blockedRow}><Avatar name={blockedUser.full_name} size={38} /><Text numberOfLines={2} style={styles.blockedName}>{blockedUser.full_name}</Text><Button accessibilityRole="button" accessibilityLabel={`Unblock ${blockedUser.full_name}`} onPress={() => void unblock(blockedUser.id)} style={styles.unblockButton} variant="secondary" label="Unblock" textStyle={styles.unblockText} /></View>) : <Text style={styles.emptyBlocked}>You have not blocked anyone.</Text>}<Button accessibilityRole="button" onPress={() => setShowBlockedUsers(false)} style={styles.doneButton} variant="primary" label="Done" textStyle={styles.doneText} /></View></View>
      </Modal>
    </ScrollView></SafeAreaView>
  );
}

function PolicyRow({ icon: Icon, title, copy, onPress, divider = false, destructive = false }: { icon: typeof ShieldCheck; title: string; copy: string; onPress: () => void; divider?: boolean; destructive?: boolean }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.policyRow, divider && styles.groupDivider, pressed && { opacity: 0.72 }]}><View style={styles.settingIcon}><Icon color={destructive ? c.text.body : c.text.body} size={19} /></View><View style={styles.flex}><Text style={[styles.settingTitle, destructive && styles.destructiveTitle]}>{title}</Text><Text style={styles.settingCopy}>{copy}</Text></View><ChevronRight color={c.text.muted} size={18} /></Pressable>;
}

function GithubEditor({ initialValue, api, userId, afterSave }: { initialValue: string; api: ReturnType<typeof useSession>['api']; userId: number; afterSave: () => Promise<void> }) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
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
  return <View style={styles.githubCard}><View style={styles.githubHeader}><View style={styles.settingIcon}><GitBranch color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.settingTitle}>GitHub username</Text><Text style={styles.settingCopy}>Used for repository-based class work.</Text></View></View><View style={styles.githubForm}><TextInput keyboardAppearance={scheme} accessibilityLabel="GitHub username" value={username} onChangeText={(value) => { setDraft(value); setSaved(false); setDirty(true); }} autoCapitalize="none" autoCorrect={false} placeholder="your-username" placeholderTextColor={c.text.body} style={styles.githubInput} /><Button variant="secondary" accessibilityRole="button" accessibilityLabel="Save GitHub username" disabled={mutation.isPending || unchanged} onPress={() => mutation.mutate()} style={[styles.save, (mutation.isPending || unchanged) && styles.disabled]}>{mutation.isPending ? <ActivityIndicator color={c.text.onAction} /> : saved ? <Check color={c.text.onAction} size={18} /> : <Save color={c.text.onAction} size={18} />}</Button></View></View>;

}
const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }, eyebrow: { ...typography.label, color: c.text.body, fontFamily: fonts.bold, letterSpacing: 1.8 }, heading: { ...typography.display, color: c.text.strong, fontFamily: fonts.extraBold, letterSpacing: -1.2 }, person: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 22, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, marginTop: 22 }, name: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 18 }, email: { ...typography.support, color: c.text.body, fontFamily: fonts.regular, marginTop: 2 }, role: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }, roleText: { ...typography.label, color: c.status.success.fg, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.8 }, demo: { marginTop: 14, padding: 16, borderRadius: 16, backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong }, demoTitle: { color: c.text.body, fontFamily: fonts.bold, fontSize: 13 }, demoCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 4 }, sectionLabel: { ...typography.label, color: c.text.body, fontFamily: fonts.bold, letterSpacing: 1.5, marginTop: 30, marginBottom: 8 }, group: { borderRadius: 20, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, overflow: 'hidden' }, setting: { minHeight: 82, paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 13 }, settingIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, settingTitle: { ...typography.body, color: c.text.strong, fontFamily: fonts.semibold }, settingCopy: { ...typography.meta, color: c.text.body, fontFamily: fonts.regular, marginTop: 2 }, switchSlot: { width: 54, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, switch: { transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }] }, signOut: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 28 }, signOutText: { ...typography.body, color: c.text.body, fontFamily: fonts.bold }, version: { ...typography.meta, color: c.text.body, fontFamily: fonts.medium, textAlign: 'center', marginTop: 20 },
  manage: { minHeight: 76, marginTop: 12, paddingHorizontal: 16, borderRadius: 20, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', gap: 13 }, flex: { flex: 1, minWidth: 0 }, githubCard: { marginTop: 14, borderRadius: 20, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, padding: 16 }, githubHeader: { flexDirection: 'row', alignItems: 'center', gap: 13 }, githubForm: { flexDirection: 'row', gap: 9, marginTop: 14 }, githubInput: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.page, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 13 }, save: { width: 50, minHeight: 48, borderRadius: 14, backgroundColor: c.action.primary, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.42 }, enrollment: { minHeight: 76, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 13 }, groupDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle }, enrollmentStatus: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase' }, enrollmentActive: { color: c.status.success.fg },
  policyRow: { minHeight: 82, paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 13 }, destructiveTitle: { color: c.status.danger.fg }, modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay }, blockedSheet: { maxHeight: '75%', borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 }, sheetHandle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: c.border.subtle, marginBottom: 18 }, sheetTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 20 }, sheetCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 18 }, sheetLoading: { marginVertical: 30 }, blockedRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle }, blockedName: { flex: 1, color: c.text.strong, fontFamily: fonts.semibold, fontSize: 13 }, unblockButton: { minHeight: 44, minWidth: 76, borderRadius: 12, borderWidth: 1, borderColor: c.border.strong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, unblockText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, emptyBlocked: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', paddingVertical: 30 }, doneButton: { minHeight: 48, borderRadius: 14, backgroundColor: c.action.primary, alignItems: 'center', justifyContent: 'center', marginTop: 14 }, doneText: { color: c.text.onAction, fontFamily: fonts.bold, fontSize: 14 },
  preferenceError: { minHeight: 82, paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 13 }, retryPreference: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.border.strong, justifyContent: 'center', paddingHorizontal: 12 }, retryPreferenceText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  registrationWarning: { minHeight: 72, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.status.warning.border, backgroundColor: c.status.warning.bg, flexDirection: 'row', alignItems: 'center', gap: 12 }, registrationWarningTitle: { color: c.status.warning.fg, fontFamily: fonts.bold, fontSize: 12 }, registrationWarningCopy: { color: c.status.warning.fg, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 2 },
}));
