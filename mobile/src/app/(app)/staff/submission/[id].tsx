import { haptic } from '@/lib/haptics';
import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, BookmarkPlus, CheckCircle2, CircleDashed, Code2, ExternalLink, FileText, GitBranch, GitPullRequest, Globe2, MessageSquareText, RefreshCw, XCircle } from 'lucide-react-native';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthoredContent } from '@/components/authored-content';
import { GradingReviewActions, type GradingOutcome } from '@/components/grading-review-actions';
import { LearningCard, StatusBadge } from '@/components/learning-ui';
import { MessageCodeBlock } from '@/components/message-code-block';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { VoiceDraftButton, VoiceDraftPanel } from '@/components/voice-draft-controls';
import { fonts } from '@/constants/csg-theme';
import { useVoiceDraft } from '@/hooks/use-voice-draft';
import { ApiError } from '@/lib/api';
import { demoStaffSubmissions, demoStudentProgress } from '@/lib/demo-staff';
import { demoDms } from '@/lib/demo-data';
import { openAuthenticatedWebPage, openExternalPage } from '@/lib/external-links';
import { appendFeedbackSnippet } from '@/lib/feedback-snippets';
import { learningKeys, safeExternalUrl, staffSubmissionPath, submissionBelongsToStudentProgress } from '@/lib/learning';
import { looksLikeCode } from '@/lib/code-paste';
import { formatCourseDateTime } from '@/lib/course-time';
import { clearGradingDraft, gradingDraftMatches, loadGradingDraft, saveGradingDraft } from '@/lib/submission-storage';
import type { FeedbackSnippet, RubricRating, Submission } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useEffect, useMemo, useRef, useState } from 'react';

export default function StaffSubmissionScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
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
  const previousAttempt = Boolean(submission?.latest_submission_id && submission.latest_submission_id !== submission.id);
  const submissionLoaded = Boolean(submission);
  const submissionUpdatedAt = submission?.updated_at || null;
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
  const [gradeDraft, setGradeDraft] = useState<{ submissionId: number; value: GradingOutcome | null } | null>(null);
  const [draftReadyFor, setDraftReadyFor] = useState<number | null>(null);
  const [draftNotice, setDraftNotice] = useState<{ submissionId: number; value: string } | null>(null);
  const [draftSaveResult, setDraftSaveResult] = useState<{ signature: string; status: 'saved' | 'error' } | null>(null);
  const [reviewBaseVersion, setReviewBaseVersion] = useState<{ submissionId: number; value: string | null } | null>(null);
  const [staleReviewVersion, setStaleReviewVersion] = useState<{ submissionId: number; value: string | null } | null>(null);
  const reviewCommittedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const restoredDraftKeyRef = useRef<string | null>(null);
  const feedback = feedbackDraft?.submissionId === submissionId ? feedbackDraft.value : submission?.feedback || '';
  const criterionResults = useMemo(() => criterionDraft?.submissionId === submissionId
    ? criterionDraft.values
    : Object.fromEntries((submission?.rubric?.criteria || []).map((criterion) => [criterion.id, { rating: criterion.rating || null, feedback: criterion.feedback || '' }])), [criterionDraft, submission, submissionId]);
  const selectedGrade = gradeDraft?.submissionId === submissionId ? gradeDraft.value : (submission?.grade as GradingOutcome | null) || null;
  const reviewBaseUpdatedAt = reviewBaseVersion?.submissionId === submissionId ? reviewBaseVersion.value : submissionUpdatedAt;
  const staleReview = staleReviewVersion?.submissionId === submissionId ? staleReviewVersion : null;
  const visibleDraftNotice = draftNotice?.submissionId === submissionId ? draftNotice.value : null;
  const reviewChanged = Boolean(submission && (
    selectedGrade !== ((submission.grade as GradingOutcome | null) || null)
    || feedback !== (submission.feedback || '')
    || submission.rubric?.criteria.some((criterion) => criterionResults[criterion.id]?.rating !== (criterion.rating || null) || criterionResults[criterion.id]?.feedback !== (criterion.feedback || ''))
  ));
  const gradingDraftPayload = useMemo(() => ({
    grade: selectedGrade,
    feedback,
    criterion_results: criterionResults,
    base_submission_updated_at: reviewBaseUpdatedAt,
  }), [criterionResults, feedback, reviewBaseUpdatedAt, selectedGrade]);
  const gradingDraftSignature = useMemo(() => JSON.stringify(gradingDraftPayload), [gradingDraftPayload]);
  const visibleDraftSaveState = draftSaveResult?.signature === gradingDraftSignature ? draftSaveResult.status : 'saving';
  const draftRestoring = draftReadyFor !== submissionId;
  const voiceDraft = useVoiceDraft({
    api,
    demo: auth.demo,
    surface: 'grading_feedback',
    draft: feedback,
    selection: feedbackSelection,
    disabled: false,
    onDraftChange: (value) => {
      if (!draftRestoring && !saveInFlightRef.current) setFeedbackDraft({ submissionId, value });
    },
    onSelectionChange: setFeedbackSelection,
  });
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      if (feedbackFocusedRef.current) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!submissionLoaded || !user?.id) return;
    const restoreKey = `${user.id}:${submissionId}`;
    if (restoredDraftKeyRef.current === restoreKey) return;
    restoredDraftKeyRef.current = restoreKey;
    setDraftReadyFor(null);
    let active = true;
    void loadGradingDraft(user.id, submissionId)
      .then((draft) => {
        if (!active) return;
        if (draft) {
          setReviewBaseVersion({ submissionId, value: draft.base_submission_updated_at });
          setGradeDraft({ submissionId, value: draft.grade });
          setFeedbackDraft({ submissionId, value: draft.feedback });
          setCriterionDraft({ submissionId, values: draft.criterion_results });
          if (!gradingDraftMatches(draft, submissionUpdatedAt)) {
            setStaleReviewVersion({ submissionId, value: submissionUpdatedAt });
            setDraftNotice({ submissionId, value: 'This submission changed after the draft was saved. Recheck the latest work before saving your review.' });
          } else {
            setStaleReviewVersion(null);
            setDraftNotice(null);
          }
        } else {
          setReviewBaseVersion({ submissionId, value: submissionUpdatedAt });
          setStaleReviewVersion(null);
          setDraftNotice(null);
        }
        setDraftReadyFor(submissionId);
      })
      .catch(() => {
        if (!active) return;
        setReviewBaseVersion({ submissionId, value: submissionUpdatedAt });
        setStaleReviewVersion(null);
        setDraftNotice({ submissionId, value: 'A saved review draft could not be loaded. New changes will retry device storage.' });
        setDraftReadyFor(submissionId);
      });
    return () => { active = false; };
  }, [submissionId, submissionLoaded, submissionUpdatedAt, user?.id]);
  useEffect(() => {
    if (!submissionLoaded || !user?.id || draftReadyFor !== submissionId) return;
    if (reviewChanged) reviewCommittedRef.current = false;
    const persist = (reportState: boolean) => {
      if (reviewCommittedRef.current) return;
      const operation = reviewChanged
        ? saveGradingDraft(user.id, submissionId, gradingDraftPayload)
        : clearGradingDraft(user.id, submissionId);
      if (reportState) {
        void operation
          .then(() => setDraftSaveResult(reviewChanged ? { signature: gradingDraftSignature, status: 'saved' } : null))
          .catch(() => setDraftSaveResult({ signature: gradingDraftSignature, status: 'error' }));
      } else {
        void operation.catch(() => undefined);
      }
    };
    const timer = setTimeout(() => persist(true), 250);
    return () => { clearTimeout(timer); persist(false); };
  }, [draftReadyFor, gradingDraftPayload, gradingDraftSignature, reviewChanged, submissionId, submissionLoaded, user?.id]);
  const mutation = useMutation({
    mutationFn: ({ grade, feedback: nextFeedback, baseSubmissionUpdatedAt, criterionResults: submittedCriteria }: { grade: GradingOutcome; feedback: string; baseSubmissionUpdatedAt: string; criterionResults: { rubric_criterion_id: number; rating: RubricRating; feedback: string }[] }) => auth.demo ? Promise.resolve({ submission: { ...submission!, grade, feedback: nextFeedback, graded_by: user?.full_name || 'Staff', graded_at: new Date().toISOString() } }) : api.gradeSubmission(submissionId, grade, nextFeedback, baseSubmissionUpdatedAt, submittedCriteria),
    onMutate: () => { saveInFlightRef.current = true; },
    onSuccess: async (result, variables) => {
      haptic('success');
      reviewCommittedRef.current = true;
      queryClient.setQueryData(learningKeys.submission(user?.id || 0, submissionId), result);
      queryClient.setQueryData<{ submissions: Submission[] }>(learningKeys.submissions(user?.id || 0), (current) => current ? { submissions: current.submissions.filter((item) => item.id !== submissionId) } : current);
      voiceDraft.markSent(variables.feedback);
      setGradeDraft(null);
      setFeedbackDraft(null);
      setCriterionDraft(null);
      setDraftNotice(null);
      setDraftSaveResult(null);
      setReviewBaseVersion(null);
      setStaleReviewVersion(null);
      if (user?.id) await clearGradingDraft(user.id, submissionId).catch(() => undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: learningKeys.dashboard(user?.id || 0) }),
        queryClient.invalidateQueries({ queryKey: learningKeys.submissions(user?.id || 0), refetchType: 'none' }),
        submission && validatedCohortId ? queryClient.invalidateQueries({ queryKey: learningKeys.studentDetail(user?.id || 0, submission.user_id, validatedCohortId) }) : Promise.resolve(),
      ]);
    },
    onError: (error) => {
      haptic('error');
      if (error instanceof ApiError && error.status === 409) {
        setStaleReviewVersion({ submissionId, value: null });
        setDraftNotice({ submissionId, value: 'This submission changed while you were reviewing it. Your draft is still here; recheck the latest work before saving again.' });
        void query.refetch().then((result) => {
          const latestVersion = result.data?.submission.updated_at || null;
          setStaleReviewVersion({ submissionId, value: latestVersion });
        });
        Alert.alert('Submission changed', 'Your draft was kept. Recheck the latest submission before saving again.');
        return;
      }
      Alert.alert('Could not save grade', (error as Error).message);
    },
    onSettled: () => { saveInFlightRef.current = false; },
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
    if (draftRestoring || saveInFlightRef.current) return;
    setFeedbackDraft({ submissionId, value: appendFeedbackSnippet(feedback, snippet.body) });
    if (!auth.demo) void api.useFeedbackSnippet(snippet.id).catch(() => undefined);
  };

  const submitGrade = () => {
    if (previousAttempt) return;
    if (staleReview) { Alert.alert('Review the latest submission', 'Confirm that you reviewed the refreshed work before saving this draft.'); return; }
    if (!reviewBaseUpdatedAt) { Alert.alert('Refresh required', 'Reload the latest submission before saving this review.'); return; }
    if (!selectedGrade) { Alert.alert('Choose a grade', 'Select A, B, C, or Request redo before saving this review.'); return; }
    const cleanFeedback = feedback.trim();
    if (selectedGrade === 'R' && !cleanFeedback) { Alert.alert('Feedback required', 'Tell the student what to change before requesting a redo.'); return; }
    if (submission?.rubric?.criteria.some((criterion) => !criterionResults[criterion.id]?.rating)) { Alert.alert('Complete the rubric', 'Rate every criterion before saving this review.'); return; }
    mutation.mutate({
      grade: selectedGrade,
      feedback: cleanFeedback,
      baseSubmissionUpdatedAt: reviewBaseUpdatedAt,
      criterionResults: submission?.rubric?.criteria.map((criterion) => ({
        rubric_criterion_id: criterion.id,
        rating: criterionResults[criterion.id].rating!,
        feedback: criterionResults[criterion.id].feedback,
      })) || [],
    });
  };

  const acceptLatestSubmission = () => {
    if (!staleReview?.value) {
      void query.refetch().then((result) => {
        setStaleReviewVersion({ submissionId, value: result.data?.submission.updated_at || null });
      });
      return;
    }
    setReviewBaseVersion({ submissionId, value: staleReview.value });
    setStaleReviewVersion(null);
    setDraftNotice({ submissionId, value: 'Latest submission reviewed. Your draft is ready to save.' });
    setDraftSaveResult(null);
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

  if (!user?.is_staff) return <SafeAreaView style={styles.safe}><ErrorState title="Staff access only" message="Submission review is available to instructors and admins." retryLabel="Go to Today" retry={() => router.replace('/')} /></SafeAreaView>;
  if (!Number.isInteger(submissionId) || submissionId <= 0) return <SafeAreaView style={styles.safe}><ErrorState message="This submission link is invalid." retryLabel="Go to grading queue" retry={() => router.replace('/staff/grading')} /></SafeAreaView>;
  if (query.isPending && !submission) return <SafeAreaView style={styles.safe}><LoadingState label="Loading submission" /></SafeAreaView>;
  if (query.error && !submission) return <SafeAreaView style={styles.safe}><ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /></SafeAreaView>;
  if (!submission) return <SafeAreaView style={styles.safe}><ErrorState message="Submission not found." retry={() => router.back()} /></SafeAreaView>;
  const links = submissionLinks(submission);
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable><View style={styles.headerCopy}><Text style={styles.kicker}>QUICK REVIEW</Text><Text numberOfLines={1} style={styles.headerTitle}>{submission.user_name}</Text></View>{submission.grade && submission.grade !== 'R' ? <View style={styles.gradePill}><Text style={styles.gradePillText}>{`GRADE ${submission.grade}`}</Text></View> : <View style={styles.headerStatus}><StatusBadge status={submission.grade === 'R' ? 'redo' : 'awaiting_review'} short /></View>}</View>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flexRoot}>
      <ScrollView ref={scrollRef} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View><Text style={styles.eyebrow}>{submission.lesson_title}</Text><Text style={styles.title}>{submission.content_block_title}</Text><Text style={styles.meta}>Attempt {submission.num_submissions} · submitted {formatDate(submission.created_at)}</Text></View>
        {validatedProgress && <View style={styles.relationshipRow}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${submission.user_name}'s student health`} onPress={() => router.push({ pathname: '/staff/student/[id]', params: { id: String(submission.user_id), cohort_id: String(validatedProgress.cohort.id) } })} style={styles.relationshipButton}><FileText color={c.text.body} size={17} /><Text style={styles.relationshipText}>Student health</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Message ${submission.user_name} in ${validatedProgress.cohort.name}`} onPress={() => void openDirectMessage()} style={styles.relationshipButton}><MessageSquareText color={c.text.body} size={17} /><Text style={styles.relationshipText}>Message in {validatedProgress.cohort.name}</Text></Pressable></View>}
        {submission.exercise_body && <LearningCard><View style={styles.cardHeading}><FileText color={c.text.body} size={18} /><Text style={styles.cardHeadingText}>Assignment</Text></View><AuthoredContent body={submission.exercise_body} compact /></LearningCard>}
        {submission.text && <LearningCard><View style={styles.cardHeading}><Code2 color={c.text.body} size={18} /><Text style={styles.cardHeadingText}>Student response</Text></View><View style={styles.responseCode}><MessageCodeBlock code={submission.text} language={submission.language_hint || 'Response'} surface="lesson" testID="staff-submitted-text" /></View></LearningCard>}
        {!!links.length && <View style={styles.linkGrid}>{links.map((link) => <Pressable key={link.label} accessibilityRole="link" onPress={() => void openExternalPage(link.url).catch((error) => Alert.alert('Could not open link', (error as Error).message))} style={styles.linkCard}><link.Icon color={c.text.body} size={18} /><View style={styles.linkCopy}><Text style={styles.linkTitle}>{link.label}</Text><Text numberOfLines={1} style={styles.linkValue}>{link.detail}</Text></View><ExternalLink color={c.text.muted} size={15} /></Pressable>)}</View>}
        {(submission.branch || submission.commit_sha || submission.notes) && <LearningCard><View style={styles.cardHeading}><GitBranch color={c.text.body} size={18} /><Text style={styles.cardHeadingText}>Review context</Text></View>{submission.branch && <Detail label="Branch" value={submission.branch} />}{submission.commit_sha && <Detail label="Commit" value={submission.commit_sha} />}{submission.notes && <Detail label="Student note" value={submission.notes} />}</LearningCard>}
        {submission.github_checks && <GithubChecksCard submission={submission} />}
        {submission.solution && <LearningCard><View style={styles.cardHeading}><CheckCircle2 color={c.status.success.fg} size={18} /><Text style={styles.cardHeadingText}>Instructor solution</Text></View><View style={styles.responseCode}>{isRawCode(submission.solution) ? <MessageCodeBlock code={submission.solution} language={submission.language_hint || 'Solution'} surface="lesson" /> : <AuthoredContent body={submission.solution} compact />}</View></LearningCard>}
        {submission.rubric && <LearningCard><Text style={styles.feedbackLabel}>CRITERION REVIEW</Text><Text style={styles.rubricTitle}>{submission.rubric.title}</Text><View style={styles.rubricList}>{submission.rubric.criteria.map((criterion) => <View key={criterion.id} style={styles.rubricCriterion}><Text style={styles.cardHeadingText}>{criterion.title}</Text><Text style={styles.detailValue}>{criterion.description}</Text><View style={styles.ratingGrid}>{([['exceeds', 'Exceeds'], ['meets', 'Meets'], ['developing', 'Developing'], ['redo', 'Revision']] as [RubricRating, string][]).map(([rating, label]) => <Button key={rating} accessibilityRole="button" accessibilityState={{ selected: criterionResults[criterion.id]?.rating === rating, disabled: previousAttempt || draftRestoring || mutation.isPending }} disabled={previousAttempt || draftRestoring || mutation.isPending} onPress={() => setCriterionDraft({ submissionId, values: { ...criterionResults, [criterion.id]: { rating, feedback: criterionResults[criterion.id]?.feedback || '' } } })} style={[styles.ratingButton, criterionResults[criterion.id]?.rating === rating && styles.ratingButtonActive, (previousAttempt || draftRestoring || mutation.isPending) && styles.disabled]} variant="secondary" label={label} textStyle={styles.ratingButtonText} />)}</View><TextInput keyboardAppearance={scheme} accessibilityLabel={`Feedback for ${criterion.title}`} editable={!previousAttempt && !draftRestoring && !mutation.isPending} value={criterionResults[criterion.id]?.feedback || ''} onChangeText={(value) => setCriterionDraft({ submissionId, values: { ...criterionResults, [criterion.id]: { rating: criterionResults[criterion.id]?.rating || null, feedback: value } } })} placeholder="Optional focused feedback" placeholderTextColor={c.text.body} multiline style={styles.criterionFeedback} /></View>)}</View></LearningCard>}
        <View style={styles.feedbackSection}><Text style={styles.feedbackLabel}>FEEDBACK</Text>{Boolean(snippetsQuery.data?.feedback_snippets.length) && <View style={styles.snippetPanel}><View style={styles.snippetHeading}><MessageSquareText color={c.text.body} size={16} /><Text style={styles.snippetHeadingText}>REUSABLE SNIPPETS</Text></View><View style={styles.snippetList}>{snippetsQuery.data!.feedback_snippets.map((snippet) => <Button key={snippet.id} accessibilityRole="button" accessibilityHint="Inserts editable text into the feedback draft" accessibilityState={{ disabled: previousAttempt || draftRestoring || mutation.isPending }} disabled={previousAttempt || draftRestoring || mutation.isPending} onPress={() => applySnippet(snippet)} style={[styles.snippetButton, (previousAttempt || draftRestoring || mutation.isPending) && styles.disabled]} variant="secondary" label={snippet.title} textStyle={styles.snippetButtonText} />)}</View><Text style={styles.feedbackHint}>Tap to insert, then personalize the draft for this student.</Text></View>}<TextInput keyboardAppearance={scheme} accessibilityLabel="Feedback for student" editable={!previousAttempt && !draftRestoring && !mutation.isPending} value={feedback} selection={feedbackSelection} onSelectionChange={(event) => setFeedbackSelection(event.nativeEvent.selection)} onChangeText={(value) => setFeedbackDraft({ submissionId, value })} onFocus={() => { feedbackFocusedRef.current = true; requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true })); }} onBlur={() => { feedbackFocusedRef.current = false; }} placeholder="Give one clear next step or reinforce what worked…" placeholderTextColor={c.text.body} multiline textAlignVertical="top" style={styles.feedbackInput} /><View style={styles.voiceRow}><VoiceDraftButton state={voiceDraft.state} disabled={previousAttempt || draftRestoring || mutation.isPending} onPress={() => void voiceDraft.start()} /><Text style={styles.voiceHint}>Dictate a draft, then review and personalize it before saving.</Text></View><VoiceDraftPanel state={voiceDraft.state} durationMillis={voiceDraft.durationMillis} maxDurationSeconds={voiceDraft.maxDurationSeconds} metering={voiceDraft.metering} error={voiceDraft.error} notice={voiceDraft.notice} hasReview={Boolean(voiceDraft.review)} hasRecording={voiceDraft.hasRecording} onStop={() => void voiceDraft.stop()} onCancel={() => void voiceDraft.cancel()} onRetry={voiceDraft.retry} onRecordAgain={() => void voiceDraft.recordAgain()} onRestore={voiceDraft.restore} onDismiss={voiceDraft.dismissReview} /><Text style={styles.feedbackHint}>Redo requests require feedback. Passing grades may include concise feedback.</Text><Button variant="secondary" accessibilityRole="button" disabled={previousAttempt || draftRestoring || mutation.isPending || !feedback.trim() || snippetMutation.isPending} onPress={() => snippetMutation.mutate(feedback.trim())} style={({ pressed }) => [styles.saveSnippet, pressed && styles.pressed, (previousAttempt || draftRestoring || mutation.isPending || !feedback.trim() || snippetMutation.isPending) && styles.disabled]}><BookmarkPlus color={c.text.body} size={16} /><Text style={styles.saveSnippetText}>{snippetMutation.isPending ? 'Saving snippet…' : 'Save draft as reusable snippet'}</Text></Button></View>
        <View><GradingReviewActions previousAttempt={previousAttempt} onLatest={() => router.push(staffSubmissionPath(submission.latest_submission_id!, validatedCohortId ? { cohortId: validatedCohortId, studentId: submission.user_id } : undefined))} selected={selectedGrade} changed={reviewChanged} saving={mutation.isPending} disabled={previousAttempt || draftRestoring} saveBlocked={Boolean(staleReview)} onSelect={(grade) => setGradeDraft({ submissionId, value: grade })} onSave={submitGrade} />{reviewChanged && <Text style={[styles.draftStatus, visibleDraftSaveState === 'error' && styles.draftStatusError]}>{visibleDraftSaveState === 'error' ? 'Draft could not be saved on this device. Keep this screen open and try another edit.' : visibleDraftSaveState === 'saved' ? 'Review draft saved on this device.' : 'Saving review draft…'}</Text>}{visibleDraftNotice && <Text style={styles.draftNotice}>{visibleDraftNotice}</Text>}{staleReview && !previousAttempt && <Pressable accessibilityRole="button" accessibilityLabel={staleReview.value ? 'Use latest submission and keep draft' : 'Refresh latest submission'} accessibilityState={{ disabled: query.isFetching }} disabled={query.isFetching} onPress={acceptLatestSubmission} style={({ pressed }) => [styles.latestSubmissionButton, pressed && styles.pressed, query.isFetching && styles.disabled]}><RefreshCw color={c.status.warning.fg} size={17} /><Text style={styles.latestSubmissionButtonText}>{query.isFetching ? 'Refreshing latest submission…' : staleReview.value ? 'I reviewed the latest work — keep my draft' : 'Refresh latest submission'}</Text></Pressable>}</View>
        {mutation.isSuccess && <View style={styles.saved}><CheckCircle2 color={c.status.success.fg} size={18} /><Text style={styles.savedText}>Review saved and student notification queued.</Text></View>}
        <Pressable accessibilityRole="button" onPress={() => void openAuthenticatedWebPage(api, validatedCohortId ? `/admin/submissions/${submission.id}?cohort_id=${validatedCohortId}&student_id=${submission.user_id}` : `/admin/submissions/${submission.id}`).catch((error) => Alert.alert('Could not open full grading', (error as Error).message))} style={styles.handoff}><ExternalLink color={c.text.body} size={17} /><View style={styles.linkCopy}><Text style={styles.handoffTitle}>Open full submission record</Text><Text style={styles.handoffCopy}>{validatedCohortId ? 'Continue on the web with student, cohort, and grading context intact.' : 'Continue on the web in the submission record.'}</Text></View></Pressable>
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
function Detail({ label, value }: { label: string; value: string }) {
  const styles = useStyles(); return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>; }
/** A solution stored as plain code (no Markdown fence, no HTML) keeps its exact lines. */
function isRawCode(value: string) { return !/^\s*</.test(value) && !/^ {0,3}(`{3,}|~{3,})/m.test(value) && looksLikeCode(value); }
function formatDate(value: string) { return formatCourseDateTime(value, { fallback: value }); }

function GithubChecksCard({ submission }: { submission: Submission }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const checks = submission.github_checks!;
  return <LearningCard>
    <View style={styles.cardHeading}><GitBranch color={c.text.body} size={18} /><View style={styles.linkCopy}><Text style={styles.cardHeadingText}>Automated checks</Text><Text style={styles.checkBoundary}>Exact commit status; logs stay on GitHub.</Text></View></View>
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
      const row = <><Icon color={run.conclusion === 'success' ? c.status.success.fg : failed ? c.status.warning.fg : c.text.muted} size={17} /><View style={styles.linkCopy}><Text numberOfLines={1} style={styles.checkName}>{run.name}</Text><Text numberOfLines={1} style={styles.checkMeta}>{run.workflow_name || run.app_slug || 'GitHub'} · {run.conclusion?.replaceAll('_', ' ') || 'pending'}</Text></View>{detailsUrl && <ExternalLink color={c.text.muted} size={15} />}</>;
      return detailsUrl ? <Pressable key={run.id} accessibilityRole="link" accessibilityLabel={`Open ${run.name} on GitHub`} onPress={() => void openExternalPage(detailsUrl).catch((error) => Alert.alert('Could not open check', (error as Error).message))} style={styles.checkRow}>{row}</Pressable> : <View key={run.id} style={styles.checkRow}>{row}</View>;
    })}</View>
  </LearningCard>;
}

function CheckCount({ label, count, tone }: { label: string; count: number; tone: 'success' | 'failure' | 'pending' }) {
  const styles = useStyles();
  return <View style={[styles.checkPill, tone === 'success' ? styles.checkSuccess : tone === 'failure' ? styles.checkFailure : styles.checkPending]}><Text style={styles.checkPillText}>{count} {label}</Text></View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, flexRoot: { flex: 1 }, header: { minHeight: 70, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minWidth: 0 }, kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.2 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17 }, headerStatus: { marginRight: 10, flexShrink: 0 }, responseCode: { marginTop: 10 }, gradePill: { minHeight: 30, borderRadius: 15, backgroundColor: c.status.success.bg, borderWidth: 1, borderColor: c.border.strong, justifyContent: 'center', paddingHorizontal: 10, marginRight: 10 }, redoPill: { backgroundColor: c.status.warning.bg, borderColor: c.status.warning.border }, gradePillText: { color: c.status.success.fg, fontFamily: fonts.extraBold, fontSize: 12, letterSpacing: 0.8 }, content: { padding: 20, paddingBottom: 70, gap: 14 }, eyebrow: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34, letterSpacing: -0.7, marginTop: 5 }, meta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 7 }, cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }, cardHeadingText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, linkGrid: { gap: 8 }, linkCard: { minHeight: 58, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, linkCopy: { flex: 1, minWidth: 0 }, linkTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, linkValue: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 }, detail: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle, paddingVertical: 9 }, detailLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8 }, detailValue: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 3 }, rubricTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 16 }, rubricList: { gap: 10, marginTop: 12 }, rubricCriterion: { borderRadius: 15, borderWidth: 1, borderColor: c.border.strong, padding: 12 }, ratingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }, ratingButton: { minHeight: 44, minWidth: '47%', flexGrow: 1, borderRadius: 12, borderWidth: 1,  alignItems: 'center', justifyContent: 'center' }, ratingButtonActive: {   borderWidth: 2 }, ratingButtonText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, criterionFeedback: { minHeight: 76, borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, padding: 11, marginTop: 8 }, feedbackSection: { marginTop: 8 }, feedbackLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.3, marginBottom: 8 }, snippetPanel: { borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 12, marginBottom: 10 }, snippetHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 }, snippetHeadingText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, snippetList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }, snippetButton: { minHeight: 44, borderRadius: 12, borderWidth: 1,   justifyContent: 'center', paddingHorizontal: 11, paddingVertical: 7 }, snippetButtonText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, feedbackInput: { minHeight: 142, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, color: c.text.strong, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, padding: 14 }, feedbackHint: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 7 }, saveSnippet: { minHeight: 44, alignSelf: 'flex-start', borderRadius: 12, borderWidth: 1,  flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginTop: 10 }, saveSnippetText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, pressed: { opacity: 0.76 }, disabled: { opacity: 0.42 }, gradeSection: { marginTop: 6 }, gradeHint: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: -3, marginBottom: 10 }, gradeRow: { flexDirection: 'row', gap: 8 }, gradeButton: { flex: 1, minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, gradeButtonActive: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator, borderWidth: 2 }, gradeButtonText: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 13 }, redoButton: { minHeight: 52, borderRadius: 15, borderWidth: 1, borderColor: c.status.warning.border, backgroundColor: c.status.warning.bg, marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, redoButtonActive: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator, borderWidth: 2 }, redoButtonText: { color: c.status.warning.fg, fontFamily: fonts.bold, fontSize: 12 }, saveReview: { minHeight: 54, borderRadius: 16, backgroundColor: c.action.primary, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, saveReviewText: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 13 }, draftStatus: { color: c.status.success.fg, fontFamily: fonts.semibold, fontSize: 12, textAlign: 'center', marginTop: 9 }, draftStatusError: { color: c.status.danger.fg }, draftNotice: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 7 }, saved: { minHeight: 48, borderRadius: 15, backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, savedText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, handoff: { minHeight: 70, borderRadius: 17, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 }, handoffTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, handoffCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 3 },
  relationshipRow: { flexDirection: 'row', gap: 8 }, relationshipButton: { flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, relationshipText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 },
  checkBoundary: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 }, checkSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, checkPill: { minHeight: 30, borderRadius: 15, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 10 }, checkSuccess: { backgroundColor: c.status.success.bg, borderColor: c.status.success.border }, checkFailure: { backgroundColor: c.surface.sunken, borderColor: c.border.strong }, checkPending: { backgroundColor: c.surface.sunken, borderColor: c.border.strong }, checkPillText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, checkCommit: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 9 }, checkList: { marginTop: 9 }, checkRow: { minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', gap: 9 }, checkName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, checkMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  voiceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }, voiceHint: { flex: 1, color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  response: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 },
  latestSubmissionButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, marginTop: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  latestSubmissionButtonText: { color: c.status.warning.fg, fontFamily: fonts.bold, fontSize: 12, textAlign: 'center' },
}));
