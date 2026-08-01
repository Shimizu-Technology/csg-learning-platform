import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleHelp, Clock3, Send, ShieldAlert, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts, palette } from '@/constants/csg-theme';
import { captureProductEvent } from '@/lib/analytics';
import { learningKeys } from '@/lib/learning';
import type { HelpCategory, HelpContextSource, HelpContextType, HelpRequest, HelpUrgency } from '@/lib/types';
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
}

export function ContextualHelp({ cohortId, contextType, contextSource = 'primary', contextId, contextLabel }: ContextualHelpProps) {
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [category, setCategory] = useState<HelpCategory>('concept');
  const [urgency, setUrgency] = useState<HelpUrgency>('normal');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const queryKey = learningKeys.helpRequests(user?.id || 0, cohortId, contextType);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.helpRequests({ cohort_id: cohortId, context_type: contextType }, signal),
    enabled: Boolean(user && !auth.demo),
    meta: { persist: false },
  });
  const relevant = useMemo(() => (query.data?.help_requests || []).filter((request) => request.context_id === contextId && request.context_source === contextSource), [contextId, contextSource, query.data?.help_requests]);
  const active = relevant.find((request) => request.status === 'open' || request.status === 'acknowledged');
  const resolved = relevant.find((request) => request.status === 'resolved');

  async function submit() {
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
      setMessage('');
      Alert.alert(result.created ? 'Request sent' : 'Already in the queue', result.created ? 'Your instructor can now see where you need help.' : 'Your existing request is still active.');
    } catch (error) {
      Alert.alert('Could not send your request', `${(error as Error).message}\n\nYour draft is still here so you can try again.`);
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    if (!active || saving) return;
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
    <Pressable accessibilityRole="button" accessibilityLabel={active ? `Help request status: ${status}` : `Ask for help with ${contextLabel}`} onPress={() => { setVisible(true); if (!auth.demo) void query.refetch(); }} style={[styles.launcher, active && styles.launcherActive]}>
      {active ? <Clock3 color={palette.warning} size={17} /> : <CircleHelp color={palette.rubySoft} size={17} />}
      <Text style={[styles.launcherText, active && styles.launcherTextActive]}>{active ? status : "I'm stuck"}</Text>
    </Pressable>
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVisible(false)}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}><View style={styles.headerIcon}><CircleHelp color={palette.rubySoft} size={20} /></View><View style={styles.flex}><Text style={styles.kicker}>CONTEXTUAL HELP</Text><Text numberOfLines={1} style={styles.headerTitle}>{contextLabel}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close help" onPress={() => setVisible(false)} style={styles.close}><X color={palette.muted} size={21} /></Pressable></View>
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {query.isPending && !auth.demo ? <Text style={styles.loading}>Checking your requests…</Text> : active ? <View style={styles.stack}>
            <View style={styles.statusCard}><Clock3 color={palette.warning} size={20} /><View style={styles.flex}><Text style={styles.statusTitle}>{status}</Text><Text style={styles.statusCopy}>{active.status === 'acknowledged' ? `${active.owner?.full_name || 'An instructor'} acknowledged your request.` : 'It is visible in the staff support queue.'}</Text></View></View>
            <View style={styles.requestCard}><Text style={styles.fieldLabel}>YOUR QUESTION</Text><Text style={styles.requestText}>{active.message}</Text><View style={styles.pills}><Text style={styles.pill}>{active.category.toUpperCase()}</Text>{active.urgency === 'urgent' && <Text style={styles.urgentPill}>URGENT</Text>}</View></View>
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => void cancel()} style={styles.cancelButton}><Text style={styles.cancelText}>{saving ? 'Canceling…' : 'Cancel request'}</Text></Pressable>
          </View> : <View style={styles.stack}>
            {resolved && <View style={styles.resolvedCard}><CheckCircle2 color={palette.success} size={20} /><View style={styles.flex}><Text style={styles.resolvedTitle}>Previous instructor response</Text><Text style={styles.resolvedText}>{resolved.staff_response}</Text><Text style={styles.resolvedHint}>You can ask again if you still need help.</Text></View></View>}
            <View><Text style={styles.fieldLabel}>WHAT KIND OF HELP?</Text><View style={styles.choices}>{categories.map((item) => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: category === item.value }} onPress={() => setCategory(item.value)} style={[styles.choice, category === item.value && styles.choiceActive]}><Text style={[styles.choiceText, category === item.value && styles.choiceTextActive]}>{item.label}</Text></Pressable>)}</View></View>
            <View><Text style={styles.fieldLabel}>WHAT HAVE YOU TRIED?</Text><TextInput accessibilityLabel="Describe where you are stuck" value={message} onChangeText={setMessage} maxLength={2000} multiline placeholder="Share the step you reached, what you expected, and what happened instead." placeholderTextColor={palette.quiet} style={styles.messageInput} /><Text style={styles.counter}>{message.length}/2,000</Text></View>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: urgency === 'urgent' }} onPress={() => setUrgency(urgency === 'urgent' ? 'normal' : 'urgent')} style={[styles.urgentChoice, urgency === 'urgent' && styles.urgentChoiceActive]}><ShieldAlert color={urgency === 'urgent' ? '#FF7187' : palette.muted} size={20} /><View style={styles.flex}><Text style={styles.urgentTitle}>I am fully blocked</Text><Text style={styles.urgentCopy}>Use urgent only when you cannot continue and need attention before the next class.</Text></View></Pressable>
            <Pressable accessibilityRole="button" disabled={saving || !message.trim()} onPress={() => void submit()} style={[styles.sendButton, (saving || !message.trim()) && styles.disabled]}><Send color={palette.text} size={17} /><Text style={styles.sendText}>{saving ? 'Sending…' : 'Send to my instructor'}</Text></Pressable>
          </View>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  launcher: { minHeight: 44, alignSelf: 'flex-start', borderRadius: 14, borderWidth: 1, borderColor: '#542630', backgroundColor: '#25151A', paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, launcherActive: { borderColor: '#5A4828', backgroundColor: '#251F14' }, launcherText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 }, launcherTextActive: { color: palette.warning }, safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 }, headerIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, marginTop: 2 }, content: { padding: 20, paddingBottom: 50 }, loading: { color: palette.muted, fontFamily: fonts.medium, fontSize: 13, textAlign: 'center', paddingVertical: 40 }, stack: { gap: 16 }, statusCard: { borderRadius: 18, borderWidth: 1, borderColor: '#5A4828', backgroundColor: '#251F14', padding: 16, flexDirection: 'row', gap: 11 }, statusTitle: { color: palette.warning, fontFamily: fonts.bold, fontSize: 14 }, statusCopy: { color: '#D2B979', fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, marginTop: 4 }, requestCard: { borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 16 }, requestText: { color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, marginTop: 8 }, pills: { flexDirection: 'row', gap: 7, marginTop: 13 }, pill: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11, backgroundColor: palette.panelRaised, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 }, urgentPill: { color: '#FF7187', fontFamily: fonts.bold, fontSize: 11, backgroundColor: '#2C1418', borderRadius: 10, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 }, cancelButton: { minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: '#5A252D', alignItems: 'center', justifyContent: 'center' }, cancelText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 }, resolvedCard: { borderRadius: 18, borderWidth: 1, borderColor: '#275442', backgroundColor: '#10231D', padding: 16, flexDirection: 'row', gap: 11 }, resolvedTitle: { color: palette.success, fontFamily: fonts.bold, fontSize: 13 }, resolvedText: { color: '#B9D7CA', fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, marginTop: 6 }, resolvedHint: { color: '#86B8A5', fontFamily: fonts.semibold, fontSize: 11, marginTop: 8 }, fieldLabel: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.1, marginBottom: 8 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' }, choiceActive: { borderColor: '#6A2A36', backgroundColor: '#2A151B' }, choiceText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 12 }, choiceTextActive: { color: palette.rubySoft }, messageInput: { minHeight: 150, borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, padding: 14, textAlignVertical: 'top' }, counter: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, textAlign: 'right', marginTop: 5 }, urgentChoice: { minHeight: 76, borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 11 }, urgentChoiceActive: { borderColor: '#672A33', backgroundColor: '#261317' }, urgentTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, urgentCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 4 }, sendButton: { minHeight: 50, borderRadius: 16, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, sendText: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, disabled: { opacity: 0.45 },
});
