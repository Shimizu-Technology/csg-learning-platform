/*
 * The module grading grid (U-4.2): which week it opens on and how its columns are labelled.
 */

export interface GridExercise {
  id: number
  filename: string | null
  title: string
  lesson_title: string
  release_day: number
}

interface GridSubmission {
  id: number
  content_block_id: number
  grade: string | null
  latest_submission_id?: number | null
}

/** "Lesson · exercise" for a column's tooltip and accessible name, without repeating a matching title. */
export function exerciseFullLabel(exercise: GridExercise, index: number): string {
  const lesson = exercise.lesson_title?.trim() || ''
  const work = exercise.filename?.trim() || exercise.title?.trim() || ''
  if (!work || work.toLowerCase() === lesson.toLowerCase()) return lesson || work || `Exercise ${index + 1}`
  return lesson ? `${lesson} · ${work}` : work
}

/**
 * Short column labels for one week's exercises. Labels that would read the same once cut
 * ("Practice…", "Practice…") get their position in the week, so no two columns look alike.
 */
export function exerciseColumnLabels(exercises: GridExercise[]): string[] {
  const raw = exercises.map((exercise, index) =>
    exercise.filename?.trim() || exercise.title?.trim() || exercise.lesson_title?.trim() || `Exercise ${index + 1}`)
  const cut = raw.map((label) => (label.length > 14 ? `${label.slice(0, 12)}…` : label))
  const seen = new Map<string, number>()
  cut.forEach((label) => seen.set(label, (seen.get(label) || 0) + 1))
  return cut.map((label, index) => {
    if ((seen.get(label) || 0) < 2) return label
    const base = raw[index].length > 10 ? `${raw[index].slice(0, 9)}…` : raw[index]
    return `${base} ${index + 1}`
  })
}

/** Latest attempts only (the server's latest_submission_id), so an old ungraded attempt never counts as waiting. */
function isLatest(item: GridSubmission) {
  return item.latest_submission_id == null || item.latest_submission_id === item.id
}

/**
 * The week the grid opens on: the first with work waiting for review, else the latest week
 * with any submission, else the first week. Null when the module has no exercises.
 */
export function defaultGradingWeek(weeks: Array<[number, GridExercise[]]>, submissions: GridSubmission[]): number | null {
  if (weeks.length === 0) return null
  const weekOf = new Map<number, number>()
  weeks.forEach(([week, exercises]) => exercises.forEach((exercise) => weekOf.set(exercise.id, week)))
  const waiting = weeks.find(([week]) =>
    submissions.some((item) => weekOf.get(item.content_block_id) === week && item.grade === null && isLatest(item)))
  if (waiting) return waiting[0]
  const withWork = weeks.filter(([week]) => submissions.some((item) => weekOf.get(item.content_block_id) === week))
  return (withWork.at(-1) ?? weeks[0])[0]
}
