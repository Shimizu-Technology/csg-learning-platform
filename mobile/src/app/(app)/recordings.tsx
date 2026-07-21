import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { ArrowLeft, Check, ChevronRight, Film, Play, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProgressBar } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoRecordings } from '@/lib/demo-learning';
import { learningKeys } from '@/lib/learning';
import type { RecordingItem } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

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
  const progress = item.watch_progress;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={onPress} style={styles.row}>
    <View style={[styles.sourceIcon, item.source !== 'uploaded' && styles.sourceIconExternal]}>{progress?.completed ? <Check color={palette.success} size={19} /> : <Play color={item.source === 'uploaded' ? palette.rubySoft : palette.warning} fill={item.source === 'uploaded' ? palette.rubySoft : palette.warning} size={18} />}</View>
    <View style={styles.flex}><View style={styles.rowTop}><Text numberOfLines={2} style={styles.rowTitle}>{item.title}</Text><Text style={[styles.badge, item.source !== 'uploaded' && styles.badgeExternal]}>{item.source === 'uploaded' ? 'CSG VIDEO' : item.source.toUpperCase()}</Text></View><Text style={styles.rowMeta}>{dateLabel(item.recorded_date)}{item.duration_display ? ` · ${item.duration_display}` : ''}</Text>{progress && !progress.completed && progress.progress_percentage > 0 && <View style={styles.progress}><ProgressBar value={progress.progress_percentage} label={`${item.title} watch progress`} /></View>}{progress?.completed && <Text style={styles.watched}>WATCHED</Text>}</View>
    <ChevronRight color={palette.quiet} size={19} />
  </Pressable>;
}

export default function RecordingsScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const [filter, setFilter] = useState('');
  const query = useQuery({ queryKey: learningKeys.recordings(user?.id ?? 0), queryFn: ({ signal }) => auth.demo ? Promise.resolve({ recordings: [], s3_recordings: [], items: demoRecordings }) : api.recordings(signal), enabled: Boolean(user) });
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const items = (query.data?.items || []).filter((item) => `${item.title} ${item.description || ''} ${item.cohort_name}`.toLowerCase().includes(needle));
    const sorted = [...items].sort((a, b) => (b.recorded_date || '').localeCompare(a.recorded_date || ''));
    const cohorts = sorted.reduce<Record<string, RecordingItem[]>>((result, item) => {
      (result[item.cohort_name] ||= []).push(item);
      return result;
    }, {});
    return Object.entries(cohorts).map(([cohort, cohortItems]) => ({
      cohort,
      dateGroups: Object.entries(cohortItems.reduce<Record<string, RecordingItem[]>>((result, item) => {
        (result[monthLabel(item.recorded_date)] ||= []).push(item);
        return result;
      }, {})),
      count: cohortItems.length,
    }));
  }, [filter, query.data?.items]);

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View><Text style={styles.kicker}>LEARNING LIBRARY</Text><Text style={styles.headerTitle}>Recordings</Text></View></View>{query.isPending && !query.data ? <LoadingState label="Loading class recordings" /> : query.error && !query.data ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
    {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved recordings. Playback needs a connection.</Text></View>}
    <View style={styles.hero}><View style={styles.heroIcon}><Film color={palette.rubySoft} size={23} /></View><Text style={styles.heroKicker}>CLASS REPLAYS</Text><Text style={styles.heroTitle}>Pick up where you left off</Text><Text style={styles.heroCopy}>Uploaded CSG videos play natively with secure resume and watch progress. Legacy recordings remain available during migration.</Text></View>
    <View style={styles.search}><Search color={palette.quiet} size={18} /><TextInput accessibilityLabel="Search recordings" value={filter} onChangeText={setFilter} placeholder="Search class recordings" placeholderTextColor={palette.quiet} style={styles.input} /></View>
    {groups.map(({ cohort, count, dateGroups }) => <View key={cohort} style={styles.group}><View style={styles.groupHeading}><Text style={styles.groupKicker}>COHORT</Text><Text style={styles.groupTitle}>{cohort}</Text><Text style={styles.groupCount}>{count}</Text></View>{dateGroups.map(([date, items]) => <View key={date} style={styles.dateGroup}><Text style={styles.dateHeading}>{date}</Text><View style={styles.rows}>{items.map((item) => <RecordingRow key={item.item_key} item={item} onPress={() => router.push(`/recording/${encodeURIComponent(item.item_key)}` as Href)} />)}</View></View>)}</View>)}
    {!groups.length && <View style={styles.empty}><Film color={palette.rubySoft} size={31} /><Text style={styles.emptyTitle}>{filter ? 'No matching recordings' : 'No recordings yet'}</Text><Text style={styles.emptyCopy}>{filter ? 'Try a different search.' : 'Your class replays will appear here after they are published.'}</Text></View>}
  </ScrollView>}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, content: { padding: 20, paddingBottom: 100, gap: 15 }, flex: { flex: 1, minWidth: 0 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: '#2A2115', justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: palette.warning, fontFamily: fonts.semibold, fontSize: 10 }, hero: { borderRadius: 22, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', padding: 20 }, heroIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#351821', alignItems: 'center', justifyContent: 'center' }, heroKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.2, marginTop: 15 }, heroTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 24, letterSpacing: -0.6, marginTop: 5 }, heroCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 18, marginTop: 8 }, search: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, group: { gap: 9 }, groupHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 2 }, groupKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1 }, groupTitle: { flex: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 16 }, groupCount: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 10 }, dateGroup: { gap: 7 }, dateHeading: { color: palette.muted, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: 3, marginTop: 3 }, rows: { gap: 8 }, row: { minHeight: 94, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, sourceIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, sourceIconExternal: { backgroundColor: '#2A2115' }, rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 }, rowTitle: { flex: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 }, badge: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 7, letterSpacing: 0.5, borderRadius: 8, backgroundColor: '#2A151B', paddingHorizontal: 6, paddingVertical: 4 }, badgeExternal: { color: palette.warning, backgroundColor: '#2A2115' }, rowMeta: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 9, marginTop: 4 }, progress: { marginTop: 8 }, watched: { color: palette.success, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 0.8, marginTop: 6 }, empty: { alignItems: 'center', paddingVertical: 55 }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16, marginTop: 12 }, emptyCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 5, maxWidth: 270 },
});
