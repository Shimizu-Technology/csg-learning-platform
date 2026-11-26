import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, FolderLock, Search } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Keyboard, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { CohortDocForm } from '@/components/cohort-doc-modal';
import { CohortFileCard } from '@/components/cohort-file-card';
import { CohortFolderZipButton } from '@/components/cohort-folder-zip-button';
import { CohortLinkForm } from '@/components/cohort-link-form';
import { DriveFilterBar, DriveFolderStrip } from '@/components/drive-controls';
import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { StaffOnlyScreen } from '@/components/staff-only-screen';
import { Button } from '@/components/ui/button';
import { fonts } from '@/constants/csg-theme';
import { themedAlert as Alert } from '@/lib/alerts';
import {
  CLASS_FOLDER_PRESETS,
  STUDENT_FOLDER_PRESETS,
  groupByFolder,
  isStudentFolderItem,
  loadCohortFiles,
  matchesCohortFile,
  uploadCohortFile,
  uploadCohortFileVersion,
  type CohortFile,
  type CohortFilesResponse,
} from '@/lib/cohort-files';
import {
  matchesDriveTypeFilter,
  sortDriveFiles,
  summarizeFolders,
  type DriveSort,
  type DriveTypeFilter,
  type DriveViewMode,
} from '@/lib/drive-helpers';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

type FilesView = 'class' | 'students';
const STATUS: Record<string, string> = { paused: 'Paused', expired: 'Access ended' };
const STAFF_REVIEW = { staff: true, canChange: true };

/**
 * Staff Drive on mobile: browse, upload, organize, stage, copy, and review
 * class files and private student folders directly on phone or tablet.
 */
export default function StaffCohortFilesScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const { cohort_id, student, file: fileParam } = useLocalSearchParams<{ cohort_id?: string; student?: string; file?: string }>();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const [cohortId, setCohortId] = useState<number | null>(cohort_id ? Number(cohort_id) : null);
  const [view, setView] = useState<FilesView>(Number(student) ? 'students' : 'class');
  const [studentId, setStudentId] = useState<number | null>(Number(student) || null);
  const [search, setSearch] = useState('');
  const [classSearch, setClassSearch] = useState('');
  const [classFolder, setClassFolder] = useState('All');
  const [studentSubfolder, setStudentSubfolder] = useState('All');
  const [typeFilter, setTypeFilter] = useState<DriveTypeFilter>('all');
  const [sort, setSort] = useState<DriveSort>('updated_desc');
  const [viewMode, setViewMode] = useState<DriveViewMode>('list');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [adding, setAdding] = useState<'link' | 'doc' | null>(null);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [openFileId, setOpenFileId] = useState<number | null>(Number(fileParam) || null);
  const queryClient = useQueryClient();
  // A new notification link while this screen is open opens its item too.
  const [linked, setLinked] = useState(`${cohort_id}:${student}:${fileParam}`);
  if (linked !== `${cohort_id}:${student}:${fileParam}`) {
    setLinked(`${cohort_id}:${student}:${fileParam}`);
    if (Number(fileParam)) {
      if (Number(cohort_id)) setCohortId(Number(cohort_id));
      setView(Number(student) ? 'students' : 'class');
      setStudentId(Number(student) || null);
      setSearch('');
      setClassSearch('');
      setClassFolder('All');
      setStudentSubfolder('All');
      setTypeFilter('all');
      setNeedsReviewOnly(false);
      setOpenFileId(Number(fileParam));
    }
  }
  const cohortsQuery = useQuery({ queryKey: ['staff-files-cohorts', user?.id], queryFn: ({ signal }) => api.cohorts(signal), enabled: Boolean(user?.is_staff && !auth.demo) });
  const cohorts = cohortsQuery.data?.cohorts || [];
  const selectedCohortId = cohortId ?? cohorts[0]?.id ?? null;
  // Student folders are private: memory only, and dropped once access is revoked (loadCohortFiles returns null).
  const filesQuery = useQuery({ queryKey: ['staff-cohort-files', selectedCohortId], queryFn: ({ signal }) => loadCohortFiles(api, selectedCohortId!, signal), enabled: Boolean(user?.is_staff && selectedCohortId && !auth.demo), meta: { persist: false } });

  if (!user?.is_staff) return <StaffOnlyScreen message="Cohort files and student folders are for instructors and admins." />;
  const shell = (body: ReactNode) => <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><BackButton style={styles.back} /><View><Text style={styles.kicker}>COHORT DRIVE</Text><Text style={styles.headerTitle}>Files</Text></View></View>{body}</SafeAreaView>;
  if (auth.demo) return shell(<EmptyState title="Live cohort files" copy="Class files and student folders are available when you sign in to a live staff account." />);
  if (cohortsQuery.isPending) return shell(<LoadingState label="Loading cohorts" />);
  if (cohortsQuery.error) return shell(<ErrorState message={(cohortsQuery.error as Error).message} retry={() => void cohortsQuery.refetch()} />);
  if (!cohorts.length || !selectedCohortId) return shell(<EmptyState title="No cohorts yet" copy="Add a cohort before sharing files." />);

  const data = filesQuery.data;
  const storageReady = Boolean(data?.storage_configured);
  const classFiles = data?.class_files || [];
  const folders = data?.student_folders || [];
  const openFolder = folders.find((folder) => folder.student_id === studentId) || null;
  const needle = search.trim().toLowerCase();
  const classNeedle = classSearch.trim().toLowerCase();

  const replaceFile = (next: CohortFile) => queryClient.setQueryData<CohortFilesResponse | null>(['staff-cohort-files', selectedCohortId], (current) => current && {
    ...current,
    class_files: current.class_files.map((item) => (item.id === next.id ? next : item)),
    student_folders: (current.student_folders || []).map((folder) => {
      if (folder.student_id !== next.student_id) return folder;
      const files = folder.files.map((item) => (item.id === next.id ? next : item));
      return { ...folder, files, needs_review_count: files.filter((item) => isStudentFolderItem(item) && item.review_status === 'needs_review').length };
    }),
  });
  const removeFileFromCache = (fileId: number) => queryClient.setQueryData<CohortFilesResponse | null>(['staff-cohort-files', selectedCohortId], (current) => current && {
    ...current,
    class_files: current.class_files.filter((item) => item.id !== fileId),
    student_folders: (current.student_folders || []).map((folder) => {
      const files = folder.files.filter((item) => item.id !== fileId);
      return { ...folder, files, file_count: files.length, needs_review_count: files.filter((item) => isStudentFolderItem(item) && item.review_status === 'needs_review').length };
    }),
  });
  const created = (file: CohortFile) => { setAdding(null); setOpenFileId(file.id); void filesQuery.refetch(); };
  const waiting = folders.filter((folder) => folder.needs_review_count > 0).length;
  const openWebFiles = () => void openAuthenticatedWebPage(api, `/admin/cohorts/${selectedCohortId}?tab=files`).catch((error) => Alert.alert('Could not open staff tools', (error as Error).message));

  const classFolderOptions = [...new Set([...CLASS_FOLDER_PRESETS, ...(data?.folders || []), ...(data?.class_files || []).map((item) => item.folder)])];
  const classFolderSummaries = summarizeFolders(data?.class_files || []);
  const validClassFolder = classFolder !== 'All' && classFolderSummaries.some((item) => item.name === classFolder) ? classFolder : 'All';
  const filteredClassFiles = sortDriveFiles(
    (data?.class_files || []).filter(
      (file) => (validClassFolder === 'All' || file.folder === validClassFolder)
        && (!classNeedle || matchesCohortFile(file, classNeedle))
        && matchesDriveTypeFilter(file, typeFilter),
    ),
    sort,
  );

  const studentFolderOptions = openFolder ? [...new Set([...STUDENT_FOLDER_PRESETS, ...openFolder.files.map((item) => item.folder)])] : STUDENT_FOLDER_PRESETS;
  const studentSubfolderSummaries = openFolder ? summarizeFolders(openFolder.files) : [];
  const validStudentSubfolder = studentSubfolder !== 'All' && studentSubfolderSummaries.some((item) => item.name === studentSubfolder) ? studentSubfolder : 'All';
  const filteredStudentFiles = openFolder
    ? sortDriveFiles(
      openFolder.files.filter(
        (file) => (validStudentSubfolder === 'All' || file.folder === validStudentSubfolder) && matchesDriveTypeFilter(file, typeFilter),
      ),
      sort,
    )
    : [];

  const uploadFiles = async (targetStudentId?: number | null) => {
    if (!selectedCohortId || uploadProgress !== null || !data?.storage_configured) return;
    let uploadedCount = 0;
    const failedFiles: string[] = [];
    let lastError = '';
    try {
      const picked = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.length) return;
      setUploadProgress(0);
      const targetFolder = targetStudentId
        ? (validStudentSubfolder === 'All' ? STUDENT_FOLDER_PRESETS[0] : validStudentSubfolder)
        : (validClassFolder === 'All' ? CLASS_FOLDER_PRESETS[0] : validClassFolder);
      const total = picked.assets.length;
      for (let index = 0; index < total; index += 1) {
        const asset = picked.assets[index];
        try {
          await uploadCohortFile(
            api,
            selectedCohortId,
            asset,
            { folder: targetFolder, studentId: targetStudentId ?? undefined },
            (progress) => setUploadProgress((index + progress) / total),
          );
          uploadedCount += 1;
        } catch (error) {
          failedFiles.push(asset.name || `File ${index + 1}`);
          lastError = (error as Error).message;
        }
      }
      if (uploadedCount > 0) await filesQuery.refetch();
      if (failedFiles.length > 0) {
        const summary = uploadedCount > 0
          ? `Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}, but failed to upload: ${failedFiles.join(', ')}. ${lastError}`
          : `${failedFiles.length > 1 ? `Failed to upload ${failedFiles.join(', ')}: ` : ''}${lastError}`;
        Alert.alert(uploadedCount > 0 ? 'Some files could not upload' : 'Could not upload file', summary);
      }
    } catch (error) {
      if (uploadedCount > 0) await filesQuery.refetch();
      Alert.alert('Could not upload file', (error as Error).message);
    } finally {
      setUploadProgress(null);
    }
  };

  const uploadVersion = async (file: CohortFile) => {
    if (!selectedCohortId || uploadProgress !== null) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      setUploadProgress(0);
      const updated = await uploadCohortFileVersion(api, selectedCohortId, file.id, picked.assets[0], setUploadProgress);
      replaceFile(updated);
      await filesQuery.refetch();
    } catch (error) {
      Alert.alert('Could not upload new version', (error as Error).message);
    } finally {
      setUploadProgress(null);
    }
  };

  const moveFile = async (file: CohortFile, nextFolder: string) => {
    try {
      const result = await api.updateCohortFile(selectedCohortId, file.id, { folder: nextFolder });
      replaceFile(result.file);
    } catch (error) {
      Alert.alert('Could not move file', (error as Error).message);
    }
  };

  const toggleVisibility = async (file: CohortFile) => {
    const nextVisibility = file.visibility === 'staff_only' ? 'students' : 'staff_only';
    try {
      const result = await api.updateCohortFile(
        selectedCohortId,
        file.id,
        nextVisibility === 'staff_only' && file.auto_copy_to_students
          ? { visibility: nextVisibility, auto_copy_to_students: false }
          : { visibility: nextVisibility },
      );
      replaceFile(result.file);
    } catch (error) {
      Alert.alert('Could not update visibility', (error as Error).message);
    }
  };

  const copyToStudents = (file: CohortFile) => {
    Alert.alert(`Copy ${file.title} to every student?`, 'Each active student gets their own copy in their private folder. Students who already have one are skipped.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Copy to all',
        onPress: async () => {
          try {
            const result = await api.copyCohortFileToStudents(selectedCohortId, file.id);
            Alert.alert('Copied', `Copied to ${result.copied_count} student${result.copied_count === 1 ? '' : 's'}${result.skipped_count ? ` (${result.skipped_count} already had it)` : ''}.`);
            void filesQuery.refetch();
          } catch (error) {
            Alert.alert('Could not copy file', (error as Error).message);
          }
        },
      },
    ]);
  };

  const deleteFile = (file: CohortFile) => {
    Alert.alert(`Delete ${file.title}?`, 'Students lose access to it right away.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteCohortFile(selectedCohortId, file.id);
            removeFileFromCache(file.id);
          } catch (error) {
            Alert.alert('Could not delete file', (error as Error).message);
          }
        },
      },
    ]);
  };

  return shell(
    <ScrollView
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={filesQuery.isRefetching} onRefresh={() => void filesQuery.refetch()} tintColor={c.text.body} />}
    >
      <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {cohorts.map((cohort) => (
          <Pressable
            key={cohort.id}
            accessibilityRole="button"
            accessibilityState={{ selected: cohort.id === selectedCohortId }}
            onPress={() => { Keyboard.dismiss(); setCohortId(cohort.id); setStudentId(null); setSearch(''); setClassSearch(''); setClassFolder('All'); setStudentSubfolder('All'); setAdding(null); setOpenFileId(null); }}
            style={[styles.chip, cohort.id === selectedCohortId && styles.selected]}
          >
            <Text numberOfLines={1} style={[styles.chipText, cohort.id === selectedCohortId && styles.selectedText]}>{cohort.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.segment} accessibilityRole="tablist">
        {([['class', `Class files · ${data?.class_files.length ?? 0}`], ['students', `Student folders · ${folders.length}`]] as const).map(([value, label]) => (
          <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: view === value }} onPress={() => { setView(value); setStudentId(null); setAdding(null); setTypeFilter('all'); }} style={[styles.segmentItem, view === value && styles.segmentSelected]}>
            <Text style={[styles.chipText, view === value && styles.selectedText]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {filesQuery.isPending ? <LoadingState label="Loading files" /> : filesQuery.error ? <ErrorState message={(filesQuery.error as Error).message} retry={() => void filesQuery.refetch()} /> : data === null ? <EmptyState title="No access to these files" copy="You are no longer on this cohort's teaching team. Choose another cohort." /> : view === 'class' ? <>
        <View style={styles.search}>
          <Search color={c.text.body} size={18} />
          <TextInput keyboardAppearance={scheme} accessibilityLabel="Search class files" value={classSearch} onChangeText={setClassSearch} placeholder="Search class files" placeholderTextColor={c.text.body} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} style={styles.input} />
        </View>
        {adding === 'link'
          ? <CohortLinkForm cohortId={selectedCohortId} folders={classFolderOptions} onCancel={() => setAdding(null)} onSaved={() => { setAdding(null); void filesQuery.refetch(); }} />
          : adding === 'doc'
            ? <CohortDocForm cohortId={selectedCohortId} folders={classFolderOptions} onCancel={() => setAdding(null)} onCreated={created} />
            : (
              <View style={styles.stack}>
                {storageReady && (
                  <Button label={uploadProgress === null ? 'Upload class file' : `Uploading… ${Math.round(uploadProgress * 100)}%`} loading={uploadProgress !== null} onPress={() => void uploadFiles(null)} />
                )}
                <View style={styles.buttonRow}>
                  <Button style={styles.grow} variant="secondary" label="Add a class link" onPress={() => setAdding('link')} />
                  <Button style={styles.grow} variant="secondary" label="New class doc" onPress={() => setAdding('doc')} />
                </View>
              </View>
            )}
        <DriveFolderStrip folders={classFolderSummaries} activeFolder={validClassFolder} rootLabel="Class files" onSelectFolder={setClassFolder} />
        {(classFiles.length > 0) && (
          <DriveFilterBar
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            sort={sort}
            onSortChange={setSort}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        )}
        {viewMode === 'grid' ? (
          <View style={styles.grid}>
            {filteredClassFiles.map((file) => (
              <View key={file.id} style={styles.gridCell}>
                <CohortFileCard
                  cohortId={selectedCohortId}
                  file={file}
                  layout="grid"
                  downloadDisabled={!storageReady}
                  folderOptions={classFolderOptions}
                  onMoveFolder={moveFile}
                  onUploadVersion={storageReady ? uploadVersion : undefined}
                  onToggleVisibility={toggleVisibility}
                  onCopyToStudents={copyToStudents}
                  onDelete={() => deleteFile(file)}
                  onChanged={replaceFile}
                  onStale={() => void filesQuery.refetch()}
                  autoOpen={file.id === openFileId}
                />
              </View>
            ))}
          </View>
        ) : (
          groupByFolder(filteredClassFiles).map(([name, files]) => (
            <View key={name} style={styles.stack}>
              <Text accessibilityRole="header" style={styles.folderTitle}>{name}</Text>
              {files.map((file) => (
                <CohortFileCard
                  key={file.id}
                  cohortId={selectedCohortId}
                  file={file}
                  downloadDisabled={!storageReady}
                  folderOptions={classFolderOptions}
                  onMoveFolder={moveFile}
                  onUploadVersion={storageReady ? uploadVersion : undefined}
                  onToggleVisibility={toggleVisibility}
                  onCopyToStudents={copyToStudents}
                  onDelete={() => deleteFile(file)}
                  onChanged={replaceFile}
                  onStale={() => void filesQuery.refetch()}
                  autoOpen={file.id === openFileId}
                />
              ))}
            </View>
          ))
        )}
        {!classFiles.length ? (
          <EmptyState title="No class files yet" copy="Upload slides, guides, links or Learn Docs directly from your phone." />
        ) : !filteredClassFiles.length ? (
          <Text style={styles.copy}>No class files match this filter.</Text>
        ) : null}
        <CohortFolderZipButton cohortId={selectedCohortId} scope="class" empty={!classFiles.length} accessibilityLabel="Export all class files as a ZIP" />
        <Button variant="secondary" label="Open full files on web" onPress={openWebFiles} />
      </> : openFolder ? <>
        <Pressable accessibilityRole="button" accessibilityLabel="All student folders" onPress={() => { setStudentId(null); setStudentSubfolder('All'); setAdding(null); setOpenFileId(null); }} style={styles.backRow}>
          <ChevronLeft color={c.text.body} size={18} />
          <Text style={styles.chipText}>All student folders</Text>
        </Pressable>
        <Text style={styles.title}>{openFolder.student_name}</Text>
        <Text style={styles.copy}>Private: only this student and cohort staff can see these files.</Text>
        {adding === 'doc'
          ? <CohortDocForm cohortId={selectedCohortId} studentId={openFolder.student_id} folders={studentFolderOptions} onCancel={() => setAdding(null)} onCreated={created} />
          : adding === 'link'
            ? <CohortLinkForm cohortId={selectedCohortId} studentId={openFolder.student_id} folders={studentFolderOptions} onCancel={() => setAdding(null)} onSaved={() => { setAdding(null); void filesQuery.refetch(); }} />
            : (
              <View style={styles.stack}>
                {storageReady && (
                  <Button label={uploadProgress === null ? 'Upload to folder' : `Uploading… ${Math.round(uploadProgress * 100)}%`} loading={uploadProgress !== null} onPress={() => void uploadFiles(openFolder.student_id)} />
                )}
                <View style={styles.buttonRow}>
                  <Button style={styles.grow} variant="secondary" label="New doc in this folder" onPress={() => setAdding('doc')} />
                  <Button style={styles.grow} variant="secondary" label="Add link" onPress={() => setAdding('link')} />
                </View>
              </View>
            )}
        <CohortFolderZipButton cohortId={selectedCohortId} scope="student" studentId={openFolder.student_id} empty={!openFolder.files.length} accessibilityLabel={`Export ${openFolder.student_name}'s folder as a ZIP`} />
        <DriveFolderStrip folders={studentSubfolderSummaries} activeFolder={validStudentSubfolder} rootLabel={openFolder.student_name} onSelectFolder={setStudentSubfolder} />
        {openFolder.files.length > 0 && (
          <DriveFilterBar
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            sort={sort}
            onSortChange={setSort}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showNeedsReview
            needsReviewCount={openFolder.needs_review_count}
          />
        )}
        <View style={viewMode === 'grid' ? styles.grid : styles.stack}>
          {filteredStudentFiles.map((file) => (
            <View key={file.id} style={viewMode === 'grid' ? styles.gridCell : undefined}>
              <CohortFileCard
                cohortId={selectedCohortId}
                file={file}
                layout={viewMode}
                downloadDisabled={!storageReady}
                note={file.uploaded_by_role === 'student' ? 'Added by student' : 'Shared by staff'}
                folderOptions={studentFolderOptions}
                onMoveFolder={moveFile}
                onUploadVersion={storageReady ? uploadVersion : undefined}
                onDelete={() => deleteFile(file)}
                review={STAFF_REVIEW}
                onChanged={replaceFile}
                onStale={() => void filesQuery.refetch()}
                autoOpen={file.id === openFileId}
              />
            </View>
          ))}
        </View>
        {!openFolder.files.length ? (
          <EmptyState title="This folder is empty" copy="Files, links and docs you or the student add appear here." />
        ) : !filteredStudentFiles.length ? (
          <Text style={styles.copy}>No files match this filter.</Text>
        ) : null}
      </> : <>
        <View style={styles.search}><Search color={c.text.body} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search students" value={search} onChangeText={setSearch} placeholder="Search students" placeholderTextColor={c.text.body} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} style={styles.input} /></View>
        <View style={styles.buttonRow}>{([[false, 'All students'], [true, `Needs review (${waiting})`]] as const).map(([value, label]) => <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: needsReviewOnly === value }} onPress={() => setNeedsReviewOnly(value)} style={[styles.chip, needsReviewOnly === value && styles.selected]}><Text style={[styles.chipText, needsReviewOnly === value && styles.selectedText]}>{label}</Text></Pressable>)}</View>
        {folders.filter((folder) => (!needsReviewOnly || folder.needs_review_count > 0) && `${folder.student_name} ${folder.student_email}`.toLowerCase().includes(needle)).map((folder) => <Pressable key={folder.student_id} accessibilityRole="button" accessibilityLabel={`Open ${folder.student_name}'s folder, ${folder.file_count} file${folder.file_count === 1 ? '' : 's'}${folder.needs_review_count ? `, ${folder.needs_review_count} waiting for review` : ''}`} onPress={() => { setStudentId(folder.student_id); setStudentSubfolder('All'); setOpenFileId(null); }} style={styles.person}><FolderLock color={c.text.body} size={20} /><View style={styles.flex}><Text style={styles.name}>{folder.student_name}</Text><Text style={styles.copy}>{folder.file_count} file{folder.file_count === 1 ? '' : 's'}{folder.needs_review_count ? ` · ${folder.needs_review_count} need${folder.needs_review_count === 1 ? 's' : ''} review` : ''}{STATUS[folder.enrollment_status] ? ` · ${STATUS[folder.enrollment_status]}` : ''}</Text></View><ChevronRight color={c.text.muted} size={18} /></Pressable>)}
        {needsReviewOnly && !waiting && <Text style={styles.copy}>Nothing is waiting for review.</Text>}
        {!folders.length && <EmptyState title="No student folders yet" copy="Every enrolled student gets a private folder automatically." />}
      </>}
    </ScrollView>,
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 },
  content: { padding: 20, paddingBottom: 60, gap: 14 }, strip: { flexGrow: 0, maxHeight: 52 }, chips: { alignItems: 'center', gap: 8, paddingRight: 20 },
  chip: { minHeight: 44, maxWidth: 210, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 13 }, selected: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, chipText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 13 }, selectedText: { color: c.text.strong },
  segment: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, padding: 4, gap: 4 }, segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, segmentSelected: { backgroundColor: c.surface.raised },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, grow: { flexGrow: 1, minWidth: 130 },
  stack: { gap: 9 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, gridCell: { width: '48%' },
  folderTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13, marginTop: 4 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 22 }, copy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
  backRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  search: { minHeight: 48, borderRadius: 14, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 14 }, flex: { flex: 1, minWidth: 0 }, name: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15 },
}));
