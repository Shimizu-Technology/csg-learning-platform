import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Check, Circle, Code2, ExternalLink, FileText, GitBranch, Lock, Play, RotateCcw, Send } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';
import { openAuthenticatedWebLesson, openExternalPage } from '@/lib/external-links';
import { buildSubmissionInput, canSubmitWork, learningKeys, submissionState, submissionTypeFor } from '@/lib/learning';
import type { LessonContentBlock, LessonDetail, SubmissionInput, VideoProgressInput } from '@/lib/types';
import { useSession } from '@/providers/session-provider';
import { LessonMarkdown } from './lesson-markdown';
import { NativeVideoPlayer } from './native-video-player';

interface LessonContentBlockProps {
  block: LessonContentBlock;
  lesson: LessonDetail;
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
  const locked = Boolean(lesson.submission_window?.submissions_closed && (isExercise || block.block_type === 'checkpoint'));
  const runner = block.submission_config?.runner as { enabled?: boolean; language?: string } | undefined;
  const [text, setText] = useState(latest?.text || '');
  const [repoUrl, setRepoUrl] = useState(latest?.repo_url || '');
  const [liveUrl, setLiveUrl] = useState(latest?.live_url || '');
  const [prUrl, setPrUrl] = useState(latest?.pr_url || '');
  const [branch, setBranch] = useState(latest?.branch || '');
  const [commitSha, setCommitSha] = useState(latest?.commit_sha || '');
  const [notes, setNotes] = useState(latest?.notes || '');
  const [showDetails, setShowDetails] = useState(Boolean(latest?.pr_url || latest?.branch || latest?.commit_sha || latest?.notes));
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    if (!user) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: learningKeys.lesson(user.id, lesson.id) }),
      queryClient.invalidateQueries({ queryKey: learningKeys.dashboard(user.id) }),
    ]);
  };
  const progressMutation = useMutation({
    mutationFn: (status: string) => api.updateProgress(block.id, status),
    onSuccess: () => void refresh(),
    onError: (error) => Alert.alert('Could not update progress', (error as Error).message),
  });
  const submissionMutation = useMutation({
    mutationFn: async () => {
      const input = buildSubmissionInput(block.id, submissionType, { text, repoUrl, liveUrl, prUrl, branch, commitSha, notes });
      if (editable && latest) return api.updateSubmission(latest.id, withoutContentBlock(input));
      return api.createSubmission(input);
    },
    onSuccess: async () => { setMessage(editable ? 'Submission updated.' : redo ? 'Redo submitted.' : 'Work submitted.'); await refresh(); },
    onError: (error) => setMessage((error as Error).message),
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
    {block.filename && <View style={styles.file}><Code2 color={palette.quiet} size={15} /><Text style={styles.fileText}>{block.filename}</Text></View>}
    {isVideo && <LessonVideo block={block} lesson={lesson} />}
    {runner?.enabled && <Pressable accessibilityRole="button" accessibilityLabel="Open code runner on the web" accessibilityState={{ busy: handoffMutation.isPending, disabled: handoffMutation.isPending }} disabled={handoffMutation.isPending} onPress={() => handoffMutation.mutate()} style={[styles.outlineButton, handoffMutation.isPending && styles.buttonDisabled]}>{handoffMutation.isPending ? <ActivityIndicator color={palette.rubySoft} /> : <Code2 color={palette.rubySoft} size={17} />}<Text style={styles.outlineText}>{handoffMutation.isPending ? 'Opening secure runner…' : `Open ${runner.language || 'code'} runner`}</Text><ExternalLink color={palette.quiet} size={15} /></Pressable>}
    {latest && <SubmissionStatus submission={latest} redo={redo} />}
    {locked && <View style={styles.locked}><Lock color={palette.warning} size={17} /><View style={styles.flex}><Text style={styles.lockedTitle}>Submissions are closed</Text><Text style={styles.lockedCopy}>You can review this lesson and existing feedback.</Text></View></View>}
    {studentMode && isExercise && submissionType === 'prework_github_sync' && <View style={styles.sync}><GitBranch color={palette.rubySoft} size={18} /><View style={styles.flex}><Text style={styles.syncTitle}>Reviewed through GitHub</Text><Text style={styles.syncCopy}>{lesson.repository_name ? `Your work syncs from ${lesson.repository_name}.` : 'Your linked class repository is the source of truth.'}</Text></View></View>}
    {studentMode && isExercise && (submissionType === 'text_submission' || submissionType.includes('repo_')) && !passed && <View style={styles.form}>
      {submissionType === 'text_submission' ? <Field label={editable ? 'Update your response' : redo ? 'Submit your redo' : 'Your response'} value={text} onChangeText={(value) => { setText(value); setMessage(null); }} multiline placeholder="Explain your solution or share your work…" /> : <>
        <Field label="Repository URL" value={repoUrl} onChangeText={(value) => { setRepoUrl(value); setMessage(null); }} placeholder="https://github.com/…" keyboardType="url" />
        {submissionType === 'repo_and_live_url_submission' && <Field label="Live site URL" value={liveUrl} onChangeText={(value) => { setLiveUrl(value); setMessage(null); }} placeholder="https://…" keyboardType="url" />}
        <Pressable accessibilityRole="button" onPress={() => setShowDetails((value) => !value)} style={styles.detailsButton}><Text style={styles.detailsText}>{showDetails ? 'Hide optional details' : 'Add PR, branch, commit, or notes'}</Text></Pressable>
        {showDetails && <><Field label="Pull request URL" value={prUrl} onChangeText={setPrUrl} placeholder="https://github.com/…/pull/…" keyboardType="url" /><Field label="Branch" value={branch} onChangeText={setBranch} placeholder="feature/my-work" /><Field label="Commit" value={commitSha} onChangeText={setCommitSha} placeholder="Commit SHA" /><Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Anything your instructor should know…" /></>}
      </>}
      {message && <Text accessibilityLiveRegion="polite" style={[styles.message, message.includes('submitted') || message.includes('updated') ? styles.messageSuccess : undefined]}>{message}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={editable ? 'Update submission' : 'Submit work'} disabled={!canSubmit} onPress={() => submissionMutation.mutate()} style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}>{submissionMutation.isPending ? <ActivityIndicator color={palette.text} /> : <><Send color={palette.text} size={17} /><Text style={styles.primaryText}>{editable ? 'Update submission' : redo ? 'Submit redo' : 'Submit work'}</Text></>}</Pressable>
    </View>}
    {studentMode && (!isExercise || submissionType === 'manual_complete') && !(isVideo && block.has_s3_video) ? <Pressable accessibilityRole="button" accessibilityLabel={completed ? 'Mark incomplete' : 'Mark complete'} disabled={locked || progressMutation.isPending} onPress={() => progressMutation.mutate(completed ? 'not_started' : 'completed')} style={[styles.completeButton, completed && styles.completeButtonDone, (locked || progressMutation.isPending) && styles.buttonDisabled]}>{progressMutation.isPending ? <ActivityIndicator color={palette.text} /> : <>{completed ? <Check color={palette.success} size={18} /> : <Circle color={palette.rubySoft} size={18} />}<Text style={[styles.completeButtonText, completed && styles.completeButtonTextDone]}>{completed ? 'Completed' : 'Mark complete'}</Text></>}</Pressable> : null}
  </View>;
}

function LessonVideo({ block, lesson }: { block: LessonContentBlock; lesson: LessonDetail }) {
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const fetchStream = useCallback(async () => {
    const response = await api.contentVideoStream(block.id);
    return { stream_url: response.stream_url, expires_at: response.expires_at };
  }, [api, block.id]);
  const saveProgress = useCallback(async (progress: VideoProgressInput) => {
    const response = await api.updateContentVideoProgress(block.id, progress);
    if (!user) return;
    queryClient.setQueryData<{ lesson: LessonDetail }>(learningKeys.lesson(user.id, lesson.id), (current) => current ? { lesson: { ...current.lesson, content_blocks: current.lesson.content_blocks.map((candidate) => candidate.id === block.id ? { ...candidate, progress: { ...candidate.progress, status: response.video_progress.status, completed_at: response.video_progress.completed ? new Date().toISOString() : candidate.progress?.completed_at || null, video_last_position: response.video_progress.last_position, video_total_watched: response.video_progress.total_watched } } : candidate) } } : current);
    if (response.video_progress.completed) void queryClient.invalidateQueries({ queryKey: learningKeys.dashboard(user.id) });
  }, [api, block.id, lesson.id, queryClient, user]);

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
function blockLabel(value: string) { return value === 'text' ? 'Lesson notes' : value === 'checkpoint' ? 'Checkpoint' : value === 'recording' ? 'Class recording' : 'Learning step'; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }

const styles = StyleSheet.create({
  card: { borderRadius: 21, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 17 }, header: { flexDirection: 'row', alignItems: 'center', gap: 11 }, icon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 0.9 }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21, marginTop: 2 }, completeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 99, backgroundColor: '#10271F', paddingHorizontal: 8, paddingVertical: 5 }, completeText: { color: palette.success, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 0.6 }, body: { marginTop: 15 }, file: { minHeight: 40, borderRadius: 12, backgroundColor: '#090B10', borderWidth: 1, borderColor: palette.line, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }, fileText: { color: '#C9CED8', fontFamily: 'Menlo', fontSize: 11 }, nativeVideo: { marginTop: 14 }, outlineButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#3E2530', backgroundColor: '#211319', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }, outlineText: { flex: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, locked: { borderRadius: 14, borderWidth: 1, borderColor: '#4C3A1C', backgroundColor: '#251E13', padding: 12, flexDirection: 'row', gap: 10, marginTop: 14 }, lockedTitle: { color: palette.warning, fontFamily: fonts.bold, fontSize: 12 }, lockedCopy: { color: '#C8B68E', fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, marginTop: 2 }, sync: { borderRadius: 14, borderWidth: 1, borderColor: '#3E2530', backgroundColor: '#211319', padding: 12, flexDirection: 'row', gap: 10, marginTop: 14 }, syncTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, syncCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, marginTop: 2 }, status: { borderRadius: 14, backgroundColor: '#1A1E28', borderWidth: 1, borderColor: palette.line, padding: 12, flexDirection: 'row', gap: 10, marginTop: 14 }, statusRedo: { backgroundColor: '#251E13', borderColor: '#4C3A1C' }, statusPassed: { backgroundColor: '#10231C', borderColor: '#214D3A' }, statusTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, statusCopy: { color: '#D4D7DE', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 5 }, statusMeta: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 9, marginTop: 6 }, form: { gap: 12, marginTop: 16 }, field: { gap: 6 }, label: { color: '#CDD1DA', fontFamily: fonts.bold, fontSize: 10 }, input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: '#0A0C11', color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 13, paddingVertical: 12 }, inputMultiline: { minHeight: 108, textAlignVertical: 'top' }, detailsButton: { minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' }, detailsText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 }, message: { color: '#F19A8C', fontFamily: fonts.semibold, fontSize: 10, lineHeight: 15 }, messageSuccess: { color: palette.success }, primaryButton: { minHeight: 50, borderRadius: 15, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, primaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, buttonDisabled: { opacity: 0.42 }, completeButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 15 }, completeButtonDone: { borderColor: '#214D3A', backgroundColor: '#10231C' }, completeButtonText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 }, completeButtonTextDone: { color: palette.success },
});
