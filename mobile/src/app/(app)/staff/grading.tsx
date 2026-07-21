import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, ClipboardCheck, ExternalLink, GitPullRequest, Inbox } from 'lucide-react-native';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoStaffSubmissions } from '@/lib/demo-staff';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function StaffGradingScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const query = useQuery({
    queryKey: learningKeys.submissions(user?.id || 0),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ submissions: demoStaffSubmissions.filter((item) => item.grade === null) }) : api.submissions({ ungraded: true }, signal),
    enabled: Boolean(user?.is_staff),
  });

  if (!user?.is_staff) return <SafeAreaView style={styles.safe}><ErrorState message="Staff access is required." retry={() => router.replace('/')} /></SafeAreaView>;
  const submissions = query.data?.submissions || [];
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.headerCopy}><Text style={styles.kicker}>STAFF WORKFLOW</Text><Text style={styles.headerTitle}>Grading queue</Text></View><View style={styles.count}><Text style={styles.countText}>{submissions.length}</Text></View></View>
    {query.isPending && !query.data ? <LoadingState label="Loading grading queue" /> : query.error && !query.data ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
      {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved submissions. Pull to reconnect.</Text></View>}
      <Text style={styles.title}>Review what is ready now.</Text><Text style={styles.subtitle}>This focused queue keeps quick feedback native. Use the full matrix for bulk grading and cross-cohort comparisons.</Text>
      <View style={styles.stack}>{submissions.map((submission) => <LearningCard key={submission.id} onPress={() => router.push(`/staff/submission/${submission.id}`)} label={`Review ${submission.user_name}'s submission`}><View style={styles.row}><View style={styles.icon}>{submission.repo_url || submission.pr_url ? <GitPullRequest color={palette.rubySoft} size={20} /> : <ClipboardCheck color={palette.rubySoft} size={20} />}</View><View style={styles.flex}><Text style={styles.student}>{submission.user_name}</Text><Text style={styles.lesson}>{submission.lesson_title}</Text><Text numberOfLines={2} style={styles.exercise}>{submission.content_block_title} · attempt {submission.num_submissions}</Text><Text style={styles.time}>{formatRelative(submission.created_at)}</Text></View><ArrowRight color={palette.quiet} size={18} /></View></LearningCard>)}</View>
      {!submissions.length && <View style={styles.empty}><View style={styles.emptyIcon}><Inbox color={palette.success} size={28} /></View><Text style={styles.emptyTitle}>Queue cleared</Text><Text style={styles.emptyCopy}>There is no ungraded work waiting right now.</Text></View>}
      <Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, '/admin/grading').catch((error) => Alert.alert('Could not open full grading', (error as Error).message))} style={styles.handoff}><ExternalLink color={palette.rubySoft} size={18} /><View style={styles.flex}><Text style={styles.handoffTitle}>Open full grading matrix</Text><Text style={styles.handoffCopy}>Bulk grading, cohort filters, and dense progress views</Text></View><ArrowRight color={palette.quiet} size={17} /></Pressable>
    </ScrollView>}
  </SafeAreaView>;
}

function formatRelative(value: string) { const hours = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 3_600_000)); if (hours < 1) return 'Submitted recently'; if (hours < 24) return `Submitted ${hours}h ago`; return `Submitted ${Math.floor(hours / 24)}d ago`; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1.2 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, count: { minWidth: 32, height: 32, borderRadius: 16, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center', marginRight: 10 }, countText: { color: palette.rubySoft, fontFamily: fonts.extraBold, fontSize: 11 }, content: { padding: 20, paddingBottom: 60, gap: 16 }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 29, lineHeight: 35, letterSpacing: -0.8 }, subtitle: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, marginTop: -8 }, stack: { gap: 9, marginTop: 4 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, student: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 }, lesson: { color: '#C4C8D2', fontFamily: fonts.semibold, fontSize: 11, marginTop: 2 }, exercise: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 9, lineHeight: 14, marginTop: 2 }, time: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, marginTop: 7 }, empty: { alignItems: 'center', paddingVertical: 50 }, emptyIcon: { width: 62, height: 62, borderRadius: 22, backgroundColor: '#10271F', alignItems: 'center', justifyContent: 'center' }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 18, marginTop: 14 }, emptyCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 5 }, handoff: { minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 8 }, handoffTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, handoffCopy: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 9, lineHeight: 14, marginTop: 3 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: '#2A2115', justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: palette.warning, fontFamily: fonts.semibold, fontSize: 10 },
});
