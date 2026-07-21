import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Check, CheckCircle2, Code2, ExternalLink, FileText, GitBranch, GitPullRequest, Globe2, RotateCcw } from 'lucide-react-native';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoStaffSubmissions } from '@/lib/demo-staff';
import { openAuthenticatedWebPage, openExternalPage } from '@/lib/external-links';
import { learningKeys, safeExternalUrl } from '@/lib/learning';
import type { Submission } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useEffect, useRef, useState } from 'react';

type Grade = 'A' | 'B' | 'C' | 'R';

export default function StaffSubmissionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const submissionId = Number(id);
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
  const [feedbackDraft, setFeedbackDraft] = useState<{ submissionId: number; value: string } | null>(null);
  const feedback = feedbackDraft?.submissionId === submissionId ? feedbackDraft.value : submission?.feedback || '';
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      if (feedbackFocusedRef.current) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    return () => subscription.remove();
  }, []);
  const mutation = useMutation({
    mutationFn: ({ grade, feedback: nextFeedback }: { grade: Grade; feedback: string }) => auth.demo ? Promise.resolve({ submission: { ...submission!, grade, feedback: nextFeedback, graded_by: user?.full_name || 'Staff', graded_at: new Date().toISOString() } }) : api.gradeSubmission(submissionId, grade, nextFeedback),
    onSuccess: async (result) => {
      queryClient.setQueryData(learningKeys.submission(user?.id || 0, submissionId), result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: learningKeys.dashboard(user?.id || 0) }),
        queryClient.invalidateQueries({ queryKey: learningKeys.submissions(user?.id || 0) }),
        submission ? queryClient.invalidateQueries({ queryKey: learningKeys.studentDetail(user?.id || 0, submission.user_id) }) : Promise.resolve(),
      ]);
    },
    onError: (error) => Alert.alert('Could not save grade', (error as Error).message),
  });

  const submitGrade = (grade: Grade) => {
    const cleanFeedback = feedback.trim();
    if (grade === 'R' && !cleanFeedback) { Alert.alert('Feedback required', 'Tell the student what to change before requesting a redo.'); return; }
    mutation.mutate({ grade, feedback: cleanFeedback });
  };

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
        {submission.exercise_body && <LearningCard><View style={styles.cardHeading}><FileText color={palette.rubySoft} size={18} /><Text style={styles.cardHeadingText}>Assignment</Text></View><Text style={styles.body}>{submission.exercise_body}</Text></LearningCard>}
        {submission.text && <LearningCard><View style={styles.cardHeading}><Code2 color={palette.rubySoft} size={18} /><Text style={styles.cardHeadingText}>Student response</Text></View><Text selectable style={styles.response}>{submission.text}</Text></LearningCard>}
        {!!links.length && <View style={styles.linkGrid}>{links.map((link) => <Pressable key={link.label} accessibilityRole="link" onPress={() => void openExternalPage(link.url).catch((error) => Alert.alert('Could not open link', (error as Error).message))} style={styles.linkCard}><link.Icon color={palette.rubySoft} size={18} /><View style={styles.linkCopy}><Text style={styles.linkTitle}>{link.label}</Text><Text numberOfLines={1} style={styles.linkValue}>{link.detail}</Text></View><ExternalLink color={palette.quiet} size={15} /></Pressable>)}</View>}
        {(submission.branch || submission.commit_sha || submission.notes) && <LearningCard><View style={styles.cardHeading}><GitBranch color={palette.rubySoft} size={18} /><Text style={styles.cardHeadingText}>Review context</Text></View>{submission.branch && <Detail label="Branch" value={submission.branch} />}{submission.commit_sha && <Detail label="Commit" value={submission.commit_sha} />}{submission.notes && <Detail label="Student note" value={submission.notes} />}</LearningCard>}
        {submission.solution && <LearningCard><View style={styles.cardHeading}><CheckCircle2 color={palette.success} size={18} /><Text style={styles.cardHeadingText}>Instructor solution</Text></View><Text selectable style={styles.response}>{submission.solution}</Text></LearningCard>}
        <View style={styles.feedbackSection}><Text style={styles.feedbackLabel}>FEEDBACK</Text><TextInput accessibilityLabel="Feedback for student" value={feedback} onChangeText={(value) => setFeedbackDraft({ submissionId, value })} onFocus={() => { feedbackFocusedRef.current = true; requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true })); }} onBlur={() => { feedbackFocusedRef.current = false; }} placeholder="Give one clear next step or reinforce what worked…" placeholderTextColor={palette.quiet} multiline textAlignVertical="top" style={styles.feedbackInput} /><Text style={styles.feedbackHint}>Redo requests require feedback. Passing grades may include concise feedback.</Text></View>
        <View style={styles.gradeSection}><Text style={styles.feedbackLabel}>GRADE</Text><View style={styles.gradeRow}>{(['A', 'B', 'C'] as Grade[]).map((grade) => <Pressable key={grade} accessibilityRole="button" accessibilityLabel={`Grade ${grade}`} disabled={mutation.isPending} onPress={() => submitGrade(grade)} style={[styles.gradeButton, submission.grade === grade && styles.gradeButtonActive]}><Check color={submission.grade === grade ? palette.text : palette.success} size={16} /><Text style={styles.gradeButtonText}>{grade}</Text></Pressable>)}</View><Pressable accessibilityRole="button" disabled={mutation.isPending} onPress={() => submitGrade('R')} style={[styles.redoButton, submission.grade === 'R' && styles.redoButtonActive]}><RotateCcw color={palette.warning} size={18} /><Text style={styles.redoButtonText}>{mutation.isPending ? 'Saving review…' : 'Request redo with feedback'}</Text></Pressable></View>
        {mutation.isSuccess && <View style={styles.saved}><CheckCircle2 color={palette.success} size={18} /><Text style={styles.savedText}>Review saved and student notification queued.</Text></View>}
        <Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, '/admin/grading').catch((error) => Alert.alert('Could not open full grading', (error as Error).message))} style={styles.handoff}><ExternalLink color={palette.rubySoft} size={17} /><View style={styles.linkCopy}><Text style={styles.handoffTitle}>Open full grading workspace</Text><Text style={styles.handoffCopy}>Use the web for issue comments, comparison grids, and bulk workflows.</Text></View></Pressable>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, flexRoot: { flex: 1 }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1.2 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 2 }, gradePill: { minHeight: 30, borderRadius: 15, backgroundColor: '#10271F', borderWidth: 1, borderColor: '#1E5A43', justifyContent: 'center', paddingHorizontal: 10, marginRight: 10 }, redoPill: { backgroundColor: '#2A2115', borderColor: '#5B4720' }, gradePillText: { color: palette.success, fontFamily: fonts.extraBold, fontSize: 8, letterSpacing: 0.8 }, content: { padding: 20, paddingBottom: 70, gap: 14 }, eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase' }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34, letterSpacing: -0.7, marginTop: 5 }, meta: { color: palette.muted, fontFamily: fonts.regular, fontSize: 10, marginTop: 7 }, cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }, cardHeadingText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, body: { color: '#C2C6D0', fontFamily: fonts.regular, fontSize: 12, lineHeight: 19 }, response: { color: palette.text, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21 }, linkGrid: { gap: 8 }, linkCard: { minHeight: 58, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, linkCopy: { flex: 1, minWidth: 0 }, linkTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, linkValue: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 8, marginTop: 3 }, detail: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, paddingVertical: 9 }, detailLabel: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.8 }, detailValue: { color: '#D5D7DD', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 3 }, feedbackSection: { marginTop: 8 }, feedbackLabel: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.3, marginBottom: 8 }, feedbackInput: { minHeight: 142, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, padding: 14 }, feedbackHint: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 8, lineHeight: 13, marginTop: 7 }, gradeSection: { marginTop: 6 }, gradeRow: { flexDirection: 'row', gap: 8 }, gradeButton: { flex: 1, minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: '#1E5A43', backgroundColor: '#10271F', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, gradeButtonActive: { backgroundColor: '#1B684A', borderColor: palette.success }, gradeButtonText: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 13 }, redoButton: { minHeight: 52, borderRadius: 15, borderWidth: 1, borderColor: '#5B4720', backgroundColor: '#2A2115', marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, redoButtonActive: { backgroundColor: '#493718' }, redoButtonText: { color: palette.warning, fontFamily: fonts.bold, fontSize: 11 }, saved: { minHeight: 48, borderRadius: 15, backgroundColor: '#10271F', borderWidth: 1, borderColor: '#1E5A43', paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, savedText: { color: '#A8E8C9', fontFamily: fonts.semibold, fontSize: 10 }, handoff: { minHeight: 70, borderRadius: 17, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 }, handoffTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, handoffCopy: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 8, lineHeight: 13, marginTop: 3 },
});
