import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, CalendarClock, CheckCircle2, ExternalLink, History, MessageSquareText, ShieldAlert, UserRound, UserRoundCheck, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import { analyticsAgeBucket, captureProductEvent } from '@/lib/analytics';
import { demoDms } from '@/lib/demo-data';
import { demoInterventions } from '@/lib/demo-staff';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { learningKeys, updateSupportQueueIntervention } from '@/lib/learning';
import type { Intervention, InterventionOutcome, InterventionStatus, SupportQueue } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { formatCourseDateTime } from '@/lib/course-time';

const outcomes: { value: InterventionOutcome; label: string }[] = [
  { value: 're_engaged', label: 'Re-engaged' },
  { value: 'plan_completed', label: 'Plan complete' },
  { value: 'support_resolved', label: 'Support resolved' },
  { value: 'referred', label: 'Referred' },
  { value: 'paused', label: 'Paused' },
  { value: 'withdrawn', label: 'Withdrew' },
  { value: 'no_change', label: 'No change' },
];

export default function StaffInterventionScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const interventionId = Number(id);
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const [resolveOpen, setResolveOpen] = useState(false);
  const [outcome, setOutcome] = useState<InterventionOutcome>('re_engaged');
  const [resolution, setResolution] = useState('');
  const queryKey = learningKeys.intervention(user?.id || 0, interventionId);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!auth.demo) return api.intervention(interventionId, signal);
      const intervention = demoInterventions.find((item) => item.id === interventionId);
      if (!intervention) throw new Error('Intervention not found.');
      return { intervention };
    },
    enabled: Boolean(user?.is_staff && Number.isInteger(interventionId) && interventionId > 0),
    meta: { persist: false },
  });
  const intervention = query.data?.intervention;
  const mutation = useMutation({
    mutationFn: (input: { owner_id?: number; status?: InterventionStatus; next_follow_up_at?: string; outcome?: InterventionOutcome; resolution_summary?: string }) => auth.demo
      ? Promise.resolve({ intervention: { ...updateDemoIntervention(intervention!, input), ...(input.owner_id && user ? { owner: { id: user.id, full_name: user.full_name }, owner_valid: true } : {}) } })
      : api.updateIntervention(interventionId, input),
    onSuccess: async (result) => {
      queryClient.setQueryData(queryKey, result);
      queryClient.setQueryData<{ support_queue: SupportQueue }>(learningKeys.supportQueue(user?.id || 0), (current) => current ? { support_queue: updateSupportQueueIntervention(current.support_queue, result.intervention) } : current);
      if (!auth.demo) await queryClient.invalidateQueries({ queryKey: learningKeys.supportQueue(user?.id || 0) });
    },
    onError: (error) => Alert.alert('Could not update intervention', (error as Error).message),
  });

  useEffect(() => {
    if (!intervention) return;
    captureProductEvent('intervention_opened', { cohort_id: intervention.enrollment.cohort.id, intervention_id: intervention.id, trigger_type: intervention.trigger_type, severity: intervention.severity });
  }, [intervention?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openMessage() {
    if (!intervention) return;
    try {
      const conversation = auth.demo
        ? demoDms.find((item) => item.cohort_id === intervention.enrollment.cohort.id && item.users.some((member) => member.id === intervention.enrollment.student.id))
        : (await api.createCohortDm(intervention.enrollment.cohort.id, [intervention.enrollment.student.id])).direct_conversation;
      if (!conversation) throw new Error('No cohort conversation is available for this student.');
      router.push({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(conversation.id) } });
    } catch (error) {
      Alert.alert('Could not open direct message', (error as Error).message);
    }
  }

  function resolve() {
    if (!intervention || !resolution.trim()) return;
    mutation.mutate({ status: 'resolved', outcome, resolution_summary: resolution.trim() }, {
      onSuccess: () => {
        captureProductEvent('intervention_resolved', { cohort_id: intervention.enrollment.cohort.id, intervention_id: intervention.id, trigger_type: intervention.trigger_type, outcome, age_bucket: analyticsAgeBucket(intervention.created_at) });
        setResolveOpen(false);
        setResolution('');
        Alert.alert('Intervention resolved', 'The outcome is saved in the connected history.');
      },
    });
  }

  if (!user?.is_staff) return <SafeAreaView style={styles.safe}><ErrorState title="Staff access only" message="Student interventions are available to instructors and admins." retryLabel="Go to Today" retry={() => router.replace('/')} /></SafeAreaView>;
  if (!Number.isInteger(interventionId) || interventionId <= 0) return <SafeAreaView style={styles.safe}><ErrorState message="This intervention link is invalid." retryLabel="Go to support queue" retry={() => router.replace('/staff/support')} /></SafeAreaView>;
  if (query.isPending && !intervention) return <SafeAreaView style={styles.safe}><LoadingState label="Loading intervention" /></SafeAreaView>;
  if (!intervention) return <SafeAreaView style={styles.safe}><ErrorState message={query.error ? (query.error as Error).message : 'Intervention not found.'} retry={() => void query.refetch()} /></SafeAreaView>;
  const active = !['resolved', 'canceled'].includes(intervention.status);

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft color={c.text.strong} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>INTERVENTION</Text><Text numberOfLines={1} style={styles.headerTitle}>{intervention.enrollment.student.full_name}</Text></View><ShieldAlert color={intervention.severity === 'urgent' ? c.status.danger.fg : c.text.body} size={20} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.pills}><Pill label={intervention.status.replaceAll('_', ' ').toUpperCase()} tone="ruby" /><Pill label={intervention.trigger_type.replaceAll('_', ' ').toUpperCase()} tone="quiet" />{intervention.severity === 'urgent' && <Pill label="URGENT" tone="danger" />}</View>
      <Text style={styles.title}>{intervention.enrollment.student.full_name}</Text><Text style={styles.context}>{intervention.enrollment.cohort.name} · owned by {intervention.owner.full_name}</Text>
      {active && intervention.owner_valid === false && <View accessibilityRole="alert" style={styles.ownerWarning}>
        <Text style={styles.ownerWarningTitle}>Owner can no longer access this cohort — reassign</Text>
        <Text style={styles.ownerWarningCopy}>Assign this intervention to yourself to receive follow-ups and keep support moving.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Assign intervention to me" disabled={mutation.isPending} onPress={() => mutation.mutate({ owner_id: user.id })} style={[styles.smallAction, mutation.isPending && styles.disabled]}><Text style={styles.smallText}>{mutation.isPending ? 'Assigning…' : 'Assign to me'}</Text></Pressable>
      </View>}
      <View style={styles.relationshipRow}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${intervention.enrollment.student.full_name}'s student health`} onPress={() => router.push({ pathname: '/staff/student/[id]', params: { id: String(intervention.enrollment.student.id), cohort_id: String(intervention.enrollment.cohort.id) } })} style={styles.relationshipButton}><UserRound color={c.text.body} size={17} /><Text style={styles.relationshipText}>Student health</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Message ${intervention.enrollment.student.full_name}`} onPress={() => void openMessage()} style={styles.relationshipButton}><MessageSquareText color={c.text.body} size={17} /><Text style={styles.relationshipText}>Message</Text></Pressable></View>

      <View style={[styles.followCard, intervention.follow_up_due && styles.followDue]}><CalendarClock color={intervention.follow_up_due ? c.status.warning.fg : c.text.body} size={21} /><View style={styles.flex}><Text style={[styles.followTitle, intervention.follow_up_due && styles.dueText]}>{intervention.follow_up_due ? 'Follow-up due now' : 'Next follow-up'}</Text><Text style={styles.followCopy}>{formatDate(intervention.next_follow_up_at)}</Text></View></View>
      <View style={styles.card}><Text style={styles.label}>ACTION / NEXT STEP</Text><Text style={styles.body}>{intervention.action_summary || 'No action summary has been recorded.'}</Text></View>
      <View style={styles.card}><Text style={styles.label}>SAFE EVIDENCE</Text>{Object.entries(intervention.evidence_snapshot).map(([key, value]) => <View key={key} style={styles.evidenceRow}><Text style={styles.evidenceLabel}>{key.replaceAll('_', ' ')}</Text><Text numberOfLines={2} style={styles.evidenceValue}>{formatEvidence(value)}</Text></View>)}</View>

      {active && <View style={styles.card}><Text style={styles.label}>QUICK UPDATE</Text>{intervention.status === 'open' && <ActionButton icon={UserRoundCheck} label="Mark contacted" onPress={() => mutation.mutate({ status: 'contacted' })} disabled={mutation.isPending} />}<View style={styles.actionRow}><SmallAction label="Waiting on student" onPress={() => mutation.mutate({ status: 'waiting_on_student' })} disabled={mutation.isPending} /><SmallAction label="Monitor" onPress={() => mutation.mutate({ status: 'monitoring' })} disabled={mutation.isPending} /></View><ActionButton icon={CalendarClock} label="Schedule follow-up in 7 days" onPress={() => mutation.mutate({ status: 'monitoring', next_follow_up_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })} disabled={mutation.isPending} /><ActionButton icon={CheckCircle2} label="Resolve with outcome" onPress={() => setResolveOpen(true)} disabled={mutation.isPending} primary /></View>}
      {!active && <View style={styles.resolvedCard}><CheckCircle2 color={c.status.success.fg} size={20} /><Text style={styles.label}>OUTCOME · {intervention.outcome?.replaceAll('_', ' ').toUpperCase()}</Text><Text style={styles.resolvedBody}>{intervention.resolution_summary}</Text></View>}
      <Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, `/admin/interventions/${intervention.id}`).catch((error) => Alert.alert('Could not open full history', (error as Error).message))} style={styles.handoff}><History color={c.status.warning.fg} size={19} /><View style={styles.flex}><Text style={styles.handoffTitle}>Open full history on the web</Text><Text style={styles.handoffCopy}>Private notes, recovery plan check-ins, evidence, and detailed workflow controls</Text></View><ExternalLink color={c.text.muted} size={17} /></Pressable>
    </ScrollView>

    <Modal visible={resolveOpen} animationType="fade" presentationStyle="pageSheet" onRequestClose={() => { if (!mutation.isPending) setResolveOpen(false); }}><SafeAreaView style={styles.safe}><View style={styles.modalHeader}><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setResolveOpen(false)} style={styles.iconButton}><X color={c.text.body} size={21} /></Pressable><Text style={styles.modalTitle}>Resolve intervention</Text><View style={styles.iconButton} /></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}><Text style={styles.label}>OUTCOME</Text><View accessibilityRole="radiogroup" accessibilityLabel="Intervention outcome" style={styles.outcomes}>{outcomes.map((item) => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: outcome === item.value }} onPress={() => setOutcome(item.value)} style={[styles.outcome, styles.outcomeTouch, outcome === item.value && styles.outcomeSelected]}><Text style={[styles.outcomeText, outcome === item.value && styles.outcomeTextSelected]}>{item.label}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>RESOLUTION SUMMARY</Text><TextInput keyboardAppearance={scheme} accessibilityLabel="Resolution summary input" value={resolution} onChangeText={setResolution} multiline maxLength={2000} placeholder="What changed, and what should staff know next?" placeholderTextColor={c.text.body} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel="Confirm resolve intervention" disabled={!resolution.trim() || mutation.isPending} onPress={resolve} style={[styles.resolveButton, (!resolution.trim() || mutation.isPending) && styles.disabled]}><CheckCircle2 color={c.text.strong} size={17} /><Text style={styles.primaryText}>{mutation.isPending ? 'Saving…' : 'Resolve intervention'}</Text></Pressable></ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}

function ActionButton({ icon: Icon, label, onPress, disabled, primary = false }: { icon: typeof CheckCircle2; label: string; onPress: () => void; disabled: boolean; primary?: boolean }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); const foreground = primary ? c.text.onAction : c.text.strong; return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.actionButton, primary && styles.actionPrimary, disabled && styles.disabled]}><Icon color={foreground} size={17} /><Text style={[styles.actionText, { color: foreground }]}>{label}</Text></Pressable>; }
function SmallAction({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  const styles = useStyles(); return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.smallAction, disabled && styles.disabled]}><Text style={styles.smallText}>{label}</Text></Pressable>; }
function Pill({ label, tone }: { label: string; tone: 'ruby' | 'danger' | 'quiet' }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); const toneColors = tone === 'danger' ? c.status.danger : tone === 'ruby' ? c.status.pending : { fg: c.text.body, bg: c.surface.sunken, border: c.border.subtle }; return <Text style={[styles.pill, { color: toneColors.fg, backgroundColor: toneColors.bg, borderColor: toneColors.border, borderWidth: 1 }]}>{label}</Text>; }
function formatDate(value: string | null) { return value ? formatCourseDateTime(value, { fallback: value }) : 'Not scheduled'; }
function formatEvidence(value: unknown) { if (Array.isArray(value)) return value.join(', ') || 'None'; if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join(' · '); return String(value); }
function updateDemoIntervention(intervention: Intervention, input: { status?: InterventionStatus; next_follow_up_at?: string; outcome?: InterventionOutcome; resolution_summary?: string }) { return { ...intervention, ...input, follow_up_due: input.next_follow_up_at ? Date.parse(input.next_follow_up_at) <= Date.now() : intervention.follow_up_due, resolved_at: input.status === 'resolved' ? new Date().toISOString() : intervention.resolved_at, updated_at: new Date().toISOString() }; }

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  ownerWarning: { borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: c.status.warning.border, backgroundColor: c.status.warning.bg },
  ownerWarningTitle: { color: c.status.warning.fg, fontFamily: fonts.bold, fontSize: 14, lineHeight: 21 },
  ownerWarningCopy: { color: c.status.warning.fg, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  outcomeTouch: { minHeight: 44 },
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, content: { padding: 20, paddingBottom: 90, gap: 14 }, pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, pill: { fontFamily: fonts.bold, fontSize: 12, borderRadius: 9, overflow: 'hidden', backgroundColor: c.surface.sunken, paddingHorizontal: 8, paddingVertical: 5 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34, marginTop: 4 }, context: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }, relationshipRow: { flexDirection: 'row', gap: 8 }, relationshipButton: { flex: 1, minHeight: 52, borderRadius: 15, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, relationshipText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, followCard: { borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, followDue: { borderColor: c.status.warning.border, backgroundColor: c.status.warning.bg}, followTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, dueText: { color: c.status.warning.fg}, followCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }, card: { borderRadius: 20, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 16, gap: 10 }, label: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, body: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 }, evidenceRow: { minHeight: 38, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', gap: 10 }, evidenceLabel: { width: 120, color: c.text.body, fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase' }, evidenceValue: { flex: 1, color: c.text.strong, fontFamily: fonts.medium, fontSize: 12, textAlign: 'right' }, actionButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, actionPrimary: { backgroundColor: c.action.primary, borderColor: c.action.primary }, actionText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, actionRow: { flexDirection: 'row', gap: 8 }, smallAction: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, alignItems: 'center', justifyContent: 'center' }, smallText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, resolvedCard: { borderRadius: 20, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 16, gap: 9 }, resolvedBody: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 }, handoff: { minHeight: 82, borderRadius: 18, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, handoffTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, handoffCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 3 }, modalHeader: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16 }, modalContent: { padding: 20, paddingBottom: 60 }, outcomes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, outcome: { minHeight: 42, borderRadius: 13, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, outcomeSelected: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, outcomeText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, outcomeTextSelected: { color: c.text.strong }, fieldLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1, marginTop: 24, marginBottom: 8 }, input: { minHeight: 150, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, padding: 13, textAlignVertical: 'top' }, resolveButton: { minHeight: 50, borderRadius: 15, backgroundColor: c.selection.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18 }, primaryText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, disabled: { opacity: 0.45 },
}));
