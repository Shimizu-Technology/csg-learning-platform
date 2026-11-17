import type { LearningPlanEditorLesson } from '../types/api'

/** Lessons of one week (or, for self-paced courses, the whole module) in course order. */
export interface PlanLessonWeek {
  week: number | null
  lessons: LearningPlanEditorLesson[]
}

export interface PlanLessonModule {
  id: number
  name: string
  weeks: PlanLessonWeek[]
  /** Not finished and not yet placed anywhere in the plan: what "Add all remaining" adds. */
  remaining: LearningPlanEditorLesson[]
}

/** Every step handed in: done, or waiting for review. Finished lessons don't need a place in a catch-up plan. */
export const isFinished = (lesson: LearningPlanEditorLesson) => lesson.completed

const normalize = (value: string) => value.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').trim()

/**
 * Matches every word of the query against the lesson title and module. "week 3"
 * (or "wk 3") means exactly week 3, not every lesson with a 3 in its name.
 */
export function matchesQuery(lesson: LearningPlanEditorLesson, query: string) {
  let text = normalize(query)
  const week = text.match(/\b(?:week|wk)\s*(\d+)\b/)
  if (week) {
    if (lesson.week !== Number(week[1])) return false
    text = text.replace(week[0], ' ')
  }
  const words = text.split(/\s+/).filter(Boolean)
  const haystack = normalize(`${lesson.title} ${lesson.module_name}`)
  return words.every((word) => haystack.includes(word))
}

/**
 * Groups the assigned lessons (already in course order) by module, then week.
 * `placed` holds lessons the plan already uses, so they never count as remaining.
 * Lessons hidden by the search or the finished filter drop out of the groups,
 * but a module's remaining count covers the whole module.
 */
export function groupPlanLessons(
  lessons: LearningPlanEditorLesson[],
  { query = '', showFinished = false, placed = new Set<number>() }: { query?: string; showFinished?: boolean; placed?: ReadonlySet<number> } = {},
): PlanLessonModule[] {
  const modules: PlanLessonModule[] = []
  const byId = new Map<number, PlanLessonModule>()
  for (const lesson of lessons) {
    let mod = byId.get(lesson.module_id)
    if (!mod) {
      mod = { id: lesson.module_id, name: lesson.module_name, weeks: [], remaining: [] }
      byId.set(lesson.module_id, mod)
      modules.push(mod)
    }
    if (!isFinished(lesson) && !placed.has(lesson.id)) mod.remaining.push(lesson)
    if ((!showFinished && isFinished(lesson)) || !matchesQuery(lesson, query)) continue
    const last = mod.weeks.at(-1)
    if (last && last.week === lesson.week) last.lessons.push(lesson)
    else mod.weeks.push({ week: lesson.week, lessons: [lesson] })
  }
  return modules
}

export const visibleLessonCount = (modules: PlanLessonModule[]) => modules.reduce((total, mod) => total + mod.weeks.reduce((sum, week) => sum + week.lessons.length, 0), 0)

export const lessonCountLabel = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'lesson' : 'lessons'}`
