import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ArrowRight, CheckCircle2, ClipboardCheck, Clock3, MessageSquare, RotateCcw } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthoredContent } from '@/components/authored-content';
import { BackButton } from '@/components/back-button';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PressableScale } from '@/components/ui/pressable-scale';
import { fonts, tabularNums } from '@/constants/csg-theme';
import { themedAlert as Alert } from '@/lib/alerts';
import { formatCourseDate } from '@/lib/course-time';
import { gradeLabel } from '@/lib/display-labels';
import { haptic } from '@/lib/haptics';
import type { components } from '@/lib/api.generated';
import { useSession } from '@/providers/session-provider';
import { makeStyles, useTheme } from '@/providers/theme-provider';

type WorkTab = 'needs_you' | 'waiting' | 'graded';
type MyWorkItem = components['schemas']['MyWorkItem'];

const TABS: { key: WorkTab; label: string }[] = [
  { key: 'needs_you', label: 'Needs you' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'graded', label: 'Reviewed' },
];

export default function MyWork() {
  const { cohort_id } = useLocalSearchParams<{ cohort_id: string }>();
  const cohortId = Number(cohort_id);
  const { api, user } = useSession();
  const router = useRouter();
  const { colors: c } = useTheme();
  const styles = useStyles();
  const [selectedTab, setSelectedTab] = useState<WorkTab | null>(null);
  const [openingDmId, setOpeningDmId] = useState<number | null>(null);
  const openingDmRef = useRef(false);
  const mountedRef = useRef(true);
  const focusedRef = useRef(true);
  const focusGenerationRef = useRef(0);
  const hasBlurredRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const valid = Number.isSafeInteger(cohortId) && cohortId > 0;
  const enabled = Boolean(user && valid);
  const query = useQuery({
    queryKey: ['my-work', user?.id, cohortId],
    queryFn: ({ signal }) => api.myWork(cohortId, signal),
    enabled,
    staleTime: 0,
  });
  const refetchRef = useRef(query.refetch);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    refetchRef.current = query.refetch;
    enabledRef.current = enabled;
  }, [enabled, query.refetch]);
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      if (hasBlurredRef.current && enabledRef.current) {
        void refetchRef.current();
      }
      return () => {
        focusedRef.current = false;
        hasBlurredRef.current = true;
        focusGenerationRef.current += 1;
      };
    }, []),
  );
  const work = query.data?.my_work;
  const defaultTab: WorkTab = work
    ? work.counts.needs_you > 0
      ? 'needs_you'
      : work.counts.waiting > 0
        ? 'waiting'
        : 'graded'
    : 'needs_you';
  const activeTab = selectedTab ?? defaultTab;
  const items: MyWorkItem[] = work ? work[activeTab] : [];

  const openLesson = (item: MyWorkItem) =>
    router.push({
      pathname: '/lesson/[id]',
      params: { id: String(item.lesson_id), cohort_id: String(cohortId), block_id: String(item.content_block_id) },
    });

  const askAboutFeedback = async (item: MyWorkItem) => {
    if (!item.ask_to || openingDmRef.current) return;
    const focusGen = focusGenerationRef.current;
    openingDmRef.current = true;
    setOpeningDmId(item.submission_id);
    try {
      const result = await api.createCohortDm(item.cohort_id, [item.ask_to.id]);
      if (!focusedRef.current || !mountedRef.current || focusGenerationRef.current !== focusGen) return;
      router.push(`/conversation/dm/${result.direct_conversation.id}` as Href);
    } catch {
      if (focusedRef.current && mountedRef.current && focusGenerationRef.current === focusGen) {
        Alert.alert('Could not open conversation', 'Try again in a moment.');
      }
    } finally {
      openingDmRef.current = false;
      if (mountedRef.current) setOpeningDmId(null);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <BackButton style={styles.back} />
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={styles.headerTitle}>My work</Text>
          {!!work?.cohort?.name && <Text numberOfLines={1} style={styles.headerSubtitle}>{work.cohort.name}</Text>}
        </View>
      </View>

      {!valid ? (
        <ErrorState message="Choose a course to view your work." />
      ) : query.isPending ? (
        <LoadingState label="Loading your work" />
      ) : !work ? (
        <ErrorState message="Could not load your work." retry={() => void query.refetch()} />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.text.body} />}
          contentContainerStyle={styles.content}
        >
          {query.isRefetchError && (
            <View accessibilityRole="alert" style={styles.refreshBanner}>
              <Text style={styles.refreshBannerText}>Could not refresh your work.</Text>
              <Button size="sm" variant="secondary" label="Try again" onPress={() => void query.refetch()} />
            </View>
          )}

          <View style={styles.segmented} accessibilityRole="tablist">
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              const count = work.counts[tab.key];
              return (
                <PressableScale
                  key={tab.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    if (!active) haptic('selection');
                    setSelectedTab(tab.key);
                  }}
                  style={[styles.segment, active && styles.segmentActive]}
                >
                  <Text numberOfLines={1} style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                    {tab.label}
                  </Text>
                  <Text style={[styles.segmentCount, active && styles.segmentCountActive]}>{count}</Text>
                </PressableScale>
              );
            })}
          </View>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                {activeTab === 'needs_you' ? (
                  <RotateCcw color={c.text.muted} size={22} />
                ) : activeTab === 'waiting' ? (
                  <Clock3 color={c.text.muted} size={22} />
                ) : (
                  <ClipboardCheck color={c.text.muted} size={22} />
                )}
              </View>
              <Text style={styles.emptyTitle}>
                {activeTab === 'needs_you'
                  ? 'Nothing needs you right now'
                  : activeTab === 'waiting'
                    ? 'Nothing is waiting for review'
                    : 'No reviewed work yet'}
              </Text>
              <Text style={styles.emptyCopy}>
                {activeTab === 'needs_you'
                  ? 'When your instructor asks for a redo, it appears here with their feedback.'
                  : activeTab === 'waiting'
                    ? 'Exercises and projects you hand in wait here until your instructor reviews them.'
                    : 'Your reviewed exercises and projects will appear here with feedback.'}
              </Text>
            </View>
          ) : (
            <Card style={styles.listCard}>
              {items.map((item, idx) => {
                const where = [item.module_name, item.week ? `Week ${item.week}` : null].filter(Boolean).join(' · ');
                const metaParts = [
                  where || null,
                  `Attempt ${item.attempt}`,
                  item.submitted_at ? `Submitted ${formatCourseDate(item.submitted_at, { withYear: false })}` : null,
                  item.grader?.full_name ? `Reviewed by ${item.grader.full_name}` : null,
                ].filter(Boolean);
                const tone = item.status === 'redo' ? 'warning' : item.status === 'waiting' ? 'pending' : 'success';
                const statusText = item.status === 'waiting'
                  ? 'Waiting'
                  : item.grade
                    ? gradeLabel(item.grade)
                    : item.status === 'redo'
                      ? 'Redo'
                      : 'Reviewed';
                const titleSuffix = item.block_title && item.block_title !== item.lesson_title ? `, ${item.block_title}` : '';
                return (
                  <View key={item.submission_id} style={[styles.itemRow, idx > 0 && styles.rowDivider]}>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${item.lesson_title}${titleSuffix}`}
                      onPress={() => openLesson(item)}
                      style={styles.itemTap}
                    >
                      <View style={styles.itemTop}>
                        <View style={[styles.statusTile, item.status === 'redo' ? styles.warningTile : item.status === 'graded' ? styles.successTile : null]}>
                          {item.status === 'redo' ? (
                            <RotateCcw color={c.status.warning.fg} size={16} />
                          ) : item.status === 'graded' ? (
                            <CheckCircle2 color={c.status.success.fg} size={16} />
                          ) : (
                            <Clock3 color={c.text.body} size={16} />
                          )}
                        </View>
                        <View style={styles.flex}>
                          <Text style={styles.itemTitle}>
                            {item.lesson_title}
                            {item.block_title && item.block_title !== item.lesson_title ? ` · ${item.block_title}` : ''}
                          </Text>
                          <Text style={styles.itemMeta}>{metaParts.join(' · ')}</Text>
                        </View>
                        <Badge label={statusText} tone={tone} />
                      </View>
                    </PressableScale>
                    {!!item.expected_review_on && item.status === 'waiting' && (
                      <Text style={styles.expectedReview}>
                        Feedback expected by {formatCourseDate(item.expected_review_on, { withYear: false, weekday: true })}
                      </Text>
                    )}
                    {!!item.feedback && (
                      <View style={[styles.feedbackBox, item.status === 'redo' && styles.feedbackBoxRedo]}>
                        <AuthoredContent compact written body={item.feedback} />
                      </View>
                    )}
                    {item.status === 'redo' && item.submissions_closed && (
                      <Text style={styles.closedNote}>Submissions are closed.</Text>
                    )}
                    {item.status !== 'waiting' && (
                      <View style={styles.actions}>
                        {item.status === 'redo' && (
                          <Button
                            size="sm"
                            variant="primary"
                            onPress={() => openLesson(item)}
                          >
                            <Text>{item.can_resubmit && !work.read_only ? 'Open and resubmit' : 'Read feedback'}</Text>
                            <ArrowRight color={c.text.onAction} size={15} />
                          </Button>
                        )}
                        {item.ask_to && !work.read_only && (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={openingDmId === item.submission_id}
                            disabled={openingDmId !== null}
                            onPress={() => void askAboutFeedback(item)}
                          >
                            <MessageSquare color={c.text.strong} size={15} />
                            <Text>Ask about this feedback</Text>
                          </Button>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </Card>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors: c, radius }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  header: {
    minHeight: 56,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border.subtle,
    backgroundColor: c.surface.page,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  headerTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 18, letterSpacing: -0.3 },
  headerSubtitle: { color: c.text.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  refreshBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.status.warning.border,
    backgroundColor: c.status.warning.bg,
  },
  refreshBannerText: { flex: 1, color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 13 },
  segmented: {
    padding: 4,
    borderRadius: radius.card,
    backgroundColor: c.surface.sunken,
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  segmentActive: {
    backgroundColor: c.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border.subtle,
  },
  segmentLabel: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 13 },
  segmentLabelActive: { color: c.text.strong, fontFamily: fonts.bold },
  segmentCount: { ...tabularNums, color: c.text.muted, fontFamily: fonts.bold, fontSize: 12 },
  segmentCountActive: { color: c.selection.indicator },
  listCard: { padding: 0, gap: 0, overflow: 'hidden' },
  itemRow: { padding: 16, gap: 12 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle },
  itemTap: { gap: 10 },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  statusTile: { width: 34, height: 34, borderRadius: radius.control, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  warningTile: { backgroundColor: c.status.warning.bg },
  successTile: { backgroundColor: c.status.success.bg },
  itemTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 },
  itemMeta: { ...tabularNums, color: c.text.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginTop: 2 },
  expectedReview: { ...tabularNums, color: c.text.strong, fontFamily: fonts.semibold, fontSize: 13 },
  feedbackBox: {
    borderLeftWidth: 2,
    borderLeftColor: c.border.strong,
    paddingLeft: 12,
  },
  feedbackBoxRedo: { borderLeftColor: c.status.warning.fg },
  closedNote: { color: c.text.muted, fontFamily: fonts.medium, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 8 },
  emptyIcon: { width: 48, height: 48, borderRadius: radius.card, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, textAlign: 'center' },
  emptyCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: 'center' },
}));
