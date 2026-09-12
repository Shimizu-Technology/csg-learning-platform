import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { ArrowRight, BookMarked, ClipboardCheck, ExternalLink, Film, FolderOpen, Lock, Search } from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, SectionHeading, StatusPill } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { StaffCurriculumLibrary } from '@/components/staff-curriculum';
import { fontScaleLimits, fonts, palette, typography } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { demoStaffCurriculum } from '@/lib/demo-staff';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { isStudentDashboard, learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function LearnScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const [filter, setFilter] = useState('');
  const isStaff = Boolean(user?.is_staff);
  const studentQuery = useQuery({
    queryKey: learningKeys.dashboard(user?.id || 0),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ dashboard: demoDashboard }) : api.dashboard(signal),
    enabled: Boolean(user && !isStaff),
  });
  const curriculumQuery = useQuery({
    queryKey: learningKeys.curricula(user?.id || 0),
    queryFn: async ({ signal }) => {
      if (auth.demo) return { curricula: [demoStaffCurriculum] };
      const summaries = await api.curricula(signal);
      const curricula = await Promise.all(summaries.curricula.map(async (curriculum) => (await api.curriculum(curriculum.id, signal)).curriculum));
      return { curricula };
    },
    enabled: Boolean(user && isStaff),
  });
  const dashboard = studentQuery.data?.dashboard;
  const student = dashboard && isStudentDashboard(dashboard) ? dashboard : null;
  const modules = useMemo(() => (student?.modules || [])
    .filter((module) => `${module.name} ${module.lessons.map((lesson) => lesson.title).join(' ')}`.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => (a.position || 0) - (b.position || 0)), [filter, student?.modules]);
  const activeQuery = isStaff ? curriculumQuery : studentQuery;

  if (activeQuery.isPending && !activeQuery.data) return <SafeAreaView style={styles.safe}><LoadingState label={isStaff ? 'Loading curriculum library' : 'Loading learning path'} /></SafeAreaView>;
  if (activeQuery.error && !activeQuery.data) return <SafeAreaView style={styles.safe}><ErrorState message={(activeQuery.error as Error).message} retry={() => void activeQuery.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}><ScrollView refreshControl={<RefreshControl refreshing={activeQuery.isRefetching} onRefresh={() => void activeQuery.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
    <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>{isStaff ? 'CURRICULUM STUDIO' : 'YOUR CURRICULUM'}</Text>
    <Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.title}>Learn</Text>
    <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.subtitle}>{isStaff ? 'Review what students see, wherever you are' : student?.cohort?.name || 'Lessons, resources, and progress'}</Text>
    {isStaff ? <>
      <StaffCurriculumLibrary curricula={curriculumQuery.data?.curricula || []} filter={filter} onFilterChange={setFilter} onOpenCurriculum={(id) => router.push(`/staff/curriculum/${id}` as Href)} onOpenLesson={(id) => router.push(`/lesson/${id}`)} />
      <SectionHeading eyebrow="Class operations" title="More learning tools" />
      <View style={styles.libraryStack}>
        <ResourceButton title="Grading queue" copy="Quick grade, redo, and concise feedback" icon={<ClipboardCheck color={palette.rubySoft} size={20} />} onPress={() => router.push('/staff/grading')} />
        <ResourceButton title="Class recordings" copy="Review cohort media on your phone" icon={<Film color={palette.rubySoft} size={20} />} onPress={() => router.push('/recordings' as Href)} />
        <ResourceButton title="Class resources" copy="Open shared links and references" icon={<FolderOpen color={palette.rubySoft} size={20} />} onPress={() => router.push('/resources')} />
        <ResourceButton title="Full web studio" copy="Use desktop tools for operations not yet native" icon={<ExternalLink color={palette.rubySoft} size={20} />} onPress={() => void openAuthenticatedWebPage(api, '/admin/content').catch((error) => Alert.alert('Could not open curriculum tools', (error as Error).message))} />
      </View>
    </> : !student?.enrolled ? <LearningCard><Text style={styles.staffTitle}>No active curriculum</Text><Text style={styles.staffCopy}>An active cohort enrollment is required before lessons can appear.</Text></LearningCard> : <>
      <View style={styles.search}><Search color={palette.quiet} size={18} /><TextInput accessibilityLabel="Search lessons" value={filter} onChangeText={setFilter} placeholder="Find a module or lesson" placeholderTextColor={palette.quiet} style={styles.input} /></View>
      <SectionHeading eyebrow={`${modules.length} ${modules.length === 1 ? 'module' : 'modules'}`} title="Learning path" />
      <View style={styles.stack}>{modules.map((module) => {
        const locked = !module.available && !module.unlocked;
        return <LearningCard key={module.id} onPress={locked ? undefined : () => router.push(`/module/${module.id}`)} label={locked ? `${module.name} is locked` : `Open ${module.name}`}><View style={styles.moduleTop}><View style={[styles.moduleIcon, locked && styles.moduleIconLocked]}>{locked ? <Lock color={palette.quiet} size={20} /> : <BookMarked color={palette.rubySoft} size={20} />}</View><View style={styles.flex}><Text style={styles.moduleType}>{module.module_type}</Text><Text style={styles.moduleName}>{module.name}</Text><Text style={styles.moduleMeta}>{module.completed_blocks} of {module.total_blocks} learning steps · {module.lessons.length} lessons</Text></View><StatusPill completed={module.progress_percentage === 100} locked={locked} label={module.progress_percentage === 100 ? 'Complete' : locked ? 'Locked' : `${Math.round(module.progress_percentage)}%`} /></View><View style={styles.progress}><ProgressBar value={module.progress_percentage} label={`${module.name} progress`} /></View></LearningCard>;
      })}</View>
      {!modules.length && <Text style={styles.noResults}>No lessons match that search.</Text>}
      <View style={styles.libraryStack}>
        <ResourceButton title="Class recordings" copy="Secure playback, resume, and watch progress" icon={<Film color={palette.rubySoft} size={20} />} onPress={() => router.push('/recordings' as Href)} />
        <ResourceButton title="Class resources" copy="References, starter files, and useful links" icon={<FolderOpen color={palette.rubySoft} size={20} />} onPress={() => router.push('/resources')} />
      </View>
    </>}
  </ScrollView></SafeAreaView>;
}

function ResourceButton({ title, copy, icon, onPress }: { title: string; copy: string; icon: ReactNode; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={styles.resourceButton}><View style={styles.resourceIcon}>{icon}</View><View style={styles.flex}><Text style={styles.resourceTitle}>{title}</Text><Text style={styles.resourceCopy}>{copy}</Text></View><ArrowRight color={palette.muted} size={19} /></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, content: { padding: 20, paddingBottom: 120, gap: 15 }, eyebrow: { ...typography.label, color: palette.rubySoft, fontFamily: fonts.bold, letterSpacing: 1.8, marginTop: 8 }, title: { ...typography.display, color: palette.text, fontFamily: fonts.extraBold, letterSpacing: -1.2, marginTop: -9 }, subtitle: { ...typography.support, color: palette.muted, fontFamily: fonts.regular, marginTop: -10, marginBottom: 4 },
  search: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, stack: { gap: 10 },
  moduleTop: { flexDirection: 'row', alignItems: 'center', gap: 11 }, moduleIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, moduleIconLocked: { backgroundColor: '#232833' }, flex: { flex: 1, minWidth: 0 }, moduleType: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }, moduleName: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, marginTop: 2 }, moduleMeta: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 3 }, progress: { marginTop: 14 }, noResults: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', paddingVertical: 25 },
  resourceButton: { minHeight: 72, borderRadius: 19, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 6 }, resourceIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, resourceTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 }, resourceCopy: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 3 }, libraryStack: { gap: 4 }, staffTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 15 }, staffCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, marginTop: 6 },
});
