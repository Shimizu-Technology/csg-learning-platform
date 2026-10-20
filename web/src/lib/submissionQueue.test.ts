import { describe, expect, it } from 'vitest'
import { orderSubmissionQueue, submissionWhereLabel } from './submissionQueue'

const submissions = [
  { id: 1, user_id: 4, content_block_id: 8, grade: 'R', created_at: '2026-01-01T00:00:00Z' },
  { id: 2, user_id: 4, content_block_id: 8, grade: 'R', created_at: '2026-01-03T00:00:00Z' },
  { id: 3, user_id: 5, content_block_id: 9, grade: 'R', created_at: '2026-01-02T00:00:00Z' },
]

describe('orderSubmissionQueue', () => {
  it('keeps latest attempts first, then orders each group newest first', () => {
    expect(orderSubmissionQueue(submissions, 'redo').map((submission) => submission.id)).toEqual([2, 3, 1])
  })
})

describe('submissionWhereLabel', () => {
  it('shows the lesson once when the block title repeats it', () => {
    expect(submissionWhereLabel('E6 — find the boundary bug', 'E6 — find the boundary bug')).toBe('E6 — find the boundary bug')
    expect(submissionWhereLabel('Lesson 7 — plan the expense summary', 'Project plan')).toBe('Lesson 7 — plan the expense summary · Project plan')
    expect(submissionWhereLabel('Orientation', '')).toBe('Orientation')
    expect(submissionWhereLabel(null, 'Exercise')).toBe('Exercise')
  })
})

describe('feedbackDraftDiffers', () => {
  const submission = { feedback: 'Saved note', rubric: { criteria: [{ id: 1, rating: 'meets', feedback: '' }] } }
  it('is false when the draft matches what is saved', async () => {
    const { feedbackDraftDiffers } = await import('./submissionQueue')
    expect(feedbackDraftDiffers(submission, 'Saved note', { 1: { rating: 'meets', feedback: '' } })).toBe(false)
    expect(feedbackDraftDiffers(null, 'anything', {})).toBe(false)
    expect(feedbackDraftDiffers({ feedback: null }, '', {})).toBe(false)
  })
  it('is true when feedback, a rating or criterion feedback changed', async () => {
    const { feedbackDraftDiffers } = await import('./submissionQueue')
    expect(feedbackDraftDiffers(submission, 'Saved note, plus more', { 1: { rating: 'meets', feedback: '' } })).toBe(true)
    expect(feedbackDraftDiffers(submission, 'Saved note', { 1: { rating: 'exceeds', feedback: '' } })).toBe(true)
    expect(feedbackDraftDiffers(submission, 'Saved note', { 1: { rating: 'meets', feedback: 'Watch indentation' } })).toBe(true)
  })
})
