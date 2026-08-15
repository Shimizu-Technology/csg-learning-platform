import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, BookmarkPlus, Check, CheckCircle2, CircleDashed, Code2, ExternalLink, FileText, GitBranch, GitPullRequest, Globe2, MessageSquareText, RotateCcw, XCircle } from 'lucide-react-native';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { VoiceDraftButton, VoiceDraftPanel } from '@/components/voice-draft-controls';
import { fonts, palette } from '@/constants/csg-theme';
import { useVoiceDraft } from '@/hooks/use-voice-draft';
import { demoStaffSubmissions, demoStudentProgress } from '@/lib/demo-staff';
import { demoDms } from '@/lib/demo-data';
import { openAuthenticatedWebPage, openExternalPage } from '@/lib/external-links';
import { appendFeedbackSnippet } from '@/lib/feedback-snippets';
import { learningKeys, safeExternalUrl, submissionBelongsToStudentProgress } from '@/lib/learning';
import type { FeedbackSnippet, RubricRating, Submission } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useEffect, useRef, useState } from 'react';

type Grade = 'A' | 'B' | 'C' | 'R';

export default function StaffSubmissionScreen() {
  const { id, cohort_id: cohortIdParam, student_id: studentIdParam } = useLocalSearchParams<{ id: string; cohort_id?: string; student_id?: string }>();
  const submissionId = Number(id);
  const requestedCohortId = Number(cohortIdParam) || undefined;
  const requestedStudentId = Number(studentIdParam) || undefined;
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const feedbackFocusedRef = useRef(false);
  const query = useQuery({
    queryKey: learningKeys.submission(user?.id || 0, submissionId),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ submission: demoStaffSubmissions.find((item) => item.id === submissionId) || demoStaffSubmissions[0] }) : api.submission(submissionId, signal),
    enabled: Boolean(user?.is_staff && Number.isInteger(submissionId) && submissionId > 0),
  });
  const submission = query.data?.submission;
  const contextQuery = useQuery({
    queryKey: learningKeys.submissionContext(user?.id || 0, submissionId, requestedCohortId || 0),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve(demoStudentProgress) : api.studentProgress(submission!.user_id, requestedCohortId, signal),
    enabled: Boolean(user?.is_staff && submission && requestedCohortId && (!requestedStudentId || requestedStudentId === submission.user_id)),
    retry: false,
  });
  const validatedProgress = submission && contextQuery.data && requestedCohortId
    && contextQuery.data.cohort.id === requestedCohortId
    && submissionBelongsToStudentProgress(submission, contextQuery.data)
    ? contextQuery.data
    : undefined;
  const validatedCohortId = validatedProgress?.cohort.id;
  const snippetsQuery = useQuery({
    queryKey: learningKeys.feedbackSnippets(user?.id || 0),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ feedback_snippets: [] as FeedbackSnippet[] }) : api.feedbackSnippets(signal),
    enabled: Boolean(user?.is_staff),
  });
  const [feedbackDraft, setFeedbackDraft] = useState<{ submissionId: number; value: string } | null>(null);
  const [feedbackSelection, setFeedbackSelection] = useState({ start: 0, end: 0 });
  const [criterionDraft, setCriterionDraft] = useState<{ submissionId: number; values: Record<number, { rating: RubricRating | null; feedback: string }> } | null>(null);
  const feedback = feedbackDraft?.submissionId === submissionId ? feedbackDraft.value : submission?.feedback || '';
  const criterionResults = criterionDraft?.submissionId === submissionId
    ? criterionDraft.values
    : Object.fromEntries((submission?.rubric?.criteria || []).map((criterion) => [criterion.id, { rating: criterion.rating || null, feedback: criterion.feedback || '' }]));
  const voiceDraft = useVoiceDraft({
    api,
    demo: auth.demo,
    surface: 'grading_feedback',
    draft: feedback,
    selection: feedbackSelection,
    disabled: false,
    onDraftChange: (value) => setFeedbackDraft({ submissionId, value }),
    onSelectionChange: setFeedbackSelection,
  });
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      if (feedbackFocusedRef.current) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    return () => subscription.remove();
  }, []);
  const mutation = useMutation({
    mutationFn: ({ grade, feedback: nextFeedback }: { grade: Grade; feedback: string }) => auth.demo ? Promise.resolve({ submission: { ...submission!, grade, feedback: nextFeedback, graded_by: user?.full_name || 'Staff', graded_at: new Date().toISOString() } }) : api.gradeSubmission(submissionId, grade, nextFeedback, submission?.rubric?.criteria.map((criterion) => ({ rubric_criterion_id: criterion.id, rating: criterionResults[criterion.id].rating!, feedback: criterionResults[criterion.id].feedback })) || []),
    onSuccess: async (result, variables) => {
      queryClient.setQueryData(learningKeys.submission(user?.id || 0, submissionId), result);
      voiceDraft.markSent(variables.feedback);
      setCriterionDraft(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: learningKeys.dashboard(user?.id || 0) }),
        queryClient.invalidateQueries({ queryKey: learningKeys.submissions(user?.id || 0) }),
        submission && validatedCohortId ? queryClient.invalidateQueries({ queryKey: learningKeys.studentDetail(user?.id || 0, submission.user_id, validatedCohortId) }) : Promise.resolve(),
      ]);
    },
    onError: (error) => Alert.alert('Could not save grade', (error as Error).message),
  });
  const snippetMutation = useMutation({
    mutationFn: (body: string) => auth.demo ? Promise.resolve({ feedback_snippet: { id: Date.now(), title: body.slice(0, 80), body, usage_count: 0, created_by: user?.full_name || 'Staff', can_manage: true } satisfies FeedbackSnippet }) : api.createFeedbackSnippet(body),
    onSuccess: (result) => {
      queryClient.setQueryData(learningKeys.feedbackSnippets(user?.id || 0), (current: { feedback_snippets: FeedbackSnippet[] } | undefined) => ({ feedback_snippets: [result.feedback_snippet, ...(current?.feedback_snippets || [])] }));
      Alert.alert('Snippet saved', 'It is now available to instructors and remains editable whenever it is inserted.');
    },
    onError: (error) => Alert.alert('Could not save snippet', (error as Error).message),
  });

  const applySnippet = (snippet: FeedbackSnippet) => {
    setFeedbackDraft({ submissionId, value: appendFeedbackSnippet(feedback, snippet.body) });
    if (!auth.demo) void api.useFeedbackSnippet(snippet.id).catch(() => undefined);
  };

  const submitGrade = (grade: Grade) => {
    const cleanFeedback = feedback.trim();
    if (grade === 'R' && !cleanFeedback) { Alert.alert('Feedback required', 'Tell the student what to change before requesting a redo.'); return; }
    if (submission?.rubric?.criteria.some((criterion) => !criterionResults[criterion.id]?.rating)) { Alert.alert('Complete the rubric', 'Rate every criterion before saving this review.'); return; }
    mutation.mutate({ grade, feedback: cleanFeedback });
  };

  async function openDirectMessage() {
    if (!submission || !validatedCohortId) return;
    try {
      const conversation = auth.demo
        ? demoDms.find((item) => item.cohort_id === validatedCohortId && item.users.some((member) => member.id === submission.user_id))
        : (await api.createCohortDm(validatedCohortId, [submission.user_id])).direct_conversation;
      if (!conversation) throw new Error('No cohort conversation is available for this student.');
      router.push({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(conversation.id), source_type: 'submission', source_id: String(submission.id), source_label: submission.content_block_title, source_cohort_id: String(validatedCohortId), source_student_id: String(submission.user_id) } });
    } catch (error) {
      Alert.alert('Could not open direct message', (error as Error).message);
    }
  }

  if (!user?.is_staff || !Number.isInteger(submissionId) || submissionId <= 0) return <SafeAreaView style={styles.safe}><ErrorState message="This grading view is not available." retry={() => router.replace('/')} /></SafeAreaView>;
  if (query.isPending && !submission) return <SafeAreaView style={styles.safe}><LoadingState label="Loading submission" /></SafeAreaView>;
  if (query.error && !submission) return <SafeAreaView style={styles.safe}><ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /></SafeAreaView>;
  if (!submission) return <SafeAreaView style={styles.safe}><ErrorState message="Submission not found." retry={() => router.back()} /></SafeAreaView>;
  const links = submissionLinks(submission);
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.headerCopy}><Text style={styles.kicker}>QUICK REVIEW</Text><Text numberOfLines={1} style={styles.headerTitle}>{submission.user_name}</Text></View>{submission.grade && <View style={[styles.gradePill, submission.grade === 'R' && styles.redoPill]}><Text style={[styles.gradePillText, submission.grade === 'R' && { color: palette.warning }]}>{submission.grade === 'R' ? 'REDO' : `GRADE ${submission.grade}`}</Text></View>}</View>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flexRoot}>
      <ScrollView ref={scrollRef} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View><Text style={styles.eyebrow}>{submission.lesson_title}</Text><Text style={styles.title}>{submission.content_block_title}</Text><Text style={styles.meta}>Attempt {submission.num_submissions} · submitted {formatDate(submission.created_at)}</Text></View>
        {validatedProgress && <View style={styles.relationshipRow}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${submission.user_name}'s student health`} onPress={() => router.push({ pathname: '/staff/student/[id]', params: { id: String(submission.user_id), cohort_id: String(validatedProgress.cohort.id) } })} style={styles.relationshipButton}><FileText color={palette.rubySoft} size={17} /><Text style={styles.relationshipText}>Student health</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Message ${submission.user_name} in ${validatedProgress.cohort.name}`} onPress={() => void openDirectMessage()} style={styles.relationshipButton}><MessageSquareText color={palette.rubySoft} size={17} /><Text style={styles.relationshipText}>Message in {validatedProgress.cohort.name}</Text></Pressable></View>}
        {submission.exercise_body && <LearningCard><View style={styles.cardHeading}><FileText color={palette.rubySoft} size={18} /><Text style={styles.cardHeadingText}>Assignment</Text></View><Text style={styles.body}>{submission.exercise_body}</Text></LearningCard>}
        {submission.text && <LearningCard><View style={styles.cardHeading}><Code2 color={palette.rubySoft} size={18} /><Text style={styles.cardHeadingText}>Student response</Text></View><Text selectable style={styles.response}>{submission.text}</Text></LearningCard>}
        {!!links.length && <View style={styles.linkGrid}>{links.map((link) => <Pressable key={link.label} accessibilityRole="link" onPress={() => void openExternalPage(link.url).catch((error) => Alert.alert('Could not open link', (error as Error).message))} style={styles.linkCard}><link.Icon color={palette.rubySoft} size={18} /><View style={styles.linkCopy}><Text style={styles.linkTitle}>{link.label}</Text><Text numberOfLines={1} style={styles.linkValue}>{link.detail}</Text></View><ExternalLink color={palette.quiet} size={15} /></Pressable>)}</View>}
        {(submission.branch || submission.commit_sha || submission.notes) && <LearningCard><View style={styles.cardHeading}><GitBranch color={palette.rubySoft} size={18} /><Text style={styles.cardHeadingText}>Review context</Text></View>{submission.branch && <Detail label="Branch" value={submission.branch} />}{submission.commit_sha && <Detail label="Commit" value={submission.commit_sha} />}{submission.notes && <Detail label="Student note" value={submission.notes} />}</LearningCard>}
        {submission.github_checks && <GithubChecksCard submission={submission} />}
        {submission.solution && <LearningCard><View style={styles.cardHeading}><CheckCircle2 color={palette.success} size={18} /><Text style={styles.cardHeadingText}>Instructor solution</Text></View><Text selectable style={styles.response}>{submission.solution}</Text></LearningCard>}
        {submission.rubric && <LearningCard><Text style={styles.feedbackLabel}>CRITERION REVIEW</Text><Text style={styles.rubricTitle}>{submission.rubric.title}</Text><View style={styles.rubricList}>{submission.rubric.criteria.map((criterion) => <View key={criterion.id} style={styles.rubricCriterion}><Text style={styles.cardHeadingText}>{criterion.title}</Text><Text style={styles.detailValue}>{criterion.description}</Text><View style={styles.ratingGrid}>{([['exceeds', 'Exceeds'], ['meets', 'Meets'], ['developing', 'Developing'], ['redo', 'Revision']] as [RubricRating, string][]).map(([rating, label]) => <Pressable key={rating} accessibilityRole="button" accessibilityState={{ selected: criterionResults[criterion.id]?.rating === rating }} onPress={() => setCriterionDraft({ submissionId, values: { ...criterionResults, [criterion.id]: { rating, feedback: criterionResults[criterion.id]?.feedback || '' } } })} style={[styles.ratingButton, criterionResults[criterion.id]?.rating === rating && styles.ratingButtonActive]}><Text style={styles.ratingButtonText}>{label}</Text></Pressable>)}</View><TextInput accessibilityLabel={`Feedback for ${criterion.title}`} value={criterionResults[criterion.id]?.feedback || ''} onChangeText={(value) => setCriterionDraft({ submissionId, values: { ...criterionResults, [criterion.id]: { rating: criterionResults[criterion.id]?.rating || null, feedback: value } } })} placeholder="Optional focused feedback" placeholderTextColor={palette.quiet} multiline style={styles.criterionFeedback} /></View>)}</View></LearningCard>}
        <View style={styles.feedbackSection}><Text style={styles.feedbackLabel}>FEEDBACK</Text>{Boolean(snippetsQuery.data?.feedback_snippets.length) && <View style={styles.snippetPanel}><View style={styles.snippetHeading}><MessageSquareText color={palette.rubySoft} size={16} /><Text style={styles.snippetHeadingText}>REUSABLE SNIPPETS</Text></View><View style={styles.snippetList}>{snippetsQuery.data!.feedback_snippets.map((snippet) => <Pressable key={snippet.id} accessibilityRole="button" accessibilityHint="Inserts editable text into the feedback draft" onPress={() => applySnippet(snippet)} style={styles.snippetButton}><Text style={styles.snippetButtonText}>{snippet.title}</Text></Pressable>)}</View><Text style={styles.feedbackHint}>Tap to insert, then personalize the draft for this student.</Text></View>}<TextInput accessibilityLabel="Feedback for student" value={feedback} selection={feedbackSelection} onSelectionChange={(event) => setFeedbackSelection(event.nativeEvent.selection)} onChangeText={(value) => setFeedbackDraft({ submissionId, value })} onFocus={() => { feedbackFocusedRef.current = true; requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true })); }} onBlur={() => { feedbackFocusedRef.current = false; }} placeholder="Give one clear next step or reinforce what worked…" placeholderTextColor={palette.quiet} multiline textAlignVertical="top" style={styles.feedbackInput} /><View style={styles.voiceRow}><VoiceDraftButton state={voiceDraft.state} disabled={mutation.isPending} onPress={() => void voiceDraft.start()} /><Text style={styles.voiceHint}>Dictate a draft, then review and personalize it before saving.</Text></View><VoiceDraftPanel state={voiceDraft.state} durationMillis={voiceDraft.durationMillis} maxDurationSeconds={voiceDraft.maxDurationSeconds} metering={voiceDraft.metering} error={voiceDraft.error} notice={voiceDraft.notice} hasReview={Boolean(voiceDraft.review)} hasRecording={voiceDraft.hasRecording} onStop={() => void voiceDraft.stop()} onCancel={() => void voiceDraft.cancel()} onRetry={voiceDraft.retry} onRecordAgain={() => void voiceDraft.recordAgain()} onRestore={voiceDraft.restore} onDismiss={voiceDraft.dismissReview} /><Text style={styles.feedbackHint}>Redo requests require feedback. Passing grades may include concise feedback.</Text><Pressable accessibilityRole="button" disabled={!feedback.trim() || snippetMutation.isPending} onPress={() => snippetMutation.mutate(feedback.trim())} style={({ pressed }) => [styles.saveSnippet, pressed && styles.pressed, (!feedback.trim() || snippetMutation.isPending) && styles.disabled]}><BookmarkPlus color={palette.rubySoft} size={16} /><Text style={styles.saveSnippetText}>{snippetMutation.isPending ? 'Saving snippet…' : 'Save draft as reusable snippet'}</Text></Pressable></View>
        <View style={styles.gradeSection}><Text style={styles.feedbackLabel}>GRADE</Text><View style={styles.gradeRow}>{(['A', 'B', 'C'] as Grade[]).map((grade) => <Pressable key={grade} accessibilityRole="button" accessibilityLabel={`Grade ${grade}`} disabled={mutation.isPending} onPress={() => submitGrade(grade)} style={[styles.gradeButton, submission.grade === grade && styles.gradeButtonActive]}><Check color={submission.grade === grade ? palette.text : palette.success} size={16} /><Text style={styles.gradeButtonText}>{grade}</Text></Pressable>)}</View><Pressable accessibilityRole="button" disabled={mutation.isPending} onPress={() => submitGrade('R')} style={[styles.redoButton, submission.grade === 'R' && styles.redoButtonActive]}><RotateCcw color={palette.warning} size={18} /><Text style={styles.redoButtonText}>{mutation.isPending ? 'Saving review…' : 'Request redo with feedback'}</Text></Pressable></View>
        {mutation.isSuccess && <View style={styles.saved}><CheckCircle2 color={palette.success} size={18} /><Text style={styles.savedText}>Review saved and student notification queued.</Text></View>}
        <Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, validatedCohortId ? `/admin/submissions/${submission.id}?cohort_id=${validatedCohortId}&student_id=${submission.user_id}` : `/admin/submissions/${submission.id}`).catch((error) => Alert.alert('Could not open full grading', (error as Error).message))} style={styles.handoff}><ExternalLink color={palette.rubySoft} size={17} /><View style={styles.linkCopy}><Text style={styles.handoffTitle}>Open full submission record</Text><Text style={styles.handoffCopy}>{validatedCohortId ? 'Continue on the web with student, cohort, and grading context intact.' : 'Continue on the web in the submission record.'}</Text></View></Pressable>
        <View style={{ height: 20 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function submissionLinks(submission: Submission) { return [
  { label: 'Repository', url: submission.repo_url, detail: submission.repo_url || '', Icon: GitPullRequest },
  { label: 'Pull request', url: submission.pr_url, detail: submission.pr_url || '', Icon: GitBranch },
  { label: 'Live project', url: submission.live_url, detail: submission.live_url || '', Icon: Globe2 },
  { label: 'GitHub review issue', url: submission.github_issue_url, detail: submission.github_issue_url || '', Icon: GitPullRequest },
].filter((item): item is { label: string; url: string; detail: string; Icon: typeof GitPullRequest } => Boolean(safeExternalUrl(item.url))); }
function Detail({ label, value }: { label: string; value: string }) { return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>; }
function formatDate(value: string) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

function GithubChecksCard({ submission }: { submission: Submission }) {
  const checks = submission.github_checks!;
  return <LearningCard>
    <View style={styles.cardHeading}><GitBranch color={palette.rubySoft} size={18} /><View style={styles.linkCopy}><Text style={styles.cardHeadingText}>Automated checks</Text><Text style={styles.checkBoundary}>Exact commit status; logs stay on GitHub.</Text></View></View>
    <View style={styles.checkSummary}>
      <CheckCount label="passed" count={checks.summary.passed} tone="success" />
      <CheckCount label="failed" count={checks.summary.failed} tone="failure" />
      <CheckCount label="pending" count={checks.summary.pending} tone="pending" />
    </View>
    <Text style={styles.checkCommit}>Commit {checks.head_sha?.slice(0, 8)}{checks.fetched_at ? ` · refreshed ${formatDate(checks.fetched_at)}` : ''}</Text>
    <View style={styles.checkList}>{checks.runs.map((run) => {
      const detailsUrl = safeExternalUrl(run.details_url);
      const failed = ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(run.conclusion || '');
      const Icon = run.conclusion === 'success' ? CheckCircle2 : failed ? XCircle : CircleDashed;
      const row = <><Icon color={run.conclusion === 'success' ? palette.success : failed ? palette.warning : palette.quiet} size={17} /><View style={styles.linkCopy}><Text numberOfLines={1} style={styles.checkName}>{run.name}</Text><Text numberOfLines={1} style={styles.checkMeta}>{run.workflow_name || run.app_slug || 'GitHub'} · {run.conclusion?.replaceAll('_', ' ') || 'pending'}</Text></View>{detailsUrl && <ExternalLink color={palette.quiet} size={15} />}</>;
      return detailsUrl ? <Pressable key={run.id} accessibilityRole="link" accessibilityLabel={`Open ${run.name} on GitHub`} onPress={() => void openExternalPage(detailsUrl).catch((error) => Alert.alert('Could not open check', (error as Error).message))} style={styles.checkRow}>{row}</Pressable> : <View key={run.id} style={styles.checkRow}>{row}</View>;
    })}</View>
  </LearningCard>;
}

function CheckCount({ label, count, tone }: { label: string; count: number; tone: 'success' | 'failure' | 'pending' }) {
  return <View style={[styles.checkPill, tone === 'success' ? styles.checkSuccess : tone === 'failure' ? styles.checkFailure : styles.checkPending]}><Text style={styles.checkPillText}>{count} {label}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, flexRoot: { flex: 1 }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17 }, gradePill: { minHeight: 30, borderRadius: 15, backgroundColor: '#10271F', borderWidth: 1, borderColor: '#1E5A43', justifyContent: 'center', paddingHorizontal: 10, marginRight: 10 }, redoPill: { backgroundColor: '#2A2115', borderColor: '#5B4720' }, gradePillText: { color: palette.success, fontFamily: fonts.extraBold, fontSize: 11, letterSpacing: 0.8 }, content: { padding: 20, paddingBottom: 70, gap: 14 }, eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34, letterSpacing: -0.7, marginTop: 5 }, meta: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, marginTop: 7 }, cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }, cardHeadingText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, body: { color: '#C2C6D0', fontFamily: fonts.regular, fontSize: 12, lineHeight: 19 }, response: { color: palette.text, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21 }, linkGrid: { gap: 8 }, linkCard: { minHeight: 58, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, linkCopy: { flex: 1, minWidth: 0 }, linkTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, linkValue: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 3 }, detail: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, paddingVertical: 9 }, detailLabel: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }, detailValue: { color: '#D5D7DD', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 3 }, rubricTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 16 }, rubricList: { gap: 10, marginTop: 12 }, rubricCriterion: { borderRadius: 15, borderWidth: 1, borderColor: '#1E5A43', padding: 12 }, ratingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }, ratingButton: { minHeight: 42, minWidth: '47%', flexGrow: 1, borderRadius: 12, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center' }, ratingButtonActive: { borderColor: palette.success, backgroundColor: '#15372A' }, ratingButtonText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, criterionFeedback: { minHeight: 70, borderRadius: 12, borderWidth: 1, borderColor: palette.line, color: palette.text, fontFamily: fonts.regular, fontSize: 11, padding: 10, marginTop: 8 }, feedbackSection: { marginTop: 8 }, feedbackLabel: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.3, marginBottom: 8 }, snippetPanel: { borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 12, marginBottom: 10 }, snippetHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 }, snippetHeadingText: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, snippetList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }, snippetButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, justifyContent: 'center', paddingHorizontal: 11, paddingVertical: 7 }, snippetButtonText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, feedbackInput: { minHeight: 142, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, padding: 14 }, feedbackHint: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 7 }, saveSnippet: { minHeight: 44, alignSelf: 'flex-start', borderRadius: 12, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginTop: 10 }, saveSnippetText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, pressed: { opacity: 0.76 }, disabled: { opacity: 0.42 }, gradeSection: { marginTop: 6 }, gradeRow: { flexDirection: 'row', gap: 8 }, gradeButton: { flex: 1, minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: '#1E5A43', backgroundColor: '#10271F', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, gradeButtonActive: { backgroundColor: '#1B684A', borderColor: palette.success }, gradeButtonText: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 13 }, redoButton: { minHeight: 52, borderRadius: 15, borderWidth: 1, borderColor: '#5B4720', backgroundColor: '#2A2115', marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, redoButtonActive: { backgroundColor: '#493718' }, redoButtonText: { color: palette.warning, fontFamily: fonts.bold, fontSize: 11 }, saved: { minHeight: 48, borderRadius: 15, backgroundColor: '#10271F', borderWidth: 1, borderColor: '#1E5A43', paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, savedText: { color: '#A8E8C9', fontFamily: fonts.semibold, fontSize: 11 }, handoff: { minHeight: 70, borderRadius: 17, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 }, handoffTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, handoffCopy: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 3 },
  relationshipRow: { flexDirection: 'row', gap: 8 }, relationshipButton: { flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, relationshipText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 },
  checkBoundary: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 }, checkSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, checkPill: { minHeight: 30, borderRadius: 15, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 10 }, checkSuccess: { backgroundColor: '#10271F', borderColor: '#1E5A43' }, checkFailure: { backgroundColor: '#2A1719', borderColor: '#663039' }, checkPending: { backgroundColor: '#2A2115', borderColor: '#5B4720' }, checkPillText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, checkCommit: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 9 }, checkList: { marginTop: 9 }, checkRow: { minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, flexDirection: 'row', alignItems: 'center', gap: 9 }, checkName: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, checkMeta: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  voiceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }, voiceHint: { flex: 1, color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
});
