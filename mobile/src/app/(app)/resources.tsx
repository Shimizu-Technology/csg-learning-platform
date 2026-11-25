import { PausedLearningCard } from '@/components/paused-learning-card';
import { BackButton } from '@/components/back-button';
import { themedAlert as Alert } from '@/lib/alerts';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams } from 'expo-router';
import { ExternalLink, FolderLock, FolderOpen, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CohortFileCard } from '@/components/cohort-file-card';
import { CourseFileCard } from '@/components/course-file-card';
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { STUDENT_FOLDER_PRESETS, groupByFolder, uploadToMyFolder, type CohortFile } from '@/lib/cohort-files';
import { LearningCard } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { openExternalPage } from '@/lib/external-links';
import { learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useCohort } from '@/providers/cohort-provider';

export default function ResourcesScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { selectedCohortId, selectedCohort } = useCohort();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [filter, setFilter] = useState(q || '');
  const query = useQuery({
    queryKey: learningKeys.resources(user?.id || 0),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ resources: demoDashboard.resources ?? [] }) : api.resources(signal),
    enabled: Boolean(user),
  });
  const queryClient = useQueryClient();
  const filesKey = learningKeys.cohortFiles(user?.id || 0, selectedCohortId || 0);
  // Staff browse folders from Cohort files; learners get their own folder here.
  const filesQuery = useQuery({
    queryKey: filesKey,
    queryFn: ({ signal }) => api.cohortFiles(selectedCohortId!, signal),
    enabled: Boolean(user && !user.is_staff && selectedCohortId && !auth.demo),
  });
  const [folder, setFolder] = useState(STUDENT_FOLDER_PRESETS[0]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const needle = filter.trim().toLowerCase();
  const matches = (file: CohortFile) => `${file.title} ${file.filename} ${file.folder} ${file.description || ''}`.toLowerCase().includes(needle);
  const myFiles = (filesQuery.data?.my_files || []).filter(matches);
  const classFolders = groupByFolder((filesQuery.data?.class_files || []).filter(matches));
  const canUpload = Boolean(filesQuery.data?.can_upload_personal && filesQuery.data.storage_configured);
  const upload = async () => {
    if (!selectedCohortId || uploadProgress !== null) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets[0]) return;
      setUploadProgress(0);
      await uploadToMyFolder(api, selectedCohortId, picked.assets[0], folder, setUploadProgress);
      await queryClient.invalidateQueries({ queryKey: filesKey });
    } catch (error) {
      Alert.alert('Could not upload file', (error as Error).message);
    } finally {
      setUploadProgress(null);
    }
  };
  const removeFile = (file: CohortFile) => Alert.alert(`Delete ${file.title}?`, 'It is removed from your private folder for you and your instructors.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await api.deleteCohortFile(selectedCohortId!, file.id); await queryClient.invalidateQueries({ queryKey: filesKey }); }
      catch (error) { Alert.alert('Could not delete file', (error as Error).message); }
    } },
  ]);
  const resources = useMemo(() => (query.data?.resources || []).filter((resource) => (!selectedCohortId || resource.cohort_id === selectedCohortId) && `${resource.title} ${resource.category} ${resource.description || ''}`.toLowerCase().includes(filter.trim().toLowerCase())), [filter, query.data?.resources, selectedCohortId]);
  const sections = [
    { title: 'Cohort links', copy: 'Links and references shared specifically with your cohort.', items: resources.filter(resource => !resource.download_id) },
    { title: 'Course files', copy: 'Downloadable files shared across cohorts using this curriculum.', items: resources.filter(resource => resource.download_id) },
  ];

  const hasFolder = Boolean(filesQuery.data && selectedCohortId);
  const fileSections = hasFolder && selectedCohortId ? <>
    <View style={styles.section}><View style={styles.row}><FolderLock color={c.text.body} size={16} /><Text accessibilityRole="header" style={styles.category}>My files</Text></View><Text style={styles.resourceCopy}>Your private folder — only you and your instructors can see files here.</Text>
      {canUpload ? <View style={styles.stack}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{STUDENT_FOLDER_PRESETS.map((preset) => <Pressable key={preset} accessibilityRole="button" accessibilityLabel={`Upload to ${preset}`} accessibilityState={{ selected: folder === preset }} onPress={() => setFolder(preset)} style={[styles.chip, folder === preset && styles.selectedChip]}><Text style={[styles.chipText, folder === preset && styles.selectedChipText]}>{preset}</Text></Pressable>)}</ScrollView>
        <Button label={uploadProgress === null ? 'Upload file' : `Uploading… ${Math.round(uploadProgress * 100)}%`} loading={uploadProgress !== null} onPress={() => void upload()} /></View>
        : <Text style={styles.notice}>{!filesQuery.data?.can_upload_personal ? 'Uploads are paused while your course is paused or your access has ended. You can still download your files.' : "File uploads aren't available right now."}</Text>}
      <View style={styles.stack}>{myFiles.map((file) => <CohortFileCard key={file.id} cohortId={selectedCohortId} file={file} note={file.uploaded_by_role === 'student' ? 'Uploaded by you' : 'Shared by your instructor'} onDelete={file.can_manage ? () => removeFile(file) : undefined} />)}</View>
      {!myFiles.length && <Text style={styles.resourceCopy}>{filter ? 'No files in your folder match this search.' : 'No files in your folder yet.'}</Text>}
    </View>
    <View style={styles.section}><Text accessibilityRole="header" style={styles.category}>Class files</Text><Text style={styles.resourceCopy}>Slides, guides and templates your instructors shared with your cohort.</Text>
      {classFolders.map(([name, files]) => <View key={name} style={styles.stack}><Text style={styles.folderTitle}>{name}</Text>{files.map((file) => <CohortFileCard key={file.id} cohortId={selectedCohortId} file={file} />)}</View>)}
      {!classFolders.length && <Text style={styles.resourceCopy}>{filter ? 'No class files match this search.' : 'No class files yet.'}</Text>}
    </View>
  </> : null;

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><BackButton style={styles.back} /><View><Text style={styles.headerKicker}>LEARNING LIBRARY</Text><Text style={styles.headerTitle}>Resources</Text></View></View>{query.isPending && !query.data ? <LoadingState label="Loading resources" /> : query.error && !query.data ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => { void query.refetch(); if (filesQuery.isFetched) void filesQuery.refetch(); }} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
    <PausedLearningCard cohortId={selectedCohortId} />
    {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved resources. Pull to reconnect.</Text></View>}
    <Text style={styles.title}>Everything useful, close at hand.</Text><Text style={styles.subtitle}>{selectedCohort ? `${selectedCohort.name} · ` : ''}Open class references and starter files without hunting through old messages.</Text>
    <View style={styles.search}><Search color={c.text.muted} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search resources" value={filter} onChangeText={setFilter} placeholder="Search resources" placeholderTextColor={c.text.body} style={styles.input} /></View>
    {fileSections}
    {sections.map(({ title, copy, items }) => <View key={title} style={styles.section}><Text accessibilityRole="header" style={styles.category}>{title}</Text><Text style={styles.resourceCopy}>{copy}</Text><View style={styles.stack}>{(items || []).map((resource) => resource.download_id ? <View key={`${resource.cohort_id}:${resource.id}`}>{!selectedCohortId && resource.cohort_name && <Text style={styles.resourceCopy}>{resource.cohort_name}</Text>}<CourseFileCard resource={resource} /></View> : <LearningCard key={`${resource.cohort_id}:${resource.id}`} onPress={() => void openExternalPage(resource.url).catch((error) => Alert.alert('Could not open resource', (error as Error).message))} label={`Open ${resource.title}`}><View style={styles.row}><View style={styles.icon}><FolderOpen color={c.text.body} size={20} /></View><View style={styles.flex}><Text style={styles.resourceTitle}>{resource.title}</Text>{!selectedCohortId && resource.cohort_name && <Text style={styles.resourceCopy}>{resource.cohort_name}</Text>}{resource.description && <Text style={styles.resourceCopy}>{resource.description}</Text>}</View><ExternalLink color={c.text.muted} size={18} /></View></LearningCard>)}</View></View>)}
    {!resources.length && !hasFolder && <View style={styles.empty}><FolderOpen color={c.text.body} size={30} /><Text style={styles.emptyTitle}>{filter ? 'No matching resources' : 'No resources yet'}</Text><Text style={styles.emptyCopy}>{filter ? 'Try a different search.' : 'Shared class links will appear here.'}</Text></View>}
  </ScrollView>}</SafeAreaView>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, headerKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, content: { padding: 20, paddingBottom: 80, gap: 15 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 28, lineHeight: 35, letterSpacing: -0.8 }, subtitle: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: -7 }, search: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, section: { gap: 9, marginTop: 8 }, category: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.3 }, stack: { gap: 9 }, row: { flexDirection: 'row', alignItems: 'center', gap: 11 }, icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, resourceTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, resourceCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 3 }, empty: { alignItems: 'center', paddingVertical: 70 }, emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 13 }, emptyCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 5 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: c.status.warning.bg, justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12 },
  notice: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, borderRadius: 12, backgroundColor: c.surface.sunken, padding: 12 }, folderTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13, marginTop: 4 },
  chips: { gap: 8, paddingRight: 20 }, chip: { minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 12 }, selectedChip: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, chipText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, selectedChipText: { color: c.text.strong },
}));
