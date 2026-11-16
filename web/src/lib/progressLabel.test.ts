import { describe, expect, it } from 'vitest'
import { lessonsLabel } from './progressLabel'

describe('lessonsLabel', () => {
  it('counts whole lessons when the server sends them', () => {
    expect(lessonsLabel({ completed_lessons: 4, total_lessons: 6, completed_blocks: 5, total_blocks: 7 })).toBe('4 of 6 lessons')
    expect(lessonsLabel({ completed_lessons: 0, total_lessons: 1 })).toBe('0 of 1 lesson')
  })

  it('falls back to the step counts a cached row carries', () => {
    expect(lessonsLabel({ completed_blocks: 5, total_blocks: 7 })).toBe('5 of 7 done')
  })

  it('falls back to the legacy overall_progress shape', () => {
    const legacy = { completed: 5, total: 7, percentage: 71.4 }
    expect(lessonsLabel(legacy)).toBe('5 of 7 done')
  })
})
