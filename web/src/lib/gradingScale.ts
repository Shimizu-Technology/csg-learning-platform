import type { RubricRating } from '../types/api'

/** How a curriculum's work is graded (Curriculum#grading_scale on the API). */
export type GradingScale = 'letter_abc_redo' | 'pass_redo'
/** Every grade the API stores. P (Pass) passes exactly as A, B and C do. */
export type GradeChoice = 'A' | 'B' | 'C' | 'R' | 'P'

export const DEFAULT_NEW_CURRICULUM_SCALE: GradingScale = 'pass_redo'

export const GRADING_SCALE_OPTIONS: { value: GradingScale; label: string; description: string }[] = [
  {
    value: 'pass_redo',
    label: 'Pass / Redo',
    description: 'Work either passes or goes back to the student with feedback. Best for practice and prework.',
  },
  {
    value: 'letter_abc_redo',
    label: 'A / B / C / Redo',
    description: 'A, B or C for passing work, or Redo with feedback. Use when the letter matters.',
  },
]

export function normalizeGradingScale(scale: string | null | undefined): GradingScale {
  return scale === 'pass_redo' ? 'pass_redo' : 'letter_abc_redo'
}

export function gradingScaleLabel(scale: string | null | undefined): string {
  return normalizeGradingScale(scale) === 'pass_redo' ? 'Pass / Redo' : 'A / B / C / Redo'
}

/** The grades a reviewer may choose on this scale, in button order. */
export function gradeChoicesFor(scale: string | null | undefined): GradeChoice[] {
  return normalizeGradingScale(scale) === 'pass_redo' ? ['P', 'R'] : ['A', 'B', 'C', 'R']
}

export function isPassingGrade(grade: string | null | undefined): boolean {
  return grade === 'A' || grade === 'B' || grade === 'C' || grade === 'P'
}

/** Cmd/Ctrl+Enter with nothing chosen: grades are never saved by a guess. */
export function chooseGradeFirstMessage(scale: string | null | undefined): string {
  return normalizeGradingScale(scale) === 'pass_redo' ? 'Choose Pass or Redo, then save.' : 'Choose A, B, C or Redo, then save.'
}

/**
 * The grade a rubric points to, or null while it doesn't point anywhere yet.
 * Any criterion rated "Needs redo" points to Redo straight away. Otherwise every
 * criterion must be rated: Pass on Pass / Redo; on A / B / C / Redo, A when all
 * exceed (or more than half exceed and none is developing), C when any is
 * developing, B otherwise. Reviewers can still choose any grade.
 */
export function gradeFromRubric(
  scale: string | null | undefined,
  ratings: (RubricRating | null | undefined)[],
): GradeChoice | null {
  if (ratings.length === 0) return null
  if (ratings.some((rating) => rating === 'redo')) return 'R'
  if (ratings.some((rating) => !rating)) return null
  if (normalizeGradingScale(scale) === 'pass_redo') return 'P'
  const exceeds = ratings.filter((rating) => rating === 'exceeds').length
  const developing = ratings.filter((rating) => rating === 'developing').length
  if (exceeds === ratings.length || (exceeds > ratings.length / 2 && developing === 0)) return 'A'
  if (developing > 0) return 'C'
  return 'B'
}
