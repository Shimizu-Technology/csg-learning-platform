import { BackButton } from '@/components/back-button';
import { Button } from '@/components/ui/button';
import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowRight, CalendarClock, CheckCircle2, Clock3, LifeBuoy, MessageSquareReply, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { newReplyRequestId } from '@/lib/reply-attempt';
import { Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StaffAttention } from '@/components/staff-attention';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { StaffOnlyScreen } from '@/components/staff-only-screen';
import { VoiceDraftButton, VoiceDraftPanel } from '@/components/voice-draft-controls';
import { fonts } from '@/constants/csg-theme';
import { useVoiceDraft } from '@/hooks/use-voice-draft';
import { analyticsAgeBucket, captureProductEvent } from '@/lib/analytics';
import { demoSupportQueue } from '@/lib/demo-staff';
import { isStaffAttentionQuery, learningKeys, updateSupportQueueHelpRequest } from '@/lib/learning';
import type { HelpRequest, SupportQueue } from '@/lib/types';
import { FOLLOW_UP_REASON_LABELS, FOLLOW_UP_STATUS_LABELS, humanize } from '@/lib/display-labels';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useCohort } from '@/providers/cohort-provider';

export default function StaffSupportScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const queryClient = useQueryClient();
  const { api, user } = useSession();
  const { cohort_id, filter } = useLocalSearchParams<{ cohort_id?: string; filter?: string }>();
  const { selectedCohortId } = useCohort();
  const cohortId = cohort_id ? Number(cohort_id) : selectedCohortId;
  const [resolving, setResolving] = useState<HelpRequest | null>(null);
  const attemptId = useRef<string | null>(null);
  const [response, setResponse] = useState('');
  const [responseSelection, setResponseSelection] = useState({ start: 0, end: 0 });
  const [savingId, setSavingId] = useState<number | null>(null);
  const voiceDraft = useVoiceDraft({
    api,
    demo: auth.demo,
    surface: 'help_request',
    draft: response,
    selection: responseSelection,
    disabled: Boolean(savingId),
    maxDraftLength: 2_000,
    onDraftChange: setResponse,
    onSelectionChange: setResponseSelection,
  });
  const queryKey = learningKeys.supportQueue(user?.id || 0, cohortId);
  const query = useQuery({ queryKey, queryFn: ({ signal }) => auth.demo ? Promise.resolve({ support_queue: demoSupportQueue }) : api.supportQueue(signal, cohortId), enabled: Boolean(user?.is_staff), meta: { persist: false } });
  const queue = query.data?.support_queue;

  // Reply keeps the request open; Reply & resolve closes it (U-4.7).
  async function sendReply(resolveRequest: boolean) {
    if (!resolving || !response.trim() || savingId) return;
    setSavingId(resolving.id);
    try {
      const now = new Date().toISOString();
      const result = auth.demo
        ? { help_request: { ...resolving, status: resolveRequest ? 'resolved' as const : 'acknowledged' as const, staff_response: response.trim(), replies: [...(resolving.replies ?? []), { id: Date.now(), body: response.trim(), resolved_request: resolveRequest, author: { id: user!.id, full_name: user!.full_name }, created_at: now }], resolved_at: resolveRequest ? now : null, acknowledged_at: resolving.acknowledged_at || now, owner: resolving.owner || { id: user!.id, full_name: user!.full_name }, updated_at: now } }
        // A failed or lost send keeps its attempt id, so sending again can't answer twice.
        : await api.replyToHelpRequest(resolving.id, { body: response.trim(), resolve: resolveRequest, client_request_id: attemptId.current ??= newReplyRequestId() });
      queryClient.setQueryData(learningKeys.helpRequest(user!.id, resolving.id), { help_request: result.help_request });
      queryClient.setQueryData<{ support_queue: SupportQueue }>(queryKey, (current) => current ? { support_queue: updateSupportQueueHelpRequest(current.support_queue, result.help_request) } : current);
      if (!auth.demo) await queryClient.invalidateQueries({ predicate: (query) => isStaffAttentionQuery(query.queryKey, user?.id || 0) });
      voiceDraft.markSent(response.trim());
      attemptId.current = null;
      if (resolveRequest) captureProductEvent('help_request_resolved', { cohort_id: resolving.cohort.id, help_request_id: resolving.id, category: resolving.category, resolution_bucket: analyticsAgeBucket(resolving.created_at) });
      setResolving(null);
      setResponse('');
      Alert.alert('Reply sent', resolveRequest ? 'The request is resolved.' : 'The request stays open.');
    } catch (error) {
      Alert.alert('Could not send the reply', (error as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function closeResponse() {
    if (savingId) return;
    if (response.trim()) {
      Alert.alert('Discard this reply?', 'Your draft reply will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard reply', style: 'destructive', onPress: () => void discardResponse() },
      ]);
      return;
    }
    await discardResponse();
  }

  async function discardResponse() {
    await voiceDraft.cancel();
    attemptId.current = null;
    setResolving(null);
    setResponse('');
  }

  function openHelpRequest(request: HelpRequest) {
    queryClient.setQueryData(learningKeys.helpRequest(user!.id, request.id), { help_request: request });
    router.push({ pathname: '/staff/support/[id]', params: { id: String(request.id) } });
  }

  function openIntervention(intervention: SupportQueue['interventions'][number]) {
    queryClient.setQueryData(learningKeys.intervention(user!.id, intervention.id), { intervention });
    router.push({ pathname: '/staff/intervention/[id]', params: { id: String(intervention.id) } });
  }

  if (!user?.is_staff) return <StaffOnlyScreen message="Support is available to instructors and admins." />;
  if (query.isPending && !queue) return <SafeAreaView style={styles.safe}><LoadingState label="Loading Support" /></SafeAreaView>;
  if (!queue) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><BackButton style={styles.back} /></View><ErrorState title={(query.error as { status?: number } | null)?.status === 403 ? 'No access' : undefined} message={query.error ? (query.error as Error).message : 'Support is unavailable.'} retry={() => void query.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><BackButton style={styles.back} /><View style={styles.flex}><Text style={styles.kicker}>STAFF</Text><Text style={styles.headerTitle}>Support</Text></View><View style={styles.headerIcon}><LifeBuoy color={c.text.body} size={20} /></View></View>
    <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
      {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing the saved queue. Actions need a connection.</Text></View>}
      <Text style={styles.heroTitle}>Start with the follow-up that is due.</Text><Text style={styles.heroCopy}>Each follow-up plan has an owner and connects the reason, next step, student, and support history.</Text>
      <View style={styles.metrics}><Metric value={queue.summary.open_help_count} label="open requests" tone="ruby" /><Metric value={queue.summary.active_intervention_count} label="follow-up plans" tone="warning" /><Metric value={queue.summary.due_follow_up_count} label="due" tone="warning" /></View>

      {filter !== 'help' && <View style={styles.section}><Text style={styles.sectionKicker}>ASSIGNED TO STAFF</Text><Text style={styles.sectionTitle}>Follow-up plans</Text><Text style={styles.sectionCopy}>Open a plan to acknowledge contact, message the student, update its status, or continue on the web.</Text>
        {!queue.interventions.length ? <View style={styles.clearCard}><CheckCircle2 color={c.status.success.fg} size={21} /><View style={styles.flex}><Text style={styles.clearTitle}>No active follow-up plans</Text><Text style={styles.clearCopy}>Start one from Support on the web.</Text></View></View> : <View style={styles.stack}>{queue.interventions.map((intervention) => <Pressable key={intervention.id} accessibilityRole="button" accessibilityLabel={`Open follow-up plan for ${intervention.enrollment.student.full_name}`} onPress={() => openIntervention(intervention)} style={[styles.caseCard, intervention.follow_up_due && styles.caseDue]}><View style={styles.pills}><Pill label={humanize(intervention.status, FOLLOW_UP_STATUS_LABELS).toUpperCase()} tone="ruby" />{intervention.severity === 'urgent' && <Pill label="URGENT" tone="danger" />}{intervention.follow_up_due && <Pill label="FOLLOW-UP DUE" tone="warning" />}</View><Text style={styles.studentName}>{intervention.enrollment.student.full_name}</Text><Text style={styles.context}>{intervention.enrollment.cohort.name} · {humanize(intervention.trigger_type, FOLLOW_UP_REASON_LABELS)}</Text><Text numberOfLines={2} style={styles.caseAction}>{intervention.action_summary || 'Open to document the next action.'}</Text><View style={styles.caseFooter}><CalendarClock color={intervention.follow_up_due ? c.status.warning.fg : c.text.muted} size={15} /><Text style={[styles.metaText, intervention.follow_up_due && styles.dueText]}>{intervention.follow_up_due ? 'Due now' : formatRelative(intervention.next_follow_up_at || intervention.created_at)}</Text><Text style={styles.caseOwner}>{intervention.owner.full_name}</Text><ArrowRight color={c.text.muted} size={17} /></View></Pressable>)}</View>}
      </View>}

      {filter !== 'follow_up' && <View style={styles.section}><Text style={styles.sectionKicker}>DIRECT REQUESTS</Text><Text style={styles.sectionTitle}>Students who asked for help</Text>
        {!queue.help_requests.length ? <View style={styles.clearCard}><CheckCircle2 color={c.status.success.fg} size={21} /><View style={styles.flex}><Text style={styles.clearTitle}>No active requests</Text><Text style={styles.clearCopy}>New requests will appear here.</Text></View></View> : <View style={styles.stack}>{queue.help_requests.map((request) => <View key={request.id} style={[styles.requestCard, request.urgency === 'urgent' && styles.requestUrgent]}>
          <View style={styles.pills}>{request.urgency === 'urgent' && <Pill label="URGENT" tone="danger" />}<Pill label={request.status === 'acknowledged' ? 'ACKNOWLEDGED' : 'OPEN'} tone={request.status === 'acknowledged' ? 'warning' : 'ruby'} /><Pill label={request.category.toUpperCase()} tone="quiet" /></View>
          <Text style={styles.studentName}>{request.student?.full_name}</Text><Text style={styles.context}>{request.cohort.name} · {request.context_label}</Text><Text style={styles.question}>{request.message}</Text><View style={styles.requestMeta}><Clock3 color={c.text.muted} size={13} /><Text style={styles.metaText}>{formatRelative(request.created_at)}</Text>{request.owner && <Text style={styles.metaText}>· {request.owner.full_name}</Text>}</View>
          <View style={styles.actions}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${request.student?.full_name}'s help request`} onPress={() => openHelpRequest(request)} style={styles.secondaryButton}><ArrowRight color={c.text.strong} size={16} /><Text style={styles.secondaryText}>Open</Text></Pressable><Button variant="primary" accessibilityRole="button" onPress={() => { attemptId.current = null; setResolving(request); setResponse(''); }} style={styles.primaryButton}><MessageSquareReply color={c.text.strong} size={16} /><Text style={styles.primaryText}>Reply</Text></Button></View>
        </View>)}</View>}
      </View>}

      {filter && <Button label="Show all support" variant="secondary" onPress={() => router.setParams({ filter: '' })} />}
      <StaffAttention students={queue.students} cohortId={cohortId} />
    </ScrollView>

    <Modal visible={Boolean(resolving)} animationType="fade" presentationStyle="pageSheet" onRequestClose={() => { if (!savingId) void closeResponse(); }}><SafeAreaView style={styles.safe}><View style={styles.modalHeader}><Pressable accessibilityRole="button" accessibilityLabel="Close" disabled={Boolean(savingId)} onPress={() => void closeResponse()} style={styles.back}><X color={c.text.body} size={21} /></Pressable><Text style={styles.modalTitle}>Reply</Text><View style={styles.back} /></View><ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}><Text style={styles.modalStudent}>{resolving?.student?.full_name}</Text><Text style={styles.context}>{resolving?.context_label}</Text><Text style={styles.modalQuestion}>{resolving?.message}</Text><Text style={styles.fieldLabel}>REPLY VISIBLE TO THE STUDENT</Text><TextInput keyboardAppearance={scheme} accessibilityLabel="Reply to the student" value={response} selection={responseSelection} onSelectionChange={(event) => setResponseSelection(event.nativeEvent.selection)} onChangeText={setResponse} maxLength={2000} multiline placeholder="Give a clear next step, explanation, or follow-up instruction." placeholderTextColor={c.text.body} style={styles.responseInput} /><View style={styles.voiceRow}><VoiceDraftButton state={voiceDraft.state} disabled={Boolean(savingId)} onPress={() => void voiceDraft.start()} /><Text style={styles.voiceHint}>Dictate a response, then review it before sending.</Text></View><VoiceDraftPanel state={voiceDraft.state} durationMillis={voiceDraft.durationMillis} maxDurationSeconds={voiceDraft.maxDurationSeconds} metering={voiceDraft.metering} error={voiceDraft.error} notice={voiceDraft.notice} hasReview={Boolean(voiceDraft.review)} hasRecording={voiceDraft.hasRecording} onStop={() => void voiceDraft.stop()} onCancel={() => void voiceDraft.cancel()} onRetry={voiceDraft.retry} onRecordAgain={() => void voiceDraft.recordAgain()} onRestore={voiceDraft.restore} onDismiss={voiceDraft.dismissReview} /><Text style={styles.counter}>{response.length}/2,000</Text><Pressable accessibilityRole="button" disabled={!response.trim() || savingId === resolving?.id} onPress={() => void sendReply(false)} style={[styles.secondaryButton, styles.replyButton, (!response.trim() || savingId === resolving?.id) && styles.disabled]}><MessageSquareReply color={c.text.strong} size={17} /><Text style={styles.secondaryText}>{savingId === resolving?.id ? 'Sending…' : 'Send reply'}</Text></Pressable><Pressable accessibilityRole="button" disabled={!response.trim() || savingId === resolving?.id} onPress={() => void sendReply(true)} style={[styles.resolveButton, (!response.trim() || savingId === resolving?.id) && styles.disabled]}><CheckCircle2 color={c.text.strong} size={17} /><Text style={styles.primaryText}>{savingId === resolving?.id ? 'Sending…' : 'Reply & resolve'}</Text></Pressable><Text style={styles.voiceHint}>Send reply keeps the request open.</Text></ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}

function Metric({ value, label, tone }: { value: number; label: string; tone: 'ruby' | 'warning' | 'danger' }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); const color = tone === 'warning' ? c.status.warning.fg : tone === 'danger' ? c.status.danger.fg : c.text.body; return <View style={styles.metric}><Text style={[styles.metricValue, { color }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function Pill({ label, tone }: { label: string; tone: 'ruby' | 'warning' | 'danger' | 'quiet' }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); const toneColors = tone === 'danger' ? c.status.danger : tone === 'warning' ? c.status.warning : tone === 'ruby' ? c.status.pending : { fg: c.text.body, bg: c.surface.sunken, border: c.border.subtle }; return <Text style={[styles.pill, { color: toneColors.fg, backgroundColor: toneColors.bg, borderColor: toneColors.border, borderWidth: 1 }]}>{label}</Text>; }
function formatRelative(value: string) { const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000)); if (minutes < 1) return 'Now'; if (minutes < 60) return `${minutes}m ago`; if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`; return `${Math.floor(minutes / 1_440)}d ago`; }
const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, content: { padding: 20, paddingBottom: 100 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: c.status.warning.bg, justifyContent: 'center', paddingHorizontal: 12, marginBottom: 16 }, offlineText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12 }, heroTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 28, lineHeight: 35, letterSpacing: -0.8 }, heroCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: 7 }, metrics: { flexDirection: 'row', gap: 8, marginTop: 18 }, metric: { flex: 1, minHeight: 90, borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 13, justifyContent: 'space-between' }, metricValue: { fontFamily: fonts.extraBold, fontSize: 25 }, metricLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, section: { marginTop: 28 }, sectionKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.1 }, sectionTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 19, marginTop: 4 }, sectionCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 5 }, stack: { gap: 10, marginTop: 12 }, clearCard: { borderRadius: 18, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.status.success.bg, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 12 }, clearTitle: { color: c.status.success.fg, fontFamily: fonts.bold, fontSize: 13 }, clearCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }, requestCard: { borderRadius: 20, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 16 }, requestUrgent: { borderColor: c.status.danger.border, backgroundColor: c.status.danger.bg }, pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, pill: { fontFamily: fonts.bold, fontSize: 12, borderRadius: 9, overflow: 'hidden', backgroundColor: c.surface.sunken, paddingHorizontal: 7, paddingVertical: 4 }, studentName: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 17, marginTop: 13 }, context: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 3 }, question: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, backgroundColor: c.surface.sunken, borderRadius: 14, padding: 12, marginTop: 13 }, requestMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 11 }, metaText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, actions: { flexDirection: 'row', gap: 8, marginTop: 14 }, secondaryButton: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, secondaryText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, primaryButton: { flex: 1, minHeight: 46, borderRadius: 14,  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, primaryText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, signalCard: { minHeight: 86, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, signalName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, modalHeader: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16 }, modalContent: { padding: 20, paddingBottom: 60 }, modalStudent: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 23 }, modalQuestion: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, backgroundColor: c.surface.raised, borderRadius: 16, padding: 14, marginTop: 16 }, fieldLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.1, marginTop: 22, marginBottom: 8 }, responseInput: { minHeight: 170, borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, padding: 14, textAlignVertical: 'top' }, counter: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, textAlign: 'right', marginTop: 5 }, replyButton: { marginTop: 14, minHeight: 48, justifyContent: 'center' }, resolveButton: { minHeight: 50, borderRadius: 16, backgroundColor: c.selection.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18 }, disabled: { opacity: 0.45 },
  caseCard: { borderRadius: 20, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 16 }, caseDue: { borderColor: c.status.warning.border, backgroundColor: c.status.warning.bg}, caseAction: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, marginTop: 12 }, caseFooter: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 11 }, caseOwner: { flex: 1, color: c.text.body, fontFamily: fonts.bold, fontSize: 12, textAlign: 'right' }, dueText: { color: c.status.warning.fg},
  voiceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }, voiceHint: { flex: 1, color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
}));
