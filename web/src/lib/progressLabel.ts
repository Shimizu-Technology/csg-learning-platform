/**
 * "4 of 6 lessons": the learner's progress in whole lessons, from the server's
 * one definition (LearnerProgress). Learners and staff count lessons, never
 * blocks (U-5.6). Rows cached before the server sent lesson counts fall back
 * to the step counts they carry.
 */
export function lessonsLabel(row: { completed_lessons?: number | null; total_lessons?: number | null; completed_blocks?: number; total_blocks?: number }): string {
  if (row.total_lessons != null) {
    return `${row.completed_lessons ?? 0} of ${row.total_lessons} ${row.total_lessons === 1 ? 'lesson' : 'lessons'}`
  }
  return `${row.completed_blocks ?? 0} of ${row.total_blocks ?? 0} done`
}
