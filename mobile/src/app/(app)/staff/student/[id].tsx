import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Activity, AlertTriangle, ArrowLeft, ArrowRight, BookOpen, CalendarClock, CheckCircle2, ClipboardCheck, ExternalLink, Film, GitBranch, MessageSquare, RotateCcw, UserRound } from 'lucide-react-native';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, SectionHeading } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoInterventions, demoLessonVideoProgress, demoRecordingProgress, demoStaffSubmissions, demoStudentProgress } from '@/lib/demo-staff';
import { demoDms } from '@/lib/demo-data';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { learningKeys } from '@/lib/learning';
import type { Intervention, StaffVideoProgress, Submission } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function StaffStudentScreen() {
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
        api.submissions({ user_id: studentId }, signal),
        api.studentRecordingProgress(studentId, requestedCohortId, signal),
        api.studentLessonVideoProgress(studentId, requestedCohortId, signal),
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
  const ungraded = data.submissions.filter((item) => item.grade === null);
  const redo = data.submissions.filter((item) => item.grade === 'R');
  const videoProgress = [...data.recordings, ...data.lessonVideos];
  const evidenceScope = data.progress.learning_evidence_scope;
  const sharedEvidence = Boolean(evidenceScope?.shared_across_enrollments);
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.headerCopy}><Text style={styles.kicker}>STUDENT HEALTH</Text><Text numberOfLines={1} style={styles.headerTitle}>{data.progress.user.full_name}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Open full student workspace" onPress={() => void openAuthenticatedWebPage(api, `/admin/cohorts/${data.progress.cohort.id}/students/${studentId}/overview`).catch((error) => Alert.alert('Could not open student workspace', (error as Error).message))} style={styles.back}><ExternalLink color={palette.muted} size={20} /></Pressable></View>
    <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
      {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved student data. Pull to reconnect.</Text></View>}
      {!!data.unavailable?.length && <View style={styles.offline}><Text style={styles.offlineText}>Some details are temporarily unavailable: {data.unavailable.join(', ')}. Pull to try again.</Text></View>}
      <View style={styles.identity}><View style={styles.avatar}><Text allowFontScaling={false} style={styles.initials}>{initials(data.progress.user.full_name)}</Text></View><View style={styles.flex}><Text style={styles.name}>{data.progress.user.full_name}</Text><Text style={styles.email}>{data.progress.user.email}</Text><View style={styles.identityMeta}>{data.progress.user.github_username && <View style={styles.metaChip}><GitBranch color={palette.muted} size={12} /><Text style={styles.metaChipText}>{data.progress.user.github_username}</Text></View>}<View style={styles.metaChip}><UserRound color={palette.success} size={12} /><Text style={[styles.metaChipText, { color: palette.success }]}>{data.progress.cohort.name}</Text></View></View></View></View>
      {sharedEvidence && evidenceScope && <View style={styles.scopeNote}><BookOpen color="#7DA8E8" size={17} /><Text style={styles.scopeText}>Progress and work follow this learner across {evidenceScope.enrollment_count} {evidenceScope.curriculum_name} enrollments. Messages and cohort actions here stay in {data.progress.cohort.name}.</Text></View>}
      <LearningCard><View style={styles.progressTop}><View><Text style={styles.progressKicker}>OVERALL PROGRESS</Text><Text style={styles.progressNumber}>{Math.round(data.progress.overall_progress.percentage)}%</Text></View><View style={styles.stepCount}><Text style={styles.stepCountValue}>{data.progress.overall_progress.completed}/{data.progress.overall_progress.total}</Text><Text style={styles.stepCountLabel}>steps complete</Text></View></View><ProgressBar value={data.progress.overall_progress.percentage} label={`${data.progress.user.full_name} progress`} /><Text style={styles.lastSeen}>Last seen {formatRelative(data.progress.user.last_seen_at || data.progress.user.last_sign_in_at)}</Text></LearningCard>
      <View style={styles.signalGrid}><SignalCard icon={ClipboardCheck} value={ungraded.length} label="awaiting review" tone="ruby" /><SignalCard icon={RotateCcw} value={redo.length} label="redo requested" tone="warning" /><SignalCard icon={Film} value={videoProgress.filter((item) => item.completed).length} label="videos complete" tone="success" /></View>
      <View style={styles.quickRow}><Pressable accessibilityRole="button" accessibilityLabel={`Message ${data.progress.user.full_name} in ${data.progress.cohort.name}`} onPress={() => void openDirectMessage()} style={styles.quick}><MessageSquare color={palette.rubySoft} size={18} /><Text style={styles.quickText}>{sharedEvidence ? `Message in ${data.progress.cohort.name}` : 'Message'}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, `/admin/cohorts/${data.progress.cohort.id}/students/${studentId}/overview`).catch((error) => Alert.alert('Could not open student workspace', (error as Error).message))} style={styles.quick}><ExternalLink color={palette.rubySoft} size={18} /><Text style={styles.quickText}>Full workspace</Text></Pressable></View>
      {data.intervention && <Pressable accessibilityRole="button" accessibilityLabel={`Open active intervention for ${data.progress.user.full_name}`} onPress={() => openIntervention(data.intervention!)} style={[styles.intervention, data.intervention.follow_up_due && styles.interventionDue]}><CalendarClock color={data.intervention.follow_up_due ? '#FF7187' : palette.rubySoft} size={19} /><View style={styles.flex}><Text style={[styles.interventionTitle, data.intervention.follow_up_due && styles.interventionTitleDue]}>{data.intervention.follow_up_due ? 'Intervention follow-up due' : 'Active intervention'}</Text><Text numberOfLines={2} style={styles.interventionCopy}>{data.intervention.trigger_type.replaceAll('_', ' ')} · {data.intervention.status.replaceAll('_', ' ')} · {data.intervention.owner.full_name}</Text></View><ArrowRight color={palette.quiet} size={17} /></Pressable>}

      {!!ungraded.length && <View style={styles.section}><SectionHeading eyebrow="Respond now" title="Ready for review" /><View style={styles.stack}>{ungraded.map((submission) => <LearningCard key={submission.id} onPress={() => openSubmission(submission, data.progress.cohort.id)} label={`Review ${submission.content_block_title}`}><View style={styles.row}><View style={styles.reviewIcon}><ClipboardCheck color={palette.rubySoft} size={18} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{submission.lesson_title}</Text><Text style={styles.cardMeta}>{submission.content_block_title} · attempt {submission.num_submissions}</Text></View><ArrowRight color={palette.quiet} size={18} /></View></LearningCard>)}</View></View>}

      <View style={styles.section}><SectionHeading eyebrow="Curriculum" title="Learning progress" /><View style={styles.stack}>{data.progress.modules.map((mod) => <LearningCard key={mod.id}><View style={styles.moduleTop}><View style={styles.moduleIcon}><BookOpen color={palette.rubySoft} size={18} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{mod.name}</Text><Text style={styles.cardMeta}>{mod.completed_blocks} of {mod.total_blocks} steps · {mod.lessons.filter((lesson) => lesson.completed).length}/{mod.lessons.length} lessons</Text></View><Text style={styles.modulePercent}>{Math.round(mod.progress_percentage)}%</Text></View><View style={styles.moduleBar}><ProgressBar value={mod.progress_percentage} label={`${mod.name} progress`} /></View>{mod.lessons.slice(0, 4).map((lesson) => <View key={lesson.id} style={styles.lessonRow}>{lesson.completed ? <CheckCircle2 color={palette.success} size={15} /> : <Activity color={lesson.available ? palette.warning : palette.quiet} size={15} />}<Text numberOfLines={1} style={styles.lessonTitle}>{lesson.title}</Text><Text style={styles.lessonCount}>{lesson.completed_blocks}/{lesson.total_blocks}</Text></View>)}</LearningCard>)}</View></View>

      {!!videoProgress.length && <View style={styles.section}><SectionHeading eyebrow="Engagement" title="Video progress" /><View style={styles.stack}>{videoProgress.slice(0, 8).map((item) => <VideoRow key={`${item.recording_id ? 'recording' : 'lesson'}:${item.recording_id || item.content_block_id}`} item={item} />)}</View></View>}

      {!!data.progress.recent_activity.length && <View style={styles.section}><SectionHeading eyebrow="Recent signals" title="Activity" /><LearningCard>{data.progress.recent_activity.map((item, index) => <View key={`${item.content_block_id}:${item.completed_at}`} style={[styles.activityRow, index > 0 && styles.divider]}><CheckCircle2 color={palette.success} size={16} /><View style={styles.flex}><Text style={styles.activityTitle}>{item.block_title || item.block_type}</Text><Text style={styles.cardMeta}>Completed {formatRelative(item.completed_at)}</Text></View></View>)}</LearningCard></View>}
      {user.is_admin && <Pressable accessibilityRole="button" accessibilityLabel={`Open safe restart controls for ${data.progress.user.full_name}`} onPress={() => void openAuthenticatedWebPage(api, `/admin/students/${studentId}?legacy=1&cohort_id=${data.progress.cohort.id}`).catch((error) => Alert.alert('Could not open restart controls', (error as Error).message))} style={styles.restart}><RotateCcw color={palette.rubySoft} size={18} /><View style={styles.flex}><Text style={styles.restartTitle}>Restart class progress</Text><Text style={styles.restartCopy}>Opens the audited email-confirmation workflow</Text></View><ExternalLink color={palette.quiet} size={17} /></Pressable>}
      <Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, `/admin/cohorts/${data.progress.cohort.id}/students/${studentId}/access`).catch((error) => Alert.alert('Could not open student access', (error as Error).message))} style={styles.handoff}><AlertTriangle color={palette.warning} size={18} /><View style={styles.flex}><Text style={styles.handoffTitle}>Need advanced controls?</Text><Text style={styles.handoffCopy}>Open access, overrides, and administration controls for this enrollment securely on the web.</Text></View><ExternalLink color={palette.quiet} size={17} /></Pressable>
    </ScrollView>
  </SafeAreaView>;
}

function SignalCard({ icon: Icon, value, label, tone }: { icon: typeof ClipboardCheck; value: number; label: string; tone: 'ruby' | 'warning' | 'success' }) { const color = tone === 'warning' ? palette.warning : tone === 'success' ? palette.success : palette.rubySoft; return <View style={styles.signalCard}><Icon color={color} size={17} /><Text style={styles.signalValue}>{value}</Text><Text style={styles.signalLabel}>{label}</Text></View>; }
function VideoRow({ item }: { item: StaffVideoProgress }) { const title = item.recording_title || item.title || item.lesson_title || 'Class video'; return <LearningCard><View style={styles.row}><View style={[styles.reviewIcon, item.completed && styles.completeIcon]}>{item.completed ? <CheckCircle2 color={palette.success} size={18} /> : <Film color={palette.rubySoft} size={18} />}</View><View style={styles.flex}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardMeta}>{item.module_title || item.cohort_name} · {Math.round(item.progress_percentage)}% watched</Text><View style={styles.videoBar}><ProgressBar value={item.progress_percentage} label={`${title} watch progress`} /></View></View></View></LearningCard>; }
function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function formatRelative(value: string | null) { if (!value) return 'not recorded'; const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86_400_000)); if (days === 0) return 'today'; if (days === 1) return 'yesterday'; return `${days} days ago`; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, content: { padding: 20, paddingBottom: 70, gap: 16 }, identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 }, avatar: { width: 64, height: 64, borderRadius: 22, backgroundColor: '#2A303E', borderWidth: 1, borderColor: '#3C4558', alignItems: 'center', justifyContent: 'center' }, initials: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 18 }, flex: { flex: 1, minWidth: 0 }, name: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 23, letterSpacing: -0.5 }, email: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, marginTop: 3 }, identityMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 }, metaChip: { minHeight: 25, borderRadius: 13, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 }, metaChipText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 }, scopeNote: { borderRadius: 16, borderWidth: 1, borderColor: '#244A77', backgroundColor: '#122238', padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, scopeText: { flex: 1, color: '#BED6F5', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 }, progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }, progressKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.1 }, progressNumber: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 32, marginTop: 3 }, stepCount: { alignItems: 'flex-end' }, stepCountValue: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 }, stepCountLabel: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 }, lastSeen: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, marginTop: 10 }, signalGrid: { flexDirection: 'row', gap: 8 }, signalCard: { flex: 1, minHeight: 100, borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 13, justifyContent: 'space-between' }, signalValue: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 21, marginTop: 7 }, signalLabel: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 16 }, quickRow: { flexDirection: 'row', gap: 9 }, quick: { flex: 1, minHeight: 48, borderRadius: 15, backgroundColor: '#2A151B', borderWidth: 1, borderColor: '#4A2029', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, quickText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, section: { gap: 11, marginTop: 10 }, stack: { gap: 9 }, row: { flexDirection: 'row', alignItems: 'center', gap: 11 }, reviewIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, completeIcon: { backgroundColor: '#10271F' }, cardTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 }, cardMeta: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 2 }, moduleTop: { flexDirection: 'row', alignItems: 'center', gap: 11 }, moduleIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, modulePercent: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 13 }, moduleBar: { marginTop: 13, marginBottom: 7 }, lessonRow: { minHeight: 37, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, flexDirection: 'row', alignItems: 'center', gap: 8 }, lessonTitle: { flex: 1, color: '#C5C9D2', fontFamily: fonts.medium, fontSize: 11 }, lessonCount: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11 }, videoBar: { marginTop: 8 }, activityRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }, divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line }, activityTitle: { color: palette.text, fontFamily: fonts.semibold, fontSize: 11 }, restart: { minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: '#5B202D', backgroundColor: '#28131A', padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 8 }, restartTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, restartCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 3 }, handoff: { minHeight: 82, borderRadius: 18, borderWidth: 1, borderColor: '#4B3A1A', backgroundColor: '#211B11', padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 8 }, handoffTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, handoffCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 3 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: '#2A2115', justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: palette.warning, fontFamily: fonts.semibold, fontSize: 11 },
  intervention: { minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, interventionDue: { borderColor: '#672A33', backgroundColor: '#28131A' }, interventionTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, interventionTitleDue: { color: '#FF7187' }, interventionCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 3 },
});
