import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Search, Users } from 'lucide-react-native';
import { useState } from 'react';
import { Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

type Filter = 'all' | 'app' | 'invited' | 'member' | 'followup';
const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'app', label: 'App sign-in pending' },
  { key: 'invited', label: 'GitHub invited' }, { key: 'member', label: 'GitHub joined' },
  { key: 'followup', label: 'GitHub follow-up' },
];

export default function StaffAccessScreen() {
  const router = useRouter();
  const { cohort_id } = useLocalSearchParams<{ cohort_id?: string }>();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const [cohortId, setCohortId] = useState<number | null>(cohort_id ? Number(cohort_id) : null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const cohortsQuery = useQuery({ queryKey: ['staff-access-cohorts', user?.id], queryFn: ({ signal }) => api.cohorts(signal), enabled: Boolean(user?.is_staff && !auth.demo) });
  const cohorts = cohortsQuery.data?.cohorts || [];
  const selectedCohortId = cohortId ?? cohorts[0]?.id ?? null;
  const accessQuery = useQuery({ queryKey: ['staff-access', selectedCohortId], queryFn: ({ signal }) => api.cohortAccess(selectedCohortId!, signal), enabled: Boolean(selectedCohortId && !auth.demo) });
  const organization = accessQuery.data?.cohort.github_organization_name;
  const githubQuery = useQuery({ queryKey: ['staff-github-access', selectedCohortId, organization], queryFn: async ({ signal }) => {
    try { return await api.cohortGithubAccess(selectedCohortId!, signal); }
    catch (error) { if (!signal.aborted) setFilter('all'); throw error; }
  }, enabled: Boolean(selectedCohortId && organization && !auth.demo), staleTime: 60_000 });
  const students = accessQuery.data?.cohort.students || [];
  const statuses = organization && !githubQuery.isError ? githubQuery.data?.statuses : undefined;
  const activeFilter = statuses || filter === 'app' ? filter : 'all';
  const visible = students.filter((student) => {
    const github = statuses?.[String(student.user_id)];
    const matches = activeFilter === 'all' || (activeFilter === 'app' && !student.last_sign_in_at) ||
      (activeFilter === 'invited' && github === 'invited') || (activeFilter === 'member' && github === 'member') ||
      (activeFilter === 'followup' && (github === 'not_invited' || github === 'username_missing'));
    return matches && `${student.full_name} ${student.email} ${student.github_username || ''}`.toLowerCase().includes(search.trim().toLowerCase());
  });

  if (!user?.is_staff) return <SafeAreaView style={styles.safe}><EmptyState title="Staff access only" copy="This roster is for instructors and admins." /></SafeAreaView>;
  if (auth.demo) return <SafeAreaView style={styles.safe}><EmptyState title="Live access status" copy="Invitation and GitHub membership status is available when you sign in to a live staff account." /></SafeAreaView>;
  if (cohortsQuery.isPending) return <SafeAreaView style={styles.safe}><LoadingState label="Loading cohorts" /></SafeAreaView>;
  if (cohortsQuery.error) return <SafeAreaView style={styles.safe}><ErrorState message={(cohortsQuery.error as Error).message} retry={() => void cohortsQuery.refetch()} /></SafeAreaView>;
  if (!cohorts.length) return <SafeAreaView style={styles.safe}><EmptyState title="No cohorts yet" copy="Add a cohort before checking student access." /></SafeAreaView>;

  const githubLabel = (id: number) => {
    if (!accessQuery.data?.cohort.github_organization_name) return null;
    switch (statuses?.[String(id)]) {
      case 'member': return ['Joined GitHub org', palette.success] as const;
      case 'invited': return ['GitHub invite pending', palette.warning] as const;
      case 'not_invited': return ['No current GitHub invite', palette.rubySoft] as const;
      case 'username_missing': return ['GitHub username needed', palette.muted] as const;
      default: return ['GitHub status unavailable', palette.muted] as const;
    }
  };

  return <SafeAreaView edges={['bottom']} style={styles.safe}>
    <ScrollView style={styles.scroll} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={accessQuery.isRefetching || githubQuery.isRefetching} onRefresh={() => { void accessQuery.refetch(); if (accessQuery.data?.cohort.github_organization_name) void githubQuery.refetch(); }} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>PEOPLE & ACCESS</Text><Text style={styles.title}>Who has joined?</Text><Text style={styles.copy}>App sign-in and GitHub organization access are tracked separately. Enrollment does not mean an invite was accepted.</Text>
      <View style={styles.cohortBox}><Text style={styles.label}>COHORT</Text><ScrollView horizontal style={styles.strip} contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">{cohorts.map((cohort) => <Pressable key={cohort.id} accessibilityRole="button" accessibilityState={{ selected: cohort.id === selectedCohortId }} onPress={() => { Keyboard.dismiss(); setCohortId(cohort.id); setFilter('all'); setSearch(''); }} style={[styles.chip, cohort.id === selectedCohortId && styles.selectedChip]}><Text numberOfLines={1} style={[styles.chipText, cohort.id === selectedCohortId && styles.selectedText]}>{cohort.name}</Text></Pressable>)}</ScrollView></View>
      <View style={styles.search}><Search color={palette.muted} size={18} /><TextInput accessibilityLabel="Search students" value={search} onChangeText={setSearch} placeholder="Search students" placeholderTextColor={palette.quiet} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} style={styles.input} /></View>
      <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">{filters.map((option) => <Pressable key={option.key} accessibilityRole="button" accessibilityState={{ selected: activeFilter === option.key, disabled: option.key !== 'all' && option.key !== 'app' && !statuses }} disabled={option.key !== 'all' && option.key !== 'app' && !statuses} onPress={() => { Keyboard.dismiss(); setFilter(option.key); }} style={[styles.filter, activeFilter === option.key && styles.selectedFilter, option.key !== 'all' && option.key !== 'app' && !statuses && styles.disabledFilter]}><Text style={[styles.filterText, activeFilter === option.key && styles.selectedText]}>{option.label}</Text></Pressable>)}</ScrollView>
      {accessQuery.isPending ? <LoadingState label="Loading students" /> : accessQuery.error ? <ErrorState message={(accessQuery.error as Error).message} retry={() => void accessQuery.refetch()} /> : <>
        {!organization && <Text style={styles.notice}>No GitHub organization is configured for this cohort.</Text>}
        {organization && githubQuery.error && <Text style={styles.notice}>GitHub status could not be checked. Pull down to retry.</Text>}
        {statuses && githubQuery.data && <Text style={styles.checked}>GitHub checked {new Date(githubQuery.data.checked_at).toLocaleString()}</Text>}
        <View style={styles.summary}><View style={styles.summaryCard}><Text style={styles.summaryNumber}>{students.filter((student) => student.last_sign_in_at).length}</Text><Text style={styles.summaryLabel}>App sign-ins</Text></View><View style={styles.summaryCard}><Text style={styles.summaryNumber}>{statuses ? students.filter((student) => statuses[String(student.user_id)] === 'member').length : '—'}</Text><Text style={styles.summaryLabel}>GitHub joined</Text></View><View style={styles.summaryCard}><Text style={styles.summaryNumber}>{statuses ? students.filter((student) => statuses[String(student.user_id)] === 'invited').length : '—'}</Text><Text style={styles.summaryLabel}>Invites pending</Text></View></View>
        <Text style={styles.count}>{visible.length} of {students.length} enrolled</Text>
        {visible.map((student) => { const github = githubLabel(student.user_id); const membershipLabel = student.joined_at ? 'Joined cohort' : 'Added, not yet opened'; const appLabel = student.last_sign_in_at ? 'Signed in to app' : student.invite_pending ? `App invite ${student.invite_delivery_status === 'failed' ? 'failed' : student.invite_delivery_status === 'not_sent' ? 'not sent' : student.invite_delivery_status === 'queued' ? 'queued' : 'sent'}` : 'App account ready · no sign-in'; return <Pressable key={student.user_id} accessibilityRole="button" accessibilityLabel={`Open ${student.full_name}. ${membershipLabel}. ${appLabel}${github ? `. ${github[0]}` : ''}`} onPress={() => router.push({ pathname: '/staff/student/[id]', params: { id: String(student.user_id), cohort_id: String(selectedCohortId) } })} style={styles.person}><View style={styles.avatar}><Users color={palette.rubySoft} size={18} /></View><View style={styles.personCopy}><Text style={styles.name}>{student.full_name || student.email}</Text><Text style={styles.email}>{student.email}</Text><Text style={[styles.status, { color: student.joined_at ? palette.success : palette.warning }]}>{membershipLabel}</Text><Text style={[styles.status, { color: student.last_sign_in_at ? palette.success : palette.warning }]}>{appLabel}</Text>{github && <Text style={[styles.status, { color: github[1] }]}>{github[0]}</Text>}</View></Pressable>; })}
        {!visible.length && <EmptyState title="No matching students" copy="Try another name or access filter." />}
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, scroll: { flex: 1 }, content: { padding: 20, paddingBottom: 50, gap: 14 },
  eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.5 }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 27 }, copy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  cohortBox: { gap: 8 }, label: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, strip: { flexGrow: 0, maxHeight: 52 }, chips: { alignItems: 'center', gap: 8, paddingRight: 20 },
  chip: { minHeight: 44, maxWidth: 210, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 13 }, selectedChip: { borderColor: palette.rubySoft, backgroundColor: '#32161D' }, chipText: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 13 }, selectedText: { color: palette.text },
  search: { minHeight: 48, borderRadius: 14, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 14 },
  filter: { minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 12 }, selectedFilter: { backgroundColor: palette.ruby, borderColor: palette.ruby }, filterText: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 12 },
  disabledFilter: { opacity: 0.45 },
  notice: { color: palette.warning, fontFamily: fonts.regular, fontSize: 12 }, checked: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11 }, count: { color: palette.muted, fontFamily: fonts.bold, fontSize: 12 },
  summary: { flexDirection: 'row', gap: 8 }, summaryCard: { flex: 1, minHeight: 76, borderRadius: 14, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, padding: 10, justifyContent: 'space-between' }, summaryNumber: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 22 }, summaryLabel: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 11 },
  person: { flexDirection: 'row', gap: 12, minHeight: 96, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 14 }, avatar: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#32161D', alignItems: 'center', justifyContent: 'center' }, personCopy: { flex: 1 }, name: { color: palette.text, fontFamily: fonts.bold, fontSize: 15 }, email: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 }, status: { fontFamily: fonts.semibold, fontSize: 12, marginTop: 5 },
});
