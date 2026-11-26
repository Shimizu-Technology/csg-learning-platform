import { PausedLearningCard } from '@/components/paused-learning-card';
import { BackButton } from '@/components/back-button';
import { brand } from '../../lib/brand'
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery } from '@tanstack/react-query';
import { Redirect, useRouter, type Href } from 'expo-router';
import { Check, ChevronRight, Film, Link2, Play, Search, UploadCloud } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, Pressable as NativePressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProgressBar, StatusPill } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import { demoRecordings } from '@/lib/demo-learning';
import { isAlumniOnlyEnrollment } from '@/lib/enrollments';
import { learningKeys } from '@/lib/learning';
import type { RecordingItem } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useCohort } from '@/providers/cohort-provider';

function dateLabel(value: string | null) {
  if (!value) return 'Date not set';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function monthLabel(value: string | null) {
  if (!value) return 'Earlier recordings';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Earlier recordings' : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function RecordingRow({ item, onPress }: { item: RecordingItem; onPress: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const progress = item.watch_progress;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={onPress} style={styles.row}>
    <View style={[styles.sourceIcon, item.source !== 'uploaded' && styles.sourceIconExternal]}>{progress?.completed ? <Check color={c.status.success.fg} size={19} /> : <Play color={item.source === 'uploaded' ? c.text.body : c.status.warning.fg} fill={item.source === 'uploaded' ? c.text.body : c.status.warning.fg} size={18} />}</View>
    <View style={styles.flex}><View style={styles.rowTop}><Text numberOfLines={2} style={styles.rowTitle}>{item.title}</Text><Text style={[styles.badge, item.source !== 'uploaded' && styles.badgeExternal]}>{item.source === 'uploaded' ? `${brand.schoolAbbreviation} VIDEO` : item.source.toUpperCase()}</Text></View><StatusPill label={item.status === 'draft' ? 'Draft' : 'Published'} completed={item.status !== 'draft'} /><Text style={styles.rowMeta}>{dateLabel(item.recorded_date)}{item.duration_display ? ` · ${item.duration_display}` : ''}</Text>{progress && !progress.completed && progress.progress_percentage > 0 && <View style={styles.progress}><ProgressBar value={progress.progress_percentage} label={`${item.title} watch progress`} /></View>}{progress?.completed && <Text style={styles.watched}>WATCHED</Text>}</View>
    <ChevronRight color={c.text.muted} size={19} />
  </Pressable>;
}

type WatchStatusFilter = 'all' | 'unwatched' | 'in_progress' | 'watched';

const STATUS_FILTERS: readonly { id: WatchStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unwatched', label: 'Unwatched' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'watched', label: 'Watched' },
];

export default function RecordingsScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user, enrollments } = useSession();
  const { selectedCohortId, selectedCohort } = useCohort();
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<WatchStatusFilter>('all');
  const isAlumniOnly = !user?.is_staff && (selectedCohort ? selectedCohort.cohort_type === 'alumni' : isAlumniOnlyEnrollment(enrollments));
  const query = useQuery({ queryKey: learningKeys.recordings(user?.id ?? 0), queryFn: ({ signal }) => auth.demo ? Promise.resolve({ recordings: [], s3_recordings: [], items: demoRecordings }) : api.recordings(signal), enabled: Boolean(user && !isAlumniOnly) });
  const cohortItems = useMemo(
    () => (query.data?.items || []).filter((item) => !selectedCohortId || item.cohort_id === selectedCohortId),
    [query.data?.items, selectedCohortId],
  );
  const continueWatching = useMemo(() => {
    const inProgress = cohortItems.filter(
      (item) => item.watch_progress && !item.watch_progress.completed && item.watch_progress.progress_percentage > 0,
    );
    if (!inProgress.length) return null;
    return [...inProgress].sort((a, b) =>
      (b.watch_progress?.last_watched_at || '').localeCompare(a.watch_progress?.last_watched_at || ''),
    )[0];
  }, [cohortItems]);
  const hasProgress = useMemo(() => cohortItems.some((item) => item.watch_progress != null), [cohortItems]);
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const items = cohortItems.filter((item) => {
      if (statusFilter === 'watched' && !item.watch_progress?.completed) return false;
      if (statusFilter === 'in_progress' && !(item.watch_progress && !item.watch_progress.completed && item.watch_progress.progress_percentage > 0)) return false;
      if (statusFilter === 'unwatched' && Boolean(item.watch_progress && (item.watch_progress.completed || item.watch_progress.progress_percentage > 0))) return false;
      return `${item.title} ${item.description || ''} ${item.cohort_name}`.toLowerCase().includes(needle);
    });
    const sorted = [...items].sort((a, b) => (b.recorded_date || '').localeCompare(a.recorded_date || ''));
    const cohorts = sorted.reduce<Record<string, RecordingItem[]>>((result, item) => {
      (result[item.cohort_name] ||= []).push(item);
      return result;
    }, {});
    return Object.entries(cohorts).map(([cohort, cohortRows]) => ({
      cohort,
      dateGroups: Object.entries(cohortRows.reduce<Record<string, RecordingItem[]>>((result, item) => {
        (result[monthLabel(item.recorded_date)] ||= []).push(item);
        return result;
      }, {})),
      count: cohortRows.length,
    }));
  }, [cohortItems, filter, statusFilter]);

  if (isAlumniOnly) return <Redirect href="/(app)/(tabs)/learn" />;

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><BackButton style={styles.back} /><View style={styles.flex}><Text style={styles.kicker}>LEARNING LIBRARY</Text><Text style={styles.headerTitle}>Recordings</Text></View>{user?.is_staff && <View style={styles.headerActions}><Pressable accessibilityRole="button" accessibilityLabel="Add recording link" onPress={() => router.push('/recordings/link' as Href)} style={styles.uploadButton}><Link2 color={c.text.body} size={19} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Upload class recording" onPress={() => router.push('/recordings/upload' as Href)} style={styles.uploadButton}><UploadCloud color={c.text.body} size={19} /></Pressable></View>}</View>{query.isPending && !query.data ? <LoadingState label="Loading class recordings" /> : query.error && !query.data ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
    <PausedLearningCard cohortId={selectedCohortId} />
    {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved recordings. Playback needs a connection.</Text></View>}
    {continueWatching ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Continue watching ${continueWatching.title}`}
        onPress={() => router.push(`/recording/${encodeURIComponent(continueWatching.item_key)}?cohort_id=${continueWatching.cohort_id}` as Href)}
        style={styles.hero}
      >
        <View style={styles.continueTop}>
          <View style={styles.heroIcon}><Play color={c.text.strong} fill={c.text.strong} size={20} /></View>
          <Text style={styles.resumeBadge}>Resume</Text>
        </View>
        <Text style={styles.heroKicker}>CONTINUE WATCHING</Text>
        <Text numberOfLines={2} style={styles.heroTitle}>{continueWatching.title}</Text>
        <Text style={styles.heroCopy}>
          {Math.round(continueWatching.watch_progress?.progress_percentage ?? 0)}% watched
          {continueWatching.duration_display ? ` · ${continueWatching.duration_display}` : ''}
        </Text>
        <View style={styles.heroProgress}>
          <ProgressBar value={continueWatching.watch_progress?.progress_percentage ?? 0} label={`${continueWatching.title} watch progress`} />
        </View>
      </Pressable>
    ) : (
      <View style={styles.hero}><View style={styles.heroIcon}><Film color={c.text.body} size={23} /></View><Text style={styles.heroKicker}>CLASS REPLAYS</Text><Text style={styles.heroTitle}>Pick up where you left off</Text><Text style={styles.heroCopy}>{selectedCohort ? `${selectedCohort.name} · ` : ''}{brand.schoolAbbreviation}-hosted videos play natively. Supported YouTube, Vimeo, and Loom recordings play here in the app, with the original always one tap away.</Text></View>
    )}
    <View style={styles.search}><Search color={c.text.muted} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search recordings" value={filter} onChangeText={setFilter} placeholder="Search class recordings" placeholderTextColor={c.text.body} style={styles.input} /></View>
    {hasProgress && (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {STATUS_FILTERS.map((item) => {
          const active = statusFilter === item.id;
          return (
            <NativePressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setStatusFilter(item.id)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{item.label}</Text>
            </NativePressable>
          );
        })}
      </ScrollView>
    )}
    {groups.map(({ cohort, count, dateGroups }) => <View key={cohort} style={styles.group}><View style={styles.groupHeading}><Text style={styles.groupKicker}>COHORT</Text><Text style={styles.groupTitle}>{cohort}</Text><Text style={styles.groupCount}>{count}</Text></View>{dateGroups.map(([date, items]) => <View key={date} style={styles.dateGroup}><Text style={styles.dateHeading}>{date}</Text><View style={styles.rows}>{items.map((item) => <RecordingRow key={item.item_key} item={item} onPress={() => router.push(`/recording/${encodeURIComponent(item.item_key)}?cohort_id=${item.cohort_id}` as Href)} />)}</View></View>)}</View>)}
    {!groups.length && <View style={styles.empty}><Film color={c.text.body} size={31} /><Text style={styles.emptyTitle}>{filter || statusFilter !== 'all' ? 'No matching recordings' : 'No recordings yet'}</Text><Text style={styles.emptyCopy}>{filter || statusFilter !== 'all' ? 'Try a different search or filter.' : 'Your class replays will appear here after they are published.'}</Text></View>}
  </ScrollView>}</SafeAreaView>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, headerActions: { flexDirection: 'row', gap: 6 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, uploadButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, content: { padding: 20, paddingBottom: 100, gap: 15 }, flex: { flex: 1, minWidth: 0 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: c.status.warning.bg, justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12 }, hero: { borderRadius: 22, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 20 }, heroIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, heroKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.2, marginTop: 15 }, heroTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 24, letterSpacing: -0.6, marginTop: 5 }, heroCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 8 }, continueTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, resumeBadge: { minHeight: 30, borderRadius: 999, backgroundColor: c.selection.bg, color: c.text.strong, fontFamily: fonts.bold, fontSize: 12, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' }, heroProgress: { marginTop: 12 }, filterRow: { gap: 8, paddingVertical: 2 }, filterChip: { minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 14, justifyContent: 'center' }, filterChipActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, filterChipText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 13 }, filterChipTextActive: { color: c.text.strong, fontFamily: fonts.bold }, search: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, group: { gap: 9 }, groupHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 2 }, groupKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, groupTitle: { flex: 1, color: c.text.strong, fontFamily: fonts.bold, fontSize: 16 }, groupCount: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, dateGroup: { gap: 7 }, dateHeading: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: 3, marginTop: 3 }, rows: { gap: 8 }, row: { minHeight: 94, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, sourceIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, sourceIconExternal: { backgroundColor: c.surface.sunken }, rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 }, rowTitle: { flex: 1, color: c.text.strong, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 }, badge: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5, borderRadius: 8, backgroundColor: c.surface.sunken, paddingHorizontal: 6, paddingVertical: 4 }, badgeExternal: { color: c.status.warning.fg, backgroundColor: c.surface.sunken }, rowMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 4 }, progress: { marginTop: 8 }, watched: { color: c.status.success.fg, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8, marginTop: 6 }, empty: { alignItems: 'center', paddingVertical: 55 }, emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 12 }, emptyCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 5, maxWidth: 270 },
}));
