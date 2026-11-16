import { describe, expect, it } from 'vitest'
import { defaultGradingWeek, exerciseColumnLabels, exerciseFullLabel, type GridExercise } from './moduleGradingGrid'

const exercise = (id: number, release_day: number, title = `Exercise ${id}`, lesson_title = `Lesson ${id}`): GridExercise =>
  ({ id, filename: null, title, lesson_title, release_day })
const weeks: Array<[number, GridExercise[]]> = [
  [1, [exercise(1, 0), exercise(2, 1)]],
  [2, [exercise(3, 7)]],
  [3, [exercise(4, 14)]],
]

describe('defaultGradingWeek', () => {
  it('opens on the first week with a latest attempt waiting, even when week 1 is all graded', () => {
    const submissions = [
      { id: 1, content_block_id: 1, grade: 'A', latest_submission_id: 1 },
      { id: 2, content_block_id: 4, grade: null, latest_submission_id: 2 },
      { id: 3, content_block_id: 3, grade: null, latest_submission_id: 4 },
      { id: 4, content_block_id: 3, grade: 'B', latest_submission_id: 4 },
    ]
    // Week 2's ungraded row is an old attempt (its latest is graded), so week 3 is the first waiting.
    expect(defaultGradingWeek(weeks, submissions)).toBe(3)
  })

  it('falls back to the latest week with work, then the first week', () => {
    expect(defaultGradingWeek(weeks, [{ id: 1, content_block_id: 3, grade: 'A', latest_submission_id: 1 }])).toBe(2)
    expect(defaultGradingWeek(weeks, [])).toBe(1)
    expect(defaultGradingWeek([], [])).toBeNull()
  })
})

describe('column labels', () => {
  it('never shows two columns with the same cut label', () => {
    const labels = exerciseColumnLabels([
      exercise(1, 0, 'Practice: loops over arrays'),
      exercise(2, 0, 'Practice: loops over objects'),
      exercise(3, 0, 'Recap'),
    ])
    expect(new Set(labels).size).toBe(3)
    expect(labels[2]).toBe('Recap')
    expect(labels[0]).toMatch(/ 1$/)
    expect(labels[1]).toMatch(/ 2$/)
  })

  it('names lesson and exercise in full, without repeating a matching title', () => {
    expect(exerciseFullLabel(exercise(1, 0, 'Ticket prices', 'Make Decisions with JavaScript'), 0)).toBe('Make Decisions with JavaScript · Ticket prices')
    expect(exerciseFullLabel(exercise(1, 0, 'Recap', 'Recap'), 0)).toBe('Recap')
  })
})
