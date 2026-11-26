import { describe, expect, it } from 'vitest'
import { chooseGradeFirstMessage, gradeChoicesFor, gradeFromRubric, gradingScaleLabel, isPassingGrade } from './gradingScale'
import { gradeLabel } from './glossary'

describe('grading scales', () => {
  it('offers each scale its own grades and reads them as words', () => {
    expect(gradeChoicesFor('pass_redo')).toEqual(['P', 'R'])
    expect(gradeChoicesFor('letter_abc_redo')).toEqual(['A', 'B', 'C', 'R'])
    expect(gradeChoicesFor(undefined)).toEqual(['A', 'B', 'C', 'R'])
    expect(['P', 'R', 'A', 'B', 'C'].map(gradeLabel)).toEqual(['Pass', 'Redo', 'A', 'B', 'C'])
    expect(gradingScaleLabel('pass_redo')).toBe('Pass / Redo')
    expect(chooseGradeFirstMessage('pass_redo')).toBe('Choose Pass or Redo, then save.')
    expect(['A', 'B', 'C', 'P'].every(isPassingGrade)).toBe(true)
    expect(isPassingGrade('R')).toBe(false)
  })

  it('reads a grade from rubric ratings', () => {
    expect(gradeFromRubric('pass_redo', [])).toBeNull()
    expect(gradeFromRubric('pass_redo', ['meets', null])).toBeNull()
    expect(gradeFromRubric('pass_redo', ['redo', null])).toBe('R')
    expect(gradeFromRubric('pass_redo', ['developing', 'meets'])).toBe('P')
    expect(gradeFromRubric('letter_abc_redo', ['exceeds', 'exceeds'])).toBe('A')
    expect(gradeFromRubric('letter_abc_redo', ['exceeds', 'exceeds', 'meets'])).toBe('A')
    expect(gradeFromRubric('letter_abc_redo', ['exceeds', 'meets'])).toBe('B')
    expect(gradeFromRubric('letter_abc_redo', ['exceeds', 'exceeds', 'developing'])).toBe('C')
    expect(gradeFromRubric('letter_abc_redo', ['meets', 'meets'])).toBe('B')
    expect(gradeFromRubric('letter_abc_redo', ['meets', 'redo'])).toBe('R')
  })
})
