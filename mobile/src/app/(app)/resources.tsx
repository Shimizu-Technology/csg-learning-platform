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
import { CohortFolderZipButton } from '@/components/cohort-folder-zip-button';
import { CohortDocForm } from '@/components/cohort-doc-modal';
import { CohortLinkForm } from '@/components/cohort-link-form';
import { CourseFileCard } from '@/components/course-file-card';
import { DriveFilterBar, DriveFolderStrip } from '@/components/drive-controls';
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import {
  STUDENT_FOLDER_PRESETS,
  groupByFolder,
  isStudentFolderItem,
  loadCohortFiles,
  matchesCohortFile,
  uploadCohortFileVersion,
  uploadToMyFolder,
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
  const { q, file: fileParam } = useLocalSearchParams<{ q?: string; file?: string }>();
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
    queryFn: ({ signal }) => loadCohortFiles(api, selectedCohortId!, signal),
    enabled: Boolean(user && !user.is_staff && selectedCohortId && !auth.demo),
    // Private folder metadata stays in memory only, never in offline storage.
    meta: { persist: false },
  });
  const [folder, setFolder] = useState(STUDENT_FOLDER_PRESETS[0]);
  const [myActiveFolder, setMyActiveFolder] = useState('All');
  const [classActiveFolder, setClassActiveFolder] = useState('All');
  const [typeFilter, setTypeFilter] = useState<DriveTypeFilter>('all');
  const [sort, setSort] = useState<DriveSort>('updated_desc');
  const [viewMode, setViewMode] = useState<DriveViewMode>('list');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [adding, setAdding] = useState<'link' | 'doc' | null>(null);
  // A notification link (?file=) or a new doc opens that item once.
  const [openFileId, setOpenFileId] = useState<number | null>(Number(fileParam) || null);
  const [linkedParam, setLinkedParam] = useState(fileParam);
  if (fileParam !== linkedParam) {
    setLinkedParam(fileParam);
    if (Number(fileParam)) {
      setFilter('');
      setMyActiveFolder('All');
      setClassActiveFolder('All');
      setTypeFilter('all');
      setOpenFileId(Number(fileParam));
    }
  }
  const replaceMyFile = (next: CohortFile) => queryClient.setQueryData<CohortFilesResponse | null>(filesKey, (current) => current && { ...current, my_files: (current.my_files || []).map((item) => (item.id === next.id ? next : item)) });
  const needle = filter.trim().toLowerCase();
  const matches = (file: CohortFile) => matchesCohortFile(file, needle) && matchesDriveTypeFilter(file, typeFilter);

  const allMyFiles = filesQuery.data?.my_files || [];
  const allClassFiles = filesQuery.data?.class_files || [];
  const myFolderSummaries = summarizeFolders(allMyFiles);
  const classFolderSummaries = summarizeFolders(allClassFiles);
  const validMyFolder = myActiveFolder !== 'All' && myFolderSummaries.some((item) => item.name === myActiveFolder) ? myActiveFolder : 'All';
  const validClassFolder = classActiveFolder !== 'All' && classFolderSummaries.some((item) => item.name === classActiveFolder) ? classActiveFolder : 'All';
  const myFolderOptions = [...new Set([...STUDENT_FOLDER_PRESETS, ...allMyFiles.map((item) => item.folder)])];
  const myNeedsReviewCount = allMyFiles.filter((file) => isStudentFolderItem(file) && file.review_status === 'needs_review').length;

  const myFiles = sortDriveFiles(
    allMyFiles.filter((file) => (validMyFolder === 'All' || file.folder === validMyFolder) && matches(file)),
    sort,
  );
  const filteredClassFiles = sortDriveFiles(
    allClassFiles.filter((file) => (validClassFolder === 'All' || file.folder === validClassFolder) && matches(file)),
    sort,
  );
  const classFolders = groupByFolder(filteredClassFiles);
  const canUpload = Boolean(filesQuery.data?.can_upload_personal && filesQuery.data.storage_configured);
  const canAddLink = Boolean(filesQuery.data?.can_upload_personal);
  const targetUploadFolder = validMyFolder === 'All' ? folder : validMyFolder;

  const upload = async () => {
    if (!selectedCohortId || uploadProgress !== null) return;
    let uploadedCount = 0;
    const failedFiles: string[] = [];
    let lastError = '';
    try {
      const picked = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.length) return;
      setUploadProgress(0);
      const total = picked.assets.length;
      for (let index = 0; index < total; index += 1) {
        const asset = picked.assets[index];
        try {
          await uploadToMyFolder(api, selectedCohortId, asset, targetUploadFolder, (progress) => {
            setUploadProgress((index + progress) / total);
          });
          uploadedCount += 1;
        } catch (error) {
          failedFiles.push(asset.name || `File ${index + 1}`);
          lastError = (error as Error).message;
        }
      }
      if (uploadedCount > 0) await queryClient.invalidateQueries({ queryKey: filesKey });
      if (failedFiles.length > 0) {
        const summary = uploadedCount > 0
          ? `Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}, but failed to upload: ${failedFiles.join(', ')}. ${lastError}`
          : `${failedFiles.length > 1 ? `Failed to upload ${failedFiles.join(', ')}: ` : ''}${lastError}`;
        Alert.alert(uploadedCount > 0 ? 'Some files could not upload' : 'Could not upload file', summary);
      }
    } catch (error) {
      if (uploadedCount > 0) await queryClient.invalidateQueries({ queryKey: filesKey });
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
      replaceMyFile(updated);
      await queryClient.invalidateQueries({ queryKey: filesKey });
    } catch (error) {
      Alert.alert('Could not upload new version', (error as Error).message);
    } finally {
      setUploadProgress(null);
    }
  };
  const moveMyFile = async (file: CohortFile, nextFolder: string) => {
    if (!selectedCohortId) return;
    try {
      const result = await api.updateCohortFile(selectedCohortId, file.id, { folder: nextFolder });
      replaceMyFile(result.file);
    } catch (error) {
      Alert.alert('Could not move file', (error as Error).message);
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
  const storageReady = Boolean(filesQuery.data?.storage_configured);
  const filesFailed = filesQuery.isError && !filesQuery.data;
  const hasAnyDriveItems = allMyFiles.length + allClassFiles.length > 0;
  const fileSections = filesFailed ? <View accessibilityRole="alert" style={styles.filesError}><Text style={styles.offlineText}>Your files and class files could not load. {(filesQuery.error as Error).message}</Text><Button variant="secondary" label="Retry" onPress={() => void filesQuery.refetch()} /></View> : hasFolder && selectedCohortId ? <>
    {hasAnyDriveItems && (
      <DriveFilterBar
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        sort={sort}
        onSortChange={setSort}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showNeedsReview={myNeedsReviewCount > 0}
        needsReviewCount={myNeedsReviewCount}
      />
    )}
    <View style={styles.section}>
      <View style={styles.row}><FolderLock color={c.text.body} size={16} /><Text accessibilityRole="header" style={styles.category}>My files</Text></View>
      <Text style={styles.resourceCopy}>Your private folder — only you and your instructors can see files here.</Text>
      {canUpload ? (
        <View style={styles.stack}>
          {validMyFolder === 'All' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.chips}>
              {STUDENT_FOLDER_PRESETS.map((preset) => (
                <Pressable key={preset} accessibilityRole="button" accessibilityLabel={`Upload to ${preset}`} accessibilityState={{ selected: folder === preset }} onPress={() => setFolder(preset)} style={[styles.chip, folder === preset && styles.selectedChip]}>
                  <Text style={[styles.chipText, folder === preset && styles.selectedChipText]}>{preset}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Button label={uploadProgress === null ? 'Upload file' : `Uploading… ${Math.round(uploadProgress * 100)}%`} loading={uploadProgress !== null} onPress={() => void upload()} />
        </View>
      ) : (
        <Text style={styles.notice}>{!filesQuery.data?.can_upload_personal ? 'Uploads are paused while your course is paused or your access has ended. You can still download your files.' : "File uploads aren't available right now. You can still add links and docs."}</Text>
      )}
      {canAddLink && (adding === 'link'
        ? <CohortLinkForm cohortId={selectedCohortId} folders={myFolderOptions} onCancel={() => setAdding(null)} onSaved={() => { setAdding(null); void queryClient.invalidateQueries({ queryKey: filesKey }); }} />
        : adding === 'doc'
          ? <CohortDocForm cohortId={selectedCohortId} folders={myFolderOptions} onCancel={() => setAdding(null)} onCreated={(created) => { setAdding(null); setOpenFileId(created.id); void queryClient.invalidateQueries({ queryKey: filesKey }); }} />
          : <View style={styles.buttonRow}><Button style={styles.grow} variant="secondary" label="Add a link" onPress={() => setAdding('link')} /><Button style={styles.grow} variant="secondary" label="New doc" onPress={() => setAdding('doc')} /></View>)}
      {allMyFiles.length > 0 && <CohortFolderZipButton cohortId={selectedCohortId} scope="my_files" empty={false} label="Export ZIP" accessibilityLabel="Export all my files as a ZIP" />}
      <DriveFolderStrip folders={myFolderSummaries} activeFolder={validMyFolder} rootLabel="My files" onSelectFolder={setMyActiveFolder} />
      <View style={viewMode === 'grid' ? styles.grid : styles.stack}>
        {myFiles.map((file) => (
          <View key={file.id} style={viewMode === 'grid' ? styles.gridCell : undefined}>
            <CohortFileCard
              cohortId={selectedCohortId}
              file={file}
              layout={viewMode}
              downloadDisabled={!storageReady}
              note={file.uploaded_by_role === 'student' ? 'Added by you' : 'Shared by your instructor'}
              onDelete={file.can_manage ? () => removeFile(file) : undefined}
              folderOptions={file.can_manage && canAddLink ? myFolderOptions : undefined}
              onMoveFolder={file.can_manage && canAddLink ? moveMyFile : undefined}
              onUploadVersion={file.can_manage && canUpload ? uploadVersion : undefined}
              review={{ staff: false, canChange: canAddLink }}
              onChanged={replaceMyFile}
              onStale={() => void queryClient.invalidateQueries({ queryKey: filesKey })}
              autoOpen={file.id === openFileId}
            />
          </View>
        ))}
      </View>
      {!myFiles.length && <Text style={styles.resourceCopy}>{filter || typeFilter !== 'all' ? 'No files in your folder match this filter.' : 'No files in your folder yet.'}</Text>}
    </View>
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.category}>Class files</Text>
      <Text style={styles.resourceCopy}>Slides, guides and templates your instructors shared with your cohort.</Text>
      <DriveFolderStrip folders={classFolderSummaries} activeFolder={validClassFolder} rootLabel="Class files" onSelectFolder={setClassActiveFolder} />
      {viewMode === 'grid' ? (
        <View style={styles.grid}>
          {filteredClassFiles.map((file) => (
            <View key={file.id} style={styles.gridCell}>
              <CohortFileCard cohortId={selectedCohortId} file={file} layout="grid" downloadDisabled={!storageReady} onStale={() => void queryClient.invalidateQueries({ queryKey: filesKey })} autoOpen={file.id === openFileId} />
            </View>
          ))}
        </View>
      ) : (
        classFolders.map(([name, files]) => (
          <View key={name} style={styles.stack}>
            <Text style={styles.folderTitle}>{name}</Text>
            {files.map((file) => (
              <CohortFileCard key={file.id} cohortId={selectedCohortId} file={file} downloadDisabled={!storageReady} onStale={() => void queryClient.invalidateQueries({ queryKey: filesKey })} autoOpen={file.id === openFileId} />
            ))}
          </View>
        ))
      )}
      {!filteredClassFiles.length && <Text style={styles.resourceCopy}>{filter || typeFilter !== 'all' ? 'No class files match this filter.' : 'No class files yet.'}</Text>}
    </View>
  </> : null;

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><BackButton style={styles.back} /><View><Text style={styles.headerKicker}>LEARNING DRIVE</Text><Text style={styles.headerTitle}>Resources</Text></View></View>{query.isPending && !query.data ? <LoadingState label="Loading resources" /> : query.error && !query.data ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => { void query.refetch(); if (filesQuery.isFetched) void filesQuery.refetch(); }} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
    <PausedLearningCard cohortId={selectedCohortId} />
    {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved resources. Pull to reconnect.</Text></View>}
    <Text style={styles.title}>Everything useful, close at hand.</Text><Text style={styles.subtitle}>{selectedCohort ? `${selectedCohort.name} · ` : ''}Open class references and starter files without hunting through old messages.</Text>
    <View style={styles.search}><Search color={c.text.muted} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search resources" value={filter} onChangeText={setFilter} placeholder="Search files, docs, and resources" placeholderTextColor={c.text.body} style={styles.input} /></View>
    {fileSections}
    {sections.map(({ title, copy, items }) => <View key={title} style={styles.section}><Text accessibilityRole="header" style={styles.category}>{title}</Text><Text style={styles.resourceCopy}>{copy}</Text><View style={styles.stack}>{(items || []).map((resource) => resource.download_id ? <View key={`${resource.cohort_id}:${resource.id}`}>{!selectedCohortId && resource.cohort_name && <Text style={styles.resourceCopy}>{resource.cohort_name}</Text>}<CourseFileCard resource={resource} /></View> : <LearningCard key={`${resource.cohort_id}:${resource.id}`} onPress={() => void openExternalPage(resource.url).catch((error) => Alert.alert('Could not open resource', (error as Error).message))} label={`Open ${resource.title}`}><View style={styles.row}><View style={styles.icon}><FolderOpen color={c.text.body} size={20} /></View><View style={styles.flex}><Text style={styles.resourceTitle}>{resource.title}</Text>{!selectedCohortId && resource.cohort_name && <Text style={styles.resourceCopy}>{resource.cohort_name}</Text>}{resource.description && <Text style={styles.resourceCopy}>{resource.description}</Text>}</View><ExternalLink color={c.text.muted} size={18} /></View></LearningCard>)}</View></View>)}
    {!resources.length && !hasFolder && !filesFailed && <View style={styles.empty}><FolderOpen color={c.text.body} size={30} /><Text style={styles.emptyTitle}>{filter ? 'No matching resources' : 'No resources yet'}</Text><Text style={styles.emptyCopy}>{filter ? 'Try a different search.' : 'Shared class links will appear here.'}</Text></View>}
  </ScrollView>}</SafeAreaView>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, headerKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, content: { padding: 20, paddingBottom: 80, gap: 15 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 28, lineHeight: 35, letterSpacing: -0.8 }, subtitle: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: -7 }, search: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, section: { gap: 9, marginTop: 8 }, category: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.3 }, stack: { gap: 9 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, gridCell: { width: '48%' }, strip: { flexGrow: 0, flexShrink: 0 }, row: { flexDirection: 'row', alignItems: 'center', gap: 11 }, icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, resourceTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, resourceCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 3 }, empty: { alignItems: 'center', paddingVertical: 70 }, emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 13 }, emptyCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 5 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: c.status.warning.bg, justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12 },
  filesError: { gap: 10, borderRadius: 12, backgroundColor: c.status.warning.bg, padding: 12 },
  notice: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, borderRadius: 12, backgroundColor: c.surface.sunken, padding: 12 }, folderTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13, marginTop: 4 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, grow: { flexGrow: 1, minWidth: 130 },
  chips: { gap: 8, paddingRight: 20 }, chip: { minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 12 }, selectedChip: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, chipText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, selectedChipText: { color: c.text.strong },
}));
