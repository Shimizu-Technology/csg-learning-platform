import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Activity, ArrowLeft, RefreshCw } from 'lucide-react-native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { activityDestination } from '@/lib/activity-destination';
import { fonts } from '@/constants/csg-theme';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

const categories = [{ id: '', label: 'All' }, { id: 'account', label: 'Sign-ins' }, { id: 'learning', label: 'Learning' }, { id: 'work', label: 'Work' }];
const labels: Record<string, string> = {
  account_signed_in: 'Signed in', checkpoint_completed: 'Completed a learning step', checkpoint_reopened: 'Reopened a learning step',
  video_started: 'Started a lesson video', video_completed: 'Completed a lesson video', recording_started: 'Started a class recording',
  recording_completed: 'Completed a class recording', submission_created: 'Submitted work', submission_updated: 'Updated submitted work', submission_graded: 'Graded submitted work',
};

type ActivityParams = { user_id?: string; cohort_id?: string; name?: string; feed?: string; category?: string; learner_id?: string; days?: string };

export default function ActivityScreen() {
  const params = useLocalSearchParams<ActivityParams>();
  // Reset filters when a mounted route changes account/cohort scope, and retain them on back.
  return <ActivityFeed key={`${params.feed || 'personal'}:${params.cohort_id || ''}:${params.user_id || ''}`} params={params} />;
}

function ActivityFeed({ params }: { params: ActivityParams }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const { user_id: rawUserId, cohort_id: rawCohortId, name, feed } = params;
  const { api, user } = useSession();
  const auth = useCsgAuth();
  const router = useRouter();
  const cohortFeed = feed === 'cohort';
  const cohortId = rawCohortId ? Number(rawCohortId) : undefined;
  const validCohort = !rawCohortId || (Number.isInteger(cohortId) && cohortId! > 0);
  const [category, setCategory] = useState(categories.some((option) => option.id === params.category) && (!cohortFeed || params.category !== 'account') ? params.category! : '');
  const [learnerId, setLearnerId] = useState(params.learner_id && /^[1-9]\d*$/.test(params.learner_id) ? Number(params.learner_id) : undefined);
  const [days, setDays] = useState(params.days === '7' || params.days === '30' ? Number(params.days) : 0);
  const [now, setNow] = useState(() => Date.now());
  const targetId = cohortFeed ? learnerId : rawUserId ? Number(rawUserId) : undefined;
  const allowed = Boolean(user && validCohort && (!feed || cohortFeed) && (cohortFeed
    ? user.is_staff && cohortId
    : !rawUserId || (typeof targetId === 'number' && Number.isInteger(targetId) && targetId > 0 && (user.is_staff || targetId === user.id))));
  const query = useInfiniteQuery({
    queryKey: ['activity-events', user?.id, feed || 'personal', targetId, cohortId, category],
    queryFn: ({ signal, pageParam }) => api.activityEvents({ ...(cohortFeed ? { feed: 'cohort' as const } : {}), user_id: targetId, cohort_id: cohortId, category: category || undefined, before_id: pageParam }, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before_id ?? undefined,
    enabled: allowed && !auth.demo,
  });
  const roster = useQuery({
    queryKey: ['cohort-home', user?.id, cohortId],
    queryFn: ({ signal }) => api.cohortHome(cohortId!, signal),
    enabled: allowed && cohortFeed && !auth.demo,
  });
  const loadedRows = query.data?.pages.flatMap((page) => page.activity_events) || [];
  const rows = days ? loadedRows.filter((event) => new Date(event.created_at).getTime() >= now - days * 86400000) : loadedRows;
  const learners = new Map<number, string>((roster.data?.home.students || []).map((student) => [student.user_id, student.full_name]));
  loadedRows.forEach((event) => { if (event.subject_user) learners.set(event.subject_user.id, event.subject_user.name); });
  const recordedSince = query.data?.pages[0]?.recorded_since;
  const changeCategory = (value: string) => { setCategory(value); router.setParams({ category: value || undefined }); };
  const changeLearner = (value?: number) => { setLearnerId(value); router.setParams({ learner_id: value ? String(value) : undefined }); };
  const changeDays = (value: number) => { setDays(value); router.setParams({ days: value ? String(value) : undefined }); };

  if (!allowed) return <SafeAreaView style={styles.safe}><ErrorState title="Activity unavailable" message="This activity history is private." retryLabel="Go back" retry={() => router.back()} /></SafeAreaView>;
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>{cohortFeed ? 'COHORT ACTIVITY' : 'ACCOUNT & LEARNING'}</Text><Text numberOfLines={1} style={styles.title}>{name || (cohortFeed ? 'Cohort activity' : 'Your activity')}</Text></View><Activity color={c.text.body} size={22} /></View>
    <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => { setNow(Date.now()); void query.refetch(); }} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>{cohortFeed ? 'Learning progress and work across this cohort. Each learner and record opens in its original cohort.' : 'Sign-ins, learning progress, and work saved by the app.'} {recordedSince ? `Recorded since ${new Date(recordedSince).toLocaleDateString()}.` : 'Recorded since rollout.'} Earlier activity was not backfilled.</Text>
      {cohortFeed && <>
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/cohort/[id]', params: { id: String(cohortId) } })} style={styles.more}><Text style={styles.moreText}>Open cohort home</Text></Pressable>
        <Text style={styles.filterLabel}>Learner</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.learnerFilters}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: !learnerId }} onPress={() => changeLearner()} style={[styles.filter, !learnerId && styles.filterSelected]}><Text style={styles.filterText}>All learners</Text></Pressable>
          {Array.from(learners).sort((a, b) => a[1].localeCompare(b[1])).map(([id, learner]) => <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: learnerId === id }} onPress={() => changeLearner(id)} style={[styles.filter, learnerId === id && styles.filterSelected]}><Text style={styles.filterText}>{learner}</Text></Pressable>)}
          {learnerId && !learners.has(learnerId) && <Pressable accessibilityRole="button" accessibilityLabel="Clear selected learner" onPress={() => changeLearner()} style={styles.filter}><Text style={styles.filterText}>Learner #{learnerId} · Clear</Text></Pressable>}
        </ScrollView>
        {roster.isError && <Text style={styles.intro}>The full learner list is unavailable. Learners from loaded activity are shown.</Text>}
      </>}
      <Text style={styles.filterLabel}>Category</Text>
      <View style={styles.filters}>{categories.filter((option) => !cohortFeed || option.id !== 'account').map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: category === option.id }} onPress={() => changeCategory(option.id)} style={[styles.filter, category === option.id && styles.filterSelected]}><Text style={[styles.filterText, category === option.id && styles.filterTextSelected]}>{option.label}</Text></Pressable>)}</View>
      {cohortFeed && <><Text style={styles.filterLabel}>Time range</Text><View style={styles.filters}>{[{ id: 0, label: 'All time' }, { id: 7, label: 'Last 7 days' }, { id: 30, label: 'Last 30 days' }].map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: days === option.id }} onPress={() => changeDays(option.id)} style={[styles.filter, days === option.id && styles.filterSelected]}><Text style={styles.filterText}>{option.label}</Text></Pressable>)}</View></>}
      {auth.demo ? <LearningCard><Text style={styles.empty}>Activity history is unavailable in the simulator walkthrough.</Text></LearningCard> : query.isPending ? <LoadingState label="Loading activity" /> : query.error && loadedRows.length === 0 ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : <>
        {query.isRefetchError && <ErrorState title="Activity refresh failed" message="Showing previously loaded activity." retry={() => void query.refetch()} />}
        {rows.length === 0 ? <LearningCard><Text style={styles.empty}>{query.hasNextPage ? 'No matching activity in loaded history. Load earlier activity to keep looking.' : 'No activity recorded for these filters yet.'}</Text></LearningCard> : <View style={styles.stack}>{rows.map((event) => {
          const destination = activityDestination(event);
          const learnerName = event.subject_user?.name || (event.actor.id === event.subject_user_id ? event.actor.name : undefined) || `Learner #${event.subject_user_id}`;
          return <LearningCard key={event.id} onPress={!cohortFeed && destination ? () => router.push(destination) : undefined} label={!cohortFeed && destination ? `Open ${event.record_label || 'activity record'}` : undefined}>
            {cohortFeed && <Pressable accessibilityRole="button" accessibilityLabel={`Open learner ${learnerName}`} onPress={() => router.push({ pathname: '/staff/student/[id]', params: { id: String(event.subject_user_id), cohort_id: String(event.cohort_id ?? cohortId) } })} style={styles.eventLink}><Text style={styles.learnerName}>{learnerName}</Text></Pressable>}
            <View style={styles.row}><View style={styles.dot} /><View style={styles.flex}><Text style={styles.eventTitle}>{labels[event.event_type] || 'Activity recorded'}{event.record_label ? ` · ${event.record_label}` : ''}</Text><Text style={styles.meta}>{new Date(event.created_at).toLocaleString()}{event.cohort_name ? ` · ${event.cohort_name}` : ''}{event.actor.id !== event.subject_user_id ? ` · By ${event.actor.name}` : ''}</Text>{event.evidence === 'player_reported' && <Text style={styles.evidence}>Player reported progress; this does not verify attention.</Text>}</View></View>
            {cohortFeed && (destination ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${event.record_label || 'activity record'}`} onPress={() => router.push(destination)} style={styles.eventLink}><Text style={styles.moreText}>Open record</Text></Pressable> : <Text style={styles.evidence}>Record unavailable</Text>)}
          </LearningCard>;
        })}</View>}
      </>}
      {query.isFetchNextPageError && <Text accessibilityRole="alert" style={styles.error}>Could not load earlier activity. Try again.</Text>}
      {query.hasNextPage && <Pressable accessibilityRole="button" disabled={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} style={styles.more}>{query.isFetchingNextPage ? <ActivityIndicator color={c.text.strong} /> : <RefreshCw color={c.text.body} size={17} />}<Text style={styles.moreText}>Show earlier activity</Text></Pressable>}
    </ScrollView>
  </SafeAreaView>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  filterLabel: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, learnerFilters: { gap: 8 }, eventLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 4 }, learnerName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 },
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.1 }, title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 18, marginTop: 3 }, content: { padding: 20, paddingBottom: 60, gap: 14 }, intro: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 }, filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, filter: { minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 13, justifyContent: 'center' }, filterSelected: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, filterText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, filterTextSelected: { color: c.text.strong }, stack: { gap: 9 }, row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.text.body, marginTop: 5 }, eventTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13, lineHeight: 19 }, meta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 4 }, evidence: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 4 }, empty: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 }, error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 12 }, more: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }, moreText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 },
}));
