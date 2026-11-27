import { PausedLearningCard } from '@/components/paused-learning-card';
import { SearchHeaderButton } from '@/components/search-header-button';
import { themedAlert as Alert } from '@/lib/alerts';
import { brand } from '../../../lib/brand';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { AlertTriangle, ArrowRight, BookMarked, BookOpen, ChevronDown, ChevronRight, ClipboardCheck, ExternalLink, Film, FolderOpen, Lock, Mail, Play, RefreshCw, Search } from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, SectionHeading, StatusBadge, StatusPill } from '@/components/learning-ui';
import { CohortSwitcher } from '@/components/cohort-switcher';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { StaffCurriculumLibrary } from '@/components/staff-curriculum';
import { fontScaleLimits, fonts, tabularNums, typography } from '@/constants/csg-theme';
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

type OutlineFilter = 'all' | 'todo' | 'redo';

export default function LearnScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user, enrollments } = useSession();
  const { selectedCohortId, selectedCohort, loading: cohortLoading, error: cohortError, stale: cohortStale, refresh } = useCohort();
  const [filter, setFilter] = useState('');
  const [outlineFilterState, setOutlineFilterState] = useState<{ cohortId: number | null; filter: OutlineFilter }>({ cohortId: selectedCohortId, filter: 'all' });
  const outlineFilter: OutlineFilter = outlineFilterState.cohortId === selectedCohortId ? outlineFilterState.filter : 'all';
  const setOutlineFilter = (next: OutlineFilter) => setOutlineFilterState({ cohortId: selectedCohortId, filter: next });
  const [toggledGroups, setToggledGroups] = useState<Record<string, boolean>>({});
  const isStaff = Boolean(user?.is_staff);
  const alumniCohort = selectedCohort ? selectedCohort.cohort_type === 'alumni' : isAlumniOnlyEnrollment(enrollments);
  const studentQuery = useQuery({
    queryKey: learningKeys.dashboard(user?.id || 0, selectedCohortId),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ dashboard: demoDashboard }) : api.dashboard(signal, selectedCohortId),
    enabled: Boolean(user && !isStaff && !cohortLoading && selectedCohortId != null),
  });
  const outlineQuery = useQuery({
    queryKey: learningKeys.courseOutline(user?.id || 0, selectedCohortId),
    queryFn: ({ signal }) => api.courseOutline(selectedCohortId, signal),
    enabled: Boolean(user && !isStaff && !auth.demo && !cohortLoading && selectedCohortId != null && !alumniCohort && typeof api.courseOutline === 'function'),
    retry: false,
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
  const outline = !isAlumniOnly ? outlineQuery.data?.outline ?? null : null;
  const modules = useMemo(() => [...(student?.modules || [])].filter((module) => module.lessons.length > 0).sort((a, b) => (a.position || 0) - (b.position || 0)), [student?.modules]);
  const search = filter.trim().toLowerCase();
  const matches = modules.flatMap((module) => module.lessons
    .filter((lesson) => `${module.name} ${lesson.title}`.toLowerCase().includes(search))
    .map((lesson) => ({ module, lesson })));
  const activeQuery = isStaff ? curriculumQuery : studentQuery;

  const openLesson = (lessonId: number, blockId?: number | null) => {
    router.push({
      pathname: '/lesson/[id]',
      params: {
        id: String(lessonId),
        cohort_id: String(selectedCohortId),
        ...(blockId ? { block_id: String(blockId) } : {}),
      },
    });
  };

  const filteredOutlineModules = useMemo(() => {
    if (!outline) return [];
    return outline.modules
      .map((mod) => ({
        ...mod,
        groups: mod.groups
          .map((group) => ({
            ...group,
            lessons: group.lessons.filter((lesson) => {
              if (outlineFilter === 'todo') return lesson.todo;
              if (outlineFilter === 'redo') return lesson.status === 'redo';
              return true;
            }),
          }))
          .filter((group) => group.lessons.length > 0),
      }))
      .filter((mod) => mod.groups.length > 0);
  }, [outline, outlineFilter]);

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
  if ((!isStaff && cohortLoading) || (activeQuery.isPending && !activeQuery.data)) return <SafeAreaView style={styles.safe}><LoadingState variant="skeleton" label={isStaff ? 'Loading curriculum library' : 'Loading learning path'} /></SafeAreaView>;
  if (activeQuery.error && !activeQuery.data) return <SafeAreaView style={styles.safe}><ErrorState message={(activeQuery.error as Error).message} retry={() => void activeQuery.refetch()} /></SafeAreaView>;

  const handleRefresh = () => {
    const tasks: Promise<unknown>[] = [refresh(), activeQuery.refetch()];
    if (!isStaff && !auth.demo && !isAlumniOnly && typeof api.courseOutline === 'function') tasks.push(outlineQuery.refetch());
    void Promise.all(tasks);
  };

  return <SafeAreaView edges={['top']} style={styles.safe}><ScrollView refreshControl={<RefreshControl refreshing={activeQuery.isRefetching || outlineQuery.isRefetching} onRefresh={handleRefresh} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
    <View style={styles.topRow}><CohortSwitcher compact /><SearchHeaderButton inline /></View>
    <View style={styles.heroBlock}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.title}>Learn</Text>
      <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.subtitle}>{isStaff ? 'Review what students see, wherever you are' : outline?.course_title || student?.cohort?.name || 'Lessons, resources, and progress'}</Text>
    </View>
    <PausedLearningCard cohortId={selectedCohortId} />
    {!isStaff && outline?.next_lesson && (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Continue: ${outline.next_lesson.title}`}
        onPress={() => openLesson(outline.next_lesson!.id, outline.next_lesson!.redo_block_id)}
        style={styles.continueCard}
      >
        <View style={styles.continueIcon}>
          <Play color={c.text.onAction} size={16} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.continueKicker}>
            {outline.next_lesson.status === 'redo' ? 'Needs redo' : `Lesson ${outline.next_lesson.number}`}
            {outline.counts ? ` · ${outline.counts.completed_lessons} of ${outline.counts.total_lessons} done` : ''}
          </Text>
          <Text numberOfLines={2} style={styles.continueTitle}>{outline.next_lesson.title}</Text>
        </View>
        <ArrowRight color={c.selection.indicator} size={18} />
      </Pressable>
    )}
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
          return <LearningCard key={lesson.id} label={locked ? `${lesson.title} is locked` : `Open ${lesson.title}`} onPress={locked ? undefined : () => openLesson(lesson.id)}>
            <View style={styles.moduleTop}><View style={styles.flex}><Text style={styles.moduleType}>{module.name}</Text><Text style={styles.moduleName}>{lesson.title}</Text><Text style={styles.moduleMeta}>{locked ? lesson.unlock_date ? `Opens ${formatCourseDate(lesson.unlock_date, { weekday: true })}` : 'Locked' : 'Available to open'}</Text></View>{!isAlumniOnly && <StatusBadge status={status} short />}</View>
          </LearningCard>;
        })}</View>
        {!matches.length && <Text style={styles.noResults}>No lessons match that search.</Text>}
      </> : outline && outline.modules.length > 0 ? <>
        {outline.mode !== 'library' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterStrip} contentContainerStyle={styles.filterRow} keyboardShouldPersistTaps="handled">
            {([
              { key: 'all', label: `All (${outline.lesson_count})` },
              { key: 'todo', label: `To do (${outline.filters.todo})` },
              ...(outline.filters.redo > 0 || outlineFilter === 'redo' ? [{ key: 'redo' as const, label: `Needs redo (${outline.filters.redo})` }] : []),
            ] as const).map((option) => {
              const active = outlineFilter === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  haptic="selection"
                  onPress={() => setOutlineFilter(option.key)}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <SectionHeading
          eyebrow={outline.course_week ? `Week ${outline.course_week.current} of ${outline.course_week.total}` : `${outline.modules.length} ${outline.modules.length === 1 ? 'module' : 'modules'}`}
          title="Course outline"
        />
        {filteredOutlineModules.length === 0 ? (
          <Text style={styles.noResults}>
            {outlineFilter === 'redo' ? 'No lessons need a redo right now.' : 'Nothing left to do right now.'}
          </Text>
        ) : (
          <View style={styles.stack}>
            {filteredOutlineModules.map((mod) => (
              <View key={mod.id} style={styles.outlineModule}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${mod.name}`}
                  onPress={() => router.push({ pathname: '/module/[id]', params: { id: String(mod.id), cohort_id: String(selectedCohortId) } })}
                  style={styles.outlineModuleHeader}
                >
                  <View style={styles.flex}>
                    <Text style={styles.outlineModuleTitle}>{mod.name}</Text>
                    {mod.counts && (
                      <Text style={styles.outlineModuleMeta}>
                        {mod.counts.completed_lessons} of {mod.counts.total_lessons} lessons done
                      </Text>
                    )}
                  </View>
                  <ChevronRight color={c.text.muted} size={18} />
                </Pressable>
                {mod.groups.map((group) => {
                  const groupStateKey = `${selectedCohortId ?? 'none'}:${group.key}`;
                  const defaultOpen = outlineFilter !== 'all' || group.current || group.this_week || mod.groups.length === 1;
                  const isOpen = toggledGroups[groupStateKey] ?? defaultOpen;
                  return (
                    <Card key={groupStateKey} style={styles.groupCard}>
                      {group.label && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ expanded: isOpen }}
                          haptic="selection"
                          onPress={() => setToggledGroups((prev) => ({ ...prev, [groupStateKey]: !isOpen }))}
                          style={styles.groupHeader}
                        >
                          <View style={styles.flex}>
                            <Text style={styles.groupTitle}>
                              {group.label}
                              {group.this_week ? ' · This week' : ''}
                            </Text>
                            {group.counts && (
                              <Text style={styles.groupMeta}>
                                {group.counts.completed_lessons}/{group.counts.total_lessons} complete
                              </Text>
                            )}
                          </View>
                          {isOpen ? <ChevronDown color={c.text.muted} size={18} /> : <ChevronRight color={c.text.muted} size={18} />}
                        </Pressable>
                      )}
                      {isOpen && group.lessons.map((lesson, idx) => {
                        const locked = !lesson.available;
                        return (
                          <Pressable
                            key={lesson.id}
                            accessibilityRole="button"
                            accessibilityLabel={locked ? `${lesson.title} is locked` : `Open ${lesson.title}`}
                            disabled={locked}
                            onPress={locked ? undefined : () => openLesson(lesson.id, lesson.redo_block_id)}
                            style={[styles.outlineRow, (idx > 0 || Boolean(group.label)) && styles.outlineRowDivider]}
                          >
                            <Text style={styles.lessonNum}>{lesson.number}</Text>
                            <View style={styles.flex}>
                              <Text numberOfLines={2} style={[styles.outlineLessonTitle, locked && styles.lockedTitle]}>{lesson.title}</Text>
                              {locked && lesson.opens_on ? (
                                <Text style={styles.outlineLessonMeta}>Opens {formatCourseDate(lesson.opens_on, { weekday: true })}</Text>
                              ) : lesson.due_on ? (
                                <Text style={styles.outlineLessonMeta}>Due {formatCourseDate(lesson.due_on, { weekday: true })}</Text>
                              ) : null}
                            </View>
                            <StatusBadge status={lesson.status} short />
                          </Pressable>
                        );
                      })}
                    </Card>
                  );
                })}
              </View>
            ))}
          </View>
        )}
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
  continueCard: {
    minHeight: 68,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: c.selection.indicator,
    backgroundColor: c.selection.bg,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...shadow.raised,
  },
  continueIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.control,
    backgroundColor: c.action.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueKicker: { ...tabularNums, color: c.selection.indicator, fontFamily: fonts.bold, fontSize: 12 },
  continueTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, marginTop: 2 },
  filterStrip: { flexGrow: 0, flexShrink: 0 },
  filterRow: { gap: 8, paddingRight: 16, alignItems: 'center' },
  filterPill: {
    minHeight: 44,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.raised,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  filterPillActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg },
  filterPillText: { ...tabularNums, color: c.text.body, fontFamily: fonts.semibold, fontSize: 13 },
  filterPillTextActive: { color: c.text.strong, fontFamily: fonts.bold },
  outlineModule: { gap: 8 },
  outlineModuleHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  outlineModuleTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16 },
  outlineModuleMeta: { ...tabularNums, color: c.text.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  groupCard: { padding: 0, gap: 0, overflow: 'hidden' },
  groupHeader: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface.sunken },
  groupTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 },
  groupMeta: { ...tabularNums, color: c.text.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 1 },
  outlineRow: { minHeight: 54, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  outlineRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle },
  lockedTitle: { color: c.text.body },
  lessonNum: { ...tabularNums, width: 24, color: c.text.muted, fontFamily: fonts.bold, fontSize: 12, textAlign: 'center' },
  outlineLessonTitle: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  outlineLessonMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
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
