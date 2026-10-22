import { switchColors } from '@/constants/csg-theme';
import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowLeft, CalendarDays, Check, ChevronRight, Film, Link2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
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
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
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
      const result = auth.demo ? null : await api.createExternalRecording(cohortId, {
        title: title.trim(),
        source_url: source.originalUrl,
        description: description.trim() || undefined,
        recorded_date: recordedDate || undefined,
        publish_immediately: publishImmediately,
      });
      await queryClient.invalidateQueries({ queryKey: learningKeys.recordings(user?.id ?? 0) });
      Alert.alert(publishImmediately ? 'Recording published' : 'Draft saved', publishImmediately
        ? `${title.trim()} is now available in the class recording library.`
        : `${title.trim()} is private. Open it to review playback and publish when ready.`, [{ text: publishImmediately ? 'Open recording' : 'Review draft', onPress: () => result ? router.replace({ pathname: '/recording/[id]', params: { id: String(result.recording.id), cohort_id: String(cohortId) } }) : router.replace('/recordings') }]);
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
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>STAFF PUBLISHING</Text><Text style={styles.headerTitle}>Add recording link</Text></View></View>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.hero}><View style={styles.heroIcon}><Link2 color={c.text.body} size={24} /></View><Text style={styles.heroTitle}>Bring a hosted replay into CSG</Text><Text style={styles.heroCopy}>Paste a secure YouTube, Vimeo, Loom, or direct video link. Students can watch supported players without leaving the app.</Text></View>

        <View style={styles.section}><Text style={styles.label}>1 · CHOOSE CLASS</Text><View style={styles.stack}>{cohorts.map((cohort) => <Pressable key={cohort.id} accessibilityRole="radio" accessibilityState={{ checked: cohortId === cohort.id }} onPress={() => setCohortId(cohort.id)} style={[styles.choice, cohortId === cohort.id && styles.choiceSelected]}><View style={[styles.choiceIcon, cohortId === cohort.id && styles.choiceIconSelected]}>{cohortId === cohort.id ? <Check color={c.text.strong} size={17} /> : <Film color={c.text.body} size={17} />}</View><View style={styles.flex}><Text style={styles.choiceTitle}>{cohort.name}</Text><Text style={styles.choiceMeta}>Started {cohort.start_date}</Text></View><ChevronRight color={c.text.muted} size={18} /></Pressable>)}</View>{!cohorts.length && <Text style={styles.help}>There are no active cohorts available.</Text>}</View>

        <View style={styles.section}><Text style={styles.label}>2 · RECORDING DETAILS</Text><Text style={styles.inputLabel}>Video link</Text><TextInput keyboardAppearance={scheme} accessibilityLabel="Recording video link" value={url} editable={!saving} autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={setUrl} placeholder="https://youtube.com/watch?v=..." placeholderTextColor={c.text.body} style={styles.input} />{!!url.trim() && <Text style={[styles.help, !source && styles.invalid]}>{source ? `${source.providerLabel} · ${source.type === 'external' ? 'opens with the original host' : 'plays in the app'}` : 'Use a valid HTTPS link.'}</Text>}<Text style={styles.inputLabel}>Title</Text><TextInput keyboardAppearance={scheme} accessibilityLabel="Recording title" value={title} editable={!saving} onChangeText={setTitle} placeholder="Week 1 class replay" placeholderTextColor={c.text.body} style={styles.input} /><Text style={styles.inputLabel}>Description (optional)</Text><TextInput keyboardAppearance={scheme} accessibilityLabel="Recording description" value={description} editable={!saving} onChangeText={setDescription} placeholder="Topics covered in this class" placeholderTextColor={c.text.body} multiline style={[styles.input, styles.multiline]} /><Text style={styles.inputLabel}>Date recorded</Text><View style={styles.dateInput}><CalendarDays color={c.text.body} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Date recorded in year month day format" value={recordedDate} editable={!saving} onChangeText={setRecordedDate} placeholder="YYYY-MM-DD" placeholderTextColor={c.text.body} style={styles.dateText} /></View></View>

        <View style={styles.section}><Text style={styles.label}>3 · STUDENT ACCESS</Text><View style={styles.visibilityCard}><View style={styles.flex}><Text style={styles.visibilityTitle}>Publish immediately</Text><Text style={styles.visibilityCopy}>{publishImmediately ? 'Students get access as soon as you save.' : 'Recommended: save privately, review it, then publish when ready.'}</Text></View><Switch accessibilityLabel="Publish immediately" disabled={saving} value={publishImmediately} onValueChange={setPublishImmediately} {...switchColors(c, publishImmediately)} /></View></View>

        <Pressable accessibilityRole="button" accessibilityLabel={publishImmediately ? 'Add and publish recording link' : 'Save recording link as draft'} disabled={!ready || saving} onPress={save} style={({ pressed }) => [styles.publish, pressed && styles.pressed, (!ready || saving) && styles.disabled]}><Link2 color={c.text.strong} size={20} /><Text style={styles.publishText}>{saving ? 'Saving…' : publishImmediately ? 'Add and publish' : 'Save as draft'}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, flex: { flex: 1 }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, content: { padding: 20, paddingBottom: 90, gap: 22 }, hero: { borderRadius: 22, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 20 }, heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, heroTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 22, letterSpacing: -0.5, marginTop: 15 }, heroCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 7 }, section: { gap: 9 }, label: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.1, marginBottom: 2 }, stack: { gap: 8 }, choice: { minHeight: 68, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }, choiceSelected: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, choiceIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, choiceIconSelected: { backgroundColor: c.selection.bg }, choiceTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, choiceMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }, inputLabel: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12, marginTop: 5 }, input: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 14, paddingVertical: 12 }, multiline: { minHeight: 88, textAlignVertical: 'top' }, dateInput: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9 }, dateText: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, visibilityCard: { minHeight: 76, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }, visibilityTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, visibilityCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 4 }, publish: { minHeight: 56, borderRadius: 17, backgroundColor: c.selection.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 }, pressed: { opacity: 0.85 }, disabled: { opacity: 0.42 }, publishText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, help: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 }, invalid: { color: c.status.warning.fg },
}));
