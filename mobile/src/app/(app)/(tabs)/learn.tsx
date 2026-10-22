import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { AlertTriangle, ArrowRight, BookMarked, ClipboardCheck, ExternalLink, Film, FolderOpen, Lock, Search } from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, SectionHeading, StatusBadge, StatusPill } from '@/components/learning-ui';
import { CohortSwitcher } from '@/components/cohort-switcher';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { StaffCurriculumLibrary } from '@/components/staff-curriculum';
import { fontScaleLimits, fonts, typography } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { demoStaffCurriculum } from '@/lib/demo-staff';
import { loadStaffCurriculumDetails } from '@/lib/curriculum';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { isAlumniOnlyEnrollment } from '@/lib/enrollments';
import { learnerLessonStatus } from '@/lib/learning-status';
import { formatCourseDate } from '@/lib/course-time';
import { isStudentDashboard, learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useCohort } from '@/providers/cohort-provider';

export default function LearnScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user, enrollments } = useSession();
  const { selectedCohortId, selectedCohort, loading: cohortLoading, error: cohortError, refresh } = useCohort();
  const [filter, setFilter] = useState('');
  const isStaff = Boolean(user?.is_staff);
  const isAlumniOnly = selectedCohort ? selectedCohort.cohort_type === 'alumni' : isAlumniOnlyEnrollment(enrollments);
  const studentQuery = useQuery({
    queryKey: learningKeys.dashboard(user?.id || 0, selectedCohortId),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ dashboard: demoDashboard }) : api.dashboard(signal, selectedCohortId),
    enabled: Boolean(user && !isStaff && !cohortLoading && selectedCohortId != null),
  });
  const curriculumQuery = useQuery({
    queryKey: learningKeys.curricula(user?.id || 0),
    queryFn: async ({ signal }) => {
      if (auth.demo) return { curricula: [demoStaffCurriculum], failedCount: 0 };
      const summaries = await api.curricula(signal);
      return loadStaffCurriculumDetails(
        summaries.curricula,
        async (id) => (await api.curriculum(id, signal)).curriculum,
      );
    },
    enabled: Boolean(user && isStaff),
  });
  const dashboard = studentQuery.data?.dashboard;
  const student = dashboard && isStudentDashboard(dashboard) ? dashboard : null;
  const modules = useMemo(() => [...(student?.modules || [])].sort((a, b) => (a.position || 0) - (b.position || 0)), [student?.modules]);
  const search = filter.trim().toLowerCase();
  const matches = modules.flatMap((module) => module.lessons
    .filter((lesson) => `${module.name} ${lesson.title}`.toLowerCase().includes(search))
    .map((lesson) => ({ module, lesson })));
  const activeQuery = isStaff ? curriculumQuery : studentQuery;

  if (!isStaff && !cohortLoading && (cohortError || selectedCohortId == null)) return <SafeAreaView style={styles.safe}><ErrorState message={cohortError || 'Choose a cohort to see your learning path.'} retry={() => void refresh()} /></SafeAreaView>;
  if ((!isStaff && cohortLoading) || (activeQuery.isPending && !activeQuery.data)) return <SafeAreaView style={styles.safe}><LoadingState label={isStaff ? 'Loading curriculum library' : 'Loading learning path'} /></SafeAreaView>;
  if (activeQuery.error && !activeQuery.data) return <SafeAreaView style={styles.safe}><ErrorState message={(activeQuery.error as Error).message} retry={() => void activeQuery.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}><ScrollView refreshControl={<RefreshControl refreshing={activeQuery.isRefetching} onRefresh={() => void activeQuery.refetch()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
    <CohortSwitcher />
    <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>{isStaff ? 'CURRICULUM STUDIO' : 'YOUR CURRICULUM'}</Text>
    <Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.title}>Learn</Text>
    <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.subtitle}>{isStaff ? 'Review what students see, wherever you are' : student?.cohort?.name || 'Lessons, resources, and progress'}</Text>
    {isStaff ? <>
      {Boolean(curriculumQuery.data?.failedCount) && <View accessibilityRole="alert" style={styles.partialWarning}><AlertTriangle color={c.status.warning.fg} size={19} /><Text style={styles.partialWarningText}>Some curricula could not be refreshed. Everything that loaded is still available below.</Text></View>}
      <StaffCurriculumLibrary curricula={curriculumQuery.data?.curricula || []} filter={filter} onFilterChange={setFilter} onOpenCurriculum={(id) => router.push(`/staff/curriculum/${id}` as Href)} onOpenLesson={(id) => router.push(`/lesson/${id}`)} />
      <SectionHeading eyebrow="Class operations" title="More learning tools" />
      <View style={styles.libraryStack}>
        <ResourceButton title="Grading queue" copy="Quick grade, redo, and concise feedback" icon={<ClipboardCheck color={c.text.body} size={20} />} onPress={() => router.push('/staff/grading')} />
        <ResourceButton title="Class recordings" copy="Review cohort media on your phone" icon={<Film color={c.text.body} size={20} />} onPress={() => router.push('/recordings' as Href)} />
        <ResourceButton title="Class resources" copy="Open shared links and references" icon={<FolderOpen color={c.text.body} size={20} />} onPress={() => router.push('/resources')} />
        <ResourceButton title="Full web studio" copy="Use desktop tools for operations not yet native" icon={<ExternalLink color={c.text.body} size={20} />} onPress={() => void openAuthenticatedWebPage(api, '/admin/content').catch((error) => Alert.alert('Could not open curriculum tools', (error as Error).message))} />
      </View>
    </> : !student?.enrolled ? <LearningCard><Text style={styles.staffTitle}>No active curriculum</Text><Text style={styles.staffCopy}>An active cohort enrollment is required before lessons can appear.</Text></LearningCard> : <>
      <View style={styles.search}><Search color={c.text.muted} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search lessons" value={filter} onChangeText={setFilter} placeholder="Find a module or lesson" placeholderTextColor={c.text.body} style={styles.input} /></View>
      {search ? <>
        <SectionHeading eyebrow={`${matches.length} ${matches.length === 1 ? 'lesson' : 'lessons'}`} title="Search results" />
        <View style={styles.stack}>{matches.map(({ module, lesson }) => {
          const locked = !lesson.available;
          const status = learnerLessonStatus({ completed: lesson.completed, available: lesson.available, submissionsClosed: lesson.submission_window?.submissions_closed, reviewStatus: lesson.review_status, partial: lesson.completed_blocks > 0 });
          return <LearningCard key={lesson.id} label={locked ? `${lesson.title} is locked` : `Open ${lesson.title}`} onPress={locked ? undefined : () => router.push({ pathname: '/lesson/[id]', params: { id: String(lesson.id), cohort_id: String(selectedCohortId) } })}>
            <View style={styles.moduleTop}><View style={styles.flex}><Text style={styles.moduleType}>{module.name}</Text><Text style={styles.moduleName}>{lesson.title}</Text><Text style={styles.moduleMeta}>{locked ? lesson.unlock_date ? `Opens ${formatCourseDate(lesson.unlock_date, { weekday: true })}` : 'Locked' : 'Available to open'}</Text></View><StatusBadge status={status} short /></View>
          </LearningCard>;
        })}</View>
        {!matches.length && <Text style={styles.noResults}>No lessons match that search.</Text>}
      </> : <>
      <SectionHeading eyebrow={`${modules.length} ${modules.length === 1 ? 'module' : 'modules'}`} title="Learning path" />
      <View style={styles.stack}>{modules.map((module) => {
        const locked = !module.available && !module.unlocked;
        return <LearningCard key={module.id} onPress={locked ? undefined : () => router.push({ pathname: '/module/[id]', params: { id: String(module.id), cohort_id: String(selectedCohortId) } })} label={locked ? `${module.name} is locked` : `Open ${module.name}`}><View style={styles.moduleTop}><View style={[styles.moduleIcon, locked && styles.moduleIconLocked]}>{locked ? <Lock color={c.text.muted} size={20} /> : <BookMarked color={c.text.body} size={20} />}</View><View style={styles.flex}><Text style={styles.moduleType}>{module.module_type}</Text><Text style={styles.moduleName}>{module.name}</Text><Text style={styles.moduleMeta}>{module.completed_blocks} of {module.total_blocks} learning steps · {module.lessons.length} lessons</Text></View><StatusPill completed={module.progress_percentage === 100} locked={locked} label={module.progress_percentage === 100 ? 'Complete' : locked ? 'Locked' : `${Math.round(module.progress_percentage)}%`} /></View><View style={styles.progress}><ProgressBar value={module.progress_percentage} label={`${module.name} progress`} /></View></LearningCard>;
      })}</View>
      {!modules.length && <Text style={styles.noResults}>No modules are assigned yet.</Text>}
      </>}
      <View style={styles.libraryStack}>
        {!isAlumniOnly && <ResourceButton title="Class recordings" copy="Secure playback, resume, and watch progress" icon={<Film color={c.text.body} size={20} />} onPress={() => router.push('/recordings' as Href)} />}
        <ResourceButton title="Class resources" copy="References, starter files, and useful links" icon={<FolderOpen color={c.text.body} size={20} />} onPress={() => router.push('/resources')} />
      </View>
    </>}
  </ScrollView></SafeAreaView>;
}

function ResourceButton({ title, copy, icon, onPress }: { title: string; copy: string; icon: ReactNode; onPress: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={styles.resourceButton}><View style={styles.resourceIcon}>{icon}</View><View style={styles.flex}><Text style={styles.resourceTitle}>{title}</Text><Text style={styles.resourceCopy}>{copy}</Text></View><ArrowRight color={c.text.body} size={19} /></Pressable>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, content: { padding: 20, paddingBottom: 120, gap: 15 }, eyebrow: { ...typography.label, color: c.text.body, fontFamily: fonts.bold, letterSpacing: 1.8, marginTop: 8 }, title: { ...typography.display, color: c.text.strong, fontFamily: fonts.extraBold, letterSpacing: -1.2, marginTop: -9 }, subtitle: { ...typography.support, color: c.text.body, fontFamily: fonts.regular, marginTop: -10, marginBottom: 4 },
  search: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, stack: { gap: 10 },
  moduleTop: { flexDirection: 'row', alignItems: 'center', gap: 11 }, moduleIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, moduleIconLocked: { backgroundColor: c.surface.sunken }, flex: { flex: 1, minWidth: 0 }, moduleType: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' }, moduleName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15, marginTop: 2 }, moduleMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }, progress: { marginTop: 14 }, noResults: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', paddingVertical: 25 },
  resourceButton: { minHeight: 72, borderRadius: 19, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 6 }, resourceIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, resourceTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, resourceCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }, libraryStack: { gap: 4 }, staffTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 15 }, staffCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, marginTop: 6 },
  partialWarning: { minHeight: 58, borderRadius: 16, borderWidth: 1, borderColor: c.status.warning.border, backgroundColor: c.status.warning.bg, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, partialWarningText: { flex: 1, color: c.status.warning.fg, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
}));
