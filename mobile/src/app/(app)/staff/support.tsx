import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, LifeBuoy, UserRoundCheck, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { analyticsAgeBucket, captureProductEvent } from '@/lib/analytics';
import { learningKeys } from '@/lib/learning';
import type { HelpRequest, SupportQueueStudent } from '@/lib/types';
import { useSession } from '@/providers/session-provider';

export default function StaffSupportScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { api, user } = useSession();
  const [resolving, setResolving] = useState<HelpRequest | null>(null);
  const [response, setResponse] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const queryKey = learningKeys.supportQueue(user?.id || 0);
  const query = useQuery({ queryKey, queryFn: ({ signal }) => api.supportQueue(signal), enabled: Boolean(user?.is_staff), meta: { persist: false } });
  const queue = query.data?.support_queue;

  async function acknowledge(request: HelpRequest) {
    setSavingId(request.id);
    try {
      await api.updateHelpRequest(request.id, { status: 'acknowledged' });
      await queryClient.invalidateQueries({ queryKey });
      Alert.alert('Acknowledged', `${request.student?.full_name || 'The student'} can now see that you are taking a look.`);
    } catch (error) {
      Alert.alert('Could not acknowledge request', (error as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function resolve() {
    if (!resolving || !response.trim() || savingId) return;
    setSavingId(resolving.id);
    try {
      await api.updateHelpRequest(resolving.id, { status: 'resolved', staff_response: response.trim() });
      captureProductEvent('help_request_resolved', { cohort_id: resolving.cohort.id, help_request_id: resolving.id, category: resolving.category, resolution_bucket: analyticsAgeBucket(resolving.created_at) });
      setResolving(null);
      setResponse('');
      await queryClient.invalidateQueries({ queryKey });
      Alert.alert('Response sent', 'The student can now see your answer.');
    } catch (error) {
      Alert.alert('Could not resolve request', (error as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  if (!user?.is_staff) return <SafeAreaView style={styles.safe}><ErrorState message="Student support is available to instructors and admins." /></SafeAreaView>;
  if (query.isPending && !queue) return <SafeAreaView style={styles.safe}><LoadingState label="Loading student support" /></SafeAreaView>;
  if (!queue) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable></View><ErrorState message={query.error ? (query.error as Error).message : 'The support queue is unavailable.'} retry={() => void query.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>STUDENT SUPPORT</Text><Text style={styles.headerTitle}>Help queue</Text></View><View style={styles.headerIcon}><LifeBuoy color={palette.rubySoft} size={20} /></View></View>
    <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
      {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing the saved queue. Actions need a connection.</Text></View>}
      <Text style={styles.heroTitle}>Start with the student who is blocked.</Text><Text style={styles.heroCopy}>Direct requests come first. Other signals explain what may need a human check-in.</Text>
      <View style={styles.metrics}><Metric value={queue.summary.open_help_count} label="open" tone="ruby" /><Metric value={queue.summary.acknowledged_help_count} label="owned" tone="warning" /><Metric value={queue.summary.urgent_help_count} label="urgent" tone="danger" /></View>

      <View style={styles.section}><Text style={styles.sectionKicker}>DIRECT REQUESTS</Text><Text style={styles.sectionTitle}>Students who asked for help</Text>
        {!queue.help_requests.length ? <View style={styles.clearCard}><CheckCircle2 color={palette.success} size={21} /><View style={styles.flex}><Text style={styles.clearTitle}>No active requests</Text><Text style={styles.clearCopy}>New requests will appear here.</Text></View></View> : <View style={styles.stack}>{queue.help_requests.map((request) => <View key={request.id} style={[styles.requestCard, request.urgency === 'urgent' && styles.requestUrgent]}>
          <View style={styles.pills}>{request.urgency === 'urgent' && <Pill label="URGENT" tone="danger" />}<Pill label={request.status === 'acknowledged' ? 'ACKNOWLEDGED' : 'OPEN'} tone={request.status === 'acknowledged' ? 'warning' : 'ruby'} /><Pill label={request.category.toUpperCase()} tone="quiet" /></View>
          <Text style={styles.studentName}>{request.student?.full_name}</Text><Text style={styles.context}>{request.cohort.name} · {request.context_label}</Text><Text style={styles.question}>{request.message}</Text><View style={styles.requestMeta}><Clock3 color={palette.quiet} size={13} /><Text style={styles.metaText}>{formatRelative(request.created_at)}</Text>{request.owner && <Text style={styles.metaText}>· {request.owner.full_name}</Text>}</View>
          <View style={styles.actions}>{request.status === 'open' && <Pressable accessibilityRole="button" disabled={savingId === request.id} onPress={() => void acknowledge(request)} style={styles.secondaryButton}><UserRoundCheck color={palette.text} size={16} /><Text style={styles.secondaryText}>Acknowledge</Text></Pressable>}<Pressable accessibilityRole="button" onPress={() => { setResolving(request); setResponse(''); }} style={styles.primaryButton}><CheckCircle2 color={palette.text} size={16} /><Text style={styles.primaryText}>Respond</Text></Pressable></View>
        </View>)}</View>}
      </View>

      <View style={styles.section}><Text style={styles.sectionKicker}>EXPLAINABLE SIGNALS</Text><Text style={styles.sectionTitle}>Other students to check on</Text><Text style={styles.sectionCopy}>Prompts for instructor judgment—not automated risk scores.</Text>
        <View style={styles.stack}>{queue.students.map((student) => <StudentSignal key={`${student.cohort_id}:${student.user_id}`} student={student} onPress={() => router.push(`/staff/student/${student.user_id}`)} />)}</View>
      </View>
    </ScrollView>

    <Modal visible={Boolean(resolving)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !savingId && setResolving(null)}><SafeAreaView style={styles.safe}><View style={styles.modalHeader}><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setResolving(null)} style={styles.back}><X color={palette.muted} size={21} /></Pressable><Text style={styles.modalTitle}>Respond and resolve</Text><View style={styles.back} /></View><ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}><Text style={styles.modalStudent}>{resolving?.student?.full_name}</Text><Text style={styles.context}>{resolving?.context_label}</Text><Text style={styles.modalQuestion}>{resolving?.message}</Text><Text style={styles.fieldLabel}>RESPONSE VISIBLE TO THE STUDENT</Text><TextInput accessibilityLabel="Instructor response" value={response} onChangeText={setResponse} maxLength={2000} multiline placeholder="Give a clear next step, explanation, or follow-up instruction." placeholderTextColor={palette.quiet} style={styles.responseInput} /><Text style={styles.counter}>{response.length}/2,000</Text><Pressable accessibilityRole="button" disabled={!response.trim() || savingId === resolving?.id} onPress={() => void resolve()} style={[styles.resolveButton, (!response.trim() || savingId === resolving?.id) && styles.disabled]}><CheckCircle2 color={palette.text} size={17} /><Text style={styles.primaryText}>{savingId === resolving?.id ? 'Sending…' : 'Send response and resolve'}</Text></Pressable></ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}

function Metric({ value, label, tone }: { value: number; label: string; tone: 'ruby' | 'warning' | 'danger' }) { const color = tone === 'warning' ? palette.warning : tone === 'danger' ? '#FF7187' : palette.rubySoft; return <View style={styles.metric}><Text style={[styles.metricValue, { color }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function Pill({ label, tone }: { label: string; tone: 'ruby' | 'warning' | 'danger' | 'quiet' }) { const color = tone === 'warning' ? palette.warning : tone === 'danger' ? '#FF7187' : tone === 'ruby' ? palette.rubySoft : palette.muted; return <Text style={[styles.pill, { color }]}>{label}</Text>; }
function StudentSignal({ student, onPress }: { student: SupportQueueStudent; onPress: () => void }) { const signals = [student.urgent_help_count > 0 && `${student.urgent_help_count} urgent`, student.help_request_count > 0 && `${student.help_request_count} help`, student.redo_count > 0 && `${student.redo_count} redo`, student.ungraded_count > 0 && `${student.ungraded_count} review`, student.inactive && 'inactive 7d+'].filter(Boolean) as string[]; return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${student.full_name}`} onPress={onPress} style={styles.signalCard}><View style={styles.flex}><Text style={styles.signalName}>{student.full_name}</Text><Text style={styles.context}>{student.cohort_name} · {student.progress_percentage}% complete</Text><View style={styles.pills}>{signals.map((signal) => <Pill key={signal} label={signal.toUpperCase()} tone={signal.includes('urgent') ? 'danger' : 'warning'} />)}</View></View><ArrowRight color={palette.quiet} size={18} /></Pressable>; }
function formatRelative(value: string) { const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000)); if (minutes < 1) return 'Now'; if (minutes < 60) return `${minutes}m ago`; if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`; return `${Math.floor(minutes / 1_440)}d ago`; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, content: { padding: 20, paddingBottom: 100 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: '#2A2115', justifyContent: 'center', paddingHorizontal: 12, marginBottom: 16 }, offlineText: { color: palette.warning, fontFamily: fonts.semibold, fontSize: 11 }, heroTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 28, lineHeight: 35, letterSpacing: -0.8 }, heroCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: 7 }, metrics: { flexDirection: 'row', gap: 8, marginTop: 18 }, metric: { flex: 1, minHeight: 90, borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 13, justifyContent: 'space-between' }, metricValue: { fontFamily: fonts.extraBold, fontSize: 25 }, metricLabel: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 }, section: { marginTop: 28 }, sectionKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.1 }, sectionTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 19, marginTop: 4 }, sectionCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 5 }, stack: { gap: 10, marginTop: 12 }, clearCard: { borderRadius: 18, borderWidth: 1, borderColor: '#275442', backgroundColor: '#10231D', padding: 16, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 12 }, clearTitle: { color: palette.success, fontFamily: fonts.bold, fontSize: 13 }, clearCopy: { color: '#86B8A5', fontFamily: fonts.regular, fontSize: 11, marginTop: 3 }, requestCard: { borderRadius: 20, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 16 }, requestUrgent: { borderColor: '#672A33' }, pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, pill: { fontFamily: fonts.bold, fontSize: 11, borderRadius: 9, overflow: 'hidden', backgroundColor: palette.panelRaised, paddingHorizontal: 7, paddingVertical: 4 }, studentName: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 17, marginTop: 13 }, context: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 3 }, question: { color: '#D8DBE2', fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, backgroundColor: palette.panelRaised, borderRadius: 14, padding: 12, marginTop: 13 }, requestMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 11 }, metaText: { color: palette.subtle, fontFamily: fonts.semibold, fontSize: 11 }, actions: { flexDirection: 'row', gap: 8, marginTop: 14 }, secondaryButton: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, secondaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, primaryButton: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, primaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, signalCard: { minHeight: 86, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, signalName: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 }, modalHeader: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16 }, modalContent: { padding: 20, paddingBottom: 60 }, modalStudent: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 23 }, modalQuestion: { color: '#D8DBE2', fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, backgroundColor: palette.panel, borderRadius: 16, padding: 14, marginTop: 16 }, fieldLabel: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.1, marginTop: 22, marginBottom: 8 }, responseInput: { minHeight: 170, borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, padding: 14, textAlignVertical: 'top' }, counter: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, textAlign: 'right', marginTop: 5 }, resolveButton: { minHeight: 50, borderRadius: 16, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18 }, disabled: { opacity: 0.45 },
});
