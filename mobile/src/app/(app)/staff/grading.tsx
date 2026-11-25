import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/back-button';
import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowRight, ClipboardCheck, ExternalLink, GitPullRequest, Inbox } from 'lucide-react-native';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { gradingQueueKey, nextGradingQueueToken } from '@/lib/grading-queue';
import { LearningCard } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { StaffOnlyScreen } from '@/components/staff-only-screen';
import { fonts } from '@/constants/csg-theme';
import { demoStaffSubmissions } from '@/lib/demo-staff';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import type { components } from '@/lib/api.generated';
import type { Submission } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useCohort } from '@/providers/cohort-provider';

export default function StaffGradingScreen({ rootTab = false }: { rootTab?: boolean }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { cohort_id, module_id, filter: requestedFilter, page: requestedPage } = useLocalSearchParams<{ cohort_id?: string; module_id?: string; filter?: string; page?: string }>();
  const { selectedCohortId, selectedCohort } = useCohort();
  const cohortId = cohort_id ? Number(cohort_id) : selectedCohortId;
  const moduleId = Number(module_id) || undefined;
  const filter = requestedFilter === 'redo' ? 'redo' : 'ungraded';
  const page = Math.max(1, Number(requestedPage) || 1);
  const queryClient = useQueryClient();
  type Row = Pick<Submission, 'id' | 'cohort_id' | 'user_id' | 'user_name' | 'content_block_type' | 'lesson_title' | 'cohort_name' | 'content_block_title' | 'num_submissions' | 'created_at'>;
  type Page = { github_sync_module_ids?: number[]; meta?: Pick<components['schemas']['PaginationMeta'], 'total_count'>; submissions: Row[]; previous: components['schemas']['GradingQueueItem'] | null; next: components['schemas']['GradingQueueItem'] | null };
  const query = useQuery<Page>({
    queryKey: ['staff-grading-queue', user?.id, cohortId, filter, page, moduleId],
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ next: null, previous: null, submissions: demoStaffSubmissions.filter((item) => item.grade === (filter === 'redo' ? 'R' : null) && (!cohortId || item.cohort_id === cohortId)) }) : moduleId ? api.gradingQueue(filter, cohortId, page, signal, moduleId) : api.gradingQueue(filter, cohortId, page, signal),
    enabled: Boolean(user?.is_staff),
  });

  const syncModuleIds = query.data?.github_sync_module_ids || [];
  const sync = useMutation({
    mutationFn: async ({ cohortId, moduleIds }: { cohortId: number; moduleId?: number; moduleIds: number[] }) => {
      let synced = 0;
      let firstError: string | undefined;
      for (const id of moduleIds) {
        try {
          const result = await api.syncCohortModuleGithub(cohortId, id);
          synced += result.synced;
          firstError ??= result.errors?.[0];
        } catch (error) {
          firstError ??= error instanceof Error ? error.message : 'Could not sync this module.';
        }
      }
      const summary = `Synced ${synced} new submission${synced === 1 ? '' : 's'}`;
      return firstError ? `${synced ? `${summary}. ` : ''}GitHub sync incomplete. ${firstError}` : synced ? summary : 'Already up to date';
    },
    onSuccess: (_, scope) => queryClient.invalidateQueries({ queryKey: ['staff-grading-queue', user?.id, scope.cohortId] }),
  });
  const syncMessage = sync.variables?.cohortId === cohortId && sync.variables?.moduleId === moduleId ? sync.data : null;

  function openSubmission(submission: Pick<Submission, 'id' | 'cohort_id' | 'user_id'>) {
    const queue = nextGradingQueueToken();
    queryClient.setQueryDefaults(gradingQueueKey(user!.id, queue), { gcTime: 30 * 60 * 1000, meta: { persist: false } });
    queryClient.setQueryData(gradingQueueKey(user!.id, queue), { submissions: [...(query.data?.previous ? [query.data.previous] : []), ...(query.data?.submissions || []), ...(query.data?.next ? [query.data.next] : [])], cohortId, filter });
    router.push({ pathname: '/staff/submission/[id]', params: { id: String(submission.id), queue, ...(submission.cohort_id ? { cohort_id: String(submission.cohort_id), student_id: String(submission.user_id) } : {}) } });
  }

  if (!user?.is_staff) return <StaffOnlyScreen message="The grading queue is available to instructors and admins." />;
  const submissions = query.data?.submissions || [];
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}>{!rootTab && <BackButton style={styles.back} />}<View style={styles.headerCopy}><Text style={styles.kicker}>STAFF WORKFLOW</Text><Text style={styles.headerTitle}>Grading queue</Text></View><View style={styles.count}><Text style={styles.countText}>{query.data?.meta?.total_count ?? submissions.length}</Text></View></View>
    {query.isPending && !query.data ? <LoadingState label="Loading grading queue" /> : query.error && !query.data ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
      {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved submissions. Pull to reconnect.</Text></View>}
      <Text style={styles.title}>{filter === 'redo' ? 'Redo requests' : 'Waiting for review'}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button variant={filter === 'ungraded' ? 'primary' : 'secondary'} accessibilityState={{ selected: filter === 'ungraded' }} label="Waiting" onPress={() => router.setParams({ filter: 'ungraded', page: '1' })} />
        <Button variant={filter === 'redo' ? 'primary' : 'secondary'} accessibilityState={{ selected: filter === 'redo' }} label="Redos" onPress={() => router.setParams({ filter: 'redo', page: '1' })} />
      </View>
      {cohortId && syncModuleIds.length > 0 && <Button variant="secondary" label={sync.isPending ? 'Syncing…' : 'Sync GitHub'} disabled={sync.isPending} onPress={() => sync.mutate({ cohortId, moduleId, moduleIds: syncModuleIds })} />}
      {syncMessage && <LearningCard><Text accessibilityLiveRegion="polite" style={styles.syncText}>{syncMessage}</Text></LearningCard>}
      <Text style={styles.subtitle}>{cohortId ? `${selectedCohort?.name || 'This cohort'} · ` : 'All cohorts · '}Quick feedback from your phone.</Text>
      <View style={styles.stack}>{submissions.map((submission) => <LearningCard key={submission.id} onPress={() => openSubmission(submission)} label={`Review ${submission.user_name}'s submission`}><View style={styles.row}><View style={styles.icon}>{submission.content_block_type === 'code_challenge' ? <GitPullRequest color={c.text.body} size={20} /> : <ClipboardCheck color={c.text.body} size={20} />}</View><View style={styles.flex}><Text style={styles.student}>{submission.user_name}</Text><Text style={styles.lesson}>{submission.lesson_title}{submission.cohort_name ? ` · ${submission.cohort_name}` : ''}</Text><Text numberOfLines={2} style={styles.exercise}>{submission.content_block_title} · attempt {submission.num_submissions}</Text><Text style={styles.time}>{formatRelative(submission.created_at)}</Text></View><ArrowRight color={c.text.muted} size={18} /></View></LearningCard>)}</View>
      <View style={{ flexDirection: 'row', gap: 8 }}>{query.data?.previous && <Button label="Previous page" onPress={() => router.setParams({ page: String(page - 1) })} />}{query.data?.next && <Button label="Next page" onPress={() => router.setParams({ page: String(page + 1) })} />}</View>
      {!submissions.length && <View style={styles.empty}><View style={styles.emptyIcon}><Inbox color={c.status.success.fg} size={28} /></View><Text style={styles.emptyTitle}>Queue cleared</Text><Text style={styles.emptyCopy}>There is no ungraded work waiting right now.</Text></View>}
      <Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, `/admin/grading${cohortId ? `?cohort_id=${cohortId}` : ''}`).catch((error) => Alert.alert('Could not open full grading', (error as Error).message))} style={styles.handoff}><ExternalLink color={c.text.body} size={18} /><View style={styles.flex}><Text style={styles.handoffTitle}>Open full grading</Text><Text style={styles.handoffCopy}>Bulk grading, cohort filters, and dense progress views</Text></View><ArrowRight color={c.text.muted} size={17} /></Pressable>
    </ScrollView>}
  </SafeAreaView>;
}

function formatRelative(value: string) { const hours = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 3_600_000)); if (hours < 1) return 'Submitted recently'; if (hours < 24) return `Submitted ${hours}h ago`; return `Submitted ${Math.floor(hours / 24)}d ago`; }

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  syncText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 13 },
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1 }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.2 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, count: { minWidth: 32, height: 32, borderRadius: 16, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center', marginRight: 10 }, countText: { color: c.text.body, fontFamily: fonts.extraBold, fontSize: 12 }, content: { padding: 20, paddingBottom: 60, gap: 16 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 29, lineHeight: 35, letterSpacing: -0.8 }, subtitle: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, marginTop: -8 }, stack: { gap: 9, marginTop: 4 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, student: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, lesson: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12, marginTop: 2 }, exercise: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 2 }, time: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, marginTop: 7 }, empty: { alignItems: 'center', paddingVertical: 50 }, emptyIcon: { width: 62, height: 62, borderRadius: 22, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 18, marginTop: 14 }, emptyCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 5 }, handoff: { minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 8 }, handoffTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, handoffCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 3 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: c.status.warning.bg, justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12 },
}));
