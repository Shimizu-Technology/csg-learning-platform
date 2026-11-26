import type { RubricRating } from '@/lib/types';

/** How a curriculum's work is graded (the submission's `grading_scale`). Same rules as the web app. */
export type GradingScale = 'letter_abc_redo' | 'pass_redo';
/** Every grade the API stores. P (Pass) passes exactly as A, B and C do. */
export type GradeChoice = 'A' | 'B' | 'C' | 'R' | 'P';

export function normalizeGradingScale(scale: string | null | undefined): GradingScale {
  return scale === 'pass_redo' ? 'pass_redo' : 'letter_abc_redo';
}

/** The passing grades a reviewer may choose on this scale; Redo is always offered separately. */
export function passingChoicesFor(scale: string | null | undefined): GradeChoice[] {
  return normalizeGradingScale(scale) === 'pass_redo' ? ['P'] : ['A', 'B', 'C'];
}

/**
 * The grade a rubric points to, or null while it doesn't point anywhere yet. Any criterion rated
 * "Needs redo" points to Redo straight away. Otherwise every criterion must be rated: Pass on
 * Pass / Redo; on A / B / C / Redo, A when all exceed (or more than half exceed and none is
 * developing), C when any is developing, B otherwise.
 */
export function gradeFromRubric(scale: string | null | undefined, ratings: (RubricRating | null | undefined)[]): GradeChoice | null {
  if (ratings.length === 0) return null;
  if (ratings.some((rating) => rating === 'redo')) return 'R';
  if (ratings.some((rating) => !rating)) return null;
  if (normalizeGradingScale(scale) === 'pass_redo') return 'P';
  const exceeds = ratings.filter((rating) => rating === 'exceeds').length;
  const developing = ratings.filter((rating) => rating === 'developing').length;
  if (exceeds === ratings.length || (exceeds > ratings.length / 2 && developing === 0)) return 'A';
  if (developing > 0) return 'C';
  return 'B';
}

/** The passing grade check suggestions point to: B (suggest_b) or Pass (suggest_pass). */
export function suggestedPassingGrade(outcome: string | null | undefined): 'B' | 'P' | null {
  if (outcome === 'suggest_b') return 'B';
  if (outcome === 'suggest_pass') return 'P';
  return null;
}
