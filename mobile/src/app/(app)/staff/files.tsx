import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, FolderLock, Search } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Keyboard, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { CohortFileCard } from '@/components/cohort-file-card';
import { CohortLinkForm } from '@/components/cohort-link-form';
import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { StaffOnlyScreen } from '@/components/staff-only-screen';
import { Button } from '@/components/ui/button';
import { fonts } from '@/constants/csg-theme';
import { themedAlert as Alert } from '@/lib/alerts';
import { CLASS_FOLDER_PRESETS, groupByFolder, loadCohortFiles } from '@/lib/cohort-files';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

type FilesView = 'class' | 'students';
const STATUS: Record<string, string> = { paused: 'Paused', expired: 'Access ended' };

/** Staff on a phone: browse a cohort's class files and open any student's private folder. */
export default function StaffCohortFilesScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const { cohort_id } = useLocalSearchParams<{ cohort_id?: string }>();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const [cohortId, setCohortId] = useState<number | null>(cohort_id ? Number(cohort_id) : null);
  const [view, setView] = useState<FilesView>('class');
  const [studentId, setStudentId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [addingLink, setAddingLink] = useState(false);
  const cohortsQuery = useQuery({ queryKey: ['staff-files-cohorts', user?.id], queryFn: ({ signal }) => api.cohorts(signal), enabled: Boolean(user?.is_staff && !auth.demo) });
  const cohorts = cohortsQuery.data?.cohorts || [];
  const selectedCohortId = cohortId ?? cohorts[0]?.id ?? null;
  // Student folders are private: memory only, and dropped once access is revoked (loadCohortFiles returns null).
  const filesQuery = useQuery({ queryKey: ['staff-cohort-files', selectedCohortId], queryFn: ({ signal }) => loadCohortFiles(api, selectedCohortId!, signal), enabled: Boolean(user?.is_staff && selectedCohortId && !auth.demo), meta: { persist: false } });

  if (!user?.is_staff) return <StaffOnlyScreen message="Cohort files and student folders are for instructors and admins." />;
  const shell = (body: ReactNode) => <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><BackButton style={styles.back} /><View><Text style={styles.kicker}>COHORT FILES</Text><Text style={styles.headerTitle}>Files</Text></View></View>{body}</SafeAreaView>;
  if (auth.demo) return shell(<EmptyState title="Live cohort files" copy="Class files and student folders are available when you sign in to a live staff account." />);
  if (cohortsQuery.isPending) return shell(<LoadingState label="Loading cohorts" />);
  if (cohortsQuery.error) return shell(<ErrorState message={(cohortsQuery.error as Error).message} retry={() => void cohortsQuery.refetch()} />);
  if (!cohorts.length || !selectedCohortId) return shell(<EmptyState title="No cohorts yet" copy="Add a cohort before sharing files." />);

  const data = filesQuery.data;
  const folders = data?.student_folders || [];
  const openFolder = folders.find((folder) => folder.student_id === studentId) || null;
  const needle = search.trim().toLowerCase();
  const openWebFiles = () => void openAuthenticatedWebPage(api, `/admin/cohorts/${selectedCohortId}?tab=files`).catch((error) => Alert.alert('Could not open staff tools', (error as Error).message));

  return shell(<ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
    refreshControl={<RefreshControl refreshing={filesQuery.isRefetching} onRefresh={() => void filesQuery.refetch()} tintColor={c.text.body} />}>
    <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">{cohorts.map((cohort) => <Pressable key={cohort.id} accessibilityRole="button" accessibilityState={{ selected: cohort.id === selectedCohortId }} onPress={() => { Keyboard.dismiss(); setCohortId(cohort.id); setStudentId(null); setSearch(''); setAddingLink(false); }} style={[styles.chip, cohort.id === selectedCohortId && styles.selected]}><Text numberOfLines={1} style={[styles.chipText, cohort.id === selectedCohortId && styles.selectedText]}>{cohort.name}</Text></Pressable>)}</ScrollView>
    <View style={styles.segment} accessibilityRole="tablist">{([['class', `Class files · ${data?.class_files.length ?? 0}`], ['students', `Student folders · ${folders.length}`]] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: view === value }} onPress={() => { setView(value); setStudentId(null); }} style={[styles.segmentItem, view === value && styles.segmentSelected]}><Text style={[styles.chipText, view === value && styles.selectedText]}>{label}</Text></Pressable>)}</View>
    {filesQuery.isPending ? <LoadingState label="Loading files" /> : filesQuery.error ? <ErrorState message={(filesQuery.error as Error).message} retry={() => void filesQuery.refetch()} /> : data === null ? <EmptyState title="No access to these files" copy="You are no longer on this cohort's teaching team. Choose another cohort." /> : view === 'class' ? <>
      {groupByFolder(data?.class_files || []).map(([name, files]) => <View key={name} style={styles.stack}><Text accessibilityRole="header" style={styles.folderTitle}>{name}</Text>{files.map((file) => <CohortFileCard key={file.id} cohortId={selectedCohortId} file={file} downloadDisabled={!data?.storage_configured} note={file.visibility === 'staff_only' ? 'Staff only' : undefined} />)}</View>)}
      {!data?.class_files.length && <EmptyState title="No class files yet" copy="Add a link here, or upload slides, guides and templates from the full staff tools." />}
      {addingLink
        ? <CohortLinkForm cohortId={selectedCohortId} folders={[...new Set([...CLASS_FOLDER_PRESETS, ...(data?.folders || [])])]} onCancel={() => setAddingLink(false)} onSaved={() => { setAddingLink(false); void filesQuery.refetch(); }} />
        : <Button label="Add a class link" onPress={() => setAddingLink(true)} />}
      <Button variant="secondary" label="Upload and share on the web" onPress={openWebFiles} />
    </> : openFolder ? <>
      <Pressable accessibilityRole="button" accessibilityLabel="All student folders" onPress={() => setStudentId(null)} style={styles.backRow}><ChevronLeft color={c.text.body} size={18} /><Text style={styles.chipText}>All student folders</Text></Pressable>
      <Text style={styles.title}>{openFolder.student_name}</Text><Text style={styles.copy}>Private: only this student and cohort staff can see these files.</Text>
      {openFolder.files.map((file) => <CohortFileCard key={file.id} cohortId={selectedCohortId} file={file} downloadDisabled={!data?.storage_configured} note={file.uploaded_by_role === 'student' ? 'Added by student' : 'Shared by staff'} />)}
      {!openFolder.files.length && <EmptyState title="This folder is empty" copy="Files you or the student upload appear here." />}
    </> : <>
      <View style={styles.search}><Search color={c.text.body} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search students" value={search} onChangeText={setSearch} placeholder="Search students" placeholderTextColor={c.text.body} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} style={styles.input} /></View>
      {folders.filter((folder) => `${folder.student_name} ${folder.student_email}`.toLowerCase().includes(needle)).map((folder) => <Pressable key={folder.student_id} accessibilityRole="button" accessibilityLabel={`Open ${folder.student_name}'s folder, ${folder.file_count} file${folder.file_count === 1 ? '' : 's'}`} onPress={() => setStudentId(folder.student_id)} style={styles.person}><FolderLock color={c.text.body} size={20} /><View style={styles.flex}><Text style={styles.name}>{folder.student_name}</Text><Text style={styles.copy}>{folder.file_count} file{folder.file_count === 1 ? '' : 's'}{STATUS[folder.enrollment_status] ? ` · ${STATUS[folder.enrollment_status]}` : ''}</Text></View><ChevronRight color={c.text.muted} size={18} /></Pressable>)}
      {!folders.length && <EmptyState title="No student folders yet" copy="Every enrolled student gets a private folder automatically." />}
    </>}
  </ScrollView>);
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 },
  content: { padding: 20, paddingBottom: 60, gap: 14 }, strip: { flexGrow: 0, maxHeight: 52 }, chips: { alignItems: 'center', gap: 8, paddingRight: 20 },
  chip: { minHeight: 44, maxWidth: 210, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 13 }, selected: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, chipText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 13 }, selectedText: { color: c.text.strong },
  segment: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, padding: 4, gap: 4 }, segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, segmentSelected: { backgroundColor: c.surface.raised },
  stack: { gap: 9 }, folderTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13, marginTop: 4 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 22 }, copy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
  backRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  search: { minHeight: 48, borderRadius: 14, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 14 }, flex: { flex: 1, minWidth: 0 }, name: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15 },
}));
