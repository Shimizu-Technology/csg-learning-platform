import type { LessonContentBlock, StudentDashboard, SubmissionBrief, SubmissionInput } from './types';

export const learningKeys = {
  dashboard: (userId: number) => ['learning', userId, 'dashboard'] as const,
  lesson: (userId: number, lessonId: number) => ['learning', userId, 'lesson', lessonId] as const,
  resources: (userId: number) => ['learning', userId, 'resources'] as const,
  recordings: (userId: number) => ['learning', userId, 'recordings'] as const,
  profile: (userId: number) => ['learning', userId, 'profile'] as const,
};

export function isStudentDashboard(value: StudentDashboard | object): value is StudentDashboard {
  return 'enrolled' in value;
}

export function lessonCompletion(blocks: LessonContentBlock[]) {
  const explicitlyRequired = blocks.filter((block) => block.completion_required);
  const completable = explicitlyRequired.length ? explicitlyRequired : blocks.filter((block) => block.block_type !== 'text' || block.progress);
  const completed = completable.filter((block) => block.progress?.status === 'completed').length;
  return { completed, total: completable.length, percentage: completable.length ? Math.round((completed / completable.length) * 100) : 0 };
}

export function submissionTypeFor(block: LessonContentBlock, requiresGithub = false) {
  return block.submission_type || (requiresGithub ? 'prework_github_sync' : block.block_type === 'exercise' || block.block_type === 'code_challenge' ? 'text_submission' : 'manual_complete');
}

export function latestSubmission(submissions: SubmissionBrief[]) {
  return submissions.reduce<SubmissionBrief | null>((latest, submission) => {
    if (!latest) return submission;
    const latestTime = Date.parse(latest.created_at);
    const submissionTime = Date.parse(submission.created_at);
    if (Number.isFinite(latestTime) && Number.isFinite(submissionTime) && submissionTime !== latestTime) {
      return submissionTime > latestTime ? submission : latest;
    }
    return submission.id > latest.id ? submission : latest;
  }, null);
}

export function submissionState(submissions: SubmissionBrief[]) {
  const latest = latestSubmission(submissions);
  return {
    latest,
    passed: Boolean(latest?.grade && latest.grade !== 'R'),
    redo: latest?.grade === 'R',
    editable: Boolean(latest && latest.grade === null),
  };
}

export function canSubmitWork(type: string, values: { text: string; repoUrl: string; liveUrl: string }) {
  if (type === 'text_submission') return Boolean(values.text.trim());
  if (type === 'repo_url_submission') return Boolean(values.repoUrl.trim());
  if (type === 'repo_and_live_url_submission') return Boolean(values.repoUrl.trim() && values.liveUrl.trim());
  return false;
}

export function buildSubmissionInput(contentBlockId: number, type: string, values: { text: string; repoUrl: string; liveUrl: string; prUrl: string; branch: string; commitSha: string; notes: string }): SubmissionInput {
  if (type === 'text_submission') return { content_block_id: contentBlockId, text: values.text.trim() };
  return {
    content_block_id: contentBlockId,
    repo_url: values.repoUrl.trim(),
    live_url: values.liveUrl.trim() || undefined,
    pr_url: values.prUrl.trim() || undefined,
    branch: values.branch.trim() || undefined,
    commit_sha: values.commitSha.trim() || undefined,
    notes: values.notes.trim() || undefined,
  };
}

export function safeExternalUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
