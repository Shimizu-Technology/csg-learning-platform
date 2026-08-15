import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, BookOpen, CheckCircle2, Clock3, ExternalLink, LifeBuoy, MessageSquareText, ShieldAlert, UserRound, UserRoundCheck } from 'lucide-react-native';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoDms } from '@/lib/demo-data';
import { demoHelpRequests } from '@/lib/demo-staff';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useState } from 'react';

export default function StaffHelpRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = Number(id);
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const [response, setResponse] = useState('');
  const query = useQuery({
    queryKey: learningKeys.helpRequest(user?.id || 0, requestId),
    queryFn: async ({ signal }) => {
      if (!auth.demo) return api.helpRequest(requestId, signal);
      const helpRequest = demoHelpRequests.find((item) => item.id === requestId);
      if (!helpRequest) throw new Error('Help request not found.');
      return { help_request: helpRequest };
    },
    enabled: Boolean(user?.is_staff && Number.isInteger(requestId) && requestId > 0),
    meta: { persist: false },
  });
  const request = query.data?.help_request;
  const mutation = useMutation({
    mutationFn: (input: { status: 'acknowledged' | 'resolved'; staff_response?: string }) => auth.demo
      ? Promise.resolve({ help_request: { ...request!, ...input, acknowledged_at: input.status === 'acknowledged' ? new Date().toISOString() : request!.acknowledged_at, resolved_at: input.status === 'resolved' ? new Date().toISOString() : request!.resolved_at, updated_at: new Date().toISOString() }, status_changed: true })
      : api.updateHelpRequest(requestId, input),
    onSuccess: async (result) => {
      queryClient.setQueryData(learningKeys.helpRequest(user?.id || 0, requestId), result);
      if (!auth.demo) await queryClient.invalidateQueries({ queryKey: learningKeys.supportQueue(user?.id || 0) });
    },
    onError: (error) => Alert.alert('Could not update request', (error as Error).message),
  });

  async function openMessage() {
    if (!request?.student) return;
    try {
      const conversation = auth.demo
        ? demoDms.find((item) => item.cohort_id === request.cohort.id && item.users.some((member) => member.id === request.student!.id))
        : (await api.createCohortDm(request.cohort.id, [request.student.id])).direct_conversation;
      if (!conversation) throw new Error('No cohort conversation is available for this student.');
      router.push({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(conversation.id), source_type: 'help_request', source_id: String(request.id), source_label: request.context_label, source_cohort_id: String(request.cohort.id), source_student_id: String(request.student.id) } });
    } catch (error) {
      Alert.alert('Could not open direct message', (error as Error).message);
    }
  }

  if (!user?.is_staff || !Number.isInteger(requestId) || requestId <= 0) return <SafeAreaView style={styles.safe}><ErrorState message="This help request is not available." retry={() => router.replace('/')} /></SafeAreaView>;
  if (query.isPending && !request) return <SafeAreaView style={styles.safe}><LoadingState label="Loading help request" /></SafeAreaView>;
  if (!request) return <SafeAreaView style={styles.safe}><ErrorState message={query.error ? (query.error as Error).message : 'Help request not found.'} retry={() => void query.refetch()} /></SafeAreaView>;
  const active = request.status === 'open' || request.status === 'acknowledged';

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>HELP REQUEST</Text><Text numberOfLines={1} style={styles.headerTitle}>{request.student?.full_name || 'Student support'}</Text></View><LifeBuoy color={palette.rubySoft} size={20} /></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={styles.pills}>{request.urgency === 'urgent' && <Pill label="URGENT" tone="danger" />}<Pill label={request.status.toUpperCase()} tone="ruby" /><Pill label={request.category.toUpperCase()} tone="quiet" /></View>
      <Text style={styles.title}>{request.context_label}</Text><View style={styles.meta}><BookOpen color={palette.muted} size={15} /><Text style={styles.metaText}>{request.cohort.name} · {request.context_type}</Text></View><View style={styles.meta}><Clock3 color={palette.muted} size={15} /><Text style={styles.metaText}>Asked {formatDate(request.created_at)}</Text></View>

      {request.student && <View style={styles.relationshipRow}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${request.student.full_name}'s student health`} onPress={() => router.push({ pathname: '/staff/student/[id]', params: { id: String(request.student!.id), cohort_id: String(request.cohort.id) } })} style={styles.relationshipButton}><UserRound color={palette.rubySoft} size={17} /><Text style={styles.relationshipText}>Student health</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Message ${request.student.full_name} in ${request.cohort.name}`} onPress={() => void openMessage()} style={styles.relationshipButton}><MessageSquareText color={palette.rubySoft} size={17} /><Text numberOfLines={2} style={styles.relationshipText}>Message in {request.cohort.name}</Text></Pressable></View>}

      <View style={[styles.questionCard, request.urgency === 'urgent' && styles.urgentCard]}>{request.urgency === 'urgent' && <ShieldAlert color="#FF7187" size={19} />}<Text style={styles.label}>STUDENT MESSAGE</Text><Text style={styles.question}>{request.message}</Text></View>
      {request.staff_response && <View style={styles.responseCard}><CheckCircle2 color={palette.success} size={19} /><Text style={styles.label}>STAFF RESPONSE</Text><Text style={styles.response}>{request.staff_response}</Text></View>}

      <View style={styles.linkStack}><Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, request.context_path).catch((error) => Alert.alert('Could not open context', (error as Error).message))} style={styles.linkButton}><BookOpen color={palette.rubySoft} size={17} /><Text style={styles.linkText}>Open learning context</Text><ExternalLink color={palette.quiet} size={16} /></Pressable><Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, `/admin/help-requests/${request.id}`).catch((error) => Alert.alert('Could not open record', (error as Error).message))} style={styles.linkButton}><LifeBuoy color={palette.rubySoft} size={17} /><Text style={styles.linkText}>Open full support record</Text><ExternalLink color={palette.quiet} size={16} /></Pressable></View>

      {active && <View style={styles.actionCard}>{request.status === 'open' && <Pressable accessibilityRole="button" disabled={mutation.isPending} onPress={() => mutation.mutate({ status: 'acknowledged' })} style={styles.secondaryButton}><UserRoundCheck color={palette.text} size={17} /><Text style={styles.secondaryText}>Acknowledge</Text></Pressable>}<Text style={styles.label}>RESPONSE VISIBLE TO THE STUDENT</Text><TextInput accessibilityLabel="Instructor response" value={response} onChangeText={setResponse} maxLength={2000} multiline placeholder="Give a clear next step or follow-up instruction." placeholderTextColor={palette.quiet} style={styles.input} /><Pressable accessibilityRole="button" disabled={!response.trim() || mutation.isPending} onPress={() => mutation.mutate({ status: 'resolved', staff_response: response.trim() })} style={[styles.primaryButton, (!response.trim() || mutation.isPending) && styles.disabled]}><CheckCircle2 color={palette.text} size={17} /><Text style={styles.primaryText}>{mutation.isPending ? 'Saving…' : 'Send response and resolve'}</Text></Pressable></View>}
    </ScrollView>
  </SafeAreaView>;
}

function Pill({ label, tone }: { label: string; tone: 'ruby' | 'danger' | 'quiet' }) { const color = tone === 'danger' ? '#FF7187' : tone === 'ruby' ? palette.rubySoft : palette.muted; return <Text style={[styles.pill, { color }]}>{label}</Text>; }
function formatDate(value: string) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, content: { padding: 20, paddingBottom: 80, gap: 14 }, pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, pill: { fontFamily: fonts.bold, fontSize: 11, borderRadius: 9, overflow: 'hidden', backgroundColor: palette.panelRaised, paddingHorizontal: 8, paddingVertical: 5 }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 26, lineHeight: 33, marginTop: 4 }, meta: { flexDirection: 'row', alignItems: 'center', gap: 7 }, metaText: { color: palette.muted, fontFamily: fonts.medium, fontSize: 11 }, relationshipRow: { flexDirection: 'row', gap: 8, marginTop: 5 }, relationshipButton: { flex: 1, minHeight: 52, borderRadius: 15, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, relationshipText: { flexShrink: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 11, textAlign: 'center' }, questionCard: { borderRadius: 20, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 16, gap: 9 }, urgentCard: { borderColor: '#672A33' }, responseCard: { borderRadius: 20, borderWidth: 1, borderColor: '#275442', backgroundColor: '#10231D', padding: 16, gap: 9 }, label: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, question: { color: '#D8DBE2', fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 }, response: { color: '#BFE7D5', fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 }, linkStack: { gap: 8 }, linkButton: { minHeight: 52, borderRadius: 15, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, linkText: { flex: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, actionCard: { borderRadius: 20, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 16, gap: 12 }, input: { minHeight: 140, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, color: palette.text, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, padding: 13, textAlignVertical: 'top' }, secondaryButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, secondaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, primaryButton: { minHeight: 50, borderRadius: 15, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, primaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, disabled: { opacity: 0.45 },
});
