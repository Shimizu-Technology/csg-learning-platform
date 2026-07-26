import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { ArrowLeft, CalendarDays, Check, ChevronRight, Film, UploadCloud, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoStaffDashboard } from '@/lib/demo-staff';
import { learningKeys } from '@/lib/learning';
import { MAX_RECORDING_SIZE, uploadRecording, type RecordingUploadAsset } from '@/lib/recording-upload';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function readableSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function fallbackMime(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'm4v') return 'video/x-m4v';
  return 'video/mp4';
}

export default function RecordingUploadScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const demoCohorts = useMemo(
    () => demoStaffDashboard.cohorts.map(({ cohort }) => ({
      id: cohort.id,
      name: cohort.name,
      status: cohort.status,
      start_date: cohort.start_date || '',
    })),
    [],
  );
  const cohortsQuery = useQuery({
    queryKey: ['recording-upload-cohorts', user?.id],
    queryFn: ({ signal }) => auth.demo
      ? Promise.resolve({ cohorts: demoCohorts })
      : api.cohorts(signal),
    enabled: Boolean(user?.is_staff),
  });
  const cohorts = useMemo(() => (cohortsQuery.data?.cohorts || []).filter((cohort) => cohort.status === 'active'), [cohortsQuery.data?.cohorts]);
  const [cohortId, setCohortId] = useState<number | null>(null);
  const [asset, setAsset] = useState<RecordingUploadAsset | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [recordedDate, setRecordedDate] = useState(today());
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Ready to publish');

  const pickVideo = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    const picked = result.assets[0];
    const file = new File(picked.uri);
    const size = picked.size ?? file.size;
    const mimeType = picked.mimeType || file.type || fallbackMime(picked.name);
    if (!size || size <= 0) {
      Alert.alert('Could not read video', 'Choose the video again from Files or Photos.');
      return;
    }
    if (size > MAX_RECORDING_SIZE) {
      Alert.alert('Video is too large', 'Recordings must be 5 GB or smaller.');
      return;
    }
    if (!mimeType.startsWith('video/')) {
      Alert.alert('Choose a video', 'That file is not recognized as a video.');
      return;
    }
    setAsset({ uri: picked.uri, name: picked.name, size, mimeType });
    setTitle(picked.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    setProgress(0);
    setStatus('Ready to publish');
  };

  const publish = async () => {
    if (!asset || !cohortId || !title.trim() || uploading) return;
    setUploading(true);
    try {
      await uploadRecording({
        api,
        asset,
        cohortId,
        title,
        description,
        recordedDate,
        onProgress: (nextProgress, nextStatus) => {
          setProgress(nextProgress);
          setStatus(nextStatus);
        },
      });
      await queryClient.invalidateQueries({ queryKey: learningKeys.recordings(user?.id ?? 0) });
      Alert.alert('Recording published', `${title.trim()} is now available in the class recording library.`, [
        { text: 'Done', onPress: () => router.replace('/recordings') },
      ]);
    } catch (error) {
      Alert.alert('Upload did not finish', (error as Error).message);
      setStatus('Upload failed. Your recording was not published.');
    } finally {
      setUploading(false);
    }
  };

  if (!user?.is_staff) return <SafeAreaView style={styles.safe}><ErrorState message="Recording uploads are available to staff." retry={() => router.replace('/recordings')} /></SafeAreaView>;
  if (cohortsQuery.isPending) return <SafeAreaView style={styles.safe}><LoadingState label="Loading classes" /></SafeAreaView>;
  if (cohortsQuery.error) return <SafeAreaView style={styles.safe}><ErrorState message={(cohortsQuery.error as Error).message} retry={() => void cohortsQuery.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>STAFF PUBLISHING</Text><Text style={styles.headerTitle}>Upload recording</Text></View></View>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.hero}><View style={styles.heroIcon}><UploadCloud color={palette.rubySoft} size={24} /></View><Text style={styles.heroTitle}>Publish directly to CSG</Text><Text style={styles.heroCopy}>Choose a class video from this device. Large recordings are securely split into retryable parts; keep this screen open until publishing finishes.</Text></View>

        <View style={styles.section}><Text style={styles.label}>1 · CHOOSE CLASS</Text><View style={styles.stack}>{cohorts.map((cohort) => <Pressable key={cohort.id} accessibilityRole="radio" accessibilityState={{ checked: cohortId === cohort.id }} onPress={() => setCohortId(cohort.id)} style={[styles.choice, cohortId === cohort.id && styles.choiceSelected]}><View style={[styles.choiceIcon, cohortId === cohort.id && styles.choiceIconSelected]}>{cohortId === cohort.id ? <Check color={palette.text} size={17} /> : <Film color={palette.muted} size={17} />}</View><View style={styles.flex}><Text style={styles.choiceTitle}>{cohort.name}</Text><Text style={styles.choiceMeta}>Started {cohort.start_date}</Text></View><ChevronRight color={palette.quiet} size={18} /></Pressable>)}</View>{!cohorts.length && <Text style={styles.help}>There are no active cohorts available for recording uploads.</Text>}</View>

        <View style={styles.section}><Text style={styles.label}>2 · CHOOSE VIDEO</Text>{asset ? <View style={styles.fileCard}><View style={styles.fileIcon}><Film color={palette.rubySoft} size={21} /></View><View style={styles.flex}><Text numberOfLines={2} style={styles.fileName}>{asset.name}</Text><Text style={styles.fileMeta}>{readableSize(asset.size)} · {asset.mimeType}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Remove selected video" disabled={uploading} onPress={() => setAsset(null)} style={styles.remove}><X color={palette.muted} size={18} /></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel="Choose video" onPress={pickVideo} style={styles.picker}><UploadCloud color={palette.rubySoft} size={29} /><Text style={styles.pickerTitle}>Choose from Files or Photos</Text><Text style={styles.pickerCopy}>MP4, MOV, M4V, or WebM · up to 5 GB</Text></Pressable>}</View>

        <View style={styles.section}><Text style={styles.label}>3 · RECORDING DETAILS</Text><Text style={styles.inputLabel}>Title</Text><TextInput accessibilityLabel="Recording title" value={title} editable={!uploading} onChangeText={setTitle} placeholder="Week 1 class replay" placeholderTextColor={palette.quiet} style={styles.input} /><Text style={styles.inputLabel}>Description (optional)</Text><TextInput accessibilityLabel="Recording description" value={description} editable={!uploading} onChangeText={setDescription} placeholder="Topics covered in this class" placeholderTextColor={palette.quiet} multiline style={[styles.input, styles.multiline]} /><Text style={styles.inputLabel}>Date recorded</Text><View style={styles.dateInput}><CalendarDays color={palette.muted} size={18} /><TextInput accessibilityLabel="Date recorded in year month day format" value={recordedDate} editable={!uploading} onChangeText={setRecordedDate} placeholder="YYYY-MM-DD" placeholderTextColor={palette.quiet} style={styles.dateText} /></View></View>

        {(uploading || progress > 0) && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.progressCard}><View style={styles.progressTop}><Text style={styles.progressStatus}>{status}</Text><Text style={styles.progressPercent}>{progress}%</Text></View><View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View></View>}

        <Pressable accessibilityRole="button" accessibilityLabel="Publish recording" disabled={!asset || !cohortId || !title.trim() || uploading} onPress={publish} style={({ pressed }) => [styles.publish, pressed && styles.pressed, (!asset || !cohortId || !title.trim() || uploading) && styles.disabled]}><UploadCloud color={palette.text} size={20} /><Text style={styles.publishText}>{uploading ? 'Publishing… keep this screen open' : 'Publish recording'}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, flex: { flex: 1 }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, content: { padding: 20, paddingBottom: 90, gap: 22 }, hero: { borderRadius: 22, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', padding: 20 }, heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#351821', alignItems: 'center', justifyContent: 'center' }, heroTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 22, letterSpacing: -0.5, marginTop: 15 }, heroCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 18, marginTop: 7 }, section: { gap: 9 }, label: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.1, marginBottom: 2 }, stack: { gap: 8 }, choice: { minHeight: 68, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }, choiceSelected: { borderColor: '#7B2A3A', backgroundColor: '#26151B' }, choiceIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#242A35', alignItems: 'center', justifyContent: 'center' }, choiceIconSelected: { backgroundColor: palette.ruby }, choiceTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, choiceMeta: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 9, marginTop: 3 }, picker: { minHeight: 146, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#62303C', backgroundColor: '#1D1217', alignItems: 'center', justifyContent: 'center', padding: 20 }, pickerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 14, marginTop: 10 }, pickerCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 10, marginTop: 5 }, fileCard: { minHeight: 82, borderRadius: 18, borderWidth: 1, borderColor: '#62303C', backgroundColor: '#211319', padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, fileIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#351821', alignItems: 'center', justifyContent: 'center' }, fileName: { color: palette.text, fontFamily: fonts.bold, fontSize: 12, lineHeight: 17 }, fileMeta: { color: palette.muted, fontFamily: fonts.regular, fontSize: 9, marginTop: 4 }, remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, inputLabel: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 10, marginTop: 5 }, input: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 14, paddingVertical: 12 }, multiline: { minHeight: 88, textAlignVertical: 'top' }, dateInput: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9 }, dateText: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, progressCard: { borderRadius: 18, borderWidth: 1, borderColor: '#62303C', backgroundColor: '#211319', padding: 15 }, progressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, progressStatus: { flex: 1, color: palette.text, fontFamily: fonts.semibold, fontSize: 10 }, progressPercent: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 }, track: { height: 7, borderRadius: 4, backgroundColor: '#3A232B', overflow: 'hidden', marginTop: 11 }, fill: { height: '100%', borderRadius: 4, backgroundColor: palette.rubySoft }, publish: { minHeight: 56, borderRadius: 17, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 }, pressed: { opacity: 0.85 }, disabled: { opacity: 0.42 }, publishText: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, help: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 },
});
