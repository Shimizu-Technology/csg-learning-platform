import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import type { CohortOfficeHour } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { useSession } from '@/providers/session-provider';
import { formatCourseDateTime } from '@/lib/course-time';

type Draft = { id: number | null; title: string; description: string; starts_at: string; ends_at: string; meeting_url: string; recurrence: CohortOfficeHour['recurrence']; event_kind: CohortOfficeHour['event_kind'] };
const emptyDraft: Draft = { id: null, title: '', description: '', starts_at: '', ends_at: '', meeting_url: '', recurrence: 'once', event_kind: 'office_hours' };

function guamWallTime(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Guam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (kind: string) => parts.find((part) => part.type === kind)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function updateWallTime(current: string, part: 'date' | 'time', value: string) {
  const [date = '', time = ''] = current.split('T');
  return part === 'date' ? `${value}T${time}` : `${date}T${value}`;
}

function validWallTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour < 24 && minute < 60;
}

export default function CohortScheduleScreen() {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cohortId = Number(id);
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { cohorts } = useCohort();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const cohort = cohorts.find((item) => item.id === cohortId);
  const query = useQuery({ queryKey: ['cohort-office-hours', user?.id, cohortId], queryFn: ({ signal }) => auth.demo ? Promise.resolve({ office_hours: [] as CohortOfficeHour[], upcoming: [] }) : api.cohortOfficeHours(cohortId, signal), enabled: Boolean(user && cohortId > 0) });
  const update = (key: keyof Draft, value: string) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const edit = (item: CohortOfficeHour) => setDraft({ id: item.id, title: item.title, description: item.description || '', starts_at: guamWallTime(item.starts_at), ends_at: guamWallTime(item.ends_at), meeting_url: item.meeting_url, recurrence: item.recurrence, event_kind: item.event_kind });
  const save = async () => {
    if (!draft || saving) return;
    if (!draft.title.trim() || !draft.meeting_url.trim() || !validWallTime(draft.starts_at) || !validWallTime(draft.ends_at)) {
      Alert.alert('Check the session', 'Add a title and meeting link. Enter valid start and end dates and times in Guam time.');
      return;
    }
    if (draft.ends_at <= draft.starts_at) { Alert.alert('Check the end time', 'The session must end after it begins.'); return; }
    setSaving(true);
    try {
      const input = { title: draft.title.trim(), description: draft.description.trim(), meeting_url: draft.meeting_url.trim(), starts_at: draft.starts_at, ends_at: draft.ends_at, recurrence: draft.recurrence, event_kind: draft.event_kind, timezone: 'Pacific/Guam' };
      if (!auth.demo) {
        if (draft.id) await api.updateCohortOfficeHour(cohortId, draft.id, input);
        else await api.createCohortOfficeHour(cohortId, input);
      }
      await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ['cohort-home', user?.id, cohortId] })]);
      setDraft(null);
    } catch (error) { Alert.alert('Could not save session', (error as Error).message); }
    finally { setSaving(false); }
  };
  const deactivate = () => {
    if (!draft?.id || saving) return;
    Alert.alert('Remove this session?', 'It will disappear from the active cohort schedule.', [{ text: 'Keep session', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => {
      setSaving(true);
      try { await api.updateCohortOfficeHour(cohortId, draft.id!, { active: false }); await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ['cohort-home', user?.id, cohortId] })]); setDraft(null); }
      catch (error) { Alert.alert('Could not remove session', (error as Error).message); }
      finally { setSaving(false); }
    } }]);
  };

  if (!user?.is_staff) return <SafeAreaView style={styles.safe}><EmptyState title="Staff access only" copy="An instructor or admin manages the cohort schedule." /></SafeAreaView>;
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => draft ? setDraft(null) : router.back()} style={styles.iconButton}><ArrowLeft color={c.text.strong} size={21} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>{cohort?.name || 'COHORT'}</Text><Text style={styles.headerTitle}>{draft ? draft.id ? 'Edit session' : 'New session' : 'Schedule'}</Text></View>{draft ? <Pressable accessibilityRole="button" accessibilityLabel="Close editor" onPress={() => setDraft(null)} style={styles.iconButton}><X color={c.text.body} size={20} /></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="Add a session" onPress={() => setDraft({ ...emptyDraft })} style={styles.add}><Plus color={c.text.strong} size={19} /></Pressable>}</View>
    {query.isPending && !query.data ? <LoadingState label="Loading sessions" /> : query.error && !query.data ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}><ScrollView keyboardShouldPersistTaps="handled" refreshControl={!draft ? <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.text.body} /> : undefined} contentContainerStyle={styles.content}>
      {draft ? <>
        <Text style={styles.intro}>Times are in Guam time. The class will see this session and its meeting link.</Text>
        <Field label="TITLE" value={draft.title} onChangeText={(value) => update('title', value)} placeholder="Office hours or live class" />
        <Field label="DESCRIPTION" value={draft.description} onChangeText={(value) => update('description', value)} placeholder="What should students bring?" multiline />
        <View style={styles.choiceRow}><Choice label="Office hours" selected={draft.event_kind === 'office_hours'} onPress={() => update('event_kind', 'office_hours')} /><Choice label="Live class" selected={draft.event_kind === 'live_class'} onPress={() => update('event_kind', 'live_class')} /></View>
        <WallTimeFields label="START · GUAM TIME" value={draft.starts_at} onChange={(part, value) => update('starts_at', updateWallTime(draft.starts_at, part, value))} />
        <WallTimeFields label="END · GUAM TIME" value={draft.ends_at} onChange={(part, value) => update('ends_at', updateWallTime(draft.ends_at, part, value))} />
        <Text style={styles.hint}>Enter dates as YYYY-MM-DD and times as HH:MM in Guam time.</Text>
        <Field label="MEETING LINK" value={draft.meeting_url} onChangeText={(value) => update('meeting_url', value)} placeholder="https://…" autoCapitalize="none" keyboardType="url" />
        <View style={styles.choiceRow}><Choice label="One time" selected={draft.recurrence === 'once'} onPress={() => update('recurrence', 'once')} /><Choice label="Every week" selected={draft.recurrence === 'weekly'} onPress={() => update('recurrence', 'weekly')} /></View>
        <Button accessibilityRole="button" accessibilityLabel="Save session" disabled={saving} onPress={() => void save()} style={[styles.save, saving && styles.disabled]} variant="secondary" label={saving ? 'Saving…' : 'Save session'} textStyle={styles.saveText} />
        {draft.id && <Pressable accessibilityRole="button" accessibilityLabel="Remove session" disabled={saving} onPress={deactivate} style={styles.remove}><Text style={styles.removeText}>Remove this session</Text></Pressable>}
      </> : <><Text style={styles.eyebrow}>LIVE LEARNING</Text><Text style={styles.title}>Class sessions and office hours</Text><Text style={styles.intro}>Students see upcoming sessions on their cohort page. Tap any session to change its time or link.</Text>{(query.data?.office_hours || []).map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`} onPress={() => edit(item)} style={styles.session}><View style={styles.sessionIcon}>{item.event_kind === 'live_class' ? <CalendarDays color={c.text.body} size={20} /> : <Clock3 color={c.text.body} size={20} />}</View><View style={styles.flex}><Text style={styles.sessionTitle}>{item.title}</Text><Text style={styles.sessionTime}>{formatCourseDateTime(item.occurrences[0]?.starts_at || item.starts_at, { weekday: true })} · {item.recurrence === 'weekly' ? 'weekly' : 'one time'}</Text></View><ChevronRight color={c.text.muted} size={18} /></Pressable>)}{!query.data?.office_hours.length && <Text style={styles.empty}>No sessions scheduled yet.</Text>}<Pressable accessibilityRole="button" onPress={() => setDraft({ ...emptyDraft })} style={styles.new}><Plus color={c.text.body} size={18} /><Text style={styles.newText}>Add a session</Text></Pressable></>}
    </ScrollView></KeyboardAvoidingView>}
  </SafeAreaView>;
}

function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; autoCapitalize?: 'none'; keyboardType?: 'url' }) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme(); return <View style={styles.fieldGroup}><Text style={styles.label}>{label}</Text><TextInput keyboardAppearance={scheme} accessibilityLabel={label} placeholderTextColor={c.text.body} style={[styles.field, props.multiline && styles.multiline]} {...props} /></View>; }
function WallTimeFields({ label, value, onChange }: { label: string; value: string; onChange: (part: 'date' | 'time', value: string) => void }) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const [date = '', time = ''] = value.split('T');
  return <View style={styles.fieldGroup}><Text style={styles.label}>{label}</Text><View style={styles.choiceRow}><TextInput keyboardAppearance={scheme} accessibilityLabel={`${label} date`} value={date} onChangeText={(next) => onChange('date', next)} placeholder="YYYY-MM-DD" placeholderTextColor={c.text.body} keyboardType="numbers-and-punctuation" style={[styles.field, styles.flex]} /><TextInput keyboardAppearance={scheme} accessibilityLabel={`${label} time`} value={time} onChangeText={(next) => onChange('time', next)} placeholder="HH:MM" placeholderTextColor={c.text.body} keyboardType="numbers-and-punctuation" style={[styles.field, styles.flex]} /></View></View>;
}
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles(); return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>; }

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({ safe: { flex: 1, backgroundColor: c.surface.page }, flex: { flex: 1, minWidth: 0 }, header: { minHeight: 66, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 9 }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, add: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.selection.bg, alignItems: 'center', justifyContent: 'center' }, content: { padding: 20, paddingBottom: 90, gap: 13 }, eyebrow: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.4 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34 }, intro: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 }, session: { minHeight: 73, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 17, backgroundColor: c.surface.sunken, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }, sessionIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, sessionTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, sessionTime: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 4 }, empty: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 30, textAlign: 'center' }, new: { minHeight: 52, borderRadius: 15, backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, newText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 13 }, fieldGroup: { gap: 7, marginTop: 3 }, label: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, field: { minHeight: 50, backgroundColor: c.surface.sunken, color: c.text.strong, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 14, paddingHorizontal: 13, fontFamily: fonts.regular, fontSize: 13 }, multiline: { minHeight: 95, textAlignVertical: 'top', paddingTop: 13 }, hint: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 }, choiceRow: { flexDirection: 'row', gap: 8, marginTop: 4 }, choice: { flex: 1, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, alignItems: 'center', justifyContent: 'center' }, choiceSelected: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator }, choiceText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, choiceTextSelected: { color: c.text.strong }, save: { minHeight: 52, borderRadius: 14, backgroundColor: c.action.primary, alignItems: 'center', justifyContent: 'center', marginTop: 14 }, disabled: { opacity: 0.6 }, saveText: { color: c.text.onAction, fontFamily: fonts.bold, fontSize: 14 }, remove: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, removeText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 } }));
