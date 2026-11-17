import { describe, expect, it } from 'vitest'
import { groupPlanLessons, matchesQuery } from './learningPlanLessons'
import type { LearningPlanEditorLesson } from '../types/api'

const lesson = (id: number, title: string, week: number | null, extra: Partial<LearningPlanEditorLesson> = {}): LearningPlanEditorLesson => ({ id, title, module_id: 1, module_name: 'React', standard_required: true, week, status: 'open', completed: false, ...extra })

describe('matchesQuery', () => {
  it('treats "week N" as exactly that week', () => {
    expect(matchesQuery(lesson(1, 'React lesson 13', 3), 'react week 1')).toBe(false)
    expect(matchesQuery(lesson(2, 'React lesson 2', 1), 'react week 1')).toBe(true)
    expect(matchesQuery(lesson(3, 'Hooks', 2), 'wk 2 hooks')).toBe(true)
    expect(matchesQuery(lesson(4, 'Hooks', null), 'week 2')).toBe(false)
  })
  it('ignores case and accents', () => {
    expect(matchesQuery(lesson(5, 'Café menus', 1), 'cafe MENU')).toBe(true)
  })
})

describe('groupPlanLessons', () => {
  it('counts remaining work across the whole module, whatever the search shows', () => {
    const lessons = [lesson(1, 'Done', 1, { completed: true, status: 'done' }), lesson(2, 'Placed', 1), lesson(3, 'Open', 2), lesson(4, 'Other', 2, { module_id: 2, module_name: 'Node' })]
    const [react, node] = groupPlanLessons(lessons, { query: 'open', placed: new Set([2]) })
    expect(react.remaining.map((item) => item.id)).toEqual([3])
    expect(react.weeks).toEqual([{ week: 2, lessons: [lessons[2]] }])
    expect(node.weeks).toEqual([])
  })
})
