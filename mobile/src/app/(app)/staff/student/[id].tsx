import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Activity, AlertTriangle, ArrowLeft, ArrowRight, BookOpen, CalendarClock, CheckCircle2, ClipboardCheck, Clock3, ExternalLink, Film, GitBranch, MessageSquare, RotateCcw, UserRound } from 'lucide-react-native';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, SectionHeading } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import { demoInterventions, demoLessonVideoProgress, demoRecordingProgress, demoStaffSubmissions, demoStudentProgress } from '@/lib/demo-staff';
import { demoDms } from '@/lib/demo-data';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { currentSubmissions, learningKeys } from '@/lib/learning';
import type { Intervention, StaffVideoProgress, Submission } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function StaffStudentScreen() {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const { id, cohort_id: cohortIdParam } = useLocalSearchParams<{ id: string; cohort_id?: string }>();
  const studentId = Number(id);
  const requestedCohortId = Number(cohortIdParam) || undefined;
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: learningKeys.studentDetail(user?.id || 0, studentId, requestedCohortId),
    queryFn: async ({ signal }) => {
      if (auth.demo) return { progress: demoStudentProgress, submissions: demoStaffSubmissions, recordings: demoRecordingProgress, lessonVideos: demoLessonVideoProgress, intervention: demoInterventions[0], unavailable: [] };
      const progress = await api.studentProgress(studentId, requestedCohortId, signal);
      const [submissionResult, recordingResult, lessonVideoResult, supportResult] = await Promise.allSettled([
        api.submissions({ user_id: studentId, cohort_id: progress.cohort.id }, signal),
        api.studentRecordingProgress(studentId, progress.cohort.id, signal),
        api.studentLessonVideoProgress(studentId, progress.cohort.id, signal),
        api.supportQueue(signal),
      ]);
      const unavailable: string[] = [];
      if (submissionResult.status === 'rejected') unavailable.push('submissions');
      if (recordingResult.status === 'rejected') unavailable.push('recording activity');
      if (lessonVideoResult.status === 'rejected') unavailable.push('lesson-video activity');
      if (supportResult.status === 'rejected') unavailable.push('intervention history');
      const blockIds = new Set(progress.modules.flatMap((mod) => mod.lessons.flatMap((lesson) => lesson.blocks.map((block) => block.id))));
      return {
        progress,
        submissions: submissionResult.status === 'fulfilled' ? submissionResult.value.submissions.filter((submission) => blockIds.has(submission.content_block_id)) : [],
        recordings: recordingResult.status === 'fulfilled' ? recordingResult.value.watch_progresses : [],
        lessonVideos: lessonVideoResult.status === 'fulfilled' ? lessonVideoResult.value.lesson_videos : [],
        intervention: supportResult.status === 'fulfilled' ? supportResult.value.support_queue.interventions.find((item) => item.enrollment.id === progress.enrollment.id) : undefined,
        unavailable,
      };
    },
    enabled: Boolean(user?.is_staff && Number.isInteger(studentId) && studentId > 0),
  });

  function openIntervention(intervention: Intervention) {
    queryClient.setQueryData(learningKeys.intervention(user!.id, intervention.id), { intervention });
    router.push({ pathname: '/staff/intervention/[id]', params: { id: String(intervention.id) } });
  }

  function openSubmission(submission: Submission, cohortId: number) {
    queryClient.setQueryData(learningKeys.submission(user!.id, submission.id), { submission });
    router.push({ pathname: '/staff/submission/[id]', params: { id: String(submission.id), cohort_id: String(cohortId), student_id: String(studentId) } });
  }

  async function openDirectMessage() {
    const cohortId = query.data?.progress.cohort.id;
    if (!cohortId) return;
    try {
      const conversation = auth.demo
        ? demoDms.find((item) => item.cohort_id === cohortId && item.users.some((member) => member.id === studentId))
        : (await api.createCohortDm(cohortId, [studentId])).direct_conversation;
      if (!conversation) throw new Error('No cohort conversation is available for this student.');
      router.push({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(conversation.id) } });
    } catch (error) {
      Alert.alert('Could not open direct message', (error as Error).message);
    }
  }

  if (!user?.is_staff) return <SafeAreaView style={styles.safe}><ErrorState title="Staff access only" message="Student progress records are available to instructors and admins." retryLabel="Go to Today" retry={() => router.replace('/')} /></SafeAreaView>;
  if (!Number.isInteger(studentId) || studentId <= 0) return <SafeAreaView style={styles.safe}><ErrorState message="This student link is invalid." retryLabel="Go to Today" retry={() => router.replace('/')} /></SafeAreaView>;
  if (query.isPending && !query.data) return <SafeAreaView style={styles.safe}><LoadingState label="Loading student health" /></SafeAreaView>;
  if (query.error && !query.data) return <SafeAreaView style={styles.safe}><ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /></SafeAreaView>;
  const data = query.data!;
  const currentWork = currentSubmissions(data.submissions);
  const ungraded = currentWork.filter((item) => item.grade === null);
  const redo = currentWork.filter((item) => item.grade === 'R');
  const videoProgress = [...data.recordings, ...data.lessonVideos];
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable><View style={styles.headerCopy}><Text style={styles.kicker}>STUDENT HEALTH</Text><Text numberOfLines={1} style={styles.headerTitle}>{data.progress.user.full_name}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Open full student workspace" onPress={() => void openAuthenticatedWebPage(api, `/admin/cohorts/${data.progress.cohort.id}/students/${studentId}/overview`).catch((error) => Alert.alert('Could not open student workspace', (error as Error).message))} style={styles.back}><ExternalLink color={c.text.body} size={20} /></Pressable></View>
    <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
      {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved student data. Pull to reconnect.</Text></View>}
      {!!data.unavailable?.length && <View style={styles.offline}><Text style={styles.offlineText}>Some details are temporarily unavailable: {data.unavailable.join(', ')}. Pull to try again.</Text></View>}
      <View style={styles.identity}><View style={styles.avatar}><Text allowFontScaling={false} style={styles.initials}>{initials(data.progress.user.full_name)}</Text></View><View style={styles.flex}><Text style={styles.name}>{data.progress.user.full_name}</Text><Text style={styles.email}>{data.progress.user.email}</Text><View style={styles.identityMeta}>{data.progress.user.github_username && <View style={styles.metaChip}><GitBranch color={c.text.body} size={12} /><Text style={styles.metaChipText}>{data.progress.user.github_username}</Text></View>}<View style={styles.metaChip}><UserRound color={c.status.success.fg} size={12} /><Text style={[styles.metaChipText, { color: c.status.success.fg }]}>{data.progress.cohort.name}</Text></View></View></View></View>
      <LearningCard><View style={styles.progressTop}><View><Text style={styles.progressKicker}>OVERALL PROGRESS</Text><Text style={styles.progressNumber}>{Math.round(data.progress.overall_progress.percentage)}%</Text></View><View style={styles.stepCount}><Text style={styles.stepCountValue}>{data.progress.overall_progress.completed}/{data.progress.overall_progress.total}</Text><Text style={styles.stepCountLabel}>steps complete</Text></View></View><ProgressBar value={data.progress.overall_progress.percentage} label={`${data.progress.user.full_name} progress`} /><Text style={styles.lastSeen}>Last seen {formatRelative(data.progress.user.last_seen_at || data.progress.user.last_sign_in_at)}</Text></LearningCard>
      <View style={styles.signalGrid}><SignalCard icon={Clock3} value={data.unavailable.includes('submissions') ? null : ungraded.length} label="awaiting review" tone="pending" /><SignalCard icon={RotateCcw} value={data.unavailable.includes('submissions') ? null : redo.length} label="redo requested" tone="warning" /><SignalCard icon={Film} value={data.unavailable.some((section) => section.includes('activity')) ? null : videoProgress.filter((item) => item.completed).length} label="videos complete" tone="success" /></View>
      <View style={styles.quickRow}><Pressable accessibilityRole="button" accessibilityLabel={`Message ${data.progress.user.full_name} in ${data.progress.cohort.name}`} onPress={() => void openDirectMessage()} style={styles.quick}><MessageSquare color={c.text.body} size={18} /><Text style={styles.quickText}>Message</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, `/admin/cohorts/${data.progress.cohort.id}/students/${studentId}/overview`).catch((error) => Alert.alert('Could not open student workspace', (error as Error).message))} style={styles.quick}><ExternalLink color={c.text.body} size={18} /><Text style={styles.quickText}>Full workspace</Text></Pressable></View>
      {data.intervention && <Pressable accessibilityRole="button" accessibilityLabel={`Open active intervention for ${data.progress.user.full_name}`} onPress={() => openIntervention(data.intervention!)} style={[styles.intervention, data.intervention.follow_up_due && styles.interventionDue]}><CalendarClock color={data.intervention.follow_up_due ? c.status.warning.fg : c.text.body} size={19} /><View style={styles.flex}><Text style={[styles.interventionTitle, data.intervention.follow_up_due && styles.interventionTitleDue]}>{data.intervention.follow_up_due ? 'Intervention follow-up due' : 'Active intervention'}</Text><Text numberOfLines={2} style={styles.interventionCopy}>{data.intervention.trigger_type.replaceAll('_', ' ')} · {data.intervention.status.replaceAll('_', ' ')} · {data.intervention.owner.full_name}</Text></View><ArrowRight color={c.text.muted} size={17} /></Pressable>}

      {data.unavailable.includes('submissions') && <ErrorState title="Submissions unavailable" message="Review counts could not be loaded for this enrollment." retry={() => void query.refetch()} />}
      {data.unavailable.some((section) => section.includes('activity')) && <ErrorState title="Video activity unavailable" message="Video totals are incomplete. Retry to load this enrollment’s activity." retry={() => void query.refetch()} />}
      {data.unavailable.includes('intervention history') && <ErrorState title="Intervention history unavailable" message="Support details could not be loaded." retry={() => void query.refetch()} />}
      {!!ungraded.length && <View style={styles.section}><SectionHeading eyebrow="Respond now" title="Ready for review" /><View style={styles.stack}>{ungraded.map((submission) => <LearningCard key={submission.id} onPress={() => openSubmission(submission, data.progress.cohort.id)} label={`Review ${submission.content_block_title}`}><View style={styles.row}><View style={styles.reviewIcon}><ClipboardCheck color={c.text.body} size={18} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{submission.lesson_title}</Text><Text style={styles.cardMeta}>{submission.content_block_title} · attempt {submission.num_submissions}</Text></View><ArrowRight color={c.text.muted} size={18} /></View></LearningCard>)}</View></View>}

      <View style={styles.section}><SectionHeading eyebrow="Curriculum" title="Learning progress" /><View style={styles.stack}>{data.progress.modules.map((mod) => <LearningCard key={mod.id}><View style={styles.moduleTop}><View style={styles.moduleIcon}><BookOpen color={c.text.body} size={18} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{mod.name}</Text><Text style={styles.cardMeta}>{mod.completed_blocks} of {mod.total_blocks} steps · {mod.lessons.filter((lesson) => lesson.completed).length}/{mod.lessons.length} lessons</Text></View><Text style={styles.modulePercent}>{Math.round(mod.progress_percentage)}%</Text></View><View style={styles.moduleBar}><ProgressBar value={mod.progress_percentage} label={`${mod.name} progress`} /></View>{mod.lessons.slice(0, 4).map((lesson) => <View key={lesson.id} style={styles.lessonRow}>{lesson.completed ? <CheckCircle2 color={c.status.success.fg} size={15} /> : <Activity color={lesson.available ? c.status.warning.fg : c.text.muted} size={15} />}<Text numberOfLines={1} style={styles.lessonTitle}>{lesson.title}</Text><Text style={styles.lessonCount}>{lesson.completed_blocks}/{lesson.total_blocks}</Text></View>)}</LearningCard>)}</View></View>

      {!!videoProgress.length && <View style={styles.section}><SectionHeading eyebrow="Engagement" title="Video progress" /><View style={styles.stack}>{videoProgress.slice(0, 8).map((item) => <VideoRow key={`${item.recording_id ? 'recording' : 'lesson'}:${item.recording_id || item.content_block_id}`} item={item} />)}</View></View>}

      <Pressable accessibilityRole="button" accessibilityLabel={`Open activity history for ${data.progress.user.full_name}`} onPress={() => router.push({ pathname: '/activity', params: { user_id: String(studentId), name: data.progress.user.full_name, cohort_id: String(data.progress.cohort.id) } })} style={styles.handoff}><Activity color={c.text.body} size={18} /><View style={styles.flex}><Text style={styles.handoffTitle}>Activity history</Text><Text style={styles.handoffCopy}>Sign-ins, player-reported video progress, submissions, and grading.</Text></View><ArrowRight color={c.text.muted} size={17} /></Pressable>

      {!!data.progress.recent_activity.length && <View style={styles.section}><SectionHeading eyebrow="Recent signals" title="Activity" /><LearningCard>{data.progress.recent_activity.map((item, index) => <View key={`${item.content_block_id}:${item.completed_at}`} style={[styles.activityRow, index > 0 && styles.divider]}><CheckCircle2 color={c.status.success.fg} size={16} /><View style={styles.flex}><Text style={styles.activityTitle}>{item.block_title || item.block_type}</Text><Text style={styles.cardMeta}>Completed {formatRelative(item.completed_at)}</Text></View></View>)}</LearningCard></View>}
      {user.is_admin && <Pressable accessibilityRole="button" accessibilityLabel={`Open safe restart controls for ${data.progress.user.full_name}`} onPress={() => void openAuthenticatedWebPage(api, `/admin/cohorts/${data.progress.cohort.id}/students/${studentId}/access`).catch((error) => Alert.alert('Could not open restart controls', (error as Error).message))} style={styles.restart}><RotateCcw color={c.text.body} size={18} /><View style={styles.flex}><Text style={styles.restartTitle}>Restart class progress</Text><Text style={styles.restartCopy}>Opens the audited email-confirmation workflow</Text></View><ExternalLink color={c.text.muted} size={17} /></Pressable>}
      <Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, `/admin/cohorts/${data.progress.cohort.id}/students/${studentId}/access`).catch((error) => Alert.alert('Could not open student access', (error as Error).message))} style={styles.handoff}><AlertTriangle color={c.status.warning.fg} size={18} /><View style={styles.flex}><Text style={styles.handoffTitle}>Need advanced controls?</Text><Text style={styles.handoffCopy}>Open access, overrides, and administration controls for this enrollment securely on the web.</Text></View><ExternalLink color={c.text.muted} size={17} /></Pressable>
    </ScrollView>
  </SafeAreaView>;
}

function SignalCard({ icon: Icon, value, label, tone }: { icon: typeof ClipboardCheck; value: number | null; label: string; tone: 'pending' | 'warning' | 'success' }) {
  const styles = useStyles();
  const { colors: c, statusTones } = useTheme(); const color = tone === 'warning' ? c.status.warning.fg : tone === 'success' ? c.status.success.fg : statusTones.pending.text; return <View style={styles.signalCard}><Icon color={color} size={17} /><Text style={styles.signalValue}>{value ?? 'Unavailable'}</Text><Text style={styles.signalLabel}>{label}</Text></View>; }
function VideoRow({ item }: { item: StaffVideoProgress }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); const title = item.recording_title || item.title || item.lesson_title || 'Class video'; return <LearningCard><View style={styles.row}><View style={[styles.reviewIcon, item.completed && styles.completeIcon]}>{item.completed ? <CheckCircle2 color={c.status.success.fg} size={18} /> : <Film color={c.text.body} size={18} />}</View><View style={styles.flex}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardMeta}>{item.module_title || item.cohort_name} · {Math.round(item.progress_percentage)}% watched</Text><View style={styles.videoBar}><ProgressBar value={item.progress_percentage} label={`${title} watch progress`} /></View></View></View></LearningCard>; }
function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function formatRelative(value: string | null) { if (!value) return 'not recorded'; const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86_400_000)); if (days === 0) return 'today'; if (days === 1) return 'yesterday'; return `${days} days ago`; }

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minWidth: 0 }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.2 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, content: { padding: 20, paddingBottom: 70, gap: 16 }, identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 }, avatar: { width: 64, height: 64, borderRadius: 22, backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong, alignItems: 'center', justifyContent: 'center' }, initials: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 18 }, flex: { flex: 1, minWidth: 0 }, name: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 23, letterSpacing: -0.5 }, email: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }, identityMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 }, metaChip: { minHeight: 25, borderRadius: 13, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 }, metaChipText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, scopeNote: { borderRadius: 16, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, scopeText: { flex: 1, color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 }, progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }, progressKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.1 }, progressNumber: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 32, marginTop: 3 }, stepCount: { alignItems: 'flex-end' }, stepCountValue: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, stepCountLabel: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 }, lastSeen: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, marginTop: 10 }, signalGrid: { flexDirection: 'row', gap: 8 }, signalCard: { flex: 1, minHeight: 100, borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 13, justifyContent: 'space-between' }, signalValue: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 21, marginTop: 7 }, signalLabel: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 }, quickRow: { flexDirection: 'row', gap: 9 }, quick: { flex: 1, minHeight: 48, borderRadius: 15, backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, quickText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, section: { gap: 11, marginTop: 10 }, stack: { gap: 9 }, row: { flexDirection: 'row', alignItems: 'center', gap: 11 }, reviewIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, completeIcon: { backgroundColor: c.surface.sunken }, cardTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 }, cardMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 2 }, moduleTop: { flexDirection: 'row', alignItems: 'center', gap: 11 }, moduleIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, modulePercent: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 13 }, moduleBar: { marginTop: 13, marginBottom: 7 }, lessonRow: { minHeight: 37, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', gap: 8 }, lessonTitle: { flex: 1, color: c.text.body, fontFamily: fonts.medium, fontSize: 12 }, lessonCount: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, videoBar: { marginTop: 8 }, activityRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }, divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle }, activityTitle: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 12 }, restart: { minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 8 }, restartTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, restartCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 3 }, handoff: { minHeight: 82, borderRadius: 18, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 8 }, handoffTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, handoffCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 3 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: c.status.warning.bg, justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12 },
  intervention: { minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, interventionDue: { borderColor: c.status.warning.border, backgroundColor: c.status.warning.bg}, interventionTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, interventionTitleDue: { color: c.status.warning.fg}, interventionCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 3 },
}));
