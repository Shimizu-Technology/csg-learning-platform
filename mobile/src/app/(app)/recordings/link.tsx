import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowLeft, CalendarDays, Check, ChevronRight, Film, Link2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoStaffDashboard } from '@/lib/demo-staff';
import { learningKeys } from '@/lib/learning';
import { resolveMediaSource } from '@/lib/media-source';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function RecordingLinkScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const demoCohorts = useMemo(() => demoStaffDashboard.cohorts.map(({ cohort }) => ({ id: cohort.id, name: cohort.name, status: cohort.status, start_date: cohort.start_date || '' })), []);
  const cohortsQuery = useQuery({
    queryKey: ['recording-link-cohorts', user?.id],
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ cohorts: demoCohorts }) : api.cohorts(signal),
    enabled: Boolean(user?.is_staff),
  });
  const cohorts = useMemo(() => (cohortsQuery.data?.cohorts || []).filter((cohort) => cohort.status === 'active'), [cohortsQuery.data?.cohorts]);
  const [cohortId, setCohortId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [recordedDate, setRecordedDate] = useState(today());
  const [publishImmediately, setPublishImmediately] = useState(false);
  const [saving, setSaving] = useState(false);
  const source = useMemo(() => resolveMediaSource(url.trim()), [url]);

  const save = async () => {
    if (!cohortId || !title.trim() || !source || saving) return;
    setSaving(true);
    try {
      if (!auth.demo) await api.createExternalRecording(cohortId, {
        title: title.trim(),
        source_url: source.originalUrl,
        description: description.trim() || undefined,
        recorded_date: recordedDate || undefined,
        publish_immediately: publishImmediately,
      });
      await queryClient.invalidateQueries({ queryKey: learningKeys.recordings(user?.id ?? 0) });
      Alert.alert(publishImmediately ? 'Recording published' : 'Draft saved', publishImmediately
        ? `${title.trim()} is now available in the class recording library.`
        : `${title.trim()} is private until you publish it.`, [{ text: 'Done', onPress: () => router.replace('/recordings') }]);
    } catch (error) {
      Alert.alert('Recording was not saved', (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!user?.is_staff) return <SafeAreaView style={styles.safe}><ErrorState title="Staff access only" message="Recording links are available to instructors and admins." retryLabel="Go to Recordings" retry={() => router.replace('/recordings')} /></SafeAreaView>;
  if (cohortsQuery.isPending) return <SafeAreaView style={styles.safe}><LoadingState label="Loading classes" /></SafeAreaView>;
  if (cohortsQuery.error) return <SafeAreaView style={styles.safe}><ErrorState message={(cohortsQuery.error as Error).message} retry={() => void cohortsQuery.refetch()} /></SafeAreaView>;

  const ready = Boolean(cohortId && title.trim() && source);
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>STAFF PUBLISHING</Text><Text style={styles.headerTitle}>Add recording link</Text></View></View>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.hero}><View style={styles.heroIcon}><Link2 color={palette.rubySoft} size={24} /></View><Text style={styles.heroTitle}>Bring a hosted replay into CSG</Text><Text style={styles.heroCopy}>Paste a secure YouTube, Vimeo, Loom, or direct video link. Students can watch supported players without leaving the app.</Text></View>

        <View style={styles.section}><Text style={styles.label}>1 · CHOOSE CLASS</Text><View style={styles.stack}>{cohorts.map((cohort) => <Pressable key={cohort.id} accessibilityRole="radio" accessibilityState={{ checked: cohortId === cohort.id }} onPress={() => setCohortId(cohort.id)} style={[styles.choice, cohortId === cohort.id && styles.choiceSelected]}><View style={[styles.choiceIcon, cohortId === cohort.id && styles.choiceIconSelected]}>{cohortId === cohort.id ? <Check color={palette.text} size={17} /> : <Film color={palette.muted} size={17} />}</View><View style={styles.flex}><Text style={styles.choiceTitle}>{cohort.name}</Text><Text style={styles.choiceMeta}>Started {cohort.start_date}</Text></View><ChevronRight color={palette.quiet} size={18} /></Pressable>)}</View>{!cohorts.length && <Text style={styles.help}>There are no active cohorts available.</Text>}</View>

        <View style={styles.section}><Text style={styles.label}>2 · RECORDING DETAILS</Text><Text style={styles.inputLabel}>Video link</Text><TextInput accessibilityLabel="Recording video link" value={url} editable={!saving} autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={setUrl} placeholder="https://youtube.com/watch?v=..." placeholderTextColor={palette.quiet} style={styles.input} />{!!url.trim() && <Text style={[styles.help, !source && styles.invalid]}>{source ? `${source.providerLabel} · ${source.type === 'external' ? 'opens with the original host' : 'plays in the app'}` : 'Use a valid HTTPS link.'}</Text>}<Text style={styles.inputLabel}>Title</Text><TextInput accessibilityLabel="Recording title" value={title} editable={!saving} onChangeText={setTitle} placeholder="Week 1 class replay" placeholderTextColor={palette.quiet} style={styles.input} /><Text style={styles.inputLabel}>Description (optional)</Text><TextInput accessibilityLabel="Recording description" value={description} editable={!saving} onChangeText={setDescription} placeholder="Topics covered in this class" placeholderTextColor={palette.quiet} multiline style={[styles.input, styles.multiline]} /><Text style={styles.inputLabel}>Date recorded</Text><View style={styles.dateInput}><CalendarDays color={palette.muted} size={18} /><TextInput accessibilityLabel="Date recorded in year month day format" value={recordedDate} editable={!saving} onChangeText={setRecordedDate} placeholder="YYYY-MM-DD" placeholderTextColor={palette.quiet} style={styles.dateText} /></View></View>

        <View style={styles.section}><Text style={styles.label}>3 · STUDENT ACCESS</Text><View style={styles.visibilityCard}><View style={styles.flex}><Text style={styles.visibilityTitle}>Publish immediately</Text><Text style={styles.visibilityCopy}>{publishImmediately ? 'Students get access as soon as you save.' : 'Recommended: save privately, review it, then publish when ready.'}</Text></View><Switch accessibilityLabel="Publish immediately" disabled={saving} value={publishImmediately} onValueChange={setPublishImmediately} trackColor={{ false: '#363C48', true: '#8B3043' }} thumbColor={publishImmediately ? palette.rubySoft : palette.muted} /></View></View>

        <Pressable accessibilityRole="button" accessibilityLabel={publishImmediately ? 'Add and publish recording link' : 'Save recording link as draft'} disabled={!ready || saving} onPress={save} style={({ pressed }) => [styles.publish, pressed && styles.pressed, (!ready || saving) && styles.disabled]}><Link2 color={palette.text} size={20} /><Text style={styles.publishText}>{saving ? 'Saving…' : publishImmediately ? 'Add and publish' : 'Save as draft'}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, flex: { flex: 1 }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, content: { padding: 20, paddingBottom: 90, gap: 22 }, hero: { borderRadius: 22, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', padding: 20 }, heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#351821', alignItems: 'center', justifyContent: 'center' }, heroTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 22, letterSpacing: -0.5, marginTop: 15 }, heroCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 18, marginTop: 7 }, section: { gap: 9 }, label: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.1, marginBottom: 2 }, stack: { gap: 8 }, choice: { minHeight: 68, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }, choiceSelected: { borderColor: '#7B2A3A', backgroundColor: '#26151B' }, choiceIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#242A35', alignItems: 'center', justifyContent: 'center' }, choiceIconSelected: { backgroundColor: palette.ruby }, choiceTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, choiceMeta: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 3 }, inputLabel: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 11, marginTop: 5 }, input: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 14, paddingVertical: 12 }, multiline: { minHeight: 88, textAlignVertical: 'top' }, dateInput: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9 }, dateText: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, visibilityCard: { minHeight: 76, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }, visibilityTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, visibilityCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 4 }, publish: { minHeight: 56, borderRadius: 17, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 }, pressed: { opacity: 0.85 }, disabled: { opacity: 0.42 }, publishText: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, help: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 }, invalid: { color: palette.warning },
});
