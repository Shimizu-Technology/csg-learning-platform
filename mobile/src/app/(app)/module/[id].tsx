import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Lock } from 'lucide-react-native';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, StatusBadge, StatusIcon } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { formatCourseDate } from '@/lib/course-time';
import { isStudentDashboard, learningKeys } from '@/lib/learning';
import { learnerLessonStatus } from '@/lib/learning-status';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useCohort } from '@/providers/cohort-provider';

export default function ModuleScreen() {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const { id: rawId, cohort_id: routeCohortId } = useLocalSearchParams<{ id: string; cohort_id?: string }>();
  const id = Number(rawId);
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { cohorts, selectedCohortId, loading: cohortLoading, error: cohortError, stale: cohortStale, refresh } = useCohort();
  const cohortId = routeCohortId ? Number(routeCohortId) : selectedCohortId;
  const validCohort = cohortId != null && Number.isInteger(cohortId) && cohortId > 0 && cohorts.some(cohort => cohort.id === cohortId);
  const query = useQuery({ queryKey: learningKeys.dashboard(user?.id || 0, cohortId), queryFn: ({ signal }) => auth.demo ? Promise.resolve({ dashboard: demoDashboard }) : api.dashboard(signal, cohortId), enabled: Boolean(user && !cohortLoading && validCohort) });
  const dashboard = query.data?.dashboard;
  const module = dashboard && isStudentDashboard(dashboard) ? dashboard.modules?.find((item) => item.id === id) : undefined;
  if (!cohortLoading && ((cohortError && !cohortStale) || !validCohort)) return <SafeAreaView style={styles.safe}><ErrorState message={cohortError || 'Choose a cohort to open this module.'} retry={() => void refresh()} /></SafeAreaView>;
  if (cohortLoading || (query.isPending && !dashboard)) return <SafeAreaView style={styles.safe}><LoadingState label="Loading module" /></SafeAreaView>;
  if (!module) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable></View><ErrorState message={query.error ? (query.error as Error).message : 'This module is unavailable.'} retry={() => void query.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable><View style={styles.flex}><Text style={styles.headerKicker}>LEARNING MODULE</Text><Text numberOfLines={1} style={styles.headerTitle}>{module.name}</Text></View></View><ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
    <View style={styles.hero}><Text style={styles.type}>{module.module_type}</Text><Text style={styles.title}>{module.name}</Text><View style={styles.progressCopy}><Text style={styles.progressText}>{module.completed_blocks} of {module.total_blocks} learning steps</Text><Text style={styles.percent}>{Math.round(module.progress_percentage)}%</Text></View><ProgressBar value={module.progress_percentage} label={`${module.name} progress`} /></View>
    <Text style={styles.sectionLabel}>LESSONS</Text><View style={styles.stack}>{module.lessons.map((lesson, index) => {
      const locked = !lesson.available;
      const status = learnerLessonStatus({ completed: lesson.completed, available: lesson.available, submissionsClosed: lesson.submission_window?.submissions_closed, reviewStatus: lesson.review_status, partial: lesson.completed_blocks > 0 });
      const finished = status === 'done';
      return <LearningCard key={lesson.id} onPress={locked ? undefined : () => router.push({ pathname: '/lesson/[id]', params: { id: String(lesson.id), cohort_id: String(cohortId) } })} label={locked ? `${lesson.title} is locked` : `Open ${lesson.title}`}><View style={styles.lessonRow}><View style={[styles.number, finished && styles.numberDone, locked && styles.numberLocked]}>{finished ? <CheckCircle2 color={c.status.success.fg} size={18} /> : locked ? <Lock color={c.text.body} size={16} /> : status === 'awaiting_review' || status === 'redo' ? <StatusIcon status={status} size={18} color={status === 'redo' ? c.status.warning.fg : undefined} /> : <Text style={styles.numberText}>{index + 1}</Text>}</View><View style={styles.flex}><Text style={styles.lessonType}>{lesson.lesson_type}</Text><Text style={styles.lessonTitle}>{lesson.title}</Text><Text style={styles.lessonMeta}>{lesson.unlock_date && locked ? `Opens ${formatCourseDate(lesson.unlock_date, { weekday: true })}` : `${lesson.completed_blocks} of ${lesson.total_blocks} steps handed in`}</Text>{status !== 'open' && <View style={styles.lessonStatus}><StatusBadge status={status} short /></View>}</View>{!locked && !finished && <ArrowRight color={c.text.body} size={18} />}</View></LearningCard>;
    })}</View>
    {!module.lessons.length && <View style={styles.empty}><BookOpen color={c.text.body} size={28} /><Text style={styles.emptyTitle}>Lessons are being prepared</Text></View>}
  </ScrollView></SafeAreaView>;
}


const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, headerKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, content: { padding: 20, paddingBottom: 80 },
  hero: { borderRadius: 22, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 20 }, type: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 27, letterSpacing: -0.8, marginTop: 5 }, progressCopy: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 19, marginBottom: 8 }, progressText: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12 }, percent: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, sectionLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.4, marginTop: 28, marginBottom: 9 }, stack: { gap: 9 }, lessonRow: { flexDirection: 'row', alignItems: 'center', gap: 11 }, number: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, numberDone: { backgroundColor: c.surface.sunken }, numberLocked: { backgroundColor: c.surface.sunken }, numberText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, lessonType: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 }, lessonTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13, marginTop: 2 }, lessonStatus: { marginTop: 7 }, lessonMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }, empty: { alignItems: 'center', paddingVertical: 60 }, emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 12 },
}));
