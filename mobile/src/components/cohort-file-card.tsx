import { useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CopyPlus,
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
  Link2,
  MoreHorizontal,
  NotebookPen,
  Presentation,
  Trash2,
  X,
} from 'lucide-react-native';

import { CohortDocModal, CohortFileReviewModal, CohortFileReviewSection, ReviewBadge, type ReviewAccess } from '@/components/cohort-doc-modal';
import { CohortFilePreviewModal } from '@/components/cohort-file-preview';
import { LearningCard } from '@/components/learning-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fonts } from '@/constants/csg-theme';
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
  const [movingFolder, setMovingFolder] = useState(false);
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
  const download = () => run('download', async () => {
    const result = await api.downloadCohortFile(cohortId, file.id);
    const url = safeExternalUrl(result.url);
    if (!url) throw new Error('The download link is unavailable. Try again.');
    await Linking.openURL(url);
  });
  const openPreview = () => run('preview', async () => {
    const result = await api.previewCohortFile(cohortId, file.id);
    if (IN_APP_MODES.has(result.preview_mode)) return setPreview(result);
    const url = safeHttpsUrl(result.url);
    if (!url) throw new Error('This file can only be downloaded.');
    await openExternalPage(url);
  });
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
    (onMoveFolder && folderOptions && folderOptions.length > 0)
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
            onPress={() => { setMovingFolder(false); setSheetOpen(true); }}
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
          <Button style={styles.action} variant="secondary" accessibilityLabel={`Open ${file.title}`} label={file.can_edit_doc ? 'Open and edit' : 'Open'} onPress={() => setDocModalOpen(true)} />
        ) : link ? (
          <Button style={styles.action} variant="secondary" accessibilityRole="link" accessibilityLabel={`Open ${file.title}`} label="Open" disabled={!href} onPress={() => void openLink()} />
        ) : (
          <>
            {file.previewable && (
              <Button style={styles.action} variant="secondary" accessibilityLabel={`Preview ${file.title}`} label={preparing === 'preview' ? 'Opening…' : 'Preview'} loading={preparing === 'preview'} disabled={Boolean(preparing) || downloadDisabled} onPress={() => void openPreview()} />
            )}
            <Button style={styles.action} variant="secondary" accessibilityLabel={`Download ${file.title}`} label={preparing === 'download' ? 'Preparing download…' : failed === 'download' ? 'Retry download' : 'Download'} loading={preparing === 'download'} disabled={Boolean(preparing) || downloadDisabled} onPress={() => void download()} />
          </>
        )}
        {reviewing && !doc && (
          <Button style={styles.action} variant="secondary" accessibilityLabel={`Review and comments on ${file.title}`} label={file.comment_count ? `Comments · ${file.comment_count}` : 'Review and comments'} onPress={() => setReviewOpen(true)} />
        )}
        {onDelete && (
          <Button style={styles.action} variant="danger" accessibilityLabel={`Delete ${file.title}`} label="Delete" onPress={onDelete} />
        )}
      </View>

      {sheetOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetHeader}>
              <Text numberOfLines={1} style={styles.sheetTitle}>{file.title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close actions" onPress={() => setSheetOpen(false)} style={styles.sheetClose}>
                <X color={c.text.body} size={20} />
              </Pressable>
            </View>
            {movingFolder && onMoveFolder ? (
              <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetList}>
                <Text style={styles.sheetSubtitle}>Choose destination folder</Text>
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
                        setMovingFolder(false);
                        void onMoveFolder(file, folderName);
                      }}
                      style={[styles.sheetRow, current && styles.sheetRowDisabled]}
                    >
                      <FolderInput color={c.text.body} size={18} />
                      <Text style={styles.sheetRowText}>{folderName}{current ? ' (current)' : ''}</Text>
                    </Pressable>
                  );
                })}
                <Button variant="secondary" label="Back" onPress={() => setMovingFolder(false)} />
              </ScrollView>
            ) : (
              <View style={styles.sheetList}>
                {onMoveFolder && folderOptions && folderOptions.length > 0 && (
                  <Pressable accessibilityRole="button" onPress={() => setMovingFolder(true)} style={styles.sheetRow}>
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
          </View>
        </View>
      </Modal>
      )}

      {!link && !doc && (
        <CohortFilePreviewModal
          title={file.title}
          preview={preview}
          onClose={() => setPreview(null)}
          onDownload={() => { setPreview(null); void download(); }}
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
  action: { flexGrow: 1, minWidth: 112 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: c.overlay,
    padding: 12,
  },
  sheetCard: {
    borderRadius: 20,
    backgroundColor: c.surface.raised,
    borderWidth: 1,
    borderColor: c.border.subtle,
    padding: 16,
    gap: 10,
    maxHeight: '70%',
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sheetTitle: { flex: 1, color: c.text.strong, fontFamily: fonts.bold, fontSize: 16 },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetSubtitle: { color: c.text.muted, fontFamily: fonts.semibold, fontSize: 12 },
  sheetScroll: { maxHeight: 320 },
  sheetList: { gap: 4 },
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
}));
