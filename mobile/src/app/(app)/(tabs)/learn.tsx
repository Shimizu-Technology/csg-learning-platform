import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { ArrowRight, BookMarked, ClipboardCheck, ExternalLink, Film, FolderOpen, Lock, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, SectionHeading, StatusPill } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { demoStaffDashboard } from '@/lib/demo-staff';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { isStudentDashboard, learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function LearnScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const [filter, setFilter] = useState('');
  const query = useQuery({ queryKey: learningKeys.dashboard(user?.id || 0), queryFn: ({ signal }) => auth.demo ? Promise.resolve({ dashboard: user?.is_staff ? demoStaffDashboard : demoDashboard }) : api.dashboard(signal), enabled: Boolean(user) });
  const dashboard = query.data?.dashboard;
  const student = dashboard && isStudentDashboard(dashboard) ? dashboard : null;
  const modules = useMemo(() => (student?.modules || []).filter((module) => `${module.name} ${module.lessons.map((lesson) => lesson.title).join(' ')}`.toLowerCase().includes(filter.trim().toLowerCase())).sort((a, b) => (a.position || 0) - (b.position || 0)), [filter, student?.modules]);

  if (query.isPending && !dashboard) return <SafeAreaView style={styles.safe}><LoadingState label="Loading learning path" /></SafeAreaView>;
  if (query.error && !dashboard) return <SafeAreaView style={styles.safe}><ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}><ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>YOUR CURRICULUM</Text><Text style={styles.title}>Learn</Text><Text style={styles.subtitle}>{student?.cohort?.name || 'Lessons, resources, and progress'}</Text>
    {student && <View style={styles.search}><Search color={palette.quiet} size={18} /><TextInput accessibilityLabel="Search lessons" value={filter} onChangeText={setFilter} placeholder="Find a module or lesson" placeholderTextColor={palette.quiet} style={styles.input} /></View>}
    {!student ? <><LearningCard><BookMarked color={palette.rubySoft} size={25} /><Text style={styles.staffTitle}>Learning operations</Text><Text style={styles.staffCopy}>Review urgent student work, open class media, and hand off desktop-shaped curriculum administration without losing your signed-in session.</Text></LearningCard><View style={styles.libraryStack}><Pressable accessibilityRole="button" onPress={() => router.push('/staff/grading')} style={styles.resourceButton}><View style={styles.resourceIcon}><ClipboardCheck color={palette.rubySoft} size={20} /></View><View style={styles.flex}><Text style={styles.resourceTitle}>Grading queue</Text><Text style={styles.resourceCopy}>Quick grade, redo, and concise feedback</Text></View><ArrowRight color={palette.muted} size={19} /></Pressable><Pressable accessibilityRole="button" onPress={() => router.push('/recordings' as Href)} style={styles.resourceButton}><View style={styles.resourceIcon}><Film color={palette.rubySoft} size={20} /></View><View style={styles.flex}><Text style={styles.resourceTitle}>Class recordings</Text><Text style={styles.resourceCopy}>Review cohort media on your phone</Text></View><ArrowRight color={palette.muted} size={19} /></Pressable><Pressable accessibilityRole="button" onPress={() => router.push('/resources')} style={styles.resourceButton}><View style={styles.resourceIcon}><FolderOpen color={palette.rubySoft} size={20} /></View><View style={styles.flex}><Text style={styles.resourceTitle}>Class resources</Text><Text style={styles.resourceCopy}>Open shared links and references</Text></View><ArrowRight color={palette.muted} size={19} /></Pressable><Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, '/admin/content').catch((error) => Alert.alert('Could not open curriculum tools', (error as Error).message))} style={styles.resourceButton}><View style={styles.resourceIcon}><ExternalLink color={palette.rubySoft} size={20} /></View><View style={styles.flex}><Text style={styles.resourceTitle}>Curriculum authoring</Text><Text style={styles.resourceCopy}>Secure web handoff for modules, schedules, and rich content</Text></View><ArrowRight color={palette.muted} size={19} /></Pressable></View></> : !student.enrolled ? <LearningCard><Text style={styles.staffTitle}>No active curriculum</Text><Text style={styles.staffCopy}>An active cohort enrollment is required before lessons can appear.</Text></LearningCard> : <>
      <SectionHeading eyebrow={`${modules.length} ${modules.length === 1 ? 'module' : 'modules'}`} title="Learning path" />
      <View style={styles.stack}>{modules.map((module) => {
        const locked = !module.available && !module.unlocked;
        return <LearningCard key={module.id} onPress={locked ? undefined : () => router.push(`/module/${module.id}`)} label={locked ? `${module.name} is locked` : `Open ${module.name}`}><View style={styles.moduleTop}><View style={[styles.moduleIcon, locked && styles.moduleIconLocked]}>{locked ? <Lock color={palette.quiet} size={20} /> : <BookMarked color={palette.rubySoft} size={20} />}</View><View style={styles.flex}><Text style={styles.moduleType}>{module.module_type}</Text><Text style={styles.moduleName}>{module.name}</Text><Text style={styles.moduleMeta}>{module.completed_blocks} of {module.total_blocks} learning steps · {module.lessons.length} lessons</Text></View><StatusPill completed={module.progress_percentage === 100} locked={locked} label={module.progress_percentage === 100 ? 'Complete' : locked ? 'Locked' : `${Math.round(module.progress_percentage)}%`} /></View><View style={styles.progress}><ProgressBar value={module.progress_percentage} label={`${module.name} progress`} /></View></LearningCard>;
      })}</View>
      {!modules.length && <Text style={styles.noResults}>No lessons match that search.</Text>}
      <View style={styles.libraryStack}><Pressable accessibilityRole="button" accessibilityLabel="Open class recordings" onPress={() => router.push('/recordings' as Href)} style={styles.resourceButton}><View style={styles.resourceIcon}><Film color={palette.rubySoft} size={20} /></View><View style={styles.flex}><Text style={styles.resourceTitle}>Class recordings</Text><Text style={styles.resourceCopy}>Secure playback, resume, and watch progress</Text></View><ArrowRight color={palette.muted} size={19} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Open all class resources" onPress={() => router.push('/resources')} style={styles.resourceButton}><View style={styles.resourceIcon}><FolderOpen color={palette.rubySoft} size={20} /></View><View style={styles.flex}><Text style={styles.resourceTitle}>Class resources</Text><Text style={styles.resourceCopy}>References, starter files, and useful links</Text></View><ArrowRight color={palette.muted} size={19} /></Pressable></View>
    </>}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, content: { padding: 20, paddingBottom: 120, gap: 15 }, eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.8, marginTop: 8 }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 34, letterSpacing: -1.2, marginTop: -9 }, subtitle: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: -10, marginBottom: 4 },
  search: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, stack: { gap: 10 },
  moduleTop: { flexDirection: 'row', alignItems: 'center', gap: 11 }, moduleIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, moduleIconLocked: { backgroundColor: '#232833' }, flex: { flex: 1, minWidth: 0 }, moduleType: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 0.8, textTransform: 'uppercase' }, moduleName: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, marginTop: 2 }, moduleMeta: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 9, marginTop: 3 }, progress: { marginTop: 14 }, noResults: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', paddingVertical: 25 },
  resourceButton: { minHeight: 72, borderRadius: 19, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 6 }, resourceIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, resourceTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 }, resourceCopy: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 9, marginTop: 3 },
  libraryStack: { gap: 4 },
  staffTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 15 }, staffCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, marginTop: 6 },
});
