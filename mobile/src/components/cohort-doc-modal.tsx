import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { AuthoredContent } from '@/components/authored-content';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { fonts, monoFont } from '@/constants/csg-theme';
import { themedAlert as Alert } from '@/lib/alerts';
import { ApiError } from '@/lib/api';
import { MAX_COMMENT_LENGTH, MAX_DOC_LENGTH, REVIEW_LABELS, isStudentFolderItem, type CohortDoc, type CohortFile, type CohortFileComment, type ReviewStatus } from '@/lib/cohort-files';
import { useSession } from '@/providers/session-provider';
import { makeStyles, useTheme } from '@/providers/theme-provider';

export type ReviewAccess = { staff: boolean; canChange: boolean };

function when(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  const label = REVIEW_LABELS[status];
  return label ? <Badge tone={status === 'reviewed' ? 'success' : 'warning'} label={label} /> : null;
}

/**
 * Review status and the comment thread for an item in a student's folder.
 * An active student marks their own item Ready for review; staff mark it
 * Reviewed or Needs review. Paused and ended learners read only.
 */
export function CohortFileReviewSection({ cohortId, file, access, onChanged }: { cohortId: number; file: CohortFile; access: ReviewAccess; onChanged?: (file: CohortFile) => void }) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const { api } = useSession();
  const [current, setCurrent] = useState(file);
  const [saving, setSaving] = useState<ReviewStatus | null>(null);
  const [comments, setComments] = useState<CohortFileComment[] | null>(null);
  const [canComment, setCanComment] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownFile, setShownFile] = useState(file);
  if (file !== shownFile) {
    setShownFile(file);
    setCurrent(file);
  }
  useEffect(() => {
    let live = true;
    api.cohortFileComments(cohortId, file.id).then((result) => {
      if (!live) return;
      setComments(result.comments);
      setCanComment(result.can_comment);
    }).catch((failure) => { if (live) setError((failure as Error).message || 'Could not load comments.'); });
    return () => { live = false; };
  }, [api, cohortId, file.id]);

  const changed = (next: CohortFile) => { setCurrent(next); onChanged?.(next); };
  async function setStatus(next: ReviewStatus) {
    if (saving) return;
    setSaving(next);
    setError(null);
    try {
      changed((await api.setCohortFileReview(cohortId, file.id, next)).file);
    } catch (failure) {
      setError((failure as Error).message || 'Could not change the review status.');
    } finally {
      setSaving(null);
    }
  }
  async function post() {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      const { comment } = await api.createCohortFileComment(cohortId, file.id, body);
      const next = [...(comments || []), comment];
      setComments(next);
      setDraft('');
      changed({ ...current, comment_count: next.length });
    } catch (failure) {
      setError((failure as Error).message || 'Could not post your comment.');
    } finally {
      setPosting(false);
    }
  }
  const remove = (comment: CohortFileComment) => Alert.alert('Delete this comment?', 'It is removed for everyone who can see this file.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        await api.deleteCohortFileComment(cohortId, file.id, comment.id);
        const next = (comments || []).filter((item) => item.id !== comment.id);
        setComments(next);
        changed({ ...current, comment_count: next.length });
      } catch (failure) { setError((failure as Error).message || 'Could not delete the comment.'); }
    } },
  ]);
  const status = current.review_status;

  return <View style={styles.section}>
    <View style={styles.row}><Text accessibilityRole="header" style={styles.label}>Review</Text>{status === 'none' ? <Badge label="Not sent for review" /> : <ReviewBadge status={status} />}</View>
    {status === 'reviewed' && <Text style={styles.meta}>{`Reviewed${current.reviewed_by_name ? ` by ${current.reviewed_by_name}` : ''}${current.reviewed_at ? ` · ${when(current.reviewed_at)}` : ''}`}</Text>}
    {access.canChange && (access.staff ? <View style={styles.actions}>
      <Button style={styles.action} label="Mark reviewed" loading={saving === 'reviewed'} disabled={Boolean(saving) || status === 'reviewed'} onPress={() => void setStatus('reviewed')} />
      <Button style={styles.action} variant="secondary" label="Needs review" loading={saving === 'needs_review'} disabled={Boolean(saving) || status === 'needs_review'} onPress={() => void setStatus('needs_review')} />
    </View> : <Button variant={status === 'needs_review' ? 'primary' : 'secondary'} accessibilityState={{ selected: status === 'needs_review' }} loading={Boolean(saving)}
      label={status === 'reviewed' ? 'Ask for another review' : status === 'needs_review' ? 'Ready for review · On' : 'Ready for review'}
      onPress={() => void setStatus(status === 'needs_review' ? 'none' : 'needs_review')} />)}
    {!access.canChange && !access.staff && <Text style={styles.meta}>Reviews and comments are read only while your course is paused or your access has ended.</Text>}
    <Text accessibilityRole="header" style={[styles.label, styles.spaced]}>Comments</Text>
    {comments === null && !error && <Text style={styles.meta}>Loading comments…</Text>}
    {comments?.length === 0 && <Text style={styles.meta}>No comments yet.</Text>}
    {comments?.map((comment) => <View key={comment.id} style={styles.comment}>
      <View style={styles.row}><Text style={styles.author}>{comment.author_name}{comment.author_role === 'staff' ? ' · Instructor' : ''}</Text><Text style={styles.meta}>{when(comment.created_at)}</Text></View>
      <Text selectable style={styles.body}>{comment.body}</Text>
      {comment.can_delete && <Pressable accessibilityRole="button" accessibilityLabel={`Delete comment from ${comment.author_name}`} onPress={() => remove(comment)} style={styles.link}><Text style={styles.linkText}>Delete</Text></Pressable>}
    </View>)}
    {canComment && <>
      <TextInput keyboardAppearance={scheme} accessibilityLabel="Add a comment" value={draft} onChangeText={setDraft} placeholder="Add a comment" placeholderTextColor={c.text.body}
        multiline maxLength={MAX_COMMENT_LENGTH} editable={!posting} style={[styles.input, styles.commentInput]} />
      <Button label={posting ? 'Posting…' : 'Post comment'} loading={posting} disabled={posting || !draft.trim()} onPress={() => void post()} />
    </>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

/** Review and comments alone, for items that open outside the app (links, PDFs, Office files). */
export function CohortFileReviewModal({ cohortId, file, access, visible, onClose, onChanged }: { cohortId: number; file: CohortFile; access: ReviewAccess; visible: boolean; onClose: () => void; onChanged?: (file: CohortFile) => void }) {
  const styles = useStyles();
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <SheetHeader title={file.title} subtitle="Review and comments" onClose={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{visible && <CohortFileReviewSection cohortId={cohortId} file={file} access={access} onChanged={onChanged} />}</ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

function SheetHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  return <View style={styles.header}>
    <View style={styles.flex}><Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.meta}>{subtitle}</Text> : null}</View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={onClose} style={styles.close}><X color={c.text.body} size={20} /></Pressable>
  </View>;
}

/**
 * A Learn Doc on the phone: Read shows it as written text, Edit is a plain
 * Markdown box with Save. A save from an older copy than the server's is
 * refused (409) and nothing is lost: the notice offers the latest version.
 * Items in a student's folder show review status and comments below. Every
 * opening starts empty and shows nothing until the doc (and the viewer's
 * rights to it) load again; a doc that is gone or no longer readable (403,
 * 404) tells the screen to refresh its list through `onStale`. Learners
 * can't rename a copy staff put in their folder, so its title is read only.
 */
export function CohortDocModal({ cohortId, file, visible, onClose, onChanged, onStale, reviewAccess }: {
  cohortId: number; file: CohortFile; visible: boolean; onClose: () => void; onChanged?: (file: CohortFile) => void; onStale?: () => void; reviewAccess?: ReviewAccess
}) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const { api } = useSession();
  const [doc, setDoc] = useState<CohortDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState(file.title);
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opening or closing the sheet drops whatever the last opening showed.
  const [shownFor, setShownFor] = useState(visible);
  if (shownFor !== visible) {
    setShownFor(visible);
    setDoc(null);
    setTitle(file.title);
    setContent('');
    setLoadError(null);
    setError(null);
    setConflict(false);
    setSaving(false);
    setMode('read');
  }
  const showReview = Boolean(reviewAccess) && isStudentFolderItem(file);
  const canEdit = Boolean(doc?.can_edit_doc);
  const titleEditable = canEdit && Boolean(doc?.file.can_manage);
  const dirty = Boolean(doc) && ((title.trim() || doc!.file.title) !== doc!.file.title || content !== doc!.doc_content);

  const apply = (next: CohortDoc) => {
    setDoc(next);
    setTitle(next.file.title);
    setContent(next.doc_content);
  };
  const opened = (next: CohortDoc) => {
    apply(next);
    setLoadError(null);
    setConflict(false);
    setMode(next.can_edit_doc && !next.doc_content.trim() ? 'edit' : 'read');
  };
  const gone = (failure: unknown) => failure instanceof ApiError && (failure.status === 403 || failure.status === 404);
  const failed = (failure: unknown) => {
    setLoadError((failure as Error).message || 'Could not open this doc.');
    if (gone(failure)) onStale?.();
  };
  // Each opening (and each closing) gets a new number. A load, retry or save
  // answers only the opening that sent it, so a slow reply from an earlier
  // opening never paints content or edit controls into a later one.
  const opening = useRef(0);
  const load = () => {
    const sent = opening.current;
    return api.cohortDoc(cohortId, file.id).then(
      (next) => { if (sent === opening.current) opened(next); },
      (failure) => { if (sent === opening.current) failed(failure); },
    );
  };
  useEffect(() => {
    opening.current += 1;
    if (visible) void load();
    // Reload only when the sheet opens or the doc changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, visible, cohortId, file.id]);

  async function save() {
    if (!doc || saving || conflict) return;
    if (content.length > MAX_DOC_LENGTH) return setError(`Docs can be up to ${MAX_DOC_LENGTH.toLocaleString()} characters.`);
    const sent = opening.current;
    setSaving(true);
    setError(null);
    try {
      const next = await api.saveCohortDoc(cohortId, file.id, {
        doc_content: content, base_doc_version: doc.doc_version ?? 0, save_revision: true, ...(titleEditable && title.trim() ? { title: title.trim() } : {}),
      });
      // Only the opening that sent this save may update the list or sheet.
      if (sent === opening.current) {
        onChanged?.(next.file);
        apply(next);
      }
    } catch (failure) {
      if (gone(failure)) onStale?.();
      if (sent !== opening.current) return;
      if (failure instanceof ApiError && failure.status === 409) setConflict(true);
      else setError((failure as Error).message || 'Could not save this doc.');
    } finally {
      if (sent === opening.current) setSaving(false);
    }
  }
  const close = () => {
    if (!dirty || !canEdit) return onClose();
    Alert.alert('Close without saving?', 'Your changes to this doc have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Close', style: 'destructive', onPress: onClose },
    ]);
  };

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <SheetHeader title={title.trim() || file.title} subtitle={!doc ? 'Learn Doc' : canEdit ? (dirty ? 'Learn Doc · Unsaved changes' : 'Learn Doc · Saved') : 'Learn Doc · Read only'} onClose={close} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {loadError ? <View style={styles.section}><Text accessibilityRole="alert" style={styles.error}>{loadError}</Text><Button variant="secondary" label="Try again" onPress={() => void load()} /></View>
            : !doc ? <Text style={styles.meta}>Opening {file.title}…</Text> : <>
              {conflict && <View accessibilityRole="alert" style={styles.notice}><Text style={styles.noticeText}>Someone else updated this doc. Load the latest version to keep editing; copy your text first if you want to keep it.</Text><Button variant="secondary" label="Load latest" onPress={() => void load()} /></View>}
              {canEdit && <View style={styles.segment} accessibilityRole="tablist">{(['read', 'edit'] as const).map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: mode === value }} onPress={() => setMode(value)} style={[styles.segmentItem, mode === value && styles.segmentSelected]}><Text style={styles.segmentText}>{value === 'read' ? 'Read' : 'Edit'}</Text></Pressable>)}</View>}
              {canEdit && mode === 'edit' ? <>
                <TextInput keyboardAppearance={scheme} accessibilityLabel="Title" value={title} onChangeText={setTitle} maxLength={160} editable={titleEditable && !saving && !conflict} style={[styles.input, !titleEditable && styles.readOnly]} />
                {!titleEditable && <Text style={styles.meta}>Your instructor named this doc, so its title stays the same.</Text>}
                <TextInput keyboardAppearance={scheme} accessibilityLabel="Doc content" value={content} onChangeText={setContent} placeholder="Write in Markdown: # headings, - [ ] tasks, | tables |" placeholderTextColor={c.text.body}
                  multiline textAlignVertical="top" autoCapitalize="sentences" editable={!saving && !conflict} style={[styles.input, styles.editor]} />
                <Text style={styles.meta}>{content.length.toLocaleString()}/{MAX_DOC_LENGTH.toLocaleString()} characters</Text>
              </> : content.trim() ? <AuthoredContent body={content} written /> : <Text style={styles.meta}>This doc is empty.</Text>}
              {!canEdit && <Text style={styles.meta}>{`Last saved ${when(doc.doc_updated_at)}${doc.doc_updated_by_name ? ` by ${doc.doc_updated_by_name}` : ''}`}</Text>}
              {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
              {canEdit && <Button label={saving ? 'Saving…' : dirty ? 'Save' : 'Saved'} loading={saving} disabled={saving || conflict || !dirty} onPress={() => void save()} />}
              {showReview && reviewAccess && <CohortFileReviewSection cohortId={cohortId} file={doc.file} access={reviewAccess} onChanged={(next) => { setDoc((current) => current && { ...current, file: next }); onChanged?.(next); }} />}
            </>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

/** Start a Learn Doc: a title and a folder, then it opens to write in. Needs no file storage. */
export function CohortDocForm({ cohortId, folders, studentId, onCreated, onCancel }: { cohortId: number; folders: string[]; studentId?: number; onCreated: (file: CohortFile) => void; onCancel: () => void }) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const { api } = useSession();
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState(folders[0] || 'General');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.createCohortDoc(cohortId, { title: title.trim(), folder, doc_content: '', ...(studentId ? { student_id: studentId } : {}) });
      onCreated(result.file);
    } catch (failure) {
      setError((failure as Error).message || 'Could not create this doc.');
    } finally {
      setSaving(false);
    }
  }
  return <View style={styles.form}>
    <Text accessibilityRole="header" style={styles.label}>New doc</Text>
    <Text style={styles.meta}>Notes, a plan or a checklist written right here.</Text>
    <TextInput keyboardAppearance={scheme} accessibilityLabel="Doc title" value={title} onChangeText={setTitle} placeholder="Job search plan" placeholderTextColor={c.text.body} maxLength={160} editable={!saving} style={styles.input} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
      {folders.map((preset) => <Pressable key={preset} accessibilityRole="button" accessibilityLabel={`Save to ${preset}`} accessibilityState={{ selected: folder === preset }} onPress={() => setFolder(preset)} style={[styles.chip, folder === preset && styles.selectedChip]}><Text style={[styles.chipText, folder === preset && styles.selectedChipText]}>{preset}</Text></Pressable>)}
    </ScrollView>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <View style={styles.actions}>
      <Button style={styles.action} label={saving ? 'Creating…' : 'Create doc'} loading={saving} disabled={saving || !title.trim()} onPress={() => void create()} />
      <Button style={styles.action} variant="secondary" label="Cancel" disabled={saving} onPress={onCancel} />
    </View>
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17 },
  close: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 48, gap: 12 },
  section: { gap: 10, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle, paddingTop: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  label: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, spaced: { marginTop: 6 },
  meta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  author: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 12 },
  body: { color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  comment: { gap: 4, borderRadius: 12, backgroundColor: c.surface.sunken, padding: 12 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, linkText: { color: c.status.danger.fg, fontFamily: fonts.semibold, fontSize: 13 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 12, paddingVertical: 10, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14 },
  readOnly: { backgroundColor: c.surface.sunken, color: c.text.body },
  editor: { minHeight: 280, fontFamily: monoFont, fontSize: 13, lineHeight: 19 }, commentInput: { minHeight: 88, textAlignVertical: 'top' },
  error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 13 },
  notice: { gap: 10, borderRadius: 12, backgroundColor: c.status.warning.bg, padding: 12 }, noticeText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17 },
  segment: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, padding: 4, gap: 4 },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, segmentSelected: { backgroundColor: c.surface.raised }, segmentText: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, action: { flexGrow: 1, minWidth: 120 },
  form: { gap: 10, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 14 },
  chips: { gap: 8, paddingRight: 20 }, chip: { minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 12 }, selectedChip: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, chipText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, selectedChipText: { color: c.text.strong },
}));
