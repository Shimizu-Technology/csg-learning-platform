import { describe, expect, it } from 'vitest'
import { orderSubmissionQueue, submissionWhereLabel } from './submissionQueue'

const submissions = [
  { id: 1, user_id: 4, content_block_id: 8, grade: 'R', created_at: '2026-01-01T00:00:00Z' },
  { id: 2, user_id: 4, content_block_id: 8, grade: 'R', created_at: '2026-01-03T00:00:00Z' },
  { id: 3, user_id: 5, content_block_id: 9, grade: 'R', created_at: '2026-01-02T00:00:00Z' },
]

describe('orderSubmissionQueue', () => {
  it('keeps latest attempts first, then orders each group newest first', () => {
    expect(orderSubmissionQueue(submissions, 'redo').map((submission) => submission.id)).toEqual([2, 3])
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

describe('enrollment-aware latest attempts', () => {
  it('keeps both cohort histories current and respects API latest metadata in filtered lists', async () => {
    const { getLatestSubmissionIds } = await import('./submissionQueue')
    const records = [
      { ...submissions[0], cohort_id: 1, latest_submission_id: 1 },
      { ...submissions[1], cohort_id: 2, latest_submission_id: 2 },
    ]
    expect([...getLatestSubmissionIds(records)]).toEqual([1, 2])
    expect([...getLatestSubmissionIds([{ ...records[0], latest_submission_id: 99 }])]).toEqual([])
  })
})

 it('groups current work by enrollment even when the same learner repeats the curriculum', async () => {
    const { getLatestSubmissionIds } = await import('./submissionQueue')
    const rows = [{ ...submissions[0], enrollment_id: 12 }, { ...submissions[1], enrollment_id: 13 }]
    expect([...getLatestSubmissionIds(rows)]).toEqual([1, 2])
    expect(orderSubmissionQueue(rows, 'redo')).toHaveLength(2)
    expect(orderSubmissionQueue([{ ...rows[0], latest_submission_id: 99 }], 'redo')).toEqual([])
  })

it('uses authoritative latest-attempt metadata even when imported timestamps are out of order', async () => {
  const { getLatestSubmissionIds } = await import('./submissionQueue')
  const rows = [
    { ...submissions[0], id: 1, enrollment_id: 9, latest_submission_id: 2, created_at: '2026-02-01' },
    { ...submissions[1], id: 2, enrollment_id: 9, latest_submission_id: 2, created_at: '2026-01-01' },
  ]
  expect([...getLatestSubmissionIds(rows)]).toEqual([2])
})
