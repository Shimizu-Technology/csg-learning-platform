import { isAuthoringAdmin, sharedLibraryReadOnlyNotice } from '@/lib/authoring-permissions';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, ChevronLeft, Eye, Lock, Pencil, Settings2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LessonContentBlockCard } from '@/components/lesson-content-block';
import { RubricPanel } from '@/components/rubric-panel';
import { LessonObjectives } from '@/components/lesson-objectives';
import { ContextualHelp } from '@/components/contextual-help';
import { ProgressBar, StatusBadge } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { LessonSettingsModal } from '@/components/staff-curriculum-management';
import { fonts } from '@/constants/csg-theme';
import { demoLessonFor } from '@/lib/demo-learning';
import { demoStaffCurriculum } from '@/lib/demo-staff';
import { formatCourseDate } from '@/lib/course-time';
import { learningKeys } from '@/lib/learning';
import { lessonLearnerProgress } from '@/lib/learning-status';
import { captureProductEvent } from '@/lib/analytics';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { useSession } from '@/providers/session-provider';

export default function LessonScreen() {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { selectedCohortId, loading: cohortLoading } = useCohort();
  const canAuthor = isAuthoringAdmin(user);
  const isStaff = Boolean(user?.is_staff);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The hero shows the lesson title; the header repeats it only once the hero scrolls away.
  // Keyed by lesson id: lesson-to-lesson navigation reuses this screen and starts with the hero in view.
  const [heroLayout, setHeroLayout] = useState<{ lessonId: number; bottom: number } | null>(null);
  const [pastHeroFor, setPastHeroFor] = useState<number | null>(null);
  const heroHeight = heroLayout?.lessonId === id ? heroLayout.bottom : 0;
  const pastHero = pastHeroFor === id;
  const validId = Number.isInteger(id) && id > 0;
  const cohortId = isStaff ? null : selectedCohortId;
  const query = useQuery({ queryKey: learningKeys.lesson(user?.id || 0, id, cohortId), queryFn: ({ signal }) => auth.demo ? Promise.resolve({ lesson: demoLessonFor(id) }) : api.lesson(id, signal, cohortId), enabled: Boolean(user && validId && (isStaff || (!cohortLoading && cohortId != null))) });
  const lesson = query.data?.lesson;
  const curriculumQuery = useQuery({ queryKey: learningKeys.curriculum(user?.id || 0, lesson?.curriculum_id || 0), queryFn: ({ signal }) => auth.demo ? Promise.resolve({ curriculum: demoStaffCurriculum }) : api.curriculum(lesson!.curriculum_id!, signal), enabled: Boolean(isStaff && lesson?.curriculum_id) });
  const curriculumModule = curriculumQuery.data?.curriculum.modules.find((item) => item.id === lesson?.module_id);
  const curriculumUnavailable = curriculumQuery.isError || (!curriculumQuery.isPending && curriculumQuery.data && !curriculumModule);
  const lessonId = lesson?.id;
  const moduleId = lesson?.module_id;
  useEffect(() => {
    if (!lessonId || !moduleId || isStaff) return;
    captureProductEvent('learning_step_started', { module_id: moduleId, lesson_id: lessonId, block_type: 'lesson' });
  }, [isStaff, lessonId, moduleId]);
  if (!validId) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable></View><ErrorState message="This lesson link is invalid." /></SafeAreaView>;
  if (!isStaff && !cohortLoading && cohortId == null) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable></View><ErrorState message="Choose a cohort to open this lesson." /></SafeAreaView>;
  if (query.isPending && !lesson) return <SafeAreaView style={styles.safe}><LoadingState label="Opening lesson" /></SafeAreaView>;
  if (!lesson) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable></View><ErrorState message={query.error ? (query.error as Error).message : 'This lesson is unavailable.'} retry={() => void query.refetch()} /></SafeAreaView>;
  const progress = lessonLearnerProgress(lesson.content_blocks, lesson.requires_github);
  const headerStatus = progress.status === 'done' || progress.status === 'awaiting_review' || progress.status === 'redo' ? progress.status : null;
  const closed = Boolean(lesson.submission_window?.submissions_closed);

  const cacheStaffLesson = (next: typeof lesson) => {
    queryClient.setQueryData(learningKeys.lesson(user?.id || 0, next.id), { lesson: next });
    if (!auth.demo) {
      void queryClient.invalidateQueries({ queryKey: learningKeys.curricula(user?.id || 0) });
      if (next.curriculum_id) void queryClient.invalidateQueries({ queryKey: learningKeys.curriculum(user?.id || 0, next.curriculum_id) });
    }
  };

  const moveLesson = async (releaseDay: number) => {
    if (!canAuthor) throw new Error(sharedLibraryReadOnlyNotice);
    if (!lesson.updated_at) throw new Error('Refresh this lesson before moving it so the change can be protected.');
    const next = auth.demo ? { ...lesson, release_day: releaseDay, updated_at: new Date().toISOString() } : (await api.updateLessonSchedule(lesson.id, releaseDay, lesson.updated_at)).lesson;
    cacheStaffLesson(next);
  };

  const toggleArchived = async () => {
    if (!canAuthor) throw new Error(sharedLibraryReadOnlyNotice);
    if (!lesson.updated_at) throw new Error('Refresh this lesson before changing its status so the change can be protected.');
    const next = auth.demo ? { ...lesson, archived_at: lesson.archived_at ? null : new Date().toISOString(), updated_at: new Date().toISOString() } : lesson.archived_at ? (await api.restoreLesson(lesson.id, lesson.updated_at)).lesson : (await api.archiveLesson(lesson.id, lesson.updated_at)).lesson;
    cacheStaffLesson(next);
  };

  const refreshLesson = () => {
    void Promise.all([
      query.refetch(),
      ...(isStaff && lesson.curriculum_id ? [curriculumQuery.refetch()] : []),
    ]);
  };

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable><View style={styles.flex}><Text style={styles.headerKicker}>{isStaff ? 'CURRICULUM PREVIEW' : 'LESSON'}</Text>{(isStaff || pastHero) && <Text numberOfLines={1} style={styles.headerTitle}>{lesson.title}</Text>}</View>{canAuthor && <Pressable accessibilityRole="button" accessibilityLabel="Edit lesson" onPress={() => router.push(`/staff/lesson/${lesson.id}/edit`)} style={styles.editButton}><Pencil color={c.text.body} size={16} /><Text style={styles.editText}>Edit</Text></Pressable>}{isStaff ? <Text style={[styles.headerProgress, styles.headerPreview]}>Preview</Text> : headerStatus ? <View style={styles.headerBadge} testID="lesson-header-status"><StatusBadge status={headerStatus} short /></View> : <Text style={styles.headerProgress} testID="lesson-header-status">{`${progress.percentage}%`}</Text>}</View><ScrollView onScroll={(event) => { const next = heroHeight > 0 && event.nativeEvent.contentOffset.y > heroHeight; if (next !== pastHero) setPastHeroFor(next ? id : null); }} scrollEventThrottle={64} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={query.isRefetching || (isStaff && curriculumQuery.isRefetching)} onRefresh={refreshLesson} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
    {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing the saved lesson. Changes need a connection.</Text></View>}
    <View onLayout={(event) => setHeroLayout({ lessonId: id, bottom: event.nativeEvent.layout.y + event.nativeEvent.layout.height })} style={styles.hero}><View style={styles.heroIcon}>{isStaff ? <Eye color={c.text.body} size={21} /> : <BookOpen color={c.text.body} size={21} />}</View><Text style={styles.type}>{lesson.lesson_type.toUpperCase()}{isStaff ? ' · READ-ONLY PREVIEW' : ''}</Text><Text style={styles.title}>{lesson.title}</Text>{isStaff ? <><View style={styles.staffMeta}><Text style={styles.staffMetaText}>{lesson.required ? 'Required' : 'Optional'}</Text><Text style={styles.staffMetaText}>{lesson.archived_at ? 'Archived' : 'Active'}</Text><Text style={styles.staffMetaText}>{lesson.content_blocks_count} {lesson.content_blocks_count === 1 ? 'block' : 'blocks'}</Text></View><View style={styles.previewNotice}><Eye color={c.text.body} size={15} /><Text style={styles.previewNoticeText}>You’re viewing the student experience. Completion, video progress, checks, and submissions are disabled.</Text></View>{lesson.updated_at && <Text style={styles.updated}>Last updated {formatUpdatedAt(lesson.updated_at)}</Text>}{canAuthor && (curriculumUnavailable ? <View style={styles.structureError}><AlertCircle color={c.text.body} size={17} /><View style={styles.flex}><Text style={styles.settingsTitle}>Curriculum tools unavailable</Text><Text style={styles.settingsCopy}>The lesson is safe to view. Retry to load its schedule and status controls.</Text></View><Button accessibilityRole="button" accessibilityLabel="Retry curriculum tools" onPress={() => void curriculumQuery.refetch()} style={styles.retryButton} variant="secondary" label="Retry" textStyle={styles.retryText} /></View> : <Pressable accessibilityRole="button" accessibilityLabel="Open lesson schedule and status" disabled={!curriculumModule} onPress={() => setSettingsOpen(true)} style={[styles.settingsButton, !curriculumModule && styles.disabled]}><Settings2 color={c.text.body} size={17} /><View style={styles.flex}><Text style={styles.settingsTitle}>Schedule and status</Text><Text style={styles.settingsCopy}>{curriculumModule ? `Move within ${curriculumModule.name}, archive, or restore` : 'Loading curriculum structure…'}</Text></View><ArrowRight color={c.text.muted} size={17} /></Pressable>)}</> : <><View style={styles.progressCopy}><Text style={styles.progressText}>{progress.done} of {progress.total} {progress.total === 1 ? 'step' : 'steps'} done{progress.awaitingReview ? ` · ${progress.awaitingReview} awaiting review` : ''}{progress.redo ? ` · ${progress.redo} redo` : ''}</Text><Text style={styles.percent}>{progress.percentage}%</Text></View><ProgressBar value={progress.percentage} label={`${lesson.title} progress`} />{closed && <View style={styles.window}><Lock color={c.status.warning.fg} size={15} /><Text style={styles.windowText}>{lesson.submission_window?.week_number ? `Week ${lesson.submission_window.week_number} submissions are closed` : 'Submissions are closed'} · review remains available</Text></View>}{lesson.cohort_id && <View style={styles.help}><ContextualHelp cohortId={lesson.cohort_id} contextType="lesson" contextId={lesson.id} contextLabel={lesson.title} /></View>}</>}</View>
    <LessonObjectives objectives={lesson.objectives} />
    <View style={styles.blocks}>{[...lesson.content_blocks].sort((a, b) => a.position - b.position).map((block) => <View key={`${lesson.cohort_id ?? 'staff'}:${block.id}`} style={styles.blockWithHelp}><RubricPanel rubric={block.rubric} /><LessonContentBlockCard block={block} lesson={lesson} />{lesson.cohort_id && ['exercise', 'code_challenge'].includes(block.block_type) && <View style={styles.blockHelp}><ContextualHelp cohortId={lesson.cohort_id} contextType="exercise" contextId={block.id} contextLabel={block.title || lesson.title} /></View>}</View>)}</View>
    {!lesson.content_blocks.length && <View style={styles.empty}><BookOpen color={c.text.body} size={30} /><Text style={styles.emptyTitle}>This lesson is being prepared</Text></View>}
    <View style={styles.lessonNav}>{lesson.prev_lesson ? <Pressable accessibilityRole="button" accessibilityLabel={`Previous lesson: ${lesson.prev_lesson.title}`} onPress={() => router.replace(`/lesson/${lesson.prev_lesson!.id}`)} style={styles.navButton}><ChevronLeft color={c.text.body} size={18} /><View style={styles.flex}><Text style={styles.navKicker}>PREVIOUS</Text><Text numberOfLines={2} style={styles.navTitle}>{lesson.prev_lesson.title}</Text></View></Pressable> : <View style={styles.navSpacer} />}{lesson.next_lesson ? <Pressable accessibilityRole="button" accessibilityLabel={`Next lesson: ${lesson.next_lesson.title}`} onPress={() => router.replace(`/lesson/${lesson.next_lesson!.id}`)} style={[styles.navButton, styles.navRight]}><View style={styles.flex}><Text style={[styles.navKicker, styles.textRight]}>NEXT</Text><Text numberOfLines={2} style={[styles.navTitle, styles.textRight]}>{lesson.next_lesson.title}</Text></View><ArrowRight color={c.text.body} size={18} /></Pressable> : <View style={styles.navSpacer} />}</View>
  </ScrollView>{canAuthor && curriculumModule && <LessonSettingsModal visible={settingsOpen} lesson={lesson} module={curriculumModule} onClose={() => setSettingsOpen(false)} onMove={moveLesson} onToggleArchived={toggleArchived} />}</SafeAreaView>;
}

function formatUpdatedAt(value: string) {
  return formatCourseDate(value, { withYear: true, fallback: value });
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, disabled: { opacity: 0.42 }, headerKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, editButton: { minHeight: 44, borderRadius: 14, backgroundColor: c.surface.sunken, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 }, editText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, headerProgress: { color: c.status.success.fg, fontFamily: fonts.bold, fontSize: 12, marginRight: 10 }, headerPreview: { color: c.text.body }, headerBadge: { marginRight: 8, flexShrink: 0 }, content: { padding: 20, paddingBottom: 90 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: c.status.warning.bg, justifyContent: 'center', paddingHorizontal: 12, marginBottom: 12 }, offlineText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12 }, hero: { borderRadius: 22, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 20 }, heroIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, type: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34, letterSpacing: -0.8, marginTop: 5 }, staffMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 17 }, staffMetaText: { minHeight: 28, borderRadius: 14, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, color: c.text.body, fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 9, paddingTop: 6 }, previewNotice: { flexDirection: 'row', gap: 8, borderRadius: 14, backgroundColor: c.status.warning.bg, padding: 12, marginTop: 14 }, previewNoticeText: { flex: 1, color: c.status.warning.fg, fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 }, updated: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 10 }, settingsButton: { minHeight: 62, borderRadius: 16, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 12, marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 9 }, structureError: { minHeight: 70, borderRadius: 16, borderWidth: 1, borderColor: c.status.danger.border, backgroundColor: c.status.danger.bg, padding: 12, marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 9 }, settingsTitle: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, settingsCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 3 }, retryButton: { minHeight: 44, borderRadius: 14,  paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' }, retryText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, progressCopy: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, marginBottom: 8 }, progressText: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12 }, percent: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, window: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 }, windowText: { flex: 1, color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 }, help: { marginTop: 16 }, blocks: { gap: 12, marginTop: 16 }, blockWithHelp: { gap: 8 }, blockHelp: { alignItems: 'flex-end' }, empty: { alignItems: 'center', paddingVertical: 60 }, emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 12 }, lessonNav: { flexDirection: 'row', gap: 10, marginTop: 22 }, navButton: { flex: 1, minHeight: 76, borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 7 }, navRight: { justifyContent: 'flex-end' }, navSpacer: { flex: 1 }, navKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8 }, navTitle: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, marginTop: 3 }, textRight: { textAlign: 'right' },
}));
