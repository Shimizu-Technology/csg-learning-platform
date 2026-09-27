import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Activity, ArrowLeft, RefreshCw } from 'lucide-react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

const categories = [{ id: '', label: 'All' }, { id: 'account', label: 'Sign-ins' }, { id: 'learning', label: 'Learning' }, { id: 'work', label: 'Work' }];
const labels: Record<string, string> = {
  account_signed_in: 'Signed in', checkpoint_completed: 'Completed a learning step', checkpoint_reopened: 'Reopened a learning step',
  video_started: 'Started a lesson video', video_completed: 'Completed a lesson video', recording_started: 'Started a class recording',
  recording_completed: 'Completed a class recording', submission_created: 'Submitted work', submission_updated: 'Updated submitted work', submission_graded: 'Graded submitted work',
};

export default function ActivityScreen() {
  const { user_id: rawUserId, name } = useLocalSearchParams<{ user_id?: string; name?: string }>();
  const { api, user } = useSession();
  const auth = useCsgAuth();
  const router = useRouter();
  const targetId = rawUserId ? Number(rawUserId) : undefined;
  const [category, setCategory] = useState('');
  const allowed = Boolean(user && (!targetId || (Number.isInteger(targetId) && targetId > 0 && (user.is_staff || targetId === user.id))));
  const query = useInfiniteQuery({
    queryKey: ['activity-events', user?.id, targetId, category],
    queryFn: ({ signal, pageParam }) => api.activityEvents({ user_id: targetId, category: category || undefined, before_id: pageParam }, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before_id ?? undefined,
    enabled: allowed && !auth.demo,
  });

  if (!allowed) return <SafeAreaView style={styles.safe}><ErrorState title="Activity unavailable" message="This activity history is private." retryLabel="Go back" retry={() => router.back()} /></SafeAreaView>;
  if (query.isPending && !auth.demo) return <SafeAreaView style={styles.safe}><LoadingState label="Loading activity" /></SafeAreaView>;
  const rows = query.data?.pages.flatMap((page) => page.activity_events) || [];
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>ACCOUNT & LEARNING</Text><Text numberOfLines={1} style={styles.title}>{name || 'Your activity'}</Text></View><Activity color={palette.rubySoft} size={22} /></View>
    <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Sign-ins, learning progress, and work saved by the app. Earlier activity was not backfilled.</Text>
      <View style={styles.filters}>{categories.map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: category === option.id }} onPress={() => setCategory(option.id)} style={[styles.filter, category === option.id && styles.filterSelected]}><Text style={[styles.filterText, category === option.id && styles.filterTextSelected]}>{option.label}</Text></Pressable>)}</View>
      {auth.demo ? <LearningCard><Text style={styles.empty}>Activity history is unavailable in the simulator walkthrough.</Text></LearningCard> : query.error && rows.length === 0 ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : rows.length === 0 ? <LearningCard><Text style={styles.empty}>No activity recorded in this category yet.</Text></LearningCard> : <View style={styles.stack}>{rows.map((event) => <LearningCard key={event.id}><View style={styles.row}><View style={styles.dot} /><View style={styles.flex}><Text style={styles.eventTitle}>{labels[event.event_type] || 'Activity recorded'}{event.record_label ? ` · ${event.record_label}` : ''}</Text><Text style={styles.meta}>{new Date(event.created_at).toLocaleString()}{event.cohort_name ? ` · ${event.cohort_name}` : ''}{event.actor.id !== event.subject_user_id ? ` · By ${event.actor.name}` : ''}</Text>{event.evidence === 'player_reported' && <Text style={styles.evidence}>Player reported progress; this does not verify attention.</Text>}</View></View></LearningCard>)}</View>}
      {query.isFetchNextPageError && <Text accessibilityRole="alert" style={styles.error}>Could not load earlier activity. Try again.</Text>}
      {query.hasNextPage && <Pressable accessibilityRole="button" disabled={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} style={styles.more}>{query.isFetchingNextPage ? <ActivityIndicator color={palette.text} /> : <RefreshCw color={palette.rubySoft} size={17} />}<Text style={styles.moreText}>Show earlier activity</Text></Pressable>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.1 }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 18, marginTop: 3 }, content: { padding: 20, paddingBottom: 60, gap: 14 }, intro: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 }, filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, filter: { minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 13, justifyContent: 'center' }, filterSelected: { borderColor: palette.rubySoft, backgroundColor: '#2A151B' }, filterText: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 12 }, filterTextSelected: { color: palette.text }, stack: { gap: 9 }, row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.rubySoft, marginTop: 5 }, eventTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13, lineHeight: 19 }, meta: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 4 }, evidence: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 4 }, empty: { color: palette.muted, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 }, error: { color: palette.warning, fontFamily: fonts.medium, fontSize: 12 }, more: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }, moreText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 },
});
