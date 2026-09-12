import { AlertCircle, ArrowLeft, Check, Cloud, Eye, FileCode2, Film, Pencil, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LessonContentBlockCard } from '@/components/lesson-content-block';
import { LessonObjectives } from '@/components/lesson-objectives';
import { RubricPanel } from '@/components/rubric-panel';
import { fonts, palette } from '@/constants/csg-theme';
import { ApiError } from '@/lib/api';
import { clearLessonEditorDraft, loadLessonEditorDraft, saveLessonEditorDraft } from '@/lib/curriculum-draft-storage';
import { fieldsForLesson, lessonEditorFieldsMatch, lessonEditorInput, lessonEditorValidation, lessonPreviewForFields, lessonSubmissionOptions, type LessonEditorFields } from '@/lib/lesson-editor';
import type { LessonDetail, LessonEditorInput } from '@/lib/types';

interface StaffLessonEditorProps {
  lesson: LessonDetail;
  userId: number;
  onBack: () => void;
  onSave: (input: LessonEditorInput) => Promise<LessonDetail>;
  onReload: () => Promise<LessonDetail>;
}

type DraftStatus = 'loading' | 'saved' | 'saving' | 'error';

export function StaffLessonEditor({ lesson, userId, onBack, onSave, onReload }: StaffLessonEditorProps) {
  const [initialLesson] = useState(lesson);
  const initialFields = useMemo(() => fieldsForLesson(initialLesson), [initialLesson]);
  const [sourceLesson, setSourceLesson] = useState(initialLesson);
  const [fields, setFields] = useState(initialFields);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(initialLesson.updated_at || '');
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>('loading');
  const [recovered, setRecovered] = useState(false);
  const [staleDraft, setStaleDraft] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const serverFields = useMemo(() => fieldsForLesson(sourceLesson), [sourceLesson]);
  const dirty = !lessonEditorFieldsMatch(fields, serverFields);
  const previewLesson = useMemo(() => lessonPreviewForFields(sourceLesson, fields), [fields, sourceLesson]);
  const videoBlock = sourceLesson.content_blocks.find((block) => ['video', 'recording'].includes(block.block_type));
  const selectedSubmission = lessonSubmissionOptions.find((option) => option.value === fields.submission_type)!;

  useEffect(() => {
    let active = true;
    void loadLessonEditorDraft(userId, initialLesson.id).then(async (draft) => {
      if (!active) return;
      if (draft && !lessonEditorFieldsMatch(draft, initialFields)) {
        setFields({ title: draft.title, required: draft.required, video_url: draft.video_url, filename: draft.filename, instructions: draft.instructions, solution: draft.solution, submission_type: draft.submission_type });
        setBaseUpdatedAt(draft.base_updated_at);
        setRecovered(true);
        setStaleDraft(Boolean(initialLesson.updated_at && draft.base_updated_at !== initialLesson.updated_at));
      } else if (draft) {
        await clearLessonEditorDraft(userId, initialLesson.id).catch(() => undefined);
      }
      if (active) { setDraftReady(true); setDraftStatus('saved'); }
    }).catch(() => {
      if (active) { setDraftReady(true); setDraftStatus('error'); }
    });
    return () => { active = false; };
  }, [initialFields, initialLesson.id, initialLesson.updated_at, userId]);

  const persistDraft = useCallback(async () => {
    if (!draftReady) return;
    if (lessonEditorFieldsMatch(fields, fieldsForLesson(sourceLesson))) {
      await clearLessonEditorDraft(userId, sourceLesson.id);
      setDraftStatus('saved');
      return;
    }
    setDraftStatus('saving');
    try {
      await saveLessonEditorDraft(userId, sourceLesson.id, fields, baseUpdatedAt);
      setDraftStatus('saved');
    } catch {
      setDraftStatus('error');
    }
  }, [baseUpdatedAt, draftReady, fields, sourceLesson, userId]);

  useEffect(() => {
    if (!draftReady) return undefined;
    const timer = setTimeout(() => void persistDraft(), 400);
    return () => clearTimeout(timer);
  }, [draftReady, fields, baseUpdatedAt, persistDraft]);

  const update = <K extends keyof LessonEditorFields>(key: K, value: LessonEditorFields[K]) => {
    setFields((current) => ({ ...current, [key]: value }));
    setError(null);
    setNotice(null);
  };

  const showMode = (nextMode: 'edit' | 'preview') => {
    setMode(nextMode);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  };

  const leave = () => {
    if (!dirty) { onBack(); return; }
    Alert.alert('Keep this draft?', 'Your edits stay safely on this device so you can return later.', [
      { text: 'Continue editing', style: 'cancel' },
      { text: 'Leave and keep draft', onPress: () => { void persistDraft().finally(onBack); } },
    ]);
  };

  const save = async () => {
    const validation = lessonEditorValidation(fields);
    if (validation) { setError(validation); setMode('edit'); return; }
    if (!baseUpdatedAt) { setError('Refresh this lesson before saving so changes can be protected.'); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const saved = await onSave(lessonEditorInput(sourceLesson, fields, baseUpdatedAt));
      const nextFields = fieldsForLesson(saved);
      setSourceLesson(saved); setFields(nextFields); setBaseUpdatedAt(saved.updated_at || '');
      setConflict(false); setRecovered(false); setStaleDraft(false); setNotice('Lesson saved. The student preview now uses this version.');
      await clearLessonEditorDraft(userId, lesson.id);
      setDraftStatus('saved');
    } catch (saveError) {
      if (saveError instanceof ApiError && (saveError.status === 409 || saveError.code === 'stale_editor')) {
        setConflict(true);
        setError('This lesson changed elsewhere after your draft began. Your edits are still safe.');
      } else {
        setError((saveError as Error).message || 'The lesson could not be saved.');
      }
    } finally {
      setSaving(false);
    }
  };

  const rebase = async () => {
    setSaving(true); setError(null);
    try {
      const latest = await onReload();
      if (!latest.updated_at) throw new Error('The latest lesson version is unavailable.');
      setSourceLesson(latest); setBaseUpdatedAt(latest.updated_at); setConflict(false); setStaleDraft(false);
      setNotice('Latest version loaded underneath your draft. Review your edits, then save again.');
      await saveLessonEditorDraft(userId, latest.id, fields, latest.updated_at);
    } catch (reloadError) {
      setError((reloadError as Error).message || 'The latest lesson could not be loaded.');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => Alert.alert('Discard this draft?', 'This removes the device copy and loads the latest saved lesson.', [
    { text: 'Keep editing', style: 'cancel' },
    { text: 'Discard draft', style: 'destructive', onPress: () => void (async () => {
      setSaving(true); setError(null);
      try {
        const latest = await onReload();
        setSourceLesson(latest); setFields(fieldsForLesson(latest)); setBaseUpdatedAt(latest.updated_at || '');
        setConflict(false); setRecovered(false); setStaleDraft(false); setNotice('Draft discarded. You are editing the latest saved lesson.');
        await clearLessonEditorDraft(userId, lesson.id);
        setDraftStatus('saved');
      } catch (reloadError) {
        setError((reloadError as Error).message || 'The latest lesson could not be loaded.');
      } finally { setSaving(false); }
    })() },
  ]);

  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={leave} style={styles.headerButton}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.headerCopy}><Text style={styles.headerKicker}>CURRICULUM EDITOR</Text><Text numberOfLines={1} style={styles.headerTitle}>{fields.title || 'Untitled lesson'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Save lesson" disabled={!dirty || saving || !draftReady} onPress={() => void save()} style={[styles.saveHeader, (!dirty || saving || !draftReady) && styles.disabled]}><Save color={palette.text} size={17} /><Text style={styles.saveHeaderText}>{saving ? 'Saving' : 'Save'}</Text></Pressable></View>
    <View style={styles.modeBar}><Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'edit' }} onPress={() => showMode('edit')} style={[styles.modeButton, mode === 'edit' && styles.modeButtonActive]}><Pencil color={mode === 'edit' ? palette.rubySoft : palette.muted} size={17} /><Text style={[styles.modeText, mode === 'edit' && styles.modeTextActive]}>Edit</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'preview' }} onPress={() => showMode('preview')} style={[styles.modeButton, mode === 'preview' && styles.modeButtonActive]}><Eye color={mode === 'preview' ? palette.rubySoft : palette.muted} size={17} /><Text style={[styles.modeText, mode === 'preview' && styles.modeTextActive]}>Preview draft</Text></Pressable><Text style={styles.draftStatus}>{draftStatus === 'loading' ? 'Loading draft…' : draftStatus === 'saving' ? 'Saving draft…' : draftStatus === 'error' ? 'Draft not saved' : dirty ? 'Saved on device' : 'Up to date'}</Text></View>
    <ScrollView ref={scrollRef} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {recovered && <Notice icon={<Cloud color={palette.rubySoft} size={18} />} tone="ruby" title="Draft recovered" copy={staleDraft ? 'This draft began before the latest server update. Refresh its base before saving.' : 'Your unsaved edits were restored from this device.'} />}
      {conflict && <View accessibilityRole="alert" style={styles.conflict}><AlertCircle color={palette.warning} size={21} /><View style={styles.flex}><Text style={styles.conflictTitle}>Someone else updated this lesson</Text><Text style={styles.conflictCopy}>Load the latest version underneath your draft. Fields in your draft will win when you save again.</Text><Pressable accessibilityRole="button" disabled={saving} onPress={() => void rebase()} style={styles.conflictAction}><RefreshCw color={palette.warning} size={16} /><Text style={styles.conflictActionText}>Refresh base and keep draft</Text></Pressable></View></View>}
      {error && <Notice icon={<AlertCircle color={palette.rubySoft} size={18} />} tone="danger" title="Could not save" copy={error} />}
      {notice && <Notice icon={<Check color={palette.success} size={18} />} tone="success" title="Ready" copy={notice} />}
      {mode === 'preview' ? <DraftPreview lesson={previewLesson} dirty={dirty} /> : <>
        <EditorSection eyebrow="1 · ESSENTIALS" title="Lesson details" copy="Keep the title specific enough to find quickly in the curriculum library.">
          <Field label="TITLE"><TextInput accessibilityLabel="Lesson title" value={fields.title} onChangeText={(value) => update('title', value)} placeholder="What will students learn or build?" placeholderTextColor={palette.quiet} style={styles.input} /></Field>
          <View style={styles.toggle}><View style={styles.flex}><Text style={styles.toggleTitle}>{fields.required ? 'Required lesson' : 'Optional stretch'}</Text><Text style={styles.toggleCopy}>{fields.required ? 'Counts toward the student’s required weekly work.' : 'Visible to students without counting toward required completion.'}</Text></View><Switch accessibilityLabel="Required lesson" value={fields.required} onValueChange={(value) => update('required', value)} trackColor={{ false: palette.line, true: '#6A2A36' }} thumbColor={fields.required ? palette.rubySoft : palette.muted} /></View>
        </EditorSection>
        <EditorSection eyebrow="2 · WATCH" title="Lesson video" copy="Paste a YouTube, Vimeo, or direct video link. Existing private uploads remain attached.">
          {videoBlock?.has_s3_video || videoBlock?.s3_video_key ? <View style={styles.hosted}><ShieldCheck color={palette.success} size={18} /><View style={styles.flex}><Text style={styles.hostedTitle}>Hosted video attached</Text><Text style={styles.hostedCopy}>This editor preserves the uploaded file. Use the full web studio only when you need to replace the upload.</Text></View></View> : null}
          <Field label="VIDEO LINK"><TextInput accessibilityLabel="Video link" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={fields.video_url} onChangeText={(value) => update('video_url', value)} placeholder="https://…" placeholderTextColor={palette.quiet} style={styles.input} /></Field>
        </EditorSection>
        <EditorSection eyebrow="3 · BUILD" title="Exercise and submission" copy="Write the student-facing task first, then keep the answer in the instructor-only solution.">
          <Field label="INSTRUCTIONS"><TextInput accessibilityLabel="Exercise instructions" multiline textAlignVertical="top" value={fields.instructions} onChangeText={(value) => update('instructions', value)} placeholder="Explain the goal, constraints, and what done looks like…" placeholderTextColor={palette.quiet} style={[styles.input, styles.instructions]} /></Field>
          <Field label="FILENAME"><View style={styles.inputWithIcon}><FileCode2 color={palette.quiet} size={17} /><TextInput accessibilityLabel="Exercise filename" autoCapitalize="none" autoCorrect={false} value={fields.filename} onChangeText={(value) => update('filename', value)} placeholder="e.g. 111.rb or styles.css" placeholderTextColor={palette.quiet} style={styles.inlineInput} /></View></Field>
          <Field label="SUBMISSION"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{lessonSubmissionOptions.map((option) => <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: fields.submission_type === option.value }} onPress={() => update('submission_type', option.value)} style={[styles.chip, fields.submission_type === option.value && styles.chipActive]}><Text style={[styles.chipText, fields.submission_type === option.value && styles.chipTextActive]}>{option.label}</Text></Pressable>)}</ScrollView><Text style={styles.helper}>{selectedSubmission.description}</Text></Field>
          <Field label="INSTRUCTOR SOLUTION"><TextInput accessibilityLabel="Instructor solution" multiline textAlignVertical="top" value={fields.solution} onChangeText={(value) => update('solution', value)} placeholder="Reference answer, walkthrough, or grading notes…" placeholderTextColor={palette.quiet} style={[styles.input, styles.solution]} /><Text style={styles.privateCopy}>Staff only. Students never receive this content.</Text></Field>
        </EditorSection>
        <View style={styles.actions}><Pressable accessibilityRole="button" accessibilityLabel="Save lesson changes" disabled={!dirty || saving || !draftReady} onPress={() => void save()} style={[styles.primary, (!dirty || saving || !draftReady) && styles.disabled]}><Save color={palette.text} size={19} /><Text style={styles.primaryText}>{saving ? 'Saving lesson…' : dirty ? 'Save lesson changes' : 'Everything is saved'}</Text></Pressable>{dirty && <Pressable accessibilityRole="button" disabled={saving} onPress={discard} style={styles.discard}><Trash2 color={palette.muted} size={17} /><Text style={styles.discardText}>Discard device draft</Text></Pressable>}</View>
      </>}
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}

function DraftPreview({ lesson, dirty }: { lesson: LessonDetail; dirty: boolean }) {
  return <View style={styles.preview}><Notice icon={<Eye color={palette.rubySoft} size={18} />} tone="ruby" title={dirty ? 'Unsaved student preview' : 'Saved student preview'} copy={dirty ? 'This preview uses the draft on your device. Save when it looks right.' : 'This matches the lesson version students will receive.'} /><View style={styles.previewHero}><View style={styles.previewIcon}><Film color={palette.rubySoft} size={20} /></View><Text style={styles.previewType}>{lesson.lesson_type.toUpperCase()}</Text><Text style={styles.previewTitle}>{lesson.title}</Text><Text style={styles.previewMeta}>{lesson.required ? 'Required' : 'Optional'} · {lesson.content_blocks.length} blocks</Text></View><LessonObjectives objectives={lesson.objectives} /><View style={styles.previewBlocks}>{[...lesson.content_blocks].sort((a, b) => a.position - b.position).map((block) => <View key={block.id} style={styles.previewBlock}><RubricPanel rubric={block.rubric} /><LessonContentBlockCard block={block} lesson={lesson} /></View>)}</View>{!lesson.content_blocks.length && <View style={styles.empty}><Text style={styles.emptyTitle}>Nothing to preview yet</Text><Text style={styles.emptyCopy}>Add a video link or exercise instructions to build the student view.</Text></View>}</View>;
}

function EditorSection({ eyebrow, title, copy, children }: { eyebrow: string; title: string; copy: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionCopy}>{copy}</Text><View style={styles.fields}>{children}</View></View>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>;
}

function Notice({ icon, tone, title, copy }: { icon: React.ReactNode; tone: 'ruby' | 'danger' | 'success'; title: string; copy: string }) {
  return <View accessibilityRole={tone === 'danger' ? 'alert' : undefined} style={[styles.notice, tone === 'danger' && styles.noticeDanger, tone === 'success' && styles.noticeSuccess]}>{icon}<View style={styles.flex}><Text style={[styles.noticeTitle, tone === 'danger' && styles.noticeTitleDanger, tone === 'success' && styles.noticeTitleSuccess]}>{title}</Text><Text style={styles.noticeCopy}>{copy}</Text></View></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, flex: { flex: 1, minWidth: 0 }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, headerButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minWidth: 0 }, headerKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, marginTop: 2 }, saveHeader: { minHeight: 44, borderRadius: 14, backgroundColor: palette.ruby, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6 }, saveHeaderText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, disabled: { opacity: 0.42 },
  modeBar: { minHeight: 54, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5 }, modeButton: { minHeight: 44, borderRadius: 13, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 }, modeButtonActive: { backgroundColor: '#351821' }, modeText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 }, modeTextActive: { color: palette.rubySoft }, draftStatus: { flex: 1, color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, textAlign: 'right' }, content: { padding: 16, paddingBottom: 80, gap: 13 },
  notice: { borderRadius: 16, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, noticeDanger: { borderColor: '#5D2830', backgroundColor: '#2B171B' }, noticeSuccess: { borderColor: '#28523C', backgroundColor: '#15271E' }, noticeTitle: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 13 }, noticeTitleDanger: { color: palette.rubySoft }, noticeTitleSuccess: { color: palette.success }, noticeCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 3 }, conflict: { borderRadius: 18, borderWidth: 1, borderColor: '#5A4520', backgroundColor: '#282013', padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 11 }, conflictTitle: { color: palette.warning, fontFamily: fonts.bold, fontSize: 14 }, conflictCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 4 }, conflictAction: { alignSelf: 'flex-start', minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: '#6B5425', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 }, conflictActionText: { color: palette.warning, fontFamily: fonts.bold, fontSize: 11 },
  section: { borderRadius: 21, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, padding: 16 }, eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, sectionTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 19, marginTop: 7 }, sectionCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 5 }, fields: { gap: 16, marginTop: 18 }, field: { gap: 7 }, label: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 }, input: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 13, paddingVertical: 12 }, instructions: { minHeight: 150, lineHeight: 20 }, solution: { minHeight: 130, lineHeight: 20 }, inputWithIcon: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, inlineInput: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, toggle: { minHeight: 76, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12 }, toggleTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, toggleCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 3 }, hosted: { borderRadius: 15, borderWidth: 1, borderColor: '#28523C', backgroundColor: '#15271E', padding: 12, flexDirection: 'row', gap: 9 }, hostedTitle: { color: palette.success, fontFamily: fonts.bold, fontSize: 12 }, hostedCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 3 }, chips: { gap: 7 }, chip: { minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }, chipActive: { borderColor: palette.ruby, backgroundColor: '#351821' }, chipText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 }, chipTextActive: { color: palette.rubySoft }, helper: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 }, privateCopy: { color: palette.warning, fontFamily: fonts.medium, fontSize: 11 },
  actions: { alignItems: 'center', gap: 8, paddingVertical: 5 }, primary: { width: '100%', minHeight: 54, borderRadius: 16, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, primaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, discard: { minHeight: 44, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 7 }, discardText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 },
  preview: { gap: 13 }, previewHero: { borderRadius: 22, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', padding: 20 }, previewIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#351821', alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, previewType: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, previewTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 26, lineHeight: 33, letterSpacing: -0.7, marginTop: 5 }, previewMeta: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11, marginTop: 13, textTransform: 'uppercase' }, previewBlocks: { gap: 12 }, previewBlock: { gap: 8 }, empty: { alignItems: 'center', paddingVertical: 50 }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 15 }, emptyCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 },
});
