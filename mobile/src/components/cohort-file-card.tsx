import { useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { FileText, Link2, NotebookPen } from 'lucide-react-native';

import { CohortDocModal, CohortFileReviewModal, CohortFileReviewSection, ReviewBadge, type ReviewAccess } from '@/components/cohort-doc-modal';
import { CohortFilePreviewModal } from '@/components/cohort-file-preview';
import { LearningCard } from '@/components/learning-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fonts } from '@/constants/csg-theme';
import { LINK_PROVIDER_LABELS, cohortFileMeta, isStudentFolderItem, safeExternalFileUrl, safeHttpsUrl, type CohortFile, type CohortFilePreview } from '@/lib/cohort-files';
import { openExternalPage } from '@/lib/external-links';
import { safeExternalUrl } from '@/lib/learning';
import { useSession } from '@/providers/session-provider';
import { makeStyles, useTheme } from '@/providers/theme-provider';

const IN_APP_MODES = new Set(['markdown', 'text', 'csv', 'image']);

/**
 * A class or private-folder item. Files get a 1-tap download and, when the
 * type can show in the app, Preview: text, Markdown, CSV and images open in a
 * sheet; PDFs, audio and video open their short-lived inline link in the
 * in-app browser. Links get Open. Learn Docs open in the doc sheet. Signed
 * links are requested per tap and never stored. With `review`, items in a
 * student's folder show their review status and comments; `autoOpen` opens
 * the item once (a notification link).
 */
export function CohortFileCard({ cohortId, file, note, onDelete, downloadDisabled = false, review, onChanged, onStale, autoOpen = false }: {
  cohortId: number; file: CohortFile; note?: string; onDelete?: () => void; downloadDisabled?: boolean
  review?: ReviewAccess; onChanged?: (file: CohortFile) => void; onStale?: () => void; autoOpen?: boolean
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
  const link = file.kind === 'link';
  const doc = file.kind === 'doc';
  const href = link ? safeExternalFileUrl(file.external_url) : null;
  const reviewing = review && isStudentFolderItem(file) ? review : undefined;
  const [autoOpened, setAutoOpened] = useState(false);
  if (autoOpen && !autoOpened) {
    setAutoOpened(true);
    if (doc) setDocOpen(true);
    else if (reviewing) setReviewOpen(true);
  }

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

  const Icon = doc ? NotebookPen : link ? Link2 : FileText;
  const commentNote = reviewing ? ` · ${file.comment_count} comment${file.comment_count === 1 ? '' : 's'}` : '';
  return <LearningCard>
    <View style={styles.heading}><Icon color={c.text.body} size={20} /><Text style={styles.title}>{file.title}</Text></View>
    {(link || doc || file.version_number > 1 || (reviewing && file.review_status !== 'none')) && <View style={styles.badges}>
      {link && <Badge label={LINK_PROVIDER_LABELS[file.link_provider || 'web']} />}
      {doc && <Badge tone="brand" label="Learn Doc" />}
      {!link && !doc && file.version_number > 1 && <Badge tone="pending" label={`v${file.version_number}`} />}
      {reviewing && <ReviewBadge status={file.review_status} />}
    </View>}
    <Text style={styles.meta}>{cohortFileMeta(file)}{note ? ` · ${note}` : ''}{commentNote}</Text>
    {file.description && <Text style={styles.meta}>{file.description}</Text>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!link && !doc && downloadDisabled && <Text style={styles.meta}>Downloads are unavailable until file storage is set up.</Text>}
    <View style={styles.actions}>
      {doc ? <Button style={styles.action} variant="secondary" accessibilityLabel={`Open ${file.title}`} label={file.can_edit_doc ? 'Open and edit' : 'Open'} onPress={() => setDocOpen(true)} />
        : link ? <Button style={styles.action} variant="secondary" accessibilityRole="link" accessibilityLabel={`Open ${file.title}`} label="Open" disabled={!href} onPress={() => void openLink()} /> : <>
        {file.previewable && <Button style={styles.action} variant="secondary" accessibilityLabel={`Preview ${file.title}`} label={preparing === 'preview' ? 'Opening…' : 'Preview'} loading={preparing === 'preview'} disabled={Boolean(preparing) || downloadDisabled} onPress={() => void openPreview()} />}
        <Button style={styles.action} variant="secondary" accessibilityLabel={`Download ${file.title}`} label={preparing === 'download' ? 'Preparing download…' : failed === 'download' ? 'Retry download' : 'Download'} loading={preparing === 'download'} disabled={Boolean(preparing) || downloadDisabled} onPress={() => void download()} />
      </>}
      {reviewing && !doc && <Button style={styles.action} variant="secondary" accessibilityLabel={`Review and comments on ${file.title}`} label={file.comment_count ? `Comments · ${file.comment_count}` : 'Review and comments'} onPress={() => setReviewOpen(true)} />}
      {onDelete && <Button style={styles.action} variant="danger" accessibilityLabel={`Delete ${file.title}`} label="Delete" onPress={onDelete} />}
    </View>
    {!link && !doc && <CohortFilePreviewModal title={file.title} preview={preview} onClose={() => setPreview(null)} onDownload={() => { setPreview(null); void download(); }}
      review={reviewing && preview ? <CohortFileReviewSection cohortId={cohortId} file={file} access={reviewing} onChanged={onChanged} /> : undefined} />}
    {doc && <CohortDocModal cohortId={cohortId} file={file} visible={docOpen} onClose={() => setDocOpen(false)} onChanged={onChanged} onStale={onStale} reviewAccess={reviewing} />}
    {reviewing && !doc && <CohortFileReviewModal cohortId={cohortId} file={file} access={reviewing} visible={reviewOpen} onClose={() => setReviewOpen(false)} onChanged={onChanged} />}
  </LearningCard>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  meta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 8 },
  error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 13, marginTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  action: { flexGrow: 1, minWidth: 130 },
}));
