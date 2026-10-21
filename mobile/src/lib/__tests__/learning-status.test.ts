import { contrastRatio } from '@/test-utils/contrast';
import { statusTones } from '@/constants/csg-theme';
import { isGradableWorkBlock, LEARNER_STATUS, learnerLessonStatus, lessonLearnerProgress, submissionStatus, weeklyItemStatus } from '../learning-status';
import type { LessonContentBlock } from '../types';

function block(overrides: Partial<LessonContentBlock>): LessonContentBlock {
  return { id: 1, block_type: 'exercise', position: 0, title: null, body: null, video_url: null, filename: null, metadata: {}, ...overrides };
}

describe('learner status', () => {
  it('treats submitted work as awaiting review, not done, and a redo as open work', () => {
    expect(learnerLessonStatus({ completed: true, reviewStatus: 'awaiting_review' })).toBe('awaiting_review');
    expect(learnerLessonStatus({ completed: true, reviewStatus: 'redo_requested' })).toBe('redo');
    expect(learnerLessonStatus({ completed: true, reviewStatus: 'reviewed' })).toBe('done');
    expect(learnerLessonStatus({ completed: false, available: false })).toBe('upcoming');
    expect(learnerLessonStatus({ completed: false })).toBe('open');
    expect(LEARNER_STATUS.awaiting_review.label).toBe('Submitted · awaiting review');
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
    expect(isGradableWorkBlock(block({ block_type: 'checkpoint', submission_type: 'text_submission', knowledge_check: { id: 1 } as LessonContentBlock['knowledge_check'] }))).toBe(false);
    expect(isGradableWorkBlock(block({ block_type: 'exercise' }))).toBe(true);
  });

  it('does not count work awaiting review toward lesson progress', () => {
    const progress = lessonLearnerProgress([
      block({ id: 1, block_type: 'checkpoint', submission_type: 'text_submission', completion_required: true, progress: { status: 'completed', completed_at: null }, submissions: [{ id: 9, text: 'x', grade: null, feedback: null, graded_at: null, num_submissions: 1, created_at: '2026-10-21T00:00:00Z' }] }),
    ]);
    expect(progress).toMatchObject({ done: 0, awaitingReview: 1, total: 1, percentage: 0, status: 'awaiting_review' });

    const redo = lessonLearnerProgress([
      block({ id: 2, completion_required: true, submissions: [{ id: 10, text: 'x', grade: 'R', feedback: 'Try again', graded_at: null, num_submissions: 1, created_at: '2026-10-21T00:00:00Z' }] }),
    ]);
    expect(redo.status).toBe('redo');

    expect(lessonLearnerProgress([]).percentage).toBe(0);
  });

  it('uses CSG family status colours with readable contrast', () => {
    for (const tone of ['success', 'pending', 'warning'] as const) {
      expect(contrastRatio(statusTones[tone].text, statusTones[tone].background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('reviewed work without a submission', () => {
  it('is not done just because the stored step is marked complete', () => {
    const progress = lessonLearnerProgress([{ id: 3, block_type: 'checkpoint', position: 0, title: null, body: null, video_url: null, filename: null, metadata: {}, submission_type: 'text_submission', completion_required: true, progress: { status: 'completed', completed_at: null }, submissions: [] }]);
    expect(progress.done).toBe(0);
    expect(progress.status).not.toBe('done');
  });
});
