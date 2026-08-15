import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, CalendarClock, CheckCircle2, ExternalLink, History, MessageSquareText, ShieldAlert, UserRound, UserRoundCheck, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { analyticsAgeBucket, captureProductEvent } from '@/lib/analytics';
import { demoDms } from '@/lib/demo-data';
import { demoInterventions } from '@/lib/demo-staff';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { learningKeys } from '@/lib/learning';
import type { Intervention, InterventionOutcome, InterventionStatus } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

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
    mutationFn: (input: { status?: InterventionStatus; next_follow_up_at?: string; outcome?: InterventionOutcome; resolution_summary?: string }) => auth.demo
      ? Promise.resolve({ intervention: updateDemoIntervention(intervention!, input) })
      : api.updateIntervention(interventionId, input),
    onSuccess: async (result) => {
      queryClient.setQueryData(queryKey, result);
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

  if (!user?.is_staff || !Number.isInteger(interventionId) || interventionId <= 0) return <SafeAreaView style={styles.safe}><ErrorState message="This intervention is not available." retry={() => router.replace('/')} /></SafeAreaView>;
  if (query.isPending && !intervention) return <SafeAreaView style={styles.safe}><LoadingState label="Loading intervention" /></SafeAreaView>;
  if (!intervention) return <SafeAreaView style={styles.safe}><ErrorState message={query.error ? (query.error as Error).message : 'Intervention not found.'} retry={() => void query.refetch()} /></SafeAreaView>;
  const active = !['resolved', 'canceled'].includes(intervention.status);

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>INTERVENTION</Text><Text numberOfLines={1} style={styles.headerTitle}>{intervention.enrollment.student.full_name}</Text></View><ShieldAlert color={intervention.severity === 'urgent' ? '#FF7187' : palette.rubySoft} size={20} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.pills}><Pill label={intervention.status.replaceAll('_', ' ').toUpperCase()} tone="ruby" /><Pill label={intervention.trigger_type.replaceAll('_', ' ').toUpperCase()} tone="quiet" />{intervention.severity === 'urgent' && <Pill label="URGENT" tone="danger" />}</View>
      <Text style={styles.title}>{intervention.enrollment.student.full_name}</Text><Text style={styles.context}>{intervention.enrollment.cohort.name} · owned by {intervention.owner.full_name}</Text>
      <View style={styles.relationshipRow}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${intervention.enrollment.student.full_name}'s student health`} onPress={() => router.push({ pathname: '/staff/student/[id]', params: { id: String(intervention.enrollment.student.id), cohort_id: String(intervention.enrollment.cohort.id) } })} style={styles.relationshipButton}><UserRound color={palette.rubySoft} size={17} /><Text style={styles.relationshipText}>Student health</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Message ${intervention.enrollment.student.full_name}`} onPress={() => void openMessage()} style={styles.relationshipButton}><MessageSquareText color={palette.rubySoft} size={17} /><Text style={styles.relationshipText}>Message</Text></Pressable></View>

      <View style={[styles.followCard, intervention.follow_up_due && styles.followDue]}><CalendarClock color={intervention.follow_up_due ? '#FF7187' : palette.rubySoft} size={21} /><View style={styles.flex}><Text style={[styles.followTitle, intervention.follow_up_due && styles.dueText]}>{intervention.follow_up_due ? 'Follow-up due now' : 'Next follow-up'}</Text><Text style={styles.followCopy}>{formatDate(intervention.next_follow_up_at)}</Text></View></View>
      <View style={styles.card}><Text style={styles.label}>ACTION / NEXT STEP</Text><Text style={styles.body}>{intervention.action_summary || 'No action summary has been recorded.'}</Text></View>
      <View style={styles.card}><Text style={styles.label}>SAFE EVIDENCE</Text>{Object.entries(intervention.evidence_snapshot).map(([key, value]) => <View key={key} style={styles.evidenceRow}><Text style={styles.evidenceLabel}>{key.replaceAll('_', ' ')}</Text><Text numberOfLines={2} style={styles.evidenceValue}>{formatEvidence(value)}</Text></View>)}</View>

      {active && <View style={styles.card}><Text style={styles.label}>QUICK UPDATE</Text>{intervention.status === 'open' && <ActionButton icon={UserRoundCheck} label="Mark contacted" onPress={() => mutation.mutate({ status: 'contacted' })} disabled={mutation.isPending} />}<View style={styles.actionRow}><SmallAction label="Waiting on student" onPress={() => mutation.mutate({ status: 'waiting_on_student' })} disabled={mutation.isPending} /><SmallAction label="Monitor" onPress={() => mutation.mutate({ status: 'monitoring' })} disabled={mutation.isPending} /></View><ActionButton icon={CalendarClock} label="Schedule follow-up in 7 days" onPress={() => mutation.mutate({ status: 'monitoring', next_follow_up_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })} disabled={mutation.isPending} /><ActionButton icon={CheckCircle2} label="Resolve with outcome" onPress={() => setResolveOpen(true)} disabled={mutation.isPending} primary /></View>}
      {!active && <View style={styles.resolvedCard}><CheckCircle2 color={palette.success} size={20} /><Text style={styles.label}>OUTCOME · {intervention.outcome?.replaceAll('_', ' ').toUpperCase()}</Text><Text style={styles.resolvedBody}>{intervention.resolution_summary}</Text></View>}
      <Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, `/admin/interventions/${intervention.id}`).catch((error) => Alert.alert('Could not open full history', (error as Error).message))} style={styles.handoff}><History color={palette.warning} size={19} /><View style={styles.flex}><Text style={styles.handoffTitle}>Open full history on the web</Text><Text style={styles.handoffCopy}>Private notes, recovery plan check-ins, evidence, and detailed workflow controls</Text></View><ExternalLink color={palette.quiet} size={17} /></Pressable>
    </ScrollView>

    <Modal visible={resolveOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!mutation.isPending) setResolveOpen(false); }}><SafeAreaView style={styles.safe}><View style={styles.modalHeader}><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setResolveOpen(false)} style={styles.iconButton}><X color={palette.muted} size={21} /></Pressable><Text style={styles.modalTitle}>Resolve intervention</Text><View style={styles.iconButton} /></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}><Text style={styles.label}>OUTCOME</Text><View style={styles.outcomes}>{outcomes.map((item) => <Pressable key={item.value} accessibilityRole="button" onPress={() => setOutcome(item.value)} style={[styles.outcome, outcome === item.value && styles.outcomeSelected]}><Text style={[styles.outcomeText, outcome === item.value && styles.outcomeTextSelected]}>{item.label}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>RESOLUTION SUMMARY</Text><TextInput accessibilityLabel="Resolution summary" value={resolution} onChangeText={setResolution} multiline maxLength={2000} placeholder="What changed, and what should staff know next?" placeholderTextColor={palette.quiet} style={styles.input} /><Pressable accessibilityRole="button" disabled={!resolution.trim() || mutation.isPending} onPress={resolve} style={[styles.resolveButton, (!resolution.trim() || mutation.isPending) && styles.disabled]}><CheckCircle2 color={palette.text} size={17} /><Text style={styles.primaryText}>{mutation.isPending ? 'Saving…' : 'Resolve intervention'}</Text></Pressable></ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}

function ActionButton({ icon: Icon, label, onPress, disabled, primary = false }: { icon: typeof CheckCircle2; label: string; onPress: () => void; disabled: boolean; primary?: boolean }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.actionButton, primary && styles.actionPrimary, disabled && styles.disabled]}><Icon color={palette.text} size={17} /><Text style={styles.actionText}>{label}</Text></Pressable>; }
function SmallAction({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) { return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.smallAction, disabled && styles.disabled]}><Text style={styles.smallText}>{label}</Text></Pressable>; }
function Pill({ label, tone }: { label: string; tone: 'ruby' | 'danger' | 'quiet' }) { const color = tone === 'danger' ? '#FF7187' : tone === 'ruby' ? palette.rubySoft : palette.muted; return <Text style={[styles.pill, { color }]}>{label}</Text>; }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Not scheduled'; }
function formatEvidence(value: unknown) { if (Array.isArray(value)) return value.join(', ') || 'None'; if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join(' · '); return String(value); }
function updateDemoIntervention(intervention: Intervention, input: { status?: InterventionStatus; next_follow_up_at?: string; outcome?: InterventionOutcome; resolution_summary?: string }) { return { ...intervention, ...input, follow_up_due: input.next_follow_up_at ? Date.parse(input.next_follow_up_at) <= Date.now() : intervention.follow_up_due, resolved_at: input.status === 'resolved' ? new Date().toISOString() : intervention.resolved_at, updated_at: new Date().toISOString() }; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, content: { padding: 20, paddingBottom: 90, gap: 14 }, pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, pill: { fontFamily: fonts.bold, fontSize: 11, borderRadius: 9, overflow: 'hidden', backgroundColor: palette.panelRaised, paddingHorizontal: 8, paddingVertical: 5 }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34, marginTop: 4 }, context: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }, relationshipRow: { flexDirection: 'row', gap: 8 }, relationshipButton: { flex: 1, minHeight: 52, borderRadius: 15, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, relationshipText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, followCard: { borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, followDue: { borderColor: '#672A33', backgroundColor: '#28131A' }, followTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, dueText: { color: '#FF7187' }, followCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, marginTop: 3 }, card: { borderRadius: 20, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 16, gap: 10 }, label: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, body: { color: '#D8DBE2', fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 }, evidenceRow: { minHeight: 38, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, flexDirection: 'row', alignItems: 'center', gap: 10 }, evidenceLabel: { width: 120, color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, textTransform: 'uppercase' }, evidenceValue: { flex: 1, color: palette.text, fontFamily: fonts.medium, fontSize: 11, textAlign: 'right' }, actionButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, actionPrimary: { backgroundColor: palette.ruby, borderColor: palette.ruby }, actionText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, actionRow: { flexDirection: 'row', gap: 8 }, smallAction: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center' }, smallText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, resolvedCard: { borderRadius: 20, borderWidth: 1, borderColor: '#275442', backgroundColor: '#10231D', padding: 16, gap: 9 }, resolvedBody: { color: '#BFE7D5', fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 }, handoff: { minHeight: 82, borderRadius: 18, borderWidth: 1, borderColor: '#4B3A1A', backgroundColor: '#211B11', padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, handoffTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, handoffCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 3 }, modalHeader: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16 }, modalContent: { padding: 20, paddingBottom: 60 }, outcomes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, outcome: { minHeight: 42, borderRadius: 13, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, outcomeSelected: { borderColor: palette.ruby, backgroundColor: '#2A151B' }, outcomeText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 }, outcomeTextSelected: { color: palette.rubySoft }, fieldLabel: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1, marginTop: 24, marginBottom: 8 }, input: { minHeight: 150, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, padding: 13, textAlignVertical: 'top' }, resolveButton: { minHeight: 50, borderRadius: 15, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18 }, primaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, disabled: { opacity: 0.45 },
});
