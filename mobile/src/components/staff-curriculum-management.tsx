import { AlertCircle, Archive, CalendarDays, Check, Plus, RotateCcw, Save, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts, palette } from '@/constants/csg-theme';
import { StaffRichTextEditor } from '@/components/staff-rich-text-editor';
import { curriculumDayNames, curriculumModuleTypes, curriculumReleaseDay, curriculumSchedulePatterns, curriculumWeekFor, scheduledDayIndices } from '@/lib/curriculum';
import { richTextHtmlHasVisibleContent } from '@/lib/rich-text-editor';
import type { CurriculumModuleInput, ExerciseCreateInput, LessonDetail, StaffCurriculumModule } from '@/lib/types';

type ModuleEditorProps = {
  visible: boolean;
  module?: StaffCurriculumModule | null;
  defaultPosition: number;
  onClose: () => void;
  onSave: (input: CurriculumModuleInput) => Promise<void>;
};

export function ModuleEditorModal({ visible, module, defaultPosition, onClose, onSave }: ModuleEditorProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [moduleType, setModuleType] = useState('live_class');
  const [scheduleDays, setScheduleDays] = useState('weekdays');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName(module?.name || '');
    setDescription(module?.description || '');
    setModuleType(module?.module_type || 'live_class');
    setScheduleDays(module?.schedule_days || 'weekdays');
    setError(null);
  };

  const submit = async () => {
    if (!name.trim()) { setError('Give this module a clear name.'); return; }
    setSaving(true); setError(null);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        module_type: moduleType,
        schedule_days: scheduleDays,
        position: module?.position ?? defaultPosition,
        total_days: module?.total_days || 0,
        day_offset: module?.day_offset || 0,
        base_updated_at: module?.updated_at,
      });
      onClose();
    } catch (requestError) {
      setError((requestError as Error).message || 'The module could not be saved.');
    } finally { setSaving(false); }
  };

  return <EditorSheet visible={visible} title={module ? 'Module settings' : 'New module'} subtitle={module ? 'Update how this module is organized.' : 'Choose when this part of the curriculum appears.'} onShow={reset} onClose={onClose} saving={saving} onSave={() => void submit()} saveLabel={module ? 'Save module' : 'Create module'} saveButtonText={module ? 'Save' : 'Create'}>
    {error && <EditorNotice message={error} />}
    <Field label="NAME"><TextInput accessibilityLabel="Module name" value={name} onChangeText={setName} placeholder="e.g. Live Class" placeholderTextColor={palette.quiet} style={styles.input} /></Field>
    <Field label="DESCRIPTION"><TextInput accessibilityLabel="Module description" value={description} onChangeText={setDescription} multiline textAlignVertical="top" placeholder="What belongs in this module?" placeholderTextColor={palette.quiet} style={[styles.input, styles.multiline]} /></Field>
    <Field label="TYPE"><ChoiceGrid options={curriculumModuleTypes} selected={moduleType} onSelect={setModuleType} /></Field>
    <Field label="LEARNING DAYS"><ChoiceGrid options={curriculumSchedulePatterns} selected={scheduleDays} onSelect={setScheduleDays} /><Text style={styles.helper}>Existing lessons must already fall on the selected days. Move them first if the schedule cannot be changed.</Text></Field>
  </EditorSheet>;
}

type ExerciseEditorProps = {
  visible: boolean;
  module: StaffCurriculumModule | null;
  defaultWeek: number;
  onClose: () => void;
  onSave: (input: ExerciseCreateInput) => Promise<void>;
};

export function ExerciseEditorModal({ visible, module, defaultWeek, onClose, onSave }: ExerciseEditorProps) {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [week, setWeek] = useState(defaultWeek);
  const [weekdayIndex, setWeekdayIndex] = useState(0);
  const [required, setRequired] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => scheduledDayIndices(module?.schedule_days || 'weekdays'), [module?.schedule_days]);
  const weeks = useMemo(() => Array.from({ length: Math.max(1, module?.week_count || 1, defaultWeek, (module?.week_count || 1) + 1) }, (_, index) => index + 1), [defaultWeek, module?.week_count]);

  const reset = () => {
    if (!module) return;
    setTitle(''); setInstructions(''); setWeek(defaultWeek); setWeekdayIndex(days[0]); setRequired(true); setError(null);
  };

  const submit = async () => {
    if (!title.trim()) { setError('Give this lesson a clear title.'); return; }
    if (!richTextHtmlHasVisibleContent(instructions)) { setError('Add a starting prompt so the new lesson is useful immediately.'); return; }
    setSaving(true); setError(null);
    try {
      await onSave({ title: title.trim(), instructions: instructions.trim(), release_day: curriculumReleaseDay(week, weekdayIndex), required, submission_type: 'manual_complete' });
      onClose();
    } catch (requestError) {
      setError((requestError as Error).message || 'The lesson could not be created.');
    } finally { setSaving(false); }
  };

  return <EditorSheet visible={visible} title="New lesson" subtitle={module ? `Add a useful starting point to ${module.name}.` : 'Choose a module first.'} onShow={reset} onClose={onClose} saving={saving} onSave={() => void submit()} saveLabel="Create and continue" saveButtonText="Create">
    {error && <EditorNotice message={error} />}
    <View style={styles.tip}><Plus color={palette.rubySoft} size={18} /><Text style={styles.tipText}>Start with the title, placement, and student prompt. The full editor opens next for video, submission, filename, and solution details.</Text></View>
    <Field label="TITLE"><TextInput accessibilityLabel="New lesson title" value={title} onChangeText={setTitle} placeholder="What will students learn or build?" placeholderTextColor={palette.quiet} style={styles.input} /></Field>
    <Field label="WEEK"><HorizontalChoices options={weeks.map((value) => ({ value, label: `Week ${value}` }))} selected={week} onSelect={setWeek} /></Field>
    <Field label="DAY"><HorizontalChoices options={days.map((value) => ({ value, label: curriculumDayNames[value] }))} selected={weekdayIndex} onSelect={setWeekdayIndex} /></Field>
    <View style={styles.toggle}><View style={styles.flex}><Text style={styles.toggleTitle}>{required ? 'Required lesson' : 'Optional stretch'}</Text><Text style={styles.toggleCopy}>{required ? 'Counts toward required weekly work.' : 'Available without counting toward required completion.'}</Text></View><Switch accessibilityLabel="Required lesson" value={required} onValueChange={setRequired} trackColor={{ false: palette.line, true: '#6A2A36' }} thumbColor={required ? palette.rubySoft : palette.muted} /></View>
    <Field label="STARTING PROMPT"><StaffRichTextEditor accessibilityLabel="New lesson instructions" value={instructions} onChange={setInstructions} /></Field>
  </EditorSheet>;
}

type LessonSettingsProps = {
  visible: boolean;
  lesson: LessonDetail;
  module: StaffCurriculumModule;
  onClose: () => void;
  onMove: (releaseDay: number) => Promise<void>;
  onToggleArchived: () => Promise<void>;
};

export function LessonSettingsModal({ visible, lesson, module, onClose, onMove, onToggleArchived }: LessonSettingsProps) {
  const [week, setWeek] = useState(curriculumWeekFor(lesson));
  const [weekdayIndex, setWeekdayIndex] = useState(lesson.release_day % 7);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => scheduledDayIndices(module.schedule_days), [module.schedule_days]);
  const weeks = useMemo(() => Array.from({ length: Math.max(module.week_count + 1, curriculumWeekFor(lesson), 1) }, (_, index) => index + 1), [lesson, module.week_count]);
  const nextReleaseDay = curriculumReleaseDay(week, weekdayIndex);
  const moved = nextReleaseDay !== lesson.release_day;

  const reset = () => {
    setWeek(curriculumWeekFor(lesson)); setWeekdayIndex(days.includes(lesson.release_day % 7) ? lesson.release_day % 7 : days[0]); setError(null);
  };

  const move = async () => {
    if (!moved) return;
    setSaving(true); setError(null);
    try { await onMove(nextReleaseDay); onClose(); }
    catch (requestError) { setError((requestError as Error).message || 'The lesson could not be moved.'); }
    finally { setSaving(false); }
  };

  const toggleArchived = () => Alert.alert(
    lesson.archived_at ? 'Restore this lesson?' : 'Archive this lesson?',
    lesson.archived_at ? 'Students can access it again according to its schedule.' : 'Student evidence stays intact, but the lesson disappears from active curriculum.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: lesson.archived_at ? 'Restore lesson' : 'Archive lesson', style: lesson.archived_at ? 'default' : 'destructive', onPress: () => void (async () => {
        setSaving(true); setError(null);
        try { await onToggleArchived(); onClose(); }
        catch (requestError) { setError((requestError as Error).message || 'The lesson status could not be changed.'); }
        finally { setSaving(false); }
      })() },
    ],
  );

  return <EditorSheet visible={visible} title="Lesson settings" subtitle={lesson.title} onShow={reset} onClose={onClose} saving={saving} onSave={() => void move()} saveLabel="Move lesson" saveButtonText="Move" saveDisabled={!moved}>
    {error && <EditorNotice message={error} />}
    <View style={styles.tip}><CalendarDays color={palette.rubySoft} size={18} /><Text style={styles.tipText}>Placement controls when the lesson appears in this reusable module. Cohort dates are calculated from this schedule.</Text></View>
    <Field label="WEEK"><HorizontalChoices options={weeks.map((value) => ({ value, label: `Week ${value}` }))} selected={week} onSelect={setWeek} /></Field>
    <Field label="DAY"><HorizontalChoices options={days.map((value) => ({ value, label: curriculumDayNames[value] }))} selected={weekdayIndex} onSelect={setWeekdayIndex} /></Field>
    <View style={styles.current}><Check color={palette.success} size={17} /><Text style={styles.currentText}>{moved ? `Move to Week ${week}, ${curriculumDayNames[weekdayIndex]}` : `Currently Week ${week}, ${curriculumDayNames[weekdayIndex]}`}</Text></View>
    <View style={styles.dangerSection}><Text style={styles.dangerLabel}>VISIBILITY</Text><Text style={styles.dangerCopy}>{lesson.archived_at ? 'This lesson is archived and hidden from active student curriculum.' : 'Archiving is reversible and preserves submissions, progress, and authored content.'}</Text><Pressable accessibilityRole="button" accessibilityLabel={lesson.archived_at ? 'Restore lesson' : 'Archive lesson'} disabled={saving} onPress={toggleArchived} style={[styles.archiveButton, lesson.archived_at && styles.restoreButton]}>{lesson.archived_at ? <RotateCcw color={palette.success} size={18} /> : <Archive color={palette.rubySoft} size={18} />}<Text style={[styles.archiveText, lesson.archived_at && styles.restoreText]}>{lesson.archived_at ? 'Restore lesson' : 'Archive lesson'}</Text></Pressable></View>
  </EditorSheet>;
}

function EditorSheet({ visible, title, subtitle, onShow, onClose, saving, onSave, saveLabel, saveButtonText, saveDisabled = false, children }: { visible: boolean; title: string; subtitle: string; onShow: () => void; onClose: () => void; saving: boolean; onSave: () => void; saveLabel: string; saveButtonText: string; saveDisabled?: boolean; children: React.ReactNode }) {
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onShow={onShow} onRequestClose={() => { if (!saving) onClose(); }}><SafeAreaView style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Close editor" disabled={saving} onPress={onClose} style={styles.headerButton}><X color={palette.muted} size={21} /></Pressable><View style={styles.flex}><Text numberOfLines={1} style={styles.headerTitle}>{title}</Text><Text numberOfLines={1} style={styles.headerSubtitle}>{subtitle}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={saveLabel} disabled={saving || saveDisabled} onPress={onSave} style={[styles.save, (saving || saveDisabled) && styles.disabled]}><Save color={palette.text} size={16} /><Text style={styles.saveText}>{saving ? 'Saving' : saveButtonText}</Text></Pressable></View><ScrollView automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{children}</ScrollView></KeyboardAvoidingView></SafeAreaView></Modal>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>; }

function ChoiceGrid<T extends string>({ options, selected, onSelect }: { options: readonly { value: T; label: string }[]; selected: string; onSelect: (value: T) => void }) {
  return <View style={styles.choiceGrid}>{options.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected === option.value }} onPress={() => onSelect(option.value)} style={[styles.choice, selected === option.value && styles.choiceActive]}><Text style={[styles.choiceText, selected === option.value && styles.choiceTextActive]}>{option.label}</Text></Pressable>)}</View>;
}

function HorizontalChoices<T extends number>({ options, selected, onSelect }: { options: { value: T; label: string }[]; selected: number; onSelect: (value: T) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalChoices}>{options.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected === option.value }} onPress={() => onSelect(option.value)} style={[styles.choice, selected === option.value && styles.choiceActive]}><Text style={[styles.choiceText, selected === option.value && styles.choiceTextActive]}>{option.label}</Text></Pressable>)}</ScrollView>;
}

function EditorNotice({ message }: { message: string }) { return <View accessibilityRole="alert" style={styles.error}><AlertCircle color={palette.rubySoft} size={18} /><Text style={styles.errorText}>{message}</Text></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, flex: { flex: 1, minWidth: 0 }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, headerButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 15 }, headerSubtitle: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, marginTop: 3 }, save: { minHeight: 44, borderRadius: 14, backgroundColor: palette.ruby, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }, saveText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, disabled: { opacity: 0.42 }, content: { padding: 18, paddingBottom: 70, gap: 19 }, field: { gap: 8 }, label: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 }, input: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 13, paddingVertical: 12 }, multiline: { minHeight: 92, lineHeight: 20 }, helper: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 }, choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, horizontalChoices: { gap: 8 }, choice: { minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }, choiceActive: { borderColor: palette.ruby, backgroundColor: '#351821' }, choiceText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 }, choiceTextActive: { color: palette.rubySoft }, tip: { borderRadius: 16, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, tipText: { flex: 1, color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 }, error: { borderRadius: 16, borderWidth: 1, borderColor: '#5D2830', backgroundColor: '#2B171B', padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, errorText: { flex: 1, color: palette.rubySoft, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 17 }, toggle: { minHeight: 76, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12 }, toggleTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, toggleCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 3 }, current: { borderRadius: 14, backgroundColor: '#15271E', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, currentText: { flex: 1, color: palette.success, fontFamily: fonts.semibold, fontSize: 11 }, dangerSection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, paddingTop: 20, gap: 9 }, dangerLabel: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 }, dangerCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 }, archiveButton: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: '#5D2830', backgroundColor: '#2B171B', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, archiveText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 }, restoreButton: { borderColor: '#28523C', backgroundColor: '#15271E' }, restoreText: { color: palette.success },
});
