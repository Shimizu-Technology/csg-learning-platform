import { PausedLearningCard } from '@/components/paused-learning-card';
import { SearchHeaderButton } from '@/components/search-header-button';
import { themedAlert as Alert } from '@/lib/alerts';
import { brand } from '../../../lib/brand';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { AlertTriangle, ArrowRight, BookMarked, BookOpen, ClipboardCheck, ExternalLink, Film, FolderOpen, Lock, Mail, RefreshCw, Search } from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, SectionHeading, StatusBadge, StatusPill } from '@/components/learning-ui';
import { CohortSwitcher } from '@/components/cohort-switcher';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { StaffCurriculumLibrary } from '@/components/staff-curriculum';
import { fontScaleLimits, fonts, typography } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { demoStaffCurriculum } from '@/lib/demo-staff';
import { learnerModuleTypeLabel, loadStaffCurriculumDetails } from '@/lib/curriculum';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { isAlumniOnlyEnrollment } from '@/lib/enrollments';
import { lessonStatus } from '@/lib/learning-status';
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
  const { selectedCohortId, selectedCohort, loading: cohortLoading, error: cohortError, stale: cohortStale, refresh } = useCohort();
  const [filter, setFilter] = useState('');
  const isStaff = Boolean(user?.is_staff);
  const alumniCohort = selectedCohort ? selectedCohort.cohort_type === 'alumni' : isAlumniOnlyEnrollment(enrollments);
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
  const isAlumniOnly = (alumniCohort || student?.cohort?.cohort_type === 'alumni') && !student?.personal_plan;
  const modules = useMemo(() => [...(student?.modules || [])].filter((module) => module.lessons.length > 0).sort((a, b) => (a.position || 0) - (b.position || 0)), [student?.modules]);
  const search = filter.trim().toLowerCase();
  const matches = modules.flatMap((module) => module.lessons
    .filter((lesson) => `${module.name} ${lesson.title}`.toLowerCase().includes(search))
    .map((lesson) => ({ module, lesson })));
  const activeQuery = isStaff ? curriculumQuery : studentQuery;

  if (!isStaff && !cohortLoading && cohortError && !cohortStale) return <SafeAreaView style={styles.safe}><ErrorState message={cohortError} retry={() => void refresh()} /></SafeAreaView>;
  if (!isStaff && !cohortLoading && selectedCohortId == null) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.title}>Learn</Text>
          <LearningCard>
            <View style={styles.emptyHeader}><BookOpen color={c.text.body} size={22} /><Text style={styles.staffTitle}>No course yet</Text></View>
            <Text style={styles.staffCopy}>Open Today to check a pending enrollment, or contact {brand.schoolName} for help getting started.</Text>
            <View style={styles.emptyActions}>
              <Button label="Go to Today" onPress={() => router.navigate('/(tabs)' as Href)} />
              <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.supportButton}>
                <RefreshCw color={c.text.strong} size={17} />
                <Text style={styles.supportButtonText}>Refresh status</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(`mailto:${brand.supportEmail}?subject=${encodeURIComponent(`${brand.productName} enrollment help`)}`).catch(() => Alert.alert('Contact support', `Email ${brand.supportEmail} for help.`))} style={styles.supportButton}>
                <Mail color={c.text.strong} size={17} />
                <Text style={styles.supportButtonText}>Contact support ({brand.supportEmail})</Text>
              </Pressable>
            </View>
          </LearningCard>
        </ScrollView>
      </SafeAreaView>
    );
  }
  if ((!isStaff && cohortLoading) || (activeQuery.isPending && !activeQuery.data)) return <SafeAreaView style={styles.safe}><LoadingState label={isStaff ? 'Loading curriculum library' : 'Loading learning path'} /></SafeAreaView>;
  if (activeQuery.error && !activeQuery.data) return <SafeAreaView style={styles.safe}><ErrorState message={(activeQuery.error as Error).message} retry={() => void activeQuery.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}><ScrollView refreshControl={<RefreshControl refreshing={activeQuery.isRefetching} onRefresh={() => void Promise.all([refresh(), activeQuery.refetch()])} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
    <View style={styles.topRow}><CohortSwitcher compact /><SearchHeaderButton inline /></View>
    <View style={styles.heroBlock}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.title}>Learn</Text>
      <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.subtitle}>{isStaff ? 'Review what students see, wherever you are' : student?.cohort?.name || 'Lessons, resources, and progress'}</Text>
    </View>
    <PausedLearningCard cohortId={selectedCohortId} />
    {student?.student_today && Boolean(selectedCohortId) && !isAlumniOnly && <ResourceButton title="My work" copy="See your submissions and instructor feedback" icon={<BookMarked color={c.text.body} size={20} />} onPress={() => router.push(`/my-work?cohort_id=${selectedCohortId}` as Href)} />}
    {isStaff ? <>
      {Boolean(curriculumQuery.data?.failedCount) && <View accessibilityRole="alert" style={styles.partialWarning}><AlertTriangle color={c.status.warning.fg} size={19} /><Text style={styles.partialWarningText}>Some curricula could not be refreshed. Everything that loaded is still available below.</Text></View>}
      <StaffCurriculumLibrary curricula={curriculumQuery.data?.curricula || []} filter={filter} onFilterChange={setFilter} onOpenCurriculum={(id) => router.push(`/staff/curriculum/${id}` as Href)} onOpenLesson={(id) => router.push(`/lesson/${id}`)} />
      <SectionHeading eyebrow="Class operations" title="More learning tools" />
      <View style={styles.libraryStack}>
        <ResourceButton title="Grading queue" copy="Quick grade, redo, and concise feedback" icon={<ClipboardCheck color={c.text.body} size={20} />} onPress={() => router.push('/staff/grading')} />
        <ResourceButton title="Class recordings" copy="Review cohort media on your phone" icon={<Film color={c.text.body} size={20} />} onPress={() => router.push('/recordings' as Href)} />
        <ResourceButton title="Class resources" copy="Open shared links and references" icon={<FolderOpen color={c.text.body} size={20} />} onPress={() => router.push('/resources')} />
        <ResourceButton title="Content on the web" copy="Use desktop tools for operations not yet native" icon={<ExternalLink color={c.text.body} size={20} />} onPress={() => void openAuthenticatedWebPage(api, '/admin/content').catch((error) => Alert.alert('Could not open curriculum tools', (error as Error).message))} />
      </View>
    </> : !student?.enrolled ? <LearningCard><Text style={styles.staffTitle}>No active curriculum</Text><Text style={styles.staffCopy}>An active cohort enrollment is required before lessons can appear.</Text></LearningCard> : <>
      <View style={styles.search}><Search color={c.text.muted} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search lessons" value={filter} onChangeText={setFilter} placeholder="Find a module or lesson" placeholderTextColor={c.text.body} style={styles.input} /></View>
      {search ? <>
        <SectionHeading eyebrow={`${matches.length} ${matches.length === 1 ? 'lesson' : 'lessons'}`} title="Search results" />
        <View style={styles.stack}>{matches.map(({ module, lesson }) => {
          const locked = !lesson.available;
          const status = lessonStatus(lesson);
          return <LearningCard key={lesson.id} label={locked ? `${lesson.title} is locked` : `Open ${lesson.title}`} onPress={locked ? undefined : () => router.push({ pathname: '/lesson/[id]', params: { id: String(lesson.id), cohort_id: String(selectedCohortId) } })}>
            <View style={styles.moduleTop}><View style={styles.flex}><Text style={styles.moduleType}>{module.name}</Text><Text style={styles.moduleName}>{lesson.title}</Text><Text style={styles.moduleMeta}>{locked ? lesson.unlock_date ? `Opens ${formatCourseDate(lesson.unlock_date, { weekday: true })}` : 'Locked' : 'Available to open'}</Text></View>{!isAlumniOnly && <StatusBadge status={status} short />}</View>
          </LearningCard>;
        })}</View>
        {!matches.length && <Text style={styles.noResults}>No lessons match that search.</Text>}
      </> : <>
      <SectionHeading eyebrow={`${modules.length} ${modules.length === 1 ? 'module' : 'modules'}`} title={isAlumniOnly ? "Alumni library" : "Learning path"} />
      <View style={styles.stack}>{modules.map((module) => {
        const locked = !module.available && !module.unlocked;
        return <LearningCard key={module.id} onPress={locked ? undefined : () => router.push({ pathname: '/module/[id]', params: { id: String(module.id), cohort_id: String(selectedCohortId) } })} label={locked ? `${module.name} is locked` : `Open ${module.name}`}><View style={styles.moduleTop}><View style={[styles.moduleIcon, locked && styles.moduleIconLocked]}>{locked ? <Lock color={c.text.muted} size={20} /> : <BookMarked color={c.text.body} size={20} />}</View><View style={styles.flex}><Text style={styles.moduleType}>{learnerModuleTypeLabel(module.module_type)}</Text><Text style={styles.moduleName}>{module.name}</Text>{!isAlumniOnly && <Text style={styles.moduleMeta}>{module.lessons.filter((lesson) => lesson.completed).length} of {module.lessons.length} lessons</Text>}</View>{!isAlumniOnly && <StatusPill completed={module.progress_percentage === 100} locked={locked} label={module.progress_percentage === 100 ? 'Complete' : locked ? 'Locked' : `${Math.round(module.progress_percentage)}%`} />}</View>{!isAlumniOnly && <View style={styles.progress}><ProgressBar value={module.progress_percentage} label={`${module.name} progress`} /></View>}</LearningCard>;
      })}</View>
      {!modules.length && <Text style={styles.noResults}>{student.enrollment_status === 'paused' ? 'Only content from before your pause is shown here. Newer content opens when your enrollment resumes.' : 'No modules are assigned yet.'}</Text>}
      </>}
      <View style={styles.libraryStack}>
        {selectedCohort?.features?.recordings !== false && !isAlumniOnly && <ResourceButton title="Class recordings" copy="Secure playback, resume, and watch progress" icon={<Film color={c.text.body} size={20} />} onPress={() => router.push('/recordings' as Href)} />}
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

const useStyles = makeStyles(({ colors: c, radius, shadow }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  content: { padding: 16, paddingBottom: 108, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroBlock: { gap: 3, marginTop: 2 },
  title: { ...typography.display, color: c.text.strong, fontFamily: fonts.extraBold, letterSpacing: -0.9 },
  subtitle: { ...typography.support, color: c.text.body, fontFamily: fonts.regular },
  search: { minHeight: 48, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 11 },
  stack: { gap: 10 },
  moduleTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  moduleIcon: { width: 42, height: 42, borderRadius: radius.control, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  moduleIconLocked: { backgroundColor: c.surface.sunken },
  flex: { flex: 1, minWidth: 0 },
  moduleType: { color: c.text.muted, fontFamily: fonts.semibold, fontSize: 12 },
  moduleName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, marginTop: 1 },
  moduleMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  progress: { marginTop: 12 },
  noResults: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', paddingVertical: 25 },
  resourceButton: { minHeight: 68, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, ...shadow.raised },
  resourceIcon: { width: 40, height: 40, borderRadius: radius.control, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  resourceTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15 },
  resourceCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  libraryStack: { gap: 6 },
  staffTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 4 },
  staffCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 4 },
  partialWarning: { minHeight: 54, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.status.warning.border, backgroundColor: c.status.warning.bg, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  partialWarningText: { flex: 1, color: c.status.warning.fg, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
  emptyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyActions: { gap: 10, marginTop: 14 },
  supportButton: { minHeight: 48, borderRadius: radius.control, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.raised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  supportButtonText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 },
}));
