import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Check, ChevronDown, ChevronUp, Circle, Clock3, Code2, ExternalLink, FileText, Film, GitBranch, Lightbulb, Lock, Play, RotateCcw, Save, Send } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fonts, monoFont, palette, statusTones } from '@/constants/csg-theme';
import { formatCourseDateTime } from '@/lib/course-time';
import { openAuthenticatedWebLesson } from '@/lib/external-links';
import { webLessonUrl } from '@/lib/hafa-starter-links';
import { isEmptyVideoStep, isExerciseBlock, isSubmissionCheckpoint, submissionStatus } from '@/lib/learning-status';
import { buildSubmissionInput, canSubmitWork, isNewSubmissionAttempt, learningKeys, submissionState, submissionTypeFor } from '@/lib/learning';
import { analyticsAgeBucket, captureProductEvent } from '@/lib/analytics';
import { clearSubmissionDraft, loadSubmissionDraft, saveSubmissionDraft, submissionDraftMatches, type SubmissionDraft } from '@/lib/submission-storage';
import type { LessonContentBlock, LessonDetail, SessionUser, Submission, SubmissionBrief, SubmissionInput, VideoProgressInput } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { AuthoredContent, type StarterLinkContext } from './authored-content';
import { StatusBadge } from './learning-ui';
import { LessonMarkdown } from './lesson-markdown';
import { MessageCodeBlock } from './message-code-block';
import { InAppMediaPlayer, type InAppMediaPlayerHandle } from './in-app-media-player';
import { NativeVideoPlayer, type NativeVideoPlayerHandle } from './native-video-player';
import { VideoSegmentControls } from './video-segment-controls';
import { normalizeVideoSegments, segmentPlaybackStart, type VideoSegment } from '@/lib/video-segments';

interface LessonContentBlockProps {
  block: LessonContentBlock;
  lesson: LessonDetail;
}

interface PendingSubmissionDraft {
  userId: number;
  contentBlockId: number;
  cohortId?: number | null;
  text: string;
  baseSubmissionId: number | null;
  baseSubmissionUpdatedAt: string | null;
  changed: boolean;
}

export function LessonContentBlockCard({ block, lesson }: LessonContentBlockProps) {
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const studentMode = !user?.is_staff;
  const queryClient = useQueryClient();
  const submissions = block.submissions || [];
  const { latest, passed, redo, editable } = submissionState(submissions);
  const submissionType = submissionTypeFor(block, lesson.requires_github);
  const isVideo = block.block_type === 'video' || block.block_type === 'recording';
  const completed = block.progress?.status === 'completed';
  const [knowledgeCheckDraft, setKnowledgeCheckDraft] = useState<{ blockId: number; value: NonNullable<LessonContentBlock['knowledge_check']> } | null>(null);
  const knowledgeCheck = knowledgeCheckDraft?.blockId === block.id ? knowledgeCheckDraft.value : block.knowledge_check || null;
  const isExercise = isExerciseBlock(block);
  // Checkpoints with an explicit reviewed submission type (the Python pilot's
  // weekly checkpoints) are graded work, exactly like an exercise.
  const isCheckpointWork = isSubmissionCheckpoint({ ...block, knowledge_check: knowledgeCheck });
  const isWorkBlock = isExercise || isCheckpointWork;
  const usesTextSubmission = isWorkBlock && submissionType === 'text_submission';
  const usesRepoSubmission = isWorkBlock && submissionType.includes('repo_');
  const reviewedWork = isWorkBlock && submissionType !== 'manual_complete';
  const [selectedCheckOption, setSelectedCheckOption] = useState<number | null>(null);
  const locked = Boolean(lesson.submission_window?.submissions_closed && (isWorkBlock || (block.block_type === 'checkpoint' && !knowledgeCheck)));
  const runner = block.submission_config?.runner as { enabled?: boolean; language?: string } | undefined;
  const [text, setText] = useState(latest?.text || '');
  const [repoUrl, setRepoUrl] = useState(latest?.repo_url || '');
  const [liveUrl, setLiveUrl] = useState(latest?.live_url || '');
  const [prUrl, setPrUrl] = useState(latest?.pr_url || '');
  const [branch, setBranch] = useState(latest?.branch || '');
  const [commitSha, setCommitSha] = useState(latest?.commit_sha || '');
  const [notes, setNotes] = useState(latest?.notes || '');
  const [showDetails, setShowDetails] = useState(Boolean(latest?.pr_url || latest?.branch || latest?.commit_sha || latest?.notes));
  const [showSolution, setShowSolution] = useState(false);
  const [message, setMessage] = useState<{ body: string; success: boolean } | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [olderDraft, setOlderDraft] = useState<SubmissionDraft | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = useRef<PendingSubmissionDraft | null>(null);
  const studentEditedRef = useRef(false);
  const trackedFeedbackRef = useRef<number | null>(null);
  const cohortId = studentMode ? lesson.cohort_id : null;
  const lessonQueryKey = useMemo(() => learningKeys.lesson(user?.id || 0, lesson.id, cohortId), [cohortId, lesson.id, user?.id]);

  const updateDemoBlock = useCallback((update: (current: LessonContentBlock) => LessonContentBlock) => {
    queryClient.setQueryData<{ lesson: LessonDetail }>(lessonQueryKey, (current) => current ? {
      lesson: { ...current.lesson, content_blocks: current.lesson.content_blocks.map((item) => item.id === block.id ? update(item) : item) },
    } : current);
  }, [block.id, lessonQueryKey, queryClient]);

  useEffect(() => {
    if (!studentMode || !usesTextSubmission || !user) return;
    let canceled = false;
    void loadSubmissionDraft(user.id, block.id, cohortId).then((draft) => {
      if (canceled) return;
      if (draft && studentEditedRef.current) {
        setOlderDraft(draft);
        setDraftNotice('A device draft is available to restore.');
      } else if (draft && submissionDraftMatches(draft, latest?.id ?? null, latest?.updated_at ?? null) && draft.text !== (latest?.text || '')) {
        setText(draft.text);
        setDraftNotice('Draft restored from this device. It has not been submitted.');
      } else if (draft && !submissionDraftMatches(draft, latest?.id ?? null, latest?.updated_at ?? null)) {
        setOlderDraft(draft);
        setDraftNotice('An older device draft is available to restore.');
      } else if (draft) {
        void clearSubmissionDraft(user.id, block.id, cohortId);
      }
    }).catch(() => {
      if (!canceled) setDraftNotice('Draft storage is temporarily unavailable. Keep this screen open.');
    }).finally(() => {
      if (!canceled) setDraftHydrated(true);
    });
    return () => { canceled = true; };
  }, [block.id, cohortId, latest?.id, latest?.text, latest?.updated_at, studentMode, usesTextSubmission, user]);

  useEffect(() => {
    if (!studentMode || !usesTextSubmission || !user || !draftHydrated) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const changed = text !== (latest?.text || '');
    const pending: PendingSubmissionDraft = { userId: user.id, contentBlockId: block.id, cohortId, text, baseSubmissionId: latest?.id ?? null, baseSubmissionUpdatedAt: latest?.updated_at ?? null, changed };
    pendingDraftRef.current = pending;
    draftTimerRef.current = setTimeout(() => {
      void persistSubmissionDraft(pending).then(() => {
        if (pendingDraftRef.current !== pending) return;
        pendingDraftRef.current = null;
        setDraftNotice(changed ? 'Draft saved on this device · not submitted' : null);
      }).catch(() => setDraftNotice('Draft could not be saved. Keep this screen open.'));
    }, 300);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [block.id, cohortId, draftHydrated, latest?.id, latest?.text, latest?.updated_at, studentMode, text, usesTextSubmission, user]);

  useEffect(() => () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    if (pendingDraftRef.current) void persistSubmissionDraft(pendingDraftRef.current).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!latest?.grade || trackedFeedbackRef.current === latest.id) return;
    trackedFeedbackRef.current = latest.id;
    captureProductEvent('feedback_viewed', {
      submission_id: latest.id,
      grade_state: latest.grade === 'R' ? 'redo' : 'passed',
      age_bucket: analyticsAgeBucket(latest.graded_at),
    });
  }, [latest?.grade, latest?.graded_at, latest?.id]);

  const refresh = async () => {
    if (!user) return;
    if (auth.demo) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: lessonQueryKey }),
      queryClient.invalidateQueries({ queryKey: learningKeys.dashboard(user.id) }),
    ]);
  };
  const progressMutation = useMutation({
    mutationFn: (status: string) => auth.demo ? Promise.resolve({ progress: { id: block.id, content_block_id: block.id, status, completed_at: status === 'completed' ? new Date().toISOString() : null } }) : api.updateProgress(block.id, status, cohortId),
    onSuccess: (_result, status) => {
      if (status === 'completed') captureProductEvent('learning_step_completed', {
        module_id: lesson.module_id, lesson_id: lesson.id, content_block_id: block.id, block_type: block.block_type, source: 'manual',
      });
      if (auth.demo) updateDemoBlock((current) => ({ ...current, progress: { ...current.progress, status, completed_at: status === 'completed' ? new Date().toISOString() : null } }));
      void refresh();
    },
    onError: (error) => Alert.alert('Could not update progress', (error as Error).message),
  });
  const knowledgeCheckMutation = useMutation({
    mutationFn: () => {
      if (!knowledgeCheck || selectedCheckOption === null) throw new Error('Choose an answer first.');
      return api.attemptKnowledgeCheck(knowledgeCheck.id, selectedCheckOption, cohortId);
    },
    onSuccess: async (result) => {
      setKnowledgeCheckDraft({ blockId: block.id, value: result.knowledge_check });
      if (result.knowledge_check.latest_attempt) captureProductEvent('knowledge_check_attempted', {
        knowledge_check_id: result.knowledge_check.id,
        content_block_id: block.id,
        correct: result.knowledge_check.latest_attempt.correct,
        attempt: result.knowledge_check.attempt_count,
      });
      if (result.progress?.status === 'completed') await refresh();
    },
    onError: (error) => Alert.alert('Could not check answer', (error as Error).message),
  });
  const submissionMutation = useMutation({
    mutationFn: async () => {
      const input = buildSubmissionInput(block.id, submissionType, { text, repoUrl, liveUrl, prUrl, branch, commitSha, notes });
      if (auth.demo) return { submission: demoSubmission(block, lesson, user, input, latest) };
      if (editable && latest) return api.updateSubmission(latest.id, withoutContentBlock(input), cohortId);
      return api.createSubmission(input, cohortId);
    },
    onSuccess: async (result) => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      pendingDraftRef.current = null;
      if (user) await clearSubmissionDraft(user.id, block.id, cohortId).catch(() => undefined);
      setDraftNotice(null);
      setOlderDraft(null);
      const attempt = result.submission.num_submissions || (latest?.num_submissions || 0) + 1;
      const isNewAttempt = isNewSubmissionAttempt(editable);
      if (isNewAttempt) captureProductEvent('submission_created', { content_block_id: block.id, submission_type: submissionType, attempt });
      if (redo && latest) captureProductEvent('redo_submitted', { submission_id: result.submission.id, attempt, age_bucket: analyticsAgeBucket(latest.graded_at) });
      if (isNewAttempt) captureProductEvent('learning_step_completed', {
        module_id: lesson.module_id, lesson_id: lesson.id, content_block_id: block.id, block_type: block.block_type, source: 'submission',
      });
      setMessage({ body: editable ? 'Submission updated · awaiting review.' : redo ? 'Redo submitted · awaiting review.' : 'Submitted · your instructor will review it.', success: true });
      if (auth.demo) updateDemoBlock((current) => ({ ...current, progress: { status: 'completed', completed_at: result.submission.created_at }, submissions: [result.submission] }));
      await refresh();
    },
    onError: async (error) => {
      if (user && usesTextSubmission) {
        try {
          await saveSubmissionDraft(user.id, block.id, text, latest?.id ?? null, latest?.updated_at ?? null, cohortId);
          setDraftNotice('Draft saved on this device · not submitted');
        } catch {
          setDraftNotice('Draft could not be saved. Keep this screen open.');
        }
      }
      setMessage({ body: `Not submitted. ${(error as Error).message}`, success: false });
    },
  });
  const handoffMutation = useMutation({
    mutationFn: () => openAuthenticatedWebLesson(api, lesson.id),
    onError: (error) => Alert.alert('Could not open the code runner', (error as Error).message),
  });
  const canSubmit = useMemo(() => {
    if (locked || passed || submissionMutation.isPending) return false;
    return canSubmitWork(submissionType, { text, repoUrl, liveUrl });
  }, [liveUrl, locked, passed, repoUrl, submissionMutation.isPending, submissionType, text]);

  const icon = isVideo ? Play : isExercise ? Code2 : block.block_type === 'checkpoint' ? BadgeCheck : FileText;
  const Icon = icon;
  const blockTitle = block.title?.trim() || '';
  // The lesson hero already shows the lesson title; a block named the same only repeats it.
  const showBlockTitle = Boolean(blockTitle) && blockTitle !== lesson.title.trim();
  const starterLinks = useMemo<StarterLinkContext>(() => ({
    lessonReturn: { url: webLessonUrl(lesson.id, lesson.cohort_id), label: lesson.title },
    hint: studentMode && usesTextSubmission && !locked && !passed ? 'submit' : 'practice',
  }), [lesson.cohort_id, lesson.id, lesson.title, locked, passed, studentMode, usesTextSubmission]);
  const showMarkComplete = studentMode && !knowledgeCheck && !reviewedWork && !(isVideo && block.has_s3_video);
  const markCompleteCopy = isExercise ? 'This practice does not need a submission. Mark it complete when you finish.' : null;

  // An imported video step with no video yet has nothing for a learner to do.
  if (studentMode && isEmptyVideoStep(block)) return null;

  return <View style={styles.card} testID={`lesson-block-${block.id}`}>
    <View style={styles.header}><View style={styles.icon}><Icon color={palette.rubySoft} size={19} /></View><View style={styles.flex}><Text style={styles.kicker}>{blockKicker(block.block_type, isCheckpointWork)}</Text>{(showBlockTitle || !blockTitle) && <Text style={styles.title}>{blockTitle || blockLabel(block.block_type)}</Text>}</View>{studentMode && completed && (!reviewedWork || (submissionType === 'prework_github_sync' && !latest)) && <StatusBadge status="done" short />}</View>
    {block.body && <View style={styles.body}><AuthoredContent body={block.body} starterLinks={starterLinks} /></View>}
    {!studentMode && block.solution && <View style={styles.solution}><Pressable accessibilityRole="button" accessibilityState={{ expanded: showSolution }} onPress={() => setShowSolution((value) => !value)} style={styles.solutionButton}><Text style={styles.solutionButtonText}>Instructor solution</Text>{showSolution ? <ChevronUp color={palette.rubySoft} size={18} /> : <ChevronDown color={palette.rubySoft} size={18} />}</Pressable>{showSolution && <View style={styles.solutionBody}><LessonMarkdown body={block.solution} /></View>}</View>}
    {knowledgeCheck && <View accessibilityLabel="Quick retrieval check" style={styles.checkCard}>
      <View style={styles.checkKicker}><Lightbulb color={palette.rubySoft} size={16} /><Text style={styles.checkKickerText}>QUICK RECALL</Text>{knowledgeCheck.objective_code && <Text style={styles.objectiveCode}>{knowledgeCheck.objective_code}</Text>}</View>
      <Text style={styles.checkPrompt}>{knowledgeCheck.prompt}</Text>
      <View style={styles.checkOptions}>{knowledgeCheck.options.map((option, index) => {
        const result = knowledgeCheck.latest_attempt;
        const answerIndex = result?.correct_option ?? (!studentMode ? knowledgeCheck.correct_option : undefined);
        const correctAnswer = index === answerIndex;
        const incorrectChoice = Boolean(result && !result.correct && index === result.selected_option);
        const selected = selectedCheckOption === index;
        const disabled = !studentMode || Boolean(result?.correct);
        return <Pressable key={`${index}:${option}`} accessibilityRole="radio" accessibilityState={{ checked: selected || Boolean(result?.correct && correctAnswer), disabled }} disabled={disabled} onPress={() => setSelectedCheckOption(index)} style={[styles.checkOption, selected && styles.checkOptionSelected, correctAnswer && styles.checkOptionCorrect, incorrectChoice && styles.checkOptionIncorrect]}><Text style={styles.checkOptionLetter}>{String.fromCharCode(65 + index)}</Text><Text style={styles.checkOptionText}>{option}</Text></Pressable>;
      })}</View>
      {!studentMode && knowledgeCheck.correct_option !== undefined && <View style={[styles.checkResult, styles.checkResultCorrect]}><Text style={[styles.checkResultTitle, { color: palette.success }]}>Answer key</Text><Text style={styles.checkExplanation}>{knowledgeCheck.explanation}</Text></View>}
      {studentMode && knowledgeCheck.latest_attempt && <View accessibilityLiveRegion="polite" style={[styles.checkResult, knowledgeCheck.latest_attempt.correct ? styles.checkResultCorrect : styles.checkResultRetry]}><Text style={[styles.checkResultTitle, { color: knowledgeCheck.latest_attempt.correct ? palette.success : palette.warning }]}>{knowledgeCheck.latest_attempt.correct ? 'Correct — check complete' : 'Not yet — review and retry'}</Text><Text style={styles.checkExplanation}>{knowledgeCheck.latest_attempt.explanation}</Text></View>}
      {studentMode && !knowledgeCheck.latest_attempt?.correct && <Pressable accessibilityRole="button" disabled={selectedCheckOption === null || knowledgeCheckMutation.isPending} onPress={() => knowledgeCheckMutation.mutate()} style={[styles.checkButton, (selectedCheckOption === null || knowledgeCheckMutation.isPending) && styles.buttonDisabled]}>{knowledgeCheckMutation.isPending ? <ActivityIndicator color={palette.text} /> : <Text style={styles.checkButtonText}>{knowledgeCheck.latest_attempt ? 'Try this answer' : 'Check answer'}</Text>}</Pressable>}
      {knowledgeCheck.attempt_count > 0 && <Text style={styles.checkAttempts}>{knowledgeCheck.attempt_count} {knowledgeCheck.attempt_count === 1 ? 'attempt' : 'attempts'} recorded</Text>}
    </View>}
    {block.filename && <View style={styles.file}><Code2 color={palette.muted} size={15} /><Text style={styles.fileText}>{block.filename}</Text></View>}
    {isVideo && <LessonVideo block={block} lesson={lesson} />}
    {runner?.enabled && <Pressable accessibilityRole="button" accessibilityLabel="Open code runner on the web" accessibilityState={{ busy: handoffMutation.isPending, disabled: handoffMutation.isPending }} disabled={handoffMutation.isPending} onPress={() => handoffMutation.mutate()} style={[styles.outlineButton, handoffMutation.isPending && styles.buttonDisabled]}>{handoffMutation.isPending ? <ActivityIndicator color={palette.rubySoft} /> : <Code2 color={palette.rubySoft} size={17} />}<Text style={styles.outlineText}>{handoffMutation.isPending ? 'Opening secure runner…' : `Open ${runner.language || 'code'} runner`}</Text><ExternalLink color={palette.muted} size={15} /></Pressable>}
    {reviewedWork && latest && <SubmissionStatus submission={latest} />}
    {locked && <View style={styles.locked}><Lock color={palette.warning} size={17} /><View style={styles.flex}><Text style={styles.lockedTitle}>Submissions are closed</Text><Text style={styles.lockedCopy}>You can review this lesson and existing feedback.</Text></View></View>}
    {studentMode && isExercise && submissionType === 'prework_github_sync' && <View style={styles.sync}><GitBranch color={palette.rubySoft} size={18} /><View style={styles.flex}><Text style={styles.syncTitle}>Reviewed through GitHub</Text><Text style={styles.syncCopy}>{lesson.repository_name ? `Your work syncs from ${lesson.repository_name}.` : 'Your linked class repository is the source of truth.'}</Text></View></View>}
    {studentMode && (usesTextSubmission || usesRepoSubmission) && !passed && <View style={styles.form}>
      {usesTextSubmission ? <CodeField label={editable ? 'Update your response' : redo ? 'Submit your redo' : 'Your response'} hint="Paste your code and your answers. Line breaks and spaces are kept exactly." value={text} onChangeText={(value) => { studentEditedRef.current = true; setText(value); setDraftNotice('Saving draft on this device…'); setMessage(null); }} placeholder="Paste your code here…" /> : <>
        <Field label="Repository URL" value={repoUrl} onChangeText={(value) => { setRepoUrl(value); setMessage(null); }} placeholder="https://github.com/…" keyboardType="url" />
        {submissionType === 'repo_and_live_url_submission' && <Field label="Live site URL" value={liveUrl} onChangeText={(value) => { setLiveUrl(value); setMessage(null); }} placeholder="https://…" keyboardType="url" />}
        <Pressable accessibilityRole="button" onPress={() => setShowDetails((value) => !value)} style={styles.detailsButton}><Text style={styles.detailsText}>{showDetails ? 'Hide optional details' : 'Add PR, branch, commit, or notes'}</Text></Pressable>
        {showDetails && <><Field label="Pull request URL" value={prUrl} onChangeText={setPrUrl} placeholder="https://github.com/…/pull/…" keyboardType="url" /><Field label="Branch" value={branch} onChangeText={setBranch} placeholder="feature/my-work" /><Field label="Commit" value={commitSha} onChangeText={setCommitSha} placeholder="Commit SHA" /><Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Anything your instructor should know…" /></>}
      </>}
      {olderDraft && <Pressable accessibilityRole="button" onPress={() => { setText(olderDraft.text); setOlderDraft(null); setDraftNotice('Older draft restored · not submitted'); }} style={styles.restoreDraft}><RotateCcw color={palette.rubySoft} size={15} /><Text style={styles.restoreDraftText}>Restore older device draft</Text></Pressable>}
      {draftNotice && <View accessibilityLiveRegion="polite" style={styles.draftNotice}><Save color={palette.subtle} size={14} /><Text style={styles.draftNoticeText}>{draftNotice}</Text></View>}
      {message && <Text accessibilityLiveRegion="polite" style={[styles.message, message.success && styles.messageSuccess]}>{message.body}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={editable ? 'Update submission' : redo ? 'Submit redo' : 'Submit work'} disabled={!canSubmit} onPress={() => submissionMutation.mutate()} style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}>{submissionMutation.isPending ? <ActivityIndicator color={palette.text} /> : <><Send color={palette.text} size={17} /><Text style={styles.primaryText}>{editable ? 'Update submission' : redo ? 'Submit redo' : 'Submit work'}</Text></>}</Pressable>
    </View>}
    {reviewedWork && <SubmissionHistory submissions={submissions} latestId={latest?.id ?? null} showLatest={!(studentMode && editable && !locked)} />}
    {showMarkComplete ? <>{markCompleteCopy && !completed && <Text style={styles.markCompleteCopy}>{markCompleteCopy}</Text>}<Pressable accessibilityRole="button" accessibilityLabel={completed ? 'Mark not done' : 'Mark complete'} disabled={locked || progressMutation.isPending} onPress={() => progressMutation.mutate(completed ? 'not_started' : 'completed')} style={[styles.completeButton, completed && styles.completeButtonDone, (locked || progressMutation.isPending) && styles.buttonDisabled]}>{progressMutation.isPending ? <ActivityIndicator color={palette.text} /> : <>{completed ? <Check color={palette.success} size={18} /> : <Circle color={palette.rubySoft} size={18} />}<Text style={[styles.completeButtonText, completed && styles.completeButtonTextDone]}>{completed ? 'Done · tap to undo' : 'Mark complete'}</Text></>}</Pressable></> : null}
  </View>;
}

function LessonVideo({ block, lesson }: { block: LessonContentBlock; lesson: LessonDetail }) {
  const { api, user } = useSession();
  const userId = user?.id ?? null;
  const cohortId = user?.is_staff ? null : lesson.cohort_id;
  const queryClient = useQueryClient();
  const trackedCompletionRef = useRef(block.progress?.status === 'completed');
  const hostedPlayerRef = useRef<NativeVideoPlayerHandle>(null);
  const linkedPlayerRef = useRef<InAppMediaPlayerHandle>(null);
  const [activeVideoSegment, setActiveVideoSegment] = useState<VideoSegment | null>(null);
  const [completedVideoSegment, setCompletedVideoSegment] = useState<VideoSegment | null>(null);
  const videoSegments = useMemo(() => normalizeVideoSegments(block.metadata), [block.metadata]);
  const initialPosition = segmentPlaybackStart(videoSegments, block.progress?.video_last_position || 0);
  const fetchStream = useCallback(async () => {
    const response = await api.contentVideoStream(block.id, undefined, cohortId);
    return { stream_url: response.stream_url, expires_at: response.expires_at };
  }, [api, block.id, cohortId]);
  const saveProgress = useCallback(async (progress: VideoProgressInput) => {
    const response = await api.updateContentVideoProgress(block.id, progress, cohortId);
    if (response.video_progress.completed && !trackedCompletionRef.current) {
      trackedCompletionRef.current = true;
      captureProductEvent('learning_step_completed', {
        module_id: lesson.module_id, lesson_id: lesson.id, content_block_id: block.id, block_type: block.block_type, source: 'video',
      });
    }
    if (!userId) return;
    queryClient.setQueryData<{ lesson: LessonDetail }>(learningKeys.lesson(userId, lesson.id, cohortId), (current) => current ? { lesson: { ...current.lesson, content_blocks: current.lesson.content_blocks.map((candidate) => candidate.id === block.id ? { ...candidate, progress: { ...candidate.progress, status: response.video_progress.status, completed_at: response.video_progress.completed ? new Date().toISOString() : candidate.progress?.completed_at || null, video_last_position: response.video_progress.last_position, video_total_watched: response.video_progress.total_watched } } : candidate) } } : current);
    if (response.video_progress.completed) void queryClient.invalidateQueries({ queryKey: learningKeys.dashboard(userId) });
  }, [api, block.block_type, block.id, cohortId, lesson.id, lesson.module_id, queryClient, userId]);

  if (block.metadata?.staged_video_upload) return <View style={styles.stagedVideo}><Film color={palette.rubySoft} size={18} /><View style={styles.flex}><Text style={styles.stagedVideoTitle}>Hosted video ready to save</Text><Text style={styles.stagedVideoCopy}>Playback becomes available as soon as this lesson draft is saved.</Text></View></View>;
  const seekToSegment = (segment: VideoSegment) => {
    setActiveVideoSegment(segment);
    setCompletedVideoSegment(null);
    hostedPlayerRef.current?.seekTo(segment.start_seconds, true);
    linkedPlayerRef.current?.seekTo(segment.start_seconds, true, segment.end_seconds);
  };
  const finishSegment = () => {
    if (!activeVideoSegment) return;
    setCompletedVideoSegment(activeVideoSegment);
    setActiveVideoSegment(null);
  };
  if (block.has_s3_video) return <View style={styles.nativeVideo}><NativeVideoPlayer ref={hostedPlayerRef} fetchStream={fetchStream} initialPosition={initialPosition} initialTotalWatched={block.progress?.video_total_watched || 0} saveProgress={saveProgress} stopAtSeconds={activeVideoSegment?.end_seconds ?? null} onStopAtReached={finishSegment} title={block.title || lesson.title} trackProgress={!user?.is_staff} /><VideoSegmentControls segments={videoSegments} activeSegment={activeVideoSegment} completedSegment={completedVideoSegment} onSelect={seekToSegment} /></View>;
  if (!block.video_url) return user?.is_staff ? <View style={styles.stagedVideo}><Film color={palette.quiet} size={18} /><View style={styles.flex}><Text style={styles.stagedVideoTitle}>No video source attached</Text><Text style={styles.stagedVideoCopy}>Add a link or hosted file in the editor.</Text></View></View> : null;
  return <View style={styles.nativeVideo}><InAppMediaPlayer ref={linkedPlayerRef} initialPosition={initialPosition} initialTotalWatched={block.progress?.video_total_watched || 0} saveProgress={saveProgress} stopAtSeconds={activeVideoSegment?.end_seconds ?? null} onStopAtReached={finishSegment} title={block.title || lesson.title} trackProgress={!user?.is_staff} url={block.video_url} /><VideoSegmentControls segments={videoSegments} activeSegment={activeVideoSegment} completedSegment={completedVideoSegment} onSelect={seekToSegment} /></View>;
}

/** The latest review: one card with the status and the instructor's formatted feedback. */
function SubmissionStatus({ submission }: { submission: SubmissionBrief }) {
  const status = submissionStatus(submission);
  if (status === 'awaiting_review') return <View accessibilityRole="summary" style={[styles.status, styles.statusPending]} testID="submission-status"><Clock3 color={statusTones.pending.border} size={18} /><View style={styles.flex}><Text style={styles.statusTitle}>Submitted · awaiting review</Text><Text style={styles.statusCopy}>Your instructor will reply here. You can still revise and resubmit before they review it.</Text><Text style={styles.statusMeta}>Attempt {submission.num_submissions || 1} · {formatCourseDateTime(submission.created_at, { fallback: submission.created_at })}</Text></View></View>;
  const redo = status === 'redo';
  return <View accessibilityRole="summary" style={[styles.status, redo ? styles.statusRedo : styles.statusPassed]} testID="submission-status">{redo ? <RotateCcw color={palette.warning} size={18} /> : <BadgeCheck color={palette.success} size={18} />}<View style={styles.flex}><Text style={styles.statusTitle}>{redo ? 'Redo requested — read the feedback, then resubmit below.' : `Reviewed by your instructor${submission.grade ? ` · ${submission.grade}` : ''}`}</Text>{submission.feedback ? <View style={styles.feedbackBody} testID="submission-feedback"><AuthoredContent body={submission.feedback} compact /></View> : redo ? <Text style={styles.statusCopy}>Review the instructions and try again. Message your instructor if you are not sure what to change.</Text> : null}<Text style={styles.statusMeta}>Attempt {submission.num_submissions || 1} · {formatCourseDateTime(submission.graded_at || submission.created_at, { fallback: submission.created_at })}</Text></View></View>;
}

/** Every attempt the learner sent, newest first, with its exact text. Earlier attempts stay folded. */
function SubmissionHistory({ submissions, latestId, showLatest }: { submissions: SubmissionBrief[]; latestId: number | null; showLatest: boolean }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const ordered = useMemo(() => [...submissions].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || b.id - a.id), [submissions]);
  // While the latest attempt is still editable, the response box above already shows its text.
  const earlier = ordered.filter((item) => item.id !== latestId);
  const latestItems = showLatest ? ordered.filter((item) => item.id === latestId).slice(0, 1) : [];
  if (!latestItems.length && !earlier.length) return null;
  const visible = showEarlier ? [...latestItems, ...earlier] : latestItems;
  return <View style={styles.history} testID="submission-history">
    {(latestItems.length > 0 || showEarlier) && <Text style={styles.historyTitle}>{ordered.length === 1 ? 'Your submission' : `Your submissions (${ordered.length})`}</Text>}
    {visible.map((item) => {
      const status = submissionStatus(item);
      return <View key={item.id} style={styles.historyItem}>
        <View style={styles.historyMeta}><Text style={styles.historyMetaText}>Attempt {item.num_submissions || 1} · {formatCourseDateTime(item.created_at, { fallback: item.created_at })}</Text>{status && <StatusBadge status={status} short />}</View>
        {item.text ? <MessageCodeBlock code={item.text} language="Submitted" surface="lesson" testID="submitted-text" /> : null}
        {[item.repo_url, item.live_url, item.pr_url].filter(Boolean).map((url) => <Text key={url} selectable style={styles.historyLink}>{url}</Text>)}
        {item.id !== latestId && item.feedback ? <View style={styles.feedbackBody}><Text style={styles.historyFeedbackLabel}>Feedback</Text><AuthoredContent body={item.feedback} compact /></View> : null}
      </View>;
    })}
    {earlier.length > 0 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showEarlier }} onPress={() => setShowEarlier((value) => !value)} style={styles.detailsButton}><Text style={styles.detailsText}>{showEarlier ? 'Hide earlier attempts' : `Show earlier attempts (${earlier.length})`}</Text></Pressable>}
  </View>;
}

/**
 * The submission box is for code: no autocorrect, capitals, spell check, or
 * smart punctuation (which would turn quotes into “curly” ones Python rejects),
 * monospace at 16pt so iOS does not zoom and indentation lines up.
 */
export const CODE_INPUT_PROPS = {
  autoCapitalize: 'none',
  autoCorrect: false,
  spellCheck: false,
  autoComplete: 'off',
  smartInsertDelete: false,
  textContentType: 'none',
  keyboardType: Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password',
  dataDetectorTypes: 'none',
} as const;

function CodeField(props: { label: string; hint: string; value: string; onChangeText: (value: string) => void; placeholder: string }) {
  return <View style={styles.field}><Text style={styles.label}>{props.label}</Text><Text style={styles.fieldHint}>{props.hint}</Text><TextInput accessibilityLabel={props.label} accessibilityHint={props.hint} testID="submission-code-input" value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor={palette.muted} multiline scrollEnabled={false} {...CODE_INPUT_PROPS} style={[styles.input, styles.inputMultiline, styles.codeInput]} /></View>;
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; keyboardType?: 'default' | 'url' }) {
  return <View style={styles.field}><Text style={styles.label}>{props.label}</Text><TextInput accessibilityLabel={props.label} value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor={palette.muted} multiline={props.multiline} keyboardType={props.keyboardType} autoCapitalize={props.keyboardType === 'url' ? 'none' : 'sentences'} autoCorrect={props.keyboardType !== 'url'} style={[styles.input, props.multiline && styles.inputMultiline]} /></View>;
}

function withoutContentBlock(input: SubmissionInput): Omit<SubmissionInput, 'content_block_id'> { const { content_block_id: _ignored, ...rest } = input; return rest; }
function demoSubmission(block: LessonContentBlock, lesson: LessonDetail, user: SessionUser | null, input: SubmissionInput, latest: SubmissionBrief | null): Submission {
  const createdAt = new Date().toISOString();
  const pendingAttempt = latest && !latest.grade ? latest : null;
  return {
    id: pendingAttempt?.id ?? Date.now(), content_block_id: block.id, user_id: user?.id || 0, user_name: user?.full_name || 'Demo student', submission_type: block.submission_type || lesson.submission_type || 'text_submission', text: input.text || null,
    grade: null, feedback: null, graded_by: null, graded_at: null, github_issue_url: null, github_code_url: null, repo_url: input.repo_url || null, pr_url: input.pr_url || null, live_url: input.live_url || null, branch: input.branch || null, commit_sha: input.commit_sha || null, notes: input.notes || null,
    num_submissions: pendingAttempt?.num_submissions ?? (latest?.num_submissions || 0) + 1, created_at: pendingAttempt?.created_at ?? createdAt, updated_at: createdAt, content_block_title: block.title || 'Lesson work', content_block_type: block.block_type,
    lesson_id: lesson.id, lesson_title: lesson.title, module_id: lesson.module_id, cohort_id: lesson.cohort_id || null, filename: block.filename, submission_config: block.submission_config, language_hint: typeof block.metadata.language === 'string' ? block.metadata.language : null,
  };
}
function persistSubmissionDraft(pending: PendingSubmissionDraft) { return pending.changed ? saveSubmissionDraft(pending.userId, pending.contentBlockId, pending.text, pending.baseSubmissionId, pending.baseSubmissionUpdatedAt, pending.cohortId) : clearSubmissionDraft(pending.userId, pending.contentBlockId, pending.cohortId); }
function blockKicker(blockType: string, submissionCheckpoint: boolean) { return submissionCheckpoint ? 'CHECKPOINT · SUBMIT FOR REVIEW' : blockType.replace('_', ' ').toUpperCase(); }
function blockLabel(value: string) { return value === 'text' ? 'Lesson notes' : value === 'checkpoint' ? 'Checkpoint' : value === 'recording' ? 'Class recording' : 'Learning step'; }

const styles = StyleSheet.create({
  card: { borderRadius: 21, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 17 }, header: { flexDirection: 'row', alignItems: 'center', gap: 11 }, icon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.9 }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21, marginTop: 2 }, completeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, backgroundColor: '#10271F', paddingHorizontal: 8, paddingVertical: 5 }, completeText: { color: palette.success, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6 }, body: { marginTop: 15 }, solution: { borderRadius: 15, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', marginTop: 14, overflow: 'hidden' }, solutionButton: { minHeight: 48, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, solutionButtonText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 }, solutionBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#4D2630', padding: 13 }, checkCard: { marginTop: 15, borderRadius: 18, borderWidth: 1, borderColor: '#4A2933', backgroundColor: '#211319', padding: 14 }, checkKicker: { flexDirection: 'row', alignItems: 'center', gap: 7 }, checkKickerText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, objectiveCode: { color: palette.subtle, backgroundColor: palette.panelRaised, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontFamily: monoFont, fontSize: 11 }, checkPrompt: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 15, lineHeight: 22, marginTop: 10 }, checkOptions: { gap: 8, marginTop: 12 }, checkOption: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, checkOptionSelected: { borderColor: palette.rubySoft, backgroundColor: '#2A151B' }, checkOptionCorrect: { borderColor: palette.success, backgroundColor: '#10231C' }, checkOptionIncorrect: { borderColor: palette.warning, backgroundColor: '#251E13' }, checkOptionLetter: { color: palette.rubySoft, fontFamily: fonts.extraBold, fontSize: 11 }, checkOptionText: { flex: 1, color: palette.text, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 }, checkResult: { marginTop: 12, borderRadius: 14, borderWidth: 1, padding: 12 }, checkResultCorrect: { borderColor: '#214D3A', backgroundColor: '#10231C' }, checkResultRetry: { borderColor: '#4C3A1C', backgroundColor: '#251E13' }, checkResultTitle: { fontFamily: fonts.bold, fontSize: 12 }, checkExplanation: { color: '#D5D7DD', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 4 }, checkButton: { minHeight: 48, borderRadius: 14, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center', marginTop: 12 }, checkButtonText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, checkAttempts: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 8 }, file: { minHeight: 40, borderRadius: 12, backgroundColor: '#090B10', borderWidth: 1, borderColor: palette.line, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }, fileText: { color: '#C9CED8', fontFamily: monoFont, fontSize: 11 }, nativeVideo: { marginTop: 14 }, stagedVideo: { minHeight: 62, borderRadius: 15, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }, stagedVideoTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, stagedVideoCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 3 }, outlineButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#3E2530', backgroundColor: '#211319', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }, outlineText: { flex: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, locked: { borderRadius: 14, borderWidth: 1, borderColor: '#4C3A1C', backgroundColor: '#251E13', padding: 12, flexDirection: 'row', gap: 10, marginTop: 14 }, lockedTitle: { color: palette.warning, fontFamily: fonts.bold, fontSize: 12 }, lockedCopy: { color: '#C8B68E', fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 2 }, sync: { borderRadius: 14, borderWidth: 1, borderColor: '#3E2530', backgroundColor: '#211319', padding: 12, flexDirection: 'row', gap: 10, marginTop: 14 }, syncTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, syncCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 2 }, status: { borderRadius: 14, backgroundColor: '#1A1E28', borderWidth: 1, borderColor: palette.line, padding: 12, flexDirection: 'row', gap: 10, marginTop: 14 }, statusRedo: { backgroundColor: '#251E13', borderColor: '#4C3A1C' }, statusPassed: { backgroundColor: '#10231C', borderColor: '#214D3A' }, statusPending: { backgroundColor: '#1A1F29', borderColor: '#475569' }, statusRow: { marginTop: 12 }, feedbackBody: { marginTop: 6 }, history: { marginTop: 16, gap: 10 }, historyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 }, historyItem: { gap: 8 }, historyMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, historyMetaText: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 12 }, historyLink: { color: palette.muted, fontFamily: monoFont, fontSize: 12 }, historyFeedbackLabel: { color: palette.muted, fontFamily: fonts.bold, fontSize: 12, marginBottom: 2 }, fieldHint: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 }, codeInput: { fontFamily: monoFont, fontSize: 16, lineHeight: 22, minHeight: 160 }, markCompleteCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 14 }, statusTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, statusCopy: { color: '#D4D7DE', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 5 }, statusMeta: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, marginTop: 6 }, form: { gap: 12, marginTop: 16 }, field: { gap: 6 }, label: { color: '#CDD1DA', fontFamily: fonts.bold, fontSize: 11 }, input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: '#0A0C11', color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 13, paddingVertical: 12 }, inputMultiline: { minHeight: 108, textAlignVertical: 'top' }, detailsButton: { minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' }, detailsText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 }, restoreDraft: { minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: '#3E2530', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 }, restoreDraftText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 }, draftNotice: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 }, draftNoticeText: { flex: 1, color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, lineHeight: 16 }, message: { color: '#F19A8C', fontFamily: fonts.semibold, fontSize: 11, lineHeight: 16 }, messageSuccess: { color: palette.success }, primaryButton: { minHeight: 50, borderRadius: 15, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, primaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, buttonDisabled: { opacity: 0.42 }, completeButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 15 }, completeButtonDone: { borderColor: '#214D3A', backgroundColor: '#10231C' }, completeButtonText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 }, completeButtonTextDone: { color: palette.success },
});
