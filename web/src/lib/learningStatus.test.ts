import { describe, expect, it } from 'vitest'
import { LEARNER_STATUS, isGradableWorkBlock, learnerLessonStatus, lessonStatus, submissionStatus, weeklyItemStatus } from './learningStatus'

describe('truthful learner statuses', () => {
  it('never calls ungraded work done', () => {
    expect(learnerLessonStatus({ completed: true, reviewStatus: 'awaiting_review' })).toBe('awaiting_review')
    // One of two exercises submitted: the lesson is still open work.
    expect(learnerLessonStatus({ completed: false, reviewStatus: 'awaiting_review' })).toBe('open')
    expect(LEARNER_STATUS.awaiting_review.label).toBe('Submitted · waiting for review')
    expect(LEARNER_STATUS.awaiting_review.tone).toBe('pending')
  })

  it('treats a redo as open work with a warning tone, not as done or as an error', () => {
    expect(learnerLessonStatus({ completed: false, reviewStatus: 'redo_requested' })).toBe('redo')
    expect(learnerLessonStatus({ completed: true, reviewStatus: 'redo_requested', submissionsClosed: true })).toBe('redo')
    expect(LEARNER_STATUS.redo.tone).toBe('warning')
  })

  it('marks reviewed or non-reviewed completed work as done', () => {
    expect(learnerLessonStatus({ completed: true, reviewStatus: 'reviewed' })).toBe('done')
    expect(learnerLessonStatus({ completed: true })).toBe('done')
    expect(LEARNER_STATUS.done.tone).toBe('success')
  })

  it('orders the remaining states', () => {
    expect(learnerLessonStatus({ available: false })).toBe('upcoming')
    expect(learnerLessonStatus({ submissionsClosed: true })).toBe('closed')
    expect(learnerLessonStatus({ partial: true })).toBe('in_progress')
    expect(learnerLessonStatus({})).toBe('open')
  })

  it('maps weekly plan items using the additive review status', () => {
    expect(weeklyItemStatus({ state: 'completed', review_status: 'awaiting_review' })).toBe('awaiting_review')
    expect(weeklyItemStatus({ state: 'open', review_status: 'redo_requested' })).toBe('redo')
    expect(weeklyItemStatus({ state: 'completed' })).toBe('done')
    expect(weeklyItemStatus({ state: 'upcoming' })).toBe('upcoming')
    expect(weeklyItemStatus({ state: 'closed' })).toBe('closed')
  })

  it('maps a single submission', () => {
    expect(submissionStatus(null)).toBeNull()
    expect(submissionStatus({ grade: null })).toBe('awaiting_review')
    expect(submissionStatus({ grade: 'R' })).toBe('redo')
    expect(submissionStatus({ grade: 'B' })).toBe('done')
  })
})

describe('server learner status (AS-10)', () => {
  it('prefers the server status over the local rule', () => {
    // A stale completed flag with a redo: the server already says redo.
    expect(lessonStatus({ learner_status: 'redo', completed: true, available: true })).toBe('redo')
    // The local rule cannot see a closed week on a plan row; the server can.
    expect(lessonStatus({ learner_status: 'closed', completed: false, available: true })).toBe('closed')
    expect(weeklyItemStatus({ state: 'open', learner_status: 'in_progress' })).toBe('in_progress')
  })

  it('falls back to the shared rule for payloads from older servers', () => {
    expect(lessonStatus({ completed: true, available: true, review_status: 'awaiting_review' })).toBe('awaiting_review')
    expect(lessonStatus({ completed: false, available: true, completed_blocks: 1 })).toBe('in_progress')
    expect(lessonStatus({ completed: false, available: true, submission_window: { submissions_closed: true } })).toBe('closed')
    expect(lessonStatus({ completed: false, available: false })).toBe('upcoming')
    expect(weeklyItemStatus({ state: 'completed', review_status: 'redo_requested' })).toBe('redo')
  })
})

describe('isGradableWorkBlock', () => {
  it('matches the server rule for reviewed work', () => {
    expect(isGradableWorkBlock({ block_type: 'exercise' })).toBe(true)
    expect(isGradableWorkBlock({ block_type: 'code_challenge' })).toBe(true)
    expect(isGradableWorkBlock({ block_type: 'checkpoint', submission_type: 'text_submission' })).toBe(true)
    expect(isGradableWorkBlock({ block_type: 'checkpoint' })).toBe(false)
    expect(isGradableWorkBlock({ block_type: 'checkpoint', submission_type: 'text_submission', knowledge_check: { id: 1 } })).toBe(false)
    expect(isGradableWorkBlock({ block_type: 'video' })).toBe(false)
  })
})
