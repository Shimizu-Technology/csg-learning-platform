import { contrastRatio } from '@/test-utils/contrast';
import { themes } from '@/constants/csg-theme';
import { isGradableWorkBlock, LEARNER_STATUS, learnerLessonStatus, lessonLearnerProgress, lessonPageProgress, lessonStatus, submissionStatus, weeklyItemStatus, notYetOpen } from '../learning-status';
import type { LessonContentBlock } from '../types';

function block(overrides: Partial<LessonContentBlock>): LessonContentBlock {
  return { submission_type: null, effective_submission_type: null, submission_type_explicit: null, submission_config: {}, s3_video_key: null, objective_ids: [], rubric: null, knowledge_check: null, has_s3_video: false, completion_required: false, id: 1, block_type: 'exercise', position: 0, title: null, body: null, video_url: null, filename: null, metadata: {}, ...overrides };
}

describe('learner status', () => {
  it('treats submitted work as awaiting review, not done, and a redo as open work', () => {
    expect(learnerLessonStatus({ completed: true, reviewStatus: 'awaiting_review' })).toBe('awaiting_review');
    expect(learnerLessonStatus({ completed: true, reviewStatus: 'redo_requested' })).toBe('redo');
    expect(learnerLessonStatus({ completed: true, reviewStatus: 'reviewed' })).toBe('done');
    expect(learnerLessonStatus({ completed: false, available: false })).toBe('upcoming');
    expect(learnerLessonStatus({ completed: false })).toBe('open');
    expect(LEARNER_STATUS.awaiting_review.label).toBe('Submitted · waiting for review');
    expect(LEARNER_STATUS.awaiting_review.tone).toBe('pending');
    expect(LEARNER_STATUS.redo.tone).toBe('warning');
  });

  it('maps weekly plan items and single submissions', () => {
    expect(weeklyItemStatus({ state: 'completed', review_status: 'awaiting_review' })).toBe('awaiting_review');
    expect(weeklyItemStatus({ state: 'closed' })).toBe('closed');
    expect(submissionStatus({ grade: null })).toBe('awaiting_review');
    expect(submissionStatus({ grade: 'R' })).toBe('redo');
    expect(submissionStatus({ grade: 'A' })).toBe('done');
    expect(submissionStatus(null)).toBeNull();
  });

  it('grades checkpoints that take a reviewed submission, but not quiz or toggle checkpoints', () => {
    expect(isGradableWorkBlock(block({ block_type: 'checkpoint', submission_type: 'text_submission' }))).toBe(true);
    expect(isGradableWorkBlock(block({ block_type: 'checkpoint', submission_type: 'repo_url_submission' }))).toBe(true);
    expect(isGradableWorkBlock(block({ block_type: 'checkpoint', submission_type: 'manual_complete' }))).toBe(false);
    expect(isGradableWorkBlock(block({ block_type: 'checkpoint', submission_type: 'text_submission', knowledge_check: {prompt: '', options: [], objective_code: null, attempt_count: 0, latest_attempt: null, id: 1 } as LessonContentBlock['knowledge_check'] }))).toBe(false);
    expect(isGradableWorkBlock(block({ block_type: 'exercise' }))).toBe(true);
  });

  it('counts work awaiting review as handed in, but not done', () => {
    const progress = lessonLearnerProgress([
      block({ id: 1, block_type: 'checkpoint', submission_type: 'text_submission', completion_required: true, progress: { video_last_position: null, video_total_watched: null, status: 'completed', completed_at: null }, submissions: [{ submission_type: null, repo_url: null, pr_url: null, live_url: null, branch: null, commit_sha: null, notes: null, updated_at: '', github_issue_url: null, github_code_url: null, id: 9, text: 'x', grade: null, feedback: null, graded_at: null, num_submissions: 1, created_at: '2026-10-21T00:00:00Z' }] }),
    ]);
    expect(progress).toMatchObject({ done: 0, awaitingReview: 1, handedIn: 1, total: 1, percentage: 100, status: 'awaiting_review' });

    const redo = lessonLearnerProgress([
      block({ id: 2, completion_required: true, submissions: [{ submission_type: null, repo_url: null, pr_url: null, live_url: null, branch: null, commit_sha: null, notes: null, updated_at: '', github_issue_url: null, github_code_url: null, id: 10, text: 'x', grade: 'R', feedback: 'Try again', graded_at: null, num_submissions: 1, created_at: '2026-10-21T00:00:00Z' }] }),
    ]);
    expect(redo.status).toBe('redo');

    expect(lessonLearnerProgress([]).percentage).toBe(0);
  });

  it('prefers the server handed-in count on the lesson page', () => {
    const local = { handedIn: 1, total: 1, percentage: 100 };
    // A redo with a stale completed flag: the server counts nothing handed in.
    expect(lessonPageProgress(local, { completed_blocks: 0, total_blocks: 1 })).toEqual({ handedIn: 0, total: 1, percentage: 0 });
    expect(lessonPageProgress(local, { completed_blocks: 1, total_blocks: 2 })).toEqual({ handedIn: 1, total: 2, percentage: 50 });
    expect(lessonPageProgress(local, {})).toEqual(local);
    expect(lessonPageProgress(local, { completed_blocks: null, total_blocks: null })).toEqual(local);
  });

  it('uses CSG family status colours with readable contrast', () => {
    for (const tone of ['success', 'pending', 'warning'] as const) {
      expect(contrastRatio(themes.light.statusTones[tone].text, themes.light.statusTones[tone].background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('reviewed work without a submission', () => {
  it('is not done just because the stored step is marked complete', () => {
    const progress = lessonLearnerProgress([{ effective_submission_type: null, submission_type_explicit: null, submission_config: {}, s3_video_key: null, objective_ids: [], rubric: null, knowledge_check: null, has_s3_video: false, id: 3, block_type: 'checkpoint', position: 0, title: null, body: null, video_url: null, filename: null, metadata: {}, submission_type: 'text_submission', completion_required: true, progress: { video_last_position: null, video_total_watched: null, status: 'completed', completed_at: null }, submissions: [] }]);
    expect(progress.done).toBe(0);
    expect(progress.status).not.toBe('done');
  });
});

describe('GitHub-synced prework', () => {
  it('counts a completed exercise as done in a lesson that requires GitHub, matching its Done badge', () => {
    const synced = block({ id: 5, block_type: 'exercise', submission_type: undefined, completion_required: true, progress: { video_last_position: null, video_total_watched: null, status: 'completed', completed_at: null }, submissions: [] });
    expect(lessonLearnerProgress([synced], true).done).toBe(1);
    // Without GitHub sync the same exercise is reviewed text work: completion alone is not done.
    expect(lessonLearnerProgress([synced], false).done).toBe(0);
  });
});

describe('server learner status (AS-10)', () => {
  it('prefers the server status over the local rule', () => {
    expect(lessonStatus({ learner_status: 'redo', completed: true, available: true })).toBe('redo');
    expect(lessonStatus({ learner_status: 'closed', completed: false, available: true })).toBe('closed');
    expect(weeklyItemStatus({ state: 'open', learner_status: 'in_progress' })).toBe('in_progress');
  });

  it('falls back to the shared rule for payloads from older servers', () => {
    expect(lessonStatus({ completed: true, available: true, review_status: 'awaiting_review' })).toBe('awaiting_review');
    expect(lessonStatus({ completed: false, available: true, completed_blocks: 1 })).toBe('in_progress');
    expect(lessonStatus({ completed: false, available: true, submission_window: { submissions_closed: true } })).toBe('closed');
    expect(lessonStatus({ completed: false, available: false })).toBe('upcoming');
    expect(weeklyItemStatus({ state: 'completed', review_status: 'redo_requested' })).toBe('redo');
  });
});

it('recognizes the API refusal for lessons and modules that open later', () => {
  const refusal = (status: number, message: string) => Object.assign(new Error(message), { status });
  expect(notYetOpen(refusal(403, 'Lesson is not unlocked yet'))).toBe(true);
  expect(notYetOpen(refusal(403, 'Module is not unlocked yet'))).toBe(true);
  expect(notYetOpen(refusal(403, 'You are not enrolled in this cohort'))).toBe(false);
  expect(notYetOpen(refusal(500, 'Lesson is not unlocked yet'))).toBe(false);
  expect(notYetOpen(null)).toBe(false);
});
