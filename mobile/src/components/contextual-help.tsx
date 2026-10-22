import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleHelp, Clock3, Send, ShieldAlert, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CourseSupportAction } from '@/components/course-support-action';
import { VoiceDraftButton, VoiceDraftPanel } from '@/components/voice-draft-controls';
import { fonts } from '@/constants/csg-theme';
import { useVoiceDraft } from '@/hooks/use-voice-draft';
import { captureProductEvent } from '@/lib/analytics';
import { learningKeys } from '@/lib/learning';
import type { EnrollmentCapabilities, HelpCategory, HelpContextSource, HelpContextType, HelpRequest, HelpUrgency } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

const categories: { value: HelpCategory; label: string }[] = [
  { value: 'concept', label: 'Concept' },
  { value: 'technical', label: 'Technical issue' },
  { value: 'instructions', label: 'Instructions' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'other', label: 'Something else' },
];

interface ContextualHelpProps {
  cohortId: number;
  contextType: HelpContextType;
  contextSource?: HelpContextSource;
  contextId: number;
  contextLabel: string;
  contextPath?: string;
  capabilities?: EnrollmentCapabilities;
}

export function ContextualHelp({ cohortId, contextType, contextSource = 'primary', contextId, contextLabel, contextPath, capabilities }: ContextualHelpProps) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [category, setCategory] = useState<HelpCategory>('concept');
  const [urgency, setUrgency] = useState<HelpUrgency>('normal');
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [saving, setSaving] = useState(false);
  const queryKey = learningKeys.helpRequests(user?.id || 0, cohortId, contextType);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.helpRequests({ cohort_id: cohortId, context_type: contextType }, signal),
    enabled: Boolean(user && !auth.demo),
    meta: { persist: false },
  });
  const relevant = useMemo(() => (query.data?.help_requests || []).filter((request) => request.cohort.id === cohortId && request.context_type === contextType && request.context_id === contextId && request.context_source === contextSource), [cohortId, contextId, contextType, contextSource, query.data?.help_requests]);
  const active = relevant.find((request) => request.status === 'open' || request.status === 'acknowledged');
  const resolved = relevant.find((request) => request.status === 'resolved');
  const voiceDraft = useVoiceDraft({
    api,
    demo: auth.demo,
    surface: 'help_request',
    draft: message,
    selection,
    disabled: saving || Boolean(active),
    maxDraftLength: 2_000,
    onDraftChange: setMessage,
    onSelectionChange: setSelection,
  });

  const canAsk = capabilities?.support_mode === 'guided_help';

  async function submit() {
    if (!canAsk) return;
    const clean = message.trim();
    if (!clean || saving) return;
    if (auth.demo) {
      Alert.alert('Demo mode', 'Help requests are available when you sign in to a live student account.');
      return;
    }
    setSaving(true);
    try {
      const result = await api.createHelpRequest({ cohort_id: cohortId, context_type: contextType, context_source: contextSource, context_id: contextId, category, urgency, message: clean });
      queryClient.setQueryData<{ help_requests: HelpRequest[] }>(queryKey, (current) => ({ help_requests: [result.help_request, ...(current?.help_requests || []).filter((item) => item.id !== result.help_request.id)] }));
      if (result.created) captureProductEvent('help_requested', { cohort_id: cohortId, context_type: contextType, context_id: contextId, category, urgency });
      if (result.created) voiceDraft.markSent(clean);
      setMessage('');
      Alert.alert(result.created ? 'Request sent' : 'Already in the queue', result.created ? 'Your instructor can now see where you need help.' : 'Your existing request is still active.');
    } catch (error) {
      Alert.alert('Could not send your request', `${(error as Error).message}\n\nYour draft is still here so you can try again.`);
    } finally {
      setSaving(false);
    }
  }

  async function close() {
    await voiceDraft.cancel();
    setVisible(false);
  }

  async function cancel() {
    if (!canAsk || !active || saving) return;
    setSaving(true);
    try {
      const result = await api.updateHelpRequest(active.id, { status: 'canceled' });
      queryClient.setQueryData<{ help_requests: HelpRequest[] }>(queryKey, (current) => ({ help_requests: (current?.help_requests || []).map((item) => item.id === result.help_request.id ? result.help_request : item) }));
      Alert.alert('Request canceled');
    } catch (error) {
      Alert.alert('Could not cancel the request', (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const status = active?.status === 'acknowledged' ? 'Instructor is taking a look' : 'Sent to your instructor';
  return <>
    {!canAsk && <CourseSupportAction capabilities={capabilities} cohortId={cohortId} contextLabel={contextLabel} contextPath={contextPath} />}
    {(canAsk || active || resolved) && <Pressable accessibilityRole="button" accessibilityLabel={!canAsk ? `View previous help for ${contextLabel}` : active ? `Help request status: ${status}` : `Ask for help with ${contextLabel}`} onPress={() => { setVisible(true); if (!auth.demo) void query.refetch(); }} style={[styles.launcher, active && styles.launcherActive]}>
      {active ? <Clock3 color={c.status.warning.fg} size={17} /> : <CircleHelp color={c.text.body} size={17} />}
      <Text style={[styles.launcherText, active && styles.launcherTextActive]}>{!canAsk ? 'View previous help' : active ? status : 'Ask for help'}</Text>
    </Pressable>}
    <Modal visible={visible} animationType="fade" presentationStyle="pageSheet" onRequestClose={() => void close()}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}><View style={styles.headerIcon}><CircleHelp color={c.text.body} size={20} /></View><View style={styles.flex}><Text style={styles.kicker}>CONTEXTUAL HELP</Text><Text numberOfLines={1} style={styles.headerTitle}>{contextLabel}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close help" onPress={() => void close()} style={styles.close}><X color={c.text.body} size={21} /></Pressable></View>
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {query.isPending && !auth.demo ? <Text style={styles.loading}>Checking your requests…</Text> : active ? <View style={styles.stack}>
            <View style={styles.statusCard}><Clock3 color={c.status.warning.fg} size={20} /><View style={styles.flex}><Text style={styles.statusTitle}>{status}</Text><Text style={styles.statusCopy}>{active.status === 'acknowledged' ? `${active.owner?.full_name || 'An instructor'} acknowledged your request.` : 'It is visible in the staff support queue.'}</Text></View></View>
            <View style={styles.requestCard}><Text style={styles.fieldLabel}>YOUR QUESTION</Text><Text style={styles.requestText}>{active.message}</Text><View style={styles.pills}><Text style={styles.pill}>{active.category.toUpperCase()}</Text>{active.urgency === 'urgent' && <Text style={styles.urgentPill}>URGENT</Text>}</View></View>
            {canAsk && <Button accessibilityRole="button" disabled={saving} onPress={() => void cancel()} style={styles.cancelButton} variant="secondary" label={saving ? 'Canceling…' : 'Cancel request'} textStyle={styles.cancelText} />}
          </View> : <View style={styles.stack}>
            {resolved && <View style={styles.resolvedCard}><CheckCircle2 color={c.status.success.fg} size={20} /><View style={styles.flex}><Text style={styles.resolvedTitle}>Previous instructor response</Text><Text style={styles.resolvedText}>{resolved.staff_response}</Text><Text style={styles.resolvedHint}>{canAsk ? 'You can ask again if you still need help.' : 'Your previous response remains available.'}</Text></View></View>}
            {canAsk && <>
            <View><Text style={styles.fieldLabel}>WHAT KIND OF HELP?</Text><View style={styles.choices}>{categories.map((item) => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: category === item.value }} onPress={() => setCategory(item.value)} style={[styles.choice, category === item.value && styles.choiceActive]}><Text style={[styles.choiceText, category === item.value && styles.choiceTextActive]}>{item.label}</Text></Pressable>)}</View></View>
            <View><Text style={styles.fieldLabel}>WHAT HAVE YOU TRIED?</Text><TextInput keyboardAppearance={scheme} accessibilityLabel="Describe where you are stuck" value={message} selection={selection} onSelectionChange={(event) => setSelection(event.nativeEvent.selection)} onChangeText={setMessage} maxLength={2000} multiline placeholder="Share the step you reached, what you expected, and what happened instead." placeholderTextColor={c.text.body} style={styles.messageInput} /><View style={styles.voiceRow}><VoiceDraftButton state={voiceDraft.state} disabled={saving} onPress={() => void voiceDraft.start()} /><Text style={styles.voiceHint}>Speak a draft, then review and edit it before sending.</Text></View><VoiceDraftPanel state={voiceDraft.state} durationMillis={voiceDraft.durationMillis} maxDurationSeconds={voiceDraft.maxDurationSeconds} metering={voiceDraft.metering} error={voiceDraft.error} notice={voiceDraft.notice} hasReview={Boolean(voiceDraft.review)} hasRecording={voiceDraft.hasRecording} onStop={() => void voiceDraft.stop()} onCancel={() => void voiceDraft.cancel()} onRetry={voiceDraft.retry} onRecordAgain={() => void voiceDraft.recordAgain()} onRestore={voiceDraft.restore} onDismiss={voiceDraft.dismissReview} /><Text style={styles.counter}>{message.length}/2,000</Text></View>
            <Pressable accessibilityRole="checkbox" accessibilityLabel="I am fully blocked" accessibilityState={{ checked: urgency === 'urgent' }} onPress={() => setUrgency(urgency === 'urgent' ? 'normal' : 'urgent')} style={[styles.urgentChoice, urgency === 'urgent' && styles.urgentChoiceActive]}><ShieldAlert color={urgency === 'urgent' ? c.status.danger.fg : c.text.body} size={20} /><View style={styles.flex}><Text style={styles.urgentTitle}>I am fully blocked</Text><Text style={styles.urgentCopy}>Use urgent only when you cannot continue and need attention before the next class.</Text></View></Pressable>
            <Button variant="primary" accessibilityRole="button" disabled={saving || !message.trim()} onPress={() => void submit()} style={[styles.sendButton, (saving || !message.trim()) && styles.disabled]}><Send color={c.text.strong} size={17} /><Text style={styles.sendText}>{saving ? 'Sending…' : 'Send to my instructor'}</Text></Button>
            </>}
          </View>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  launcher: { minHeight: 44, alignSelf: 'flex-start', borderRadius: 14, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, launcherActive: { borderColor: c.status.warning.border, backgroundColor: c.status.warning.bg}, launcherText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, launcherTextActive: { color: c.status.warning.fg }, safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 }, headerIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15, marginTop: 2 }, content: { padding: 20, paddingBottom: 50 }, loading: { color: c.text.body, fontFamily: fonts.medium, fontSize: 13, textAlign: 'center', paddingVertical: 40 }, stack: { gap: 16 }, statusCard: { borderRadius: 18, borderWidth: 1, borderColor: c.status.warning.border, backgroundColor: c.status.warning.bg, padding: 16, flexDirection: 'row', gap: 11 }, statusTitle: { color: c.status.warning.fg, fontFamily: fonts.bold, fontSize: 14 }, statusCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, marginTop: 4 }, requestCard: { borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 16 }, requestText: { color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, marginTop: 8 }, pills: { flexDirection: 'row', gap: 7, marginTop: 13 }, pill: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, backgroundColor: c.surface.sunken, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 }, urgentPill: { color: c.status.danger.fg, fontFamily: fonts.bold, fontSize: 12, backgroundColor: c.status.danger.bg, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5, borderColor: c.status.danger.border, borderWidth: 1 }, cancelButton: { minHeight: 48, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, cancelText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, resolvedCard: { borderRadius: 18, borderWidth: 1, borderColor: c.status.success.border, backgroundColor: c.status.success.bg, padding: 16, flexDirection: 'row', gap: 11 }, resolvedTitle: { color: c.status.success.fg, fontFamily: fonts.bold, fontSize: 13 }, resolvedText: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, marginTop: 6 }, resolvedHint: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12, marginTop: 8 }, fieldLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.1, marginBottom: 8 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' }, choiceActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg, borderWidth: 2 }, choiceText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, choiceTextActive: { color: c.text.strong, fontFamily: fonts.extraBold }, messageInput: { minHeight: 150, borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, padding: 14, textAlignVertical: 'top' }, counter: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, textAlign: 'right', marginTop: 5 }, urgentChoice: { minHeight: 76, borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 11 }, urgentChoiceActive: { borderColor: c.status.danger.border, backgroundColor: c.status.danger.bg, borderWidth: 2 }, urgentTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, urgentCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 4 }, sendButton: { minHeight: 50, borderRadius: 16,  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, sendText: { color: c.text.onAction, fontFamily: fonts.bold, fontSize: 13 }, disabled: { opacity: 0.45 },
  voiceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }, voiceHint: { flex: 1, color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
}));
