import { submissionTypeFor } from './learning';
import type { LessonContentBlock, SubmissionBrief } from './types';

/** Gradable work whose stored completion is trustworthy on its own: practice marked complete, or work synced from GitHub. */
const COMPLETION_COUNTS_AS_DONE = ['manual_complete', 'prework_github_sync'];

/**
 * One truthful learner status, shared with the web app's `learningStatus`.
 * Submitted work is not "done" until an instructor reviews it, and a redo is
 * open work even though the learner already submitted once.
 */
export type ReviewStatus = 'awaiting_review' | 'redo_requested' | 'reviewed' | null | undefined;

export type LearnerStatus = 'done' | 'awaiting_review' | 'redo' | 'in_progress' | 'open' | 'upcoming' | 'closed';

export type StatusTone = 'success' | 'pending' | 'warning' | 'neutral' | 'quiet';

export const LEARNER_STATUS: Record<LearnerStatus, { label: string; shortLabel: string; tone: StatusTone }> = {
  done: { label: 'Done', shortLabel: 'Done', tone: 'success' },
  awaiting_review: { label: 'Submitted · awaiting review', shortLabel: 'Awaiting review', tone: 'pending' },
  redo: { label: 'Redo requested', shortLabel: 'Redo', tone: 'warning' },
  in_progress: { label: 'In progress', shortLabel: 'In progress', tone: 'neutral' },
  open: { label: 'To do', shortLabel: 'To do', tone: 'neutral' },
  upcoming: { label: 'Upcoming', shortLabel: 'Upcoming', tone: 'quiet' },
  closed: { label: 'Submissions closed', shortLabel: 'Closed', tone: 'quiet' },
};

interface LessonStatusInput {
  completed?: boolean;
  available?: boolean;
  submissionsClosed?: boolean;
  reviewStatus?: ReviewStatus;
  partial?: boolean;
}

export function learnerLessonStatus({ completed, available = true, submissionsClosed, reviewStatus, partial }: LessonStatusInput): LearnerStatus {
  if (reviewStatus === 'redo_requested') return 'redo';
  // A lesson is only awaiting review once all of its work is handed in.
  if (reviewStatus === 'awaiting_review' && completed) return 'awaiting_review';
  if (completed) return 'done';
  if (!available) return 'upcoming';
  if (submissionsClosed) return 'closed';
  if (partial) return 'in_progress';
  return 'open';
}

/** Weekly-plan items carry the API's coarse state plus the additive review status. */
export function weeklyItemStatus(item: { state: string; review_status?: ReviewStatus }): LearnerStatus {
  return learnerLessonStatus({
    completed: item.state === 'completed',
    available: item.state !== 'upcoming',
    submissionsClosed: item.state === 'closed',
    reviewStatus: item.review_status,
  });
}

/** Status of a single graded block from its latest submission. */
export function submissionStatus(latest: Pick<SubmissionBrief, 'grade'> | null | undefined): LearnerStatus | null {
  if (!latest) return null;
  if (latest.grade === 'R') return 'redo';
  if (latest.grade === null || latest.grade === undefined) return 'awaiting_review';
  return 'done';
}

const REVIEWED_SUBMISSION_TYPES = ['text_submission', 'repo_url_submission', 'repo_and_live_url_submission'];

/**
 * Checkpoints normally complete through a toggle or a retrieval check. A
 * checkpoint with an explicit reviewed submission type (the Python pilot's
 * weekly checkpoints) is graded work exactly like an exercise. Mirrors the
 * API's `ContentBlock#gradable_work_block?`.
 */
export function isSubmissionCheckpoint(block: Pick<LessonContentBlock, 'block_type' | 'submission_type' | 'knowledge_check'>) {
  return block.block_type === 'checkpoint' && !block.knowledge_check && REVIEWED_SUBMISSION_TYPES.includes(block.submission_type || '');
}

export function isExerciseBlock(block: Pick<LessonContentBlock, 'block_type'>) {
  return block.block_type === 'exercise' || block.block_type === 'code_challenge';
}

/**
 * An imported video or recording step with no video, upload, or text yet: there
 * is nothing for a learner to do, so it is hidden and left out of progress.
 * Steps the curriculum explicitly requires stay visible so they can be completed.
 */
export function isEmptyVideoStep(block: Pick<LessonContentBlock, 'block_type' | 'video_url' | 'has_s3_video' | 'metadata' | 'body' | 'completion_required'>) {
  return (block.block_type === 'video' || block.block_type === 'recording') && !block.completion_required && !block.video_url && !block.has_s3_video && !block.metadata?.staged_video_upload && !block.body?.trim();
}

export function isGradableWorkBlock(block: Pick<LessonContentBlock, 'block_type' | 'submission_type' | 'knowledge_check'>) {
  return isExerciseBlock(block) || isSubmissionCheckpoint(block);
}

/** The learner's review status for one block, or null when it is not reviewed work or nothing was submitted. */
export function blockReviewStatus(block: LessonContentBlock, latest: SubmissionBrief | null): ReviewStatus {
  if (!latest || !isGradableWorkBlock(block)) return null;
  if (latest.grade === 'R') return 'redo_requested';
  if (latest.grade === null || latest.grade === undefined) return 'awaiting_review';
  return 'reviewed';
}

function latestOf(submissions: SubmissionBrief[] | undefined) {
  return (submissions || []).reduce<SubmissionBrief | null>((latest, submission) => {
    if (!latest) return submission;
    const latestTime = Date.parse(latest.created_at);
    const submissionTime = Date.parse(submission.created_at);
    if (Number.isFinite(latestTime) && Number.isFinite(submissionTime) && submissionTime !== latestTime) return submissionTime > latestTime ? submission : latest;
    return submission.id > latest.id ? submission : latest;
  }, null);
}

/**
 * Lesson progress that matches what the learner can trust: reviewed work and
 * finished steps count as done; work awaiting review and redos do not, even
 * though submitting marks the step complete on the server.
 */
export function lessonLearnerProgress(blocks: LessonContentBlock[], requiresGithub = false) {
  const explicitlyRequired = blocks.filter((block) => block.completion_required);
  const steps = explicitlyRequired.length ? explicitlyRequired : blocks.filter((block) => (block.block_type !== 'text' || block.progress) && !isEmptyVideoStep(block));
  let done = 0;
  let awaitingReview = 0;
  let redo = 0;
  for (const block of steps) {
    const review = blockReviewStatus(block, latestOf(block.submissions));
    if (review === 'redo_requested') redo += 1;
    else if (review === 'awaiting_review') awaitingReview += 1;
    else if (review === 'reviewed') done += 1;
    // Reviewed work only counts as done once an instructor reviews it, never from the stored completion flag alone.
    else if (!(isGradableWorkBlock(block) && !COMPLETION_COUNTS_AS_DONE.includes(submissionTypeFor(block, requiresGithub))) && block.progress?.status === 'completed') done += 1;
  }
  const total = steps.length;
  const handedIn = done + awaitingReview;
  const reviewStatus: ReviewStatus = redo ? 'redo_requested' : awaitingReview ? 'awaiting_review' : null;
  const status = total === 0 ? 'open' : learnerLessonStatus({ completed: handedIn === total, reviewStatus, partial: handedIn > 0 || redo > 0 });
  return { done, awaitingReview, redo, total, percentage: total ? Math.round((done / total) * 100) : 0, status };
}
