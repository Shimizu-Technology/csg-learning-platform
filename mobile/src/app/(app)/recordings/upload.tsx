import { switchColors } from '@/constants/csg-theme';
import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { ArrowLeft, CalendarDays, Check, ChevronRight, Film, UploadCloud, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
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
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
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
  const [publishImmediately, setPublishImmediately] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Ready to upload');

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
    setStatus('Ready to upload');
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
        publishImmediately,
        onProgress: (nextProgress, nextStatus) => {
          setProgress(nextProgress);
          setStatus(nextStatus);
        },
      });
      await queryClient.invalidateQueries({ queryKey: learningKeys.recordings(user?.id ?? 0) });
      Alert.alert(publishImmediately ? 'Recording published' : 'Draft saved', publishImmediately
        ? `${title.trim()} is now available in the class recording library.`
        : `${title.trim()} is private until you publish it from the cohort recording manager.`, [
        { text: 'Done', onPress: () => router.replace('/recordings') },
      ]);
    } catch (error) {
      Alert.alert('Upload did not finish', (error as Error).message);
      setStatus('Upload failed. Your recording was not saved.');
    } finally {
      setUploading(false);
    }
  };

  if (!user?.is_staff) return <SafeAreaView style={styles.safe}><ErrorState title="Staff access only" message="Recording uploads are available to instructors and admins." retryLabel="Go to Recordings" retry={() => router.replace('/recordings')} /></SafeAreaView>;
  if (cohortsQuery.isPending) return <SafeAreaView style={styles.safe}><LoadingState label="Loading classes" /></SafeAreaView>;
  if (cohortsQuery.error) return <SafeAreaView style={styles.safe}><ErrorState message={(cohortsQuery.error as Error).message} retry={() => void cohortsQuery.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>STAFF PUBLISHING</Text><Text style={styles.headerTitle}>Upload recording</Text></View></View>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.hero}><View style={styles.heroIcon}><UploadCloud color={c.text.body} size={24} /></View><Text style={styles.heroTitle}>Upload directly to CSG</Text><Text style={styles.heroCopy}>Choose a class video from this device. Recordings stay private drafts by default, and large files upload in retryable parts.</Text></View>

        <View style={styles.section}><Text style={styles.label}>1 · CHOOSE CLASS</Text><View style={styles.stack}>{cohorts.map((cohort) => <Pressable key={cohort.id} accessibilityRole="radio" accessibilityState={{ checked: cohortId === cohort.id }} onPress={() => setCohortId(cohort.id)} style={[styles.choice, cohortId === cohort.id && styles.choiceSelected]}><View style={[styles.choiceIcon, cohortId === cohort.id && styles.choiceIconSelected]}>{cohortId === cohort.id ? <Check color={c.text.strong} size={17} /> : <Film color={c.text.body} size={17} />}</View><View style={styles.flex}><Text style={styles.choiceTitle}>{cohort.name}</Text><Text style={styles.choiceMeta}>Started {cohort.start_date}</Text></View><ChevronRight color={c.text.muted} size={18} /></Pressable>)}</View>{!cohorts.length && <Text style={styles.help}>There are no active cohorts available for recording uploads.</Text>}</View>

        <View style={styles.section}><Text style={styles.label}>2 · CHOOSE VIDEO</Text>{asset ? <View style={styles.fileCard}><View style={styles.fileIcon}><Film color={c.text.body} size={21} /></View><View style={styles.flex}><Text numberOfLines={2} style={styles.fileName}>{asset.name}</Text><Text style={styles.fileMeta}>{readableSize(asset.size)} · {asset.mimeType}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Remove selected video" disabled={uploading} onPress={() => setAsset(null)} style={styles.remove}><X color={c.text.body} size={18} /></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel="Choose video" onPress={pickVideo} style={styles.picker}><UploadCloud color={c.text.body} size={29} /><Text style={styles.pickerTitle}>Choose from Files or Photos</Text><Text style={styles.pickerCopy}>MP4, MOV, M4V, or WebM · up to 5 GB</Text></Pressable>}</View>

        <View style={styles.section}><Text style={styles.label}>3 · RECORDING DETAILS</Text><Text style={styles.inputLabel}>Title</Text><TextInput keyboardAppearance={scheme} accessibilityLabel="Recording title" value={title} editable={!uploading} onChangeText={setTitle} placeholder="Week 1 class replay" placeholderTextColor={c.text.body} style={styles.input} /><Text style={styles.inputLabel}>Description (optional)</Text><TextInput keyboardAppearance={scheme} accessibilityLabel="Recording description" value={description} editable={!uploading} onChangeText={setDescription} placeholder="Topics covered in this class" placeholderTextColor={c.text.body} multiline style={[styles.input, styles.multiline]} /><Text style={styles.inputLabel}>Date recorded</Text><View style={styles.dateInput}><CalendarDays color={c.text.body} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Date recorded in year month day format" value={recordedDate} editable={!uploading} onChangeText={setRecordedDate} placeholder="YYYY-MM-DD" placeholderTextColor={c.text.body} style={styles.dateText} /></View></View>

        <View style={styles.section}><Text style={styles.label}>4 · STUDENT ACCESS</Text><View style={styles.visibilityCard}><View style={styles.flex}><Text style={styles.visibilityTitle}>Publish immediately</Text><Text style={styles.visibilityCopy}>{publishImmediately ? 'Students get access as soon as the upload finishes.' : 'Recommended: save privately, review it, then publish from the cohort.'}</Text></View><Switch accessibilityLabel="Publish immediately" disabled={uploading} value={publishImmediately} onValueChange={setPublishImmediately} {...switchColors(c, publishImmediately)} /></View></View>

        {(uploading || progress > 0) && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.progressCard}><View style={styles.progressTop}><Text style={styles.progressStatus}>{status}</Text><Text style={styles.progressPercent}>{progress}%</Text></View><View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View></View>}

        <Pressable accessibilityRole="button" accessibilityLabel={publishImmediately ? 'Upload and publish recording' : 'Upload recording as draft'} disabled={!asset || !cohortId || !title.trim() || uploading} onPress={publish} style={({ pressed }) => [styles.publish, pressed && styles.pressed, (!asset || !cohortId || !title.trim() || uploading) && styles.disabled]}><UploadCloud color={c.text.strong} size={20} /><Text style={styles.publishText}>{uploading ? 'Uploading… keep this screen open' : publishImmediately ? 'Upload and publish' : 'Upload as draft'}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, flex: { flex: 1 }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, content: { padding: 20, paddingBottom: 90, gap: 22 }, hero: { borderRadius: 22, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 20 }, heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, heroTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 22, letterSpacing: -0.5, marginTop: 15 }, heroCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 7 }, section: { gap: 9 }, label: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.1, marginBottom: 2 }, stack: { gap: 8 }, choice: { minHeight: 68, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }, choiceSelected: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, choiceIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, choiceIconSelected: { backgroundColor: c.selection.bg }, choiceTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, choiceMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }, picker: { minHeight: 146, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.border.strong, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center', padding: 20 }, pickerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14, marginTop: 10 }, pickerCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 5 }, fileCard: { minHeight: 82, borderRadius: 18, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, fileIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, fileName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12, lineHeight: 17 }, fileMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 4 }, remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, inputLabel: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12, marginTop: 5 }, input: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 14, paddingVertical: 12 }, multiline: { minHeight: 88, textAlignVertical: 'top' }, dateInput: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9 }, dateText: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, visibilityCard: { minHeight: 76, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }, visibilityTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, visibilityCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 4 }, progressCard: { borderRadius: 18, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 15 }, progressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, progressStatus: { flex: 1, color: c.text.strong, fontFamily: fonts.semibold, fontSize: 12 }, progressPercent: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, track: { height: 7, borderRadius: 4, backgroundColor: c.surface.sunken, overflow: 'hidden', marginTop: 11 }, fill: { height: '100%', borderRadius: 4, backgroundColor: c.text.body }, publish: { minHeight: 56, borderRadius: 17, backgroundColor: c.selection.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 }, pressed: { opacity: 0.85 }, disabled: { opacity: 0.42 }, publishText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, help: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
}));
