import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Check, Circle, Code2, ExternalLink, FileText, GitBranch, Lightbulb, Lock, Play, RotateCcw, Save, Send } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';
import { openAuthenticatedWebLesson, openExternalPage } from '@/lib/external-links';
import { buildSubmissionInput, canSubmitWork, isNewSubmissionAttempt, learningKeys, submissionState, submissionTypeFor } from '@/lib/learning';
import { analyticsAgeBucket, captureProductEvent } from '@/lib/analytics';
import { clearSubmissionDraft, loadSubmissionDraft, saveSubmissionDraft, submissionDraftMatches, type SubmissionDraft } from '@/lib/submission-storage';
import type { LessonContentBlock, LessonDetail, SubmissionInput, VideoProgressInput } from '@/lib/types';
import { useSession } from '@/providers/session-provider';
import { LessonMarkdown } from './lesson-markdown';
import { NativeVideoPlayer } from './native-video-player';

interface LessonContentBlockProps {
  block: LessonContentBlock;
  lesson: LessonDetail;
}

interface PendingSubmissionDraft {
  userId: number;
  contentBlockId: number;
  text: string;
  baseSubmissionId: number | null;
  baseSubmissionUpdatedAt: string | null;
  changed: boolean;
}

export function LessonContentBlockCard({ block, lesson }: LessonContentBlockProps) {
  const { api, user } = useSession();
  const studentMode = !user?.is_staff;
  const queryClient = useQueryClient();
  const submissions = block.submissions || [];
  const { latest, passed, redo, editable } = submissionState(submissions);
  const submissionType = submissionTypeFor(block, lesson.requires_github);
  const isExercise = block.block_type === 'exercise' || block.block_type === 'code_challenge';
  const isVideo = block.block_type === 'video' || block.block_type === 'recording';
  const completed = block.progress?.status === 'completed';
  const [knowledgeCheckDraft, setKnowledgeCheckDraft] = useState<{ blockId: number; value: NonNullable<LessonContentBlock['knowledge_check']> } | null>(null);
  const knowledgeCheck = knowledgeCheckDraft?.blockId === block.id ? knowledgeCheckDraft.value : block.knowledge_check || null;
  const [selectedCheckOption, setSelectedCheckOption] = useState<number | null>(null);
  const locked = Boolean(lesson.submission_window?.submissions_closed && (isExercise || (block.block_type === 'checkpoint' && !knowledgeCheck)));
  const runner = block.submission_config?.runner as { enabled?: boolean; language?: string } | undefined;
  const [text, setText] = useState(latest?.text || '');
  const [repoUrl, setRepoUrl] = useState(latest?.repo_url || '');
  const [liveUrl, setLiveUrl] = useState(latest?.live_url || '');
  const [prUrl, setPrUrl] = useState(latest?.pr_url || '');
  const [branch, setBranch] = useState(latest?.branch || '');
  const [commitSha, setCommitSha] = useState(latest?.commit_sha || '');
  const [notes, setNotes] = useState(latest?.notes || '');
  const [showDetails, setShowDetails] = useState(Boolean(latest?.pr_url || latest?.branch || latest?.commit_sha || latest?.notes));
  const [message, setMessage] = useState<{ body: string; success: boolean } | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [olderDraft, setOlderDraft] = useState<SubmissionDraft | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = useRef<PendingSubmissionDraft | null>(null);
  const studentEditedRef = useRef(false);
  const trackedFeedbackRef = useRef<number | null>(null);

  useEffect(() => {
    if (!studentMode || submissionType !== 'text_submission' || !user) return;
    let canceled = false;
    void loadSubmissionDraft(user.id, block.id).then((draft) => {
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
        void clearSubmissionDraft(user.id, block.id);
      }
    }).catch(() => {
      if (!canceled) setDraftNotice('Draft storage is temporarily unavailable. Keep this screen open.');
    }).finally(() => {
      if (!canceled) setDraftHydrated(true);
    });
    return () => { canceled = true; };
  }, [block.id, latest?.id, latest?.text, latest?.updated_at, studentMode, submissionType, user]);

  useEffect(() => {
    if (!studentMode || submissionType !== 'text_submission' || !user || !draftHydrated) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const changed = text !== (latest?.text || '');
    const pending: PendingSubmissionDraft = { userId: user.id, contentBlockId: block.id, text, baseSubmissionId: latest?.id ?? null, baseSubmissionUpdatedAt: latest?.updated_at ?? null, changed };
    pendingDraftRef.current = pending;
    draftTimerRef.current = setTimeout(() => {
      void persistSubmissionDraft(pending).then(() => {
        if (pendingDraftRef.current !== pending) return;
        pendingDraftRef.current = null;
        setDraftNotice(changed ? 'Draft saved on this device · not submitted' : null);
      }).catch(() => setDraftNotice('Draft could not be saved. Keep this screen open.'));
    }, 300);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [block.id, draftHydrated, latest?.id, latest?.text, latest?.updated_at, studentMode, submissionType, text, user]);

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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: learningKeys.lesson(user.id, lesson.id) }),
      queryClient.invalidateQueries({ queryKey: learningKeys.dashboard(user.id) }),
    ]);
  };
  const progressMutation = useMutation({
    mutationFn: (status: string) => api.updateProgress(block.id, status),
    onSuccess: (_result, status) => {
      if (status === 'completed') captureProductEvent('learning_step_completed', {
        module_id: lesson.module_id, lesson_id: lesson.id, content_block_id: block.id, block_type: block.block_type, source: 'manual',
      });
      void refresh();
    },
    onError: (error) => Alert.alert('Could not update progress', (error as Error).message),
  });
  const knowledgeCheckMutation = useMutation({
    mutationFn: () => {
      if (!knowledgeCheck || selectedCheckOption === null) throw new Error('Choose an answer first.');
      return api.attemptKnowledgeCheck(knowledgeCheck.id, selectedCheckOption);
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
      if (editable && latest) return api.updateSubmission(latest.id, withoutContentBlock(input));
      return api.createSubmission(input);
    },
    onSuccess: async (result) => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      pendingDraftRef.current = null;
      if (user) await clearSubmissionDraft(user.id, block.id).catch(() => undefined);
      setDraftNotice(null);
      setOlderDraft(null);
      const attempt = result.submission.num_submissions || (latest?.num_submissions || 0) + 1;
      const isNewAttempt = isNewSubmissionAttempt(editable);
      if (isNewAttempt) captureProductEvent('submission_created', { content_block_id: block.id, submission_type: submissionType, attempt });
      if (redo && latest) captureProductEvent('redo_submitted', { submission_id: result.submission.id, attempt, age_bucket: analyticsAgeBucket(latest.graded_at) });
      if (isNewAttempt) captureProductEvent('learning_step_completed', {
        module_id: lesson.module_id, lesson_id: lesson.id, content_block_id: block.id, block_type: block.block_type, source: 'submission',
      });
      setMessage({ body: editable ? 'Submission updated.' : redo ? 'Redo submitted.' : 'Work submitted.', success: true });
      await refresh();
    },
    onError: async (error) => {
      if (user && submissionType === 'text_submission') {
        try {
          await saveSubmissionDraft(user.id, block.id, text, latest?.id ?? null, latest?.updated_at ?? null);
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

  return <View style={styles.card}>
    <View style={styles.header}><View style={styles.icon}><Icon color={palette.rubySoft} size={19} /></View><View style={styles.flex}><Text style={styles.kicker}>{block.block_type.replace('_', ' ').toUpperCase()}</Text><Text style={styles.title}>{block.title || blockLabel(block.block_type)}</Text></View>{completed && <View style={styles.completeBadge}><Check color={palette.success} size={15} /><Text style={styles.completeText}>DONE</Text></View>}</View>
    {block.body && <View style={styles.body}><LessonMarkdown body={block.body} /></View>}
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
    {block.filename && <View style={styles.file}><Code2 color={palette.quiet} size={15} /><Text style={styles.fileText}>{block.filename}</Text></View>}
    {isVideo && <LessonVideo block={block} lesson={lesson} />}
    {runner?.enabled && <Pressable accessibilityRole="button" accessibilityLabel="Open code runner on the web" accessibilityState={{ busy: handoffMutation.isPending, disabled: handoffMutation.isPending }} disabled={handoffMutation.isPending} onPress={() => handoffMutation.mutate()} style={[styles.outlineButton, handoffMutation.isPending && styles.buttonDisabled]}>{handoffMutation.isPending ? <ActivityIndicator color={palette.rubySoft} /> : <Code2 color={palette.rubySoft} size={17} />}<Text style={styles.outlineText}>{handoffMutation.isPending ? 'Opening secure runner…' : `Open ${runner.language || 'code'} runner`}</Text><ExternalLink color={palette.quiet} size={15} /></Pressable>}
    {latest && <SubmissionStatus submission={latest} redo={redo} />}
    {locked && <View style={styles.locked}><Lock color={palette.warning} size={17} /><View style={styles.flex}><Text style={styles.lockedTitle}>Submissions are closed</Text><Text style={styles.lockedCopy}>You can review this lesson and existing feedback.</Text></View></View>}
    {studentMode && isExercise && submissionType === 'prework_github_sync' && <View style={styles.sync}><GitBranch color={palette.rubySoft} size={18} /><View style={styles.flex}><Text style={styles.syncTitle}>Reviewed through GitHub</Text><Text style={styles.syncCopy}>{lesson.repository_name ? `Your work syncs from ${lesson.repository_name}.` : 'Your linked class repository is the source of truth.'}</Text></View></View>}
    {studentMode && isExercise && (submissionType === 'text_submission' || submissionType.includes('repo_')) && !passed && <View style={styles.form}>
      {submissionType === 'text_submission' ? <Field label={editable ? 'Update your response' : redo ? 'Submit your redo' : 'Your response'} value={text} onChangeText={(value) => { studentEditedRef.current = true; setText(value); setDraftNotice('Saving draft on this device…'); setMessage(null); }} multiline placeholder="Explain your solution or share your work…" /> : <>
        <Field label="Repository URL" value={repoUrl} onChangeText={(value) => { setRepoUrl(value); setMessage(null); }} placeholder="https://github.com/…" keyboardType="url" />
        {submissionType === 'repo_and_live_url_submission' && <Field label="Live site URL" value={liveUrl} onChangeText={(value) => { setLiveUrl(value); setMessage(null); }} placeholder="https://…" keyboardType="url" />}
        <Pressable accessibilityRole="button" onPress={() => setShowDetails((value) => !value)} style={styles.detailsButton}><Text style={styles.detailsText}>{showDetails ? 'Hide optional details' : 'Add PR, branch, commit, or notes'}</Text></Pressable>
        {showDetails && <><Field label="Pull request URL" value={prUrl} onChangeText={setPrUrl} placeholder="https://github.com/…/pull/…" keyboardType="url" /><Field label="Branch" value={branch} onChangeText={setBranch} placeholder="feature/my-work" /><Field label="Commit" value={commitSha} onChangeText={setCommitSha} placeholder="Commit SHA" /><Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Anything your instructor should know…" /></>}
      </>}
      {olderDraft && <Pressable accessibilityRole="button" onPress={() => { setText(olderDraft.text); setOlderDraft(null); setDraftNotice('Older draft restored · not submitted'); }} style={styles.restoreDraft}><RotateCcw color={palette.rubySoft} size={15} /><Text style={styles.restoreDraftText}>Restore older device draft</Text></Pressable>}
      {draftNotice && <View accessibilityLiveRegion="polite" style={styles.draftNotice}><Save color={palette.subtle} size={14} /><Text style={styles.draftNoticeText}>{draftNotice}</Text></View>}
      {message && <Text accessibilityLiveRegion="polite" style={[styles.message, message.success && styles.messageSuccess]}>{message.body}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={editable ? 'Update submission' : 'Submit work'} disabled={!canSubmit} onPress={() => submissionMutation.mutate()} style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}>{submissionMutation.isPending ? <ActivityIndicator color={palette.text} /> : <><Send color={palette.text} size={17} /><Text style={styles.primaryText}>{editable ? 'Update submission' : redo ? 'Submit redo' : 'Submit work'}</Text></>}</Pressable>
    </View>}
    {studentMode && !knowledgeCheck && (!isExercise || submissionType === 'manual_complete') && !(isVideo && block.has_s3_video) ? <Pressable accessibilityRole="button" accessibilityLabel={completed ? 'Mark incomplete' : 'Mark complete'} disabled={locked || progressMutation.isPending} onPress={() => progressMutation.mutate(completed ? 'not_started' : 'completed')} style={[styles.completeButton, completed && styles.completeButtonDone, (locked || progressMutation.isPending) && styles.buttonDisabled]}>{progressMutation.isPending ? <ActivityIndicator color={palette.text} /> : <>{completed ? <Check color={palette.success} size={18} /> : <Circle color={palette.rubySoft} size={18} />}<Text style={[styles.completeButtonText, completed && styles.completeButtonTextDone]}>{completed ? 'Completed' : 'Mark complete'}</Text></>}</Pressable> : null}
  </View>;
}

function LessonVideo({ block, lesson }: { block: LessonContentBlock; lesson: LessonDetail }) {
  const { api, user } = useSession();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const trackedCompletionRef = useRef(block.progress?.status === 'completed');
  const fetchStream = useCallback(async () => {
    const response = await api.contentVideoStream(block.id);
    return { stream_url: response.stream_url, expires_at: response.expires_at };
  }, [api, block.id]);
  const saveProgress = useCallback(async (progress: VideoProgressInput) => {
    const response = await api.updateContentVideoProgress(block.id, progress);
    if (response.video_progress.completed && !trackedCompletionRef.current) {
      trackedCompletionRef.current = true;
      captureProductEvent('learning_step_completed', {
        module_id: lesson.module_id, lesson_id: lesson.id, content_block_id: block.id, block_type: block.block_type, source: 'video',
      });
    }
    if (!userId) return;
    queryClient.setQueryData<{ lesson: LessonDetail }>(learningKeys.lesson(userId, lesson.id), (current) => current ? { lesson: { ...current.lesson, content_blocks: current.lesson.content_blocks.map((candidate) => candidate.id === block.id ? { ...candidate, progress: { ...candidate.progress, status: response.video_progress.status, completed_at: response.video_progress.completed ? new Date().toISOString() : candidate.progress?.completed_at || null, video_last_position: response.video_progress.last_position, video_total_watched: response.video_progress.total_watched } } : candidate) } } : current);
    if (response.video_progress.completed) void queryClient.invalidateQueries({ queryKey: learningKeys.dashboard(userId) });
  }, [api, block.block_type, block.id, lesson.id, lesson.module_id, queryClient, userId]);

  if (block.has_s3_video) return <View style={styles.nativeVideo}><NativeVideoPlayer fetchStream={fetchStream} initialPosition={block.progress?.video_last_position || 0} initialTotalWatched={block.progress?.video_total_watched || 0} saveProgress={saveProgress} title={block.title || lesson.title} /></View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Play ${block.title || 'video'}`} onPress={() => void openExternalPage(block.video_url).catch((error) => Alert.alert('Video unavailable', (error as Error).message))} style={styles.outlineButton}><Play color={palette.rubySoft} size={17} /><Text style={styles.outlineText}>Open video</Text><ExternalLink color={palette.quiet} size={15} /></Pressable>;
}

function SubmissionStatus({ submission, redo }: { submission: NonNullable<LessonContentBlock['submissions']>[number]; redo: boolean }) {
  const grade = submission.grade;
  return <View style={[styles.status, redo ? styles.statusRedo : grade ? styles.statusPassed : undefined]}>{redo ? <RotateCcw color={palette.warning} size={18} /> : grade ? <BadgeCheck color={palette.success} size={18} /> : <Circle color={palette.muted} size={16} />}<View style={styles.flex}><Text style={styles.statusTitle}>{redo ? 'Redo requested' : grade ? `Graded · ${grade}` : 'Submitted for review'}</Text>{submission.feedback && <Text style={styles.statusCopy}>{submission.feedback}</Text>}<Text style={styles.statusMeta}>Attempt {submission.num_submissions || 1} · {formatDate(submission.created_at)}</Text></View></View>;
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; keyboardType?: 'default' | 'url' }) {
  return <View style={styles.field}><Text style={styles.label}>{props.label}</Text><TextInput accessibilityLabel={props.label} value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor={palette.quiet} multiline={props.multiline} keyboardType={props.keyboardType} autoCapitalize={props.keyboardType === 'url' ? 'none' : 'sentences'} autoCorrect={props.keyboardType !== 'url'} style={[styles.input, props.multiline && styles.inputMultiline]} /></View>;
}

function withoutContentBlock(input: SubmissionInput): Omit<SubmissionInput, 'content_block_id'> { const { content_block_id: _ignored, ...rest } = input; return rest; }
function persistSubmissionDraft(pending: PendingSubmissionDraft) { return pending.changed ? saveSubmissionDraft(pending.userId, pending.contentBlockId, pending.text, pending.baseSubmissionId, pending.baseSubmissionUpdatedAt) : clearSubmissionDraft(pending.userId, pending.contentBlockId); }
function blockLabel(value: string) { return value === 'text' ? 'Lesson notes' : value === 'checkpoint' ? 'Checkpoint' : value === 'recording' ? 'Class recording' : 'Learning step'; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }

const styles = StyleSheet.create({
  card: { borderRadius: 21, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 17 }, header: { flexDirection: 'row', alignItems: 'center', gap: 11 }, icon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.9 }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21, marginTop: 2 }, completeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, backgroundColor: '#10271F', paddingHorizontal: 8, paddingVertical: 5 }, completeText: { color: palette.success, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6 }, body: { marginTop: 15 }, checkCard: { marginTop: 15, borderRadius: 18, borderWidth: 1, borderColor: '#4A2933', backgroundColor: '#211319', padding: 14 }, checkKicker: { flexDirection: 'row', alignItems: 'center', gap: 7 }, checkKickerText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, objectiveCode: { color: palette.subtle, backgroundColor: palette.panelRaised, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontFamily: 'Menlo', fontSize: 11 }, checkPrompt: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 15, lineHeight: 22, marginTop: 10 }, checkOptions: { gap: 8, marginTop: 12 }, checkOption: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, checkOptionSelected: { borderColor: palette.rubySoft, backgroundColor: '#2A151B' }, checkOptionCorrect: { borderColor: palette.success, backgroundColor: '#10231C' }, checkOptionIncorrect: { borderColor: palette.warning, backgroundColor: '#251E13' }, checkOptionLetter: { color: palette.rubySoft, fontFamily: fonts.extraBold, fontSize: 11 }, checkOptionText: { flex: 1, color: palette.text, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 }, checkResult: { marginTop: 12, borderRadius: 14, borderWidth: 1, padding: 12 }, checkResultCorrect: { borderColor: '#214D3A', backgroundColor: '#10231C' }, checkResultRetry: { borderColor: '#4C3A1C', backgroundColor: '#251E13' }, checkResultTitle: { fontFamily: fonts.bold, fontSize: 12 }, checkExplanation: { color: '#D5D7DD', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 4 }, checkButton: { minHeight: 48, borderRadius: 14, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center', marginTop: 12 }, checkButtonText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, checkAttempts: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 8 }, file: { minHeight: 40, borderRadius: 12, backgroundColor: '#090B10', borderWidth: 1, borderColor: palette.line, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }, fileText: { color: '#C9CED8', fontFamily: 'Menlo', fontSize: 11 }, nativeVideo: { marginTop: 14 }, outlineButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#3E2530', backgroundColor: '#211319', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }, outlineText: { flex: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, locked: { borderRadius: 14, borderWidth: 1, borderColor: '#4C3A1C', backgroundColor: '#251E13', padding: 12, flexDirection: 'row', gap: 10, marginTop: 14 }, lockedTitle: { color: palette.warning, fontFamily: fonts.bold, fontSize: 12 }, lockedCopy: { color: '#C8B68E', fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 2 }, sync: { borderRadius: 14, borderWidth: 1, borderColor: '#3E2530', backgroundColor: '#211319', padding: 12, flexDirection: 'row', gap: 10, marginTop: 14 }, syncTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, syncCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 2 }, status: { borderRadius: 14, backgroundColor: '#1A1E28', borderWidth: 1, borderColor: palette.line, padding: 12, flexDirection: 'row', gap: 10, marginTop: 14 }, statusRedo: { backgroundColor: '#251E13', borderColor: '#4C3A1C' }, statusPassed: { backgroundColor: '#10231C', borderColor: '#214D3A' }, statusTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, statusCopy: { color: '#D4D7DE', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 5 }, statusMeta: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, marginTop: 6 }, form: { gap: 12, marginTop: 16 }, field: { gap: 6 }, label: { color: '#CDD1DA', fontFamily: fonts.bold, fontSize: 11 }, input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: '#0A0C11', color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 13, paddingVertical: 12 }, inputMultiline: { minHeight: 108, textAlignVertical: 'top' }, detailsButton: { minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' }, detailsText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 }, restoreDraft: { minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: '#3E2530', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 }, restoreDraftText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 }, draftNotice: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 }, draftNoticeText: { flex: 1, color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, lineHeight: 16 }, message: { color: '#F19A8C', fontFamily: fonts.semibold, fontSize: 11, lineHeight: 16 }, messageSuccess: { color: palette.success }, primaryButton: { minHeight: 50, borderRadius: 15, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, primaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, buttonDisabled: { opacity: 0.42 }, completeButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 15 }, completeButtonDone: { borderColor: '#214D3A', backgroundColor: '#10231C' }, completeButtonText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 }, completeButtonTextDone: { color: palette.success },
});
