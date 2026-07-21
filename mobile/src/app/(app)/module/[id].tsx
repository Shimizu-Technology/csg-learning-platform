import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Lock } from 'lucide-react-native';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, StatusPill } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { isStudentDashboard, learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function ModuleScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const query = useQuery({ queryKey: learningKeys.dashboard(user?.id || 0), queryFn: ({ signal }) => auth.demo ? Promise.resolve({ dashboard: demoDashboard }) : api.dashboard(signal), enabled: Boolean(user) });
  const dashboard = query.data?.dashboard;
  const module = dashboard && isStudentDashboard(dashboard) ? dashboard.modules?.find((item) => item.id === id) : undefined;
  if (query.isPending && !dashboard) return <SafeAreaView style={styles.safe}><LoadingState label="Loading module" /></SafeAreaView>;
  if (!module) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable></View><ErrorState message={query.error ? (query.error as Error).message : 'This module is unavailable.'} retry={() => void query.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.flex}><Text style={styles.headerKicker}>LEARNING MODULE</Text><Text numberOfLines={1} style={styles.headerTitle}>{module.name}</Text></View></View><ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
    <View style={styles.hero}><Text style={styles.type}>{module.module_type}</Text><Text style={styles.title}>{module.name}</Text><View style={styles.progressCopy}><Text style={styles.progressText}>{module.completed_blocks} of {module.total_blocks} learning steps</Text><Text style={styles.percent}>{Math.round(module.progress_percentage)}%</Text></View><ProgressBar value={module.progress_percentage} label={`${module.name} progress`} /></View>
    <Text style={styles.sectionLabel}>LESSONS</Text><View style={styles.stack}>{module.lessons.map((lesson, index) => {
      const locked = !lesson.available;
      return <LearningCard key={lesson.id} onPress={locked ? undefined : () => router.push(`/lesson/${lesson.id}`)} label={locked ? `${lesson.title} is locked` : `Open ${lesson.title}`}><View style={styles.lessonRow}><View style={[styles.number, lesson.completed && styles.numberDone, locked && styles.numberLocked]}>{lesson.completed ? <CheckCircle2 color={palette.success} size={18} /> : locked ? <Lock color={palette.quiet} size={16} /> : <Text style={styles.numberText}>{index + 1}</Text>}</View><View style={styles.flex}><Text style={styles.lessonType}>{lesson.lesson_type}</Text><Text style={styles.lessonTitle}>{lesson.title}</Text><Text style={styles.lessonMeta}>{lesson.completed_blocks} of {lesson.total_blocks} complete{lesson.unlock_date && locked ? ` · opens ${formatDate(lesson.unlock_date)}` : ''}</Text></View><StatusPill completed={lesson.completed} locked={locked} label={lesson.completed ? 'Done' : locked ? 'Locked' : undefined} />{!locked && !lesson.completed && <ArrowRight color={palette.quiet} size={18} />}</View></LearningCard>;
    })}</View>
    {!module.lessons.length && <View style={styles.empty}><BookOpen color={palette.rubySoft} size={28} /><Text style={styles.emptyTitle}>Lessons are being prepared</Text></View>}
  </ScrollView></SafeAreaView>;
}

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date); }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, headerKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, content: { padding: 20, paddingBottom: 80 },
  hero: { borderRadius: 22, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', padding: 20 }, type: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 27, letterSpacing: -0.8, marginTop: 5 }, progressCopy: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 19, marginBottom: 8 }, progressText: { color: palette.muted, fontFamily: fonts.medium, fontSize: 10 }, percent: { color: palette.text, fontFamily: fonts.bold, fontSize: 10 }, sectionLabel: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.4, marginTop: 28, marginBottom: 9 }, stack: { gap: 9 }, lessonRow: { flexDirection: 'row', alignItems: 'center', gap: 11 }, number: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, numberDone: { backgroundColor: '#10271F' }, numberLocked: { backgroundColor: '#242A35' }, numberText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 }, lessonType: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.6 }, lessonTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13, marginTop: 2 }, lessonMeta: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 9, marginTop: 3 }, empty: { alignItems: 'center', paddingVertical: 60 }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16, marginTop: 12 },
});
