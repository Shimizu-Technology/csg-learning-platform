import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import {
  CopyPlus,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileUp,
  FileVideo,
  FolderInput,
  History,
  Link2,
  MoreHorizontal,
  NotebookPen,
  Presentation,
  Trash2,
} from 'lucide-react-native';

import { CohortDocModal, CohortFileReviewModal, CohortFileReviewSection, ReviewBadge, type ReviewAccess } from '@/components/cohort-doc-modal';
import { CohortFilePreviewModal } from '@/components/cohort-file-preview';
import { LearningCard } from '@/components/learning-ui';
import { Badge } from '@/components/ui/badge';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { fonts } from '@/constants/csg-theme';
import type { components } from '@/lib/api.generated';
import { LINK_PROVIDER_LABELS, cohortFileMeta, isStudentFolderItem, safeExternalFileUrl, safeHttpsUrl, type CohortFile, type CohortFilePreview } from '@/lib/cohort-files';
import { fileVisualMeta, type DriveViewMode } from '@/lib/drive-helpers';
import { openExternalPage } from '@/lib/external-links';
import { safeExternalUrl } from '@/lib/learning';
import { useSession } from '@/providers/session-provider';
import { makeStyles, useTheme } from '@/providers/theme-provider';

const IN_APP_MODES = new Set(['markdown', 'text', 'csv', 'image']);

const KIND_ICONS = {
  doc: NotebookPen,
  link: Link2,
  pdf: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  zip: FileArchive,
  file: FileText,
} as const;

/**
 * Google Drive-style native file card (List row or Grid tile) with 1-tap open/preview,
 * accessible direct action controls, and a Drive action sheet for folder move,
 * version upload, visibility toggle, and copy-to-students.
 */
export function CohortFileCard({
  cohortId,
  file,
  note,
  onDelete,
  downloadDisabled = false,
  review,
  onChanged,
  onStale,
  autoOpen = false,
  layout = 'list',
  folderOptions,
  onMoveFolder,
  onUploadVersion,
  onToggleVisibility,
  onCopyToStudents,
  onDocOpenChange,
}: {
  cohortId: number;
  file: CohortFile;
  note?: string;
  onDelete?: () => void;
  downloadDisabled?: boolean;
  review?: ReviewAccess;
  onChanged?: (file: CohortFile) => void;
  onStale?: () => void;
  autoOpen?: boolean;
  layout?: DriveViewMode;
  folderOptions?: string[];
  onMoveFolder?: (file: CohortFile, folder: string) => Promise<void> | void;
  onUploadVersion?: (file: CohortFile) => Promise<void> | void;
  onToggleVisibility?: (file: CohortFile) => Promise<void> | void;
  onCopyToStudents?: (file: CohortFile) => Promise<void> | void;
  onDocOpenChange?: (open: boolean) => void;
}) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const { api } = useSession();
  const busy = useRef(false);
  const [preparing, setPreparing] = useState<'download' | 'preview' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<'download' | 'preview' | null>(null);
  const [preview, setPreview] = useState<CohortFilePreview | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'actions' | 'move' | 'versions'>('actions');
  const [versions, setVersions] = useState<components['schemas']['CohortFileVersion'][]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const versionsGenerationRef = useRef(0);
  const versionsAbortRef = useRef<AbortController | null>(null);

  const cancelVersionLoad = () => {
    versionsGenerationRef.current += 1;
    versionsAbortRef.current?.abort();
    versionsAbortRef.current = null;
    setLoadingVersions(false);
  };

  useEffect(() => () => {
    versionsGenerationRef.current += 1;
    versionsAbortRef.current?.abort();
    versionsAbortRef.current = null;
  }, [file.id]);
  const link = file.kind === 'link';
  const doc = file.kind === 'doc';
  const href = link ? safeExternalFileUrl(file.external_url) : null;
  const reviewing = review && isStudentFolderItem(file) ? review : undefined;
  const autoCopy = file.auto_copy_to_students && file.student_id === null && file.can_manage;
  const staged = file.visibility === 'staff_only';
  const [autoOpened, setAutoOpened] = useState(false);
  if (autoOpen && !autoOpened) {
    setAutoOpened(true);
    if (doc) setDocOpen(true);
    else if (reviewing) setReviewOpen(true);
  }
  const setDocModalOpen = (next: boolean) => {
    setDocOpen(next);
    onDocOpenChange?.(next);
  };

  async function run(kind: 'download' | 'preview', task: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPreparing(kind);
    setError(null);
    setFailed(null);
    try {
      await task();
    } catch (failure) {
      setError((failure as Error).message || (kind === 'preview' ? 'Could not open the preview.' : 'Could not prepare the download.'));
      setFailed(kind);
    } finally {
      busy.current = false;
      setPreparing(null);
    }
  }
  const download = (versionId?: number) => run('download', async () => {
    const result = versionId != null
      ? await api.downloadCohortFile(cohortId, file.id, versionId)
      : await api.downloadCohortFile(cohortId, file.id);
    const url = safeExternalUrl(result.url);
    if (!url) throw new Error('The download link is unavailable. Try again.');
    await Linking.openURL(url);
  });
  const openPreview = (versionId?: number) => run('preview', async () => {
    const result = versionId != null
      ? await api.previewCohortFile(cohortId, file.id, versionId)
      : await api.previewCohortFile(cohortId, file.id);
    if (IN_APP_MODES.has(result.preview_mode)) return setPreview(result);
    const url = safeHttpsUrl(result.url);
    if (!url) throw new Error('This file can only be downloaded.');
    await openExternalPage(url);
  });
  const loadVersions = async () => {
    cancelVersionLoad();
    const generation = versionsGenerationRef.current;
    const controller = new AbortController();
    versionsAbortRef.current = controller;
    setSheetMode('versions');
    setLoadingVersions(true);
    setVersionsError(null);
    try {
      const response = await api.cohortFileVersions(cohortId, file.id, controller.signal);
      if (versionsGenerationRef.current !== generation || controller.signal.aborted) return;
      setVersions(response.versions || []);
    } catch (failure) {
      if (versionsGenerationRef.current !== generation || controller.signal.aborted) return;
      setVersionsError((failure as Error).message || 'Could not load version history.');
    } finally {
      if (versionsGenerationRef.current === generation) {
        versionsAbortRef.current = null;
        setLoadingVersions(false);
      }
    }
  };
  const openLink = async () => {
    setError(null);
    try {
      if (!href) throw new Error('This link is not a public https address.');
      await Linking.openURL(href);
    } catch (failure) {
      setError((failure as Error).message || 'Could not open the link.');
    }
  };
  const openPrimary = () => {
    if (doc) { setDocModalOpen(true); return; }
    if (link) { if (href) void openLink(); return; }
    if (file.previewable && !downloadDisabled) { void openPreview(); return; }
    if (!downloadDisabled) void download();
  };

  const visual = fileVisualMeta(file);
  const Icon = KIND_ICONS[visual.kindKey];
  const iconToneBg = visual.tone === 'brand'
    ? c.selection.bg
    : visual.tone === 'info'
      ? c.status.info.bg
      : visual.tone === 'success'
        ? c.status.success.bg
        : visual.tone === 'warning'
          ? c.status.warning.bg
          : c.surface.sunken;
  const iconToneFg = visual.tone === 'brand'
    ? c.action.primary
    : visual.tone === 'info'
      ? c.status.info.fg
      : visual.tone === 'success'
        ? c.status.success.fg
        : visual.tone === 'warning'
          ? c.status.warning.fg
          : c.text.body;

  const hasSheetActions = Boolean(
    (!link && !doc && !downloadDisabled)
    || (onMoveFolder && folderOptions && folderOptions.length > 0)
    || (onUploadVersion && !link && !doc && !downloadDisabled)
    || onToggleVisibility
    || (onCopyToStudents && !staged),
  );
  const commentNote = reviewing ? ` · ${file.comment_count} comment${file.comment_count === 1 ? '' : 's'}` : '';
  const allFolders = folderOptions ? [...new Set([file.folder, ...folderOptions])] : [file.folder];

  return (
    <LearningCard>
      {layout === 'grid' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={file.title}
          onPress={openPrimary}
          style={[styles.gridBanner, { backgroundColor: iconToneBg }]}
        >
          <Icon color={iconToneFg} size={28} />
          <Text style={[styles.gridBadge, { color: iconToneFg }]}>{visual.badgeLabel}</Text>
        </Pressable>
      )}
      <View style={styles.heading}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={file.title}
          onPress={openPrimary}
          style={styles.primaryRow}
        >
          {layout === 'list' && (
            <View style={[styles.iconTile, { backgroundColor: iconToneBg }]}>
              <Icon color={iconToneFg} size={20} />
            </View>
          )}
          <View style={styles.titleWrap}>
            <Text numberOfLines={2} style={styles.title}>{file.title}</Text>
            <Text numberOfLines={2} style={styles.meta}>
              {cohortFileMeta(file)}{note ? ` · ${note}` : ''}{commentNote}
            </Text>
          </View>
        </Pressable>
        {hasSheetActions && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${file.title}`}
            onPress={() => { setSheetMode('actions'); setSheetOpen(true); }}
            style={styles.moreButton}
          >
            <MoreHorizontal color={c.text.body} size={20} />
          </Pressable>
        )}
      </View>

      {(link || doc || autoCopy || staged || file.version_number > 1 || (reviewing && file.review_status !== 'none')) && (
        <View style={styles.badges}>
          {link && <Badge label={LINK_PROVIDER_LABELS[file.link_provider || 'web']} />}
          {doc && <Badge tone="brand" label="Learn Doc" />}
          {staged && <Badge tone="warning" label="Staff only" />}
          {autoCopy && <Badge tone="success" label="Auto-copy" accessibilityLabel="Auto-copy: every student gets their own copy" />}
          {!link && !doc && file.version_number > 1 && <Badge tone="pending" label={`v${file.version_number}`} />}
          {reviewing && <ReviewBadge status={file.review_status} />}
        </View>
      )}

      {file.description && <Text style={styles.description}>{file.description}</Text>}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!link && !doc && downloadDisabled && <Text style={styles.meta}>Downloads are unavailable until file storage is set up.</Text>}

      <View style={styles.actions}>
        {doc ? (
          <Button size="sm" style={styles.action} variant="secondary" accessibilityLabel={`Open ${file.title}`} label={file.can_edit_doc ? 'Open and edit' : 'Open'} onPress={() => setDocModalOpen(true)} />
        ) : link ? (
          <Button size="sm" style={styles.action} variant="secondary" accessibilityRole="link" accessibilityLabel={`Open ${file.title}`} label="Open" disabled={!href} onPress={() => void openLink()} />
        ) : (
          <>
            {file.previewable && (
              <Button size="sm" style={styles.action} variant="secondary" accessibilityLabel={`Preview ${file.title}`} label={preparing === 'preview' ? 'Opening…' : 'Preview'} loading={preparing === 'preview'} disabled={Boolean(preparing) || downloadDisabled} onPress={() => void openPreview()} />
            )}
            <Button size="sm" style={styles.action} variant="secondary" accessibilityLabel={`Download ${file.title}`} label={preparing === 'download' ? 'Preparing download…' : failed === 'download' ? 'Retry download' : 'Download'} loading={preparing === 'download'} disabled={Boolean(preparing) || downloadDisabled} onPress={() => void download()} />
          </>
        )}
        {reviewing && !doc && (
          <Button size="sm" style={styles.action} variant="secondary" accessibilityLabel={`Review and comments on ${file.title}`} label={file.comment_count ? `Comments · ${file.comment_count}` : 'Review and comments'} onPress={() => setReviewOpen(true)} />
        )}
        {onDelete && (
          <Button size="sm" style={styles.action} variant="danger" accessibilityLabel={`Delete ${file.title}`} label="Delete" onPress={onDelete} />
        )}
      </View>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => { cancelVersionLoad(); setSheetOpen(false); }}
        title={sheetMode === 'versions' ? 'Version history' : sheetMode === 'move' ? 'Move to folder' : file.title}
        subtitle={sheetMode === 'versions' || sheetMode === 'move' ? file.title : undefined}
      >
        {sheetMode === 'move' && onMoveFolder ? (
          <View style={styles.sheetList}>
            {allFolders.map((folderName) => {
              const current = folderName === file.folder;
              return (
                <Pressable
                  key={folderName}
                  accessibilityRole="button"
                  accessibilityLabel={`Move to ${folderName}`}
                  disabled={current}
                  onPress={() => {
                    setSheetOpen(false);
                    setSheetMode('actions');
                    void onMoveFolder(file, folderName);
                  }}
                  style={[styles.sheetRow, current && styles.sheetRowDisabled]}
                >
                  <FolderInput color={c.text.body} size={18} />
                  <Text style={styles.sheetRowText}>{folderName}{current ? ' (current)' : ''}</Text>
                </Pressable>
              );
            })}
            <Button size="sm" variant="secondary" label="Back" onPress={() => setSheetMode('actions')} />
          </View>
        ) : sheetMode === 'versions' ? (
          <View style={styles.sheetList}>
            {loadingVersions ? (
              <View style={styles.versionLoading}>
                <ActivityIndicator color={c.text.body} />
                <Text style={styles.sheetSubtitle}>Loading versions…</Text>
              </View>
            ) : versionsError ? (
              <View style={styles.sheetList}>
                <Text accessibilityRole="alert" style={styles.error}>{versionsError}</Text>
                <Button size="sm" variant="secondary" label="Retry" onPress={() => void loadVersions()} />
              </View>
            ) : versions.length === 0 ? (
              <Text style={styles.sheetSubtitle}>No earlier versions saved yet.</Text>
            ) : (
              versions.map((ver) => (
                <View key={ver.id} style={styles.versionRow}>
                  <View style={styles.titleWrap}>
                    <Text style={styles.sheetRowText}>
                      {`v${ver.version_number}${ver.current ? ' · Current' : ''}`}
                    </Text>
                    <Text numberOfLines={2} style={styles.sheetSubtitle}>
                      {ver.filename}
                      {ver.uploaded_by_name ? ` · ${ver.uploaded_by_name}` : ''}
                      {ver.note ? ` · ${ver.note}` : ''}
                    </Text>
                  </View>
                  <View style={styles.versionActions}>
                    {ver.previewable && (
                      <Button
                        size="sm"
                        variant="secondary"
                        accessibilityLabel={`Preview version ${ver.version_number}`}
                        label="View"
                        onPress={() => { setSheetOpen(false); void openPreview(ver.id); }}
                      />
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      accessibilityLabel={`Download version ${ver.version_number}`}
                      onPress={() => { setSheetOpen(false); void download(ver.id); }}
                    >
                      <Download color={c.text.strong} size={15} />
                    </Button>
                  </View>
                </View>
              ))
            )}
            <Button size="sm" variant="secondary" label="Back" onPress={() => { cancelVersionLoad(); setSheetMode('actions'); }} />
          </View>
        ) : (
          <View style={styles.sheetList}>
            {!link && !doc && !downloadDisabled && (
              <Pressable accessibilityRole="button" onPress={() => void loadVersions()} style={styles.sheetRow}>
                <History color={c.text.body} size={18} />
                <Text style={styles.sheetRowText}>Version history{file.version_number > 1 ? ` (v${file.version_number})` : ''}</Text>
              </Pressable>
            )}
            {onMoveFolder && folderOptions && folderOptions.length > 0 && (
              <Pressable accessibilityRole="button" onPress={() => setSheetMode('move')} style={styles.sheetRow}>
                <FolderInput color={c.text.body} size={18} />
                <Text style={styles.sheetRowText}>Move to folder</Text>
              </Pressable>
            )}
            {onUploadVersion && !link && !doc && !downloadDisabled && (
              <Pressable
                accessibilityRole="button"
                onPress={() => { setSheetOpen(false); void onUploadVersion(file); }}
                style={styles.sheetRow}
              >
                <FileUp color={c.text.body} size={18} />
                <Text style={styles.sheetRowText}>Upload new version</Text>
              </Pressable>
            )}
            {onToggleVisibility && (
              <Pressable
                accessibilityRole="button"
                onPress={() => { setSheetOpen(false); void onToggleVisibility(file); }}
                style={styles.sheetRow}
              >
                {staged ? <Eye color={c.text.body} size={18} /> : <EyeOff color={c.text.body} size={18} />}
                <Text style={styles.sheetRowText}>{staged ? 'Share with students' : 'Move to staff only'}</Text>
              </Pressable>
            )}
            {onCopyToStudents && !staged && (
              <Pressable
                accessibilityRole="button"
                onPress={() => { setSheetOpen(false); void onCopyToStudents(file); }}
                style={styles.sheetRow}
              >
                <CopyPlus color={c.text.body} size={18} />
                <Text style={styles.sheetRowText}>Copy to all students</Text>
              </Pressable>
            )}
            {onDelete && (
              <Pressable
                accessibilityRole="button"
                onPress={() => { setSheetOpen(false); onDelete(); }}
                style={styles.sheetRow}
              >
                <Trash2 color={c.status.danger.fg} size={18} />
                <Text style={[styles.sheetRowText, styles.sheetDanger]}>Delete</Text>
              </Pressable>
            )}
          </View>
        )}
      </BottomSheet>

      {!link && !doc && (
        <CohortFilePreviewModal
          title={file.title}
          preview={preview}
          onClose={() => setPreview(null)}
          onDownload={() => { const versionId = preview?.version_id ?? undefined; setPreview(null); void download(versionId); }}
          review={reviewing && preview ? <CohortFileReviewSection cohortId={cohortId} file={file} access={reviewing} onChanged={onChanged} /> : undefined}
        />
      )}
      {doc && (
        <CohortDocModal cohortId={cohortId} file={file} visible={docOpen} onClose={() => setDocModalOpen(false)} onChanged={onChanged} onStale={onStale} reviewAccess={reviewing} />
      )}
      {reviewing && !doc && (
        <CohortFileReviewModal cohortId={cohortId} file={file} access={reviewing} visible={reviewOpen} onClose={() => setReviewOpen(false)} onChanged={onChanged} />
      )}
    </LearningCard>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  gridBanner: {
    height: 82,
    borderRadius: 12,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  gridBadge: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.6 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  primaryRow: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 },
  moreButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  meta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
  description: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 8 },
  error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 13, marginTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  action: { flexGrow: 1, minWidth: 96 },
  sheetSubtitle: { color: c.text.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  sheetList: { gap: 6 },
  sheetRow: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetRowDisabled: { opacity: 0.45 },
  sheetRowText: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 14 },
  sheetDanger: { color: c.status.danger.fg },
  versionLoading: { paddingVertical: 20, alignItems: 'center', gap: 8 },
  versionRow: {
    minHeight: 54,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.sunken,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  versionActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
}));
