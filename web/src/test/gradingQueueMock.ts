import { vi } from 'vitest'
import { api, type GradingQueueParams } from '../lib/api'
import type { GradingQueueItem, GradingQueueResponse, Submission } from '../types/api'

/*
 * Tests describe the work in scope as a list from api.getSubmissions (often a spy over a
 * store). This serves GET /grading_queue pages from that same list, with the server's rules
 * (GradingQueue in the API, tested in api/test/integration/grading_queue_test.rb): status by
 * latest attempt, module/student/lesson filters, oldest or newest first with ids breaking ties,
 * counts and options inside the other filters, focus_id, and the items just outside the page.
 * Installed for every test in setup.ts; a test can still spy on getGradingQueue itself.
 */

const isLatest = (item: Pick<Submission, 'id' | 'latest_submission_id'>) => item.latest_submission_id == null || item.latest_submission_id === item.id

function byStatus(items: Submission[], status: string) {
  if (status === 'ungraded') return items.filter((item) => isLatest(item) && item.grade === null)
  if (status === 'redo') return items.filter((item) => isLatest(item) && item.grade === 'R')
  return items
}

function byScope(items: Submission[], params: GradingQueueParams, except: 'module' | 'student' | 'lesson' | null = null) {
  return items.filter((item) =>
    (except === 'module' || !params.module_id || item.module_id === params.module_id) &&
    (except === 'student' || !params.student_id || item.user_id === params.student_id) &&
    (except === 'lesson' || !params.lesson_id || item.lesson_id === params.lesson_id))
}

const at = (value: string) => {
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function toItem(item: Submission): GradingQueueItem {
  return {
    id: item.id, enrollment_id: item.enrollment_id, latest_submission_id: item.latest_submission_id, content_block_id: item.content_block_id,
    user_id: item.user_id, user_name: item.user_name, grade: item.grade as GradingQueueItem['grade'], graded_at: item.graded_at,
    num_submissions: item.num_submissions, created_at: item.created_at, updated_at: item.updated_at,
    content_block_title: item.content_block_title, content_block_type: item.content_block_type,
    lesson_id: item.lesson_id, lesson_title: item.lesson_title, module_id: item.module_id, module_name: item.module_name,
    module_position: item.module_position ?? null, cohort_id: item.cohort_id, cohort_name: item.cohort_name,
    course_delivery: item.course_delivery ?? null, week_number: item.week_number ?? null,
  }
}

function options(items: Submission[], key: 'module' | 'student') {
  const map = new Map<number, { id: number; name: string; count: number; position: number }>()
  items.forEach((item) => {
    const id = key === 'module' ? item.module_id : item.user_id
    if (!id) return
    const current = map.get(id)
    if (current) current.count += 1
    else map.set(id, { id, name: (key === 'module' ? item.module_name : item.user_name) || '', count: 1, position: item.module_position ?? 0 })
  })
  return map
}

export function gradingQueuePage(all: Submission[], params: GradingQueueParams): GradingQueueResponse {
  const status = params.filter || 'ungraded'
  const perPage = Math.min(params.per_page || 50, 100)
  const direction = params.sort === 'newest' ? -1 : 1
  const list = byScope(byStatus(all, status), params)
    .slice()
    .sort((a, b) => direction * (at(a.created_at) - at(b.created_at) || a.id - b.id))
  const totalPages = Math.max(Math.ceil(list.length / perPage), 1)
  const focusIndex = params.focus_id ? list.findIndex((item) => item.id === params.focus_id) : -1
  const page = Math.min(Math.max(focusIndex >= 0 ? Math.floor(focusIndex / perPage) + 1 : params.page || 1, 1), totalPages)
  const offset = (page - 1) * perPage
  const scoped = byScope(all, params)
  const modules = options(byScope(byStatus(all, status), params, 'module'), 'module')
  if (params.module_id && !modules.has(params.module_id)) {
    const known = all.find((item) => item.module_id === params.module_id)
    modules.set(params.module_id, { id: params.module_id, name: known?.module_name || `Module ${params.module_id}`, count: 0, position: known?.module_position ?? 0 })
  }
  const students = options(byScope(byStatus(all, status), params, 'student'), 'student')
  if (params.student_id && !students.has(params.student_id)) {
    const known = all.find((item) => item.user_id === params.student_id)
    students.set(params.student_id, { id: params.student_id, name: known?.user_name || `Student ${params.student_id}`, count: 0, position: 0 })
  }
  const grids = new Map<string, { cohort_id: number; cohort_name: string; module_id: number; module_name: string; waiting: number; position: number }>()
  all.forEach((item) => {
    if (!item.cohort_id || !item.module_id) return
    const key = `${item.cohort_id}:${item.module_id}`
    const grid = grids.get(key) ?? { cohort_id: item.cohort_id, cohort_name: item.cohort_name || '', module_id: item.module_id, module_name: item.module_name || '', waiting: 0, position: item.module_position ?? 0 }
    if (isLatest(item) && item.grade === null) grid.waiting += 1
    grids.set(key, grid)
  })
  const lesson = params.lesson_id ? all.find((item) => item.lesson_id === params.lesson_id) : undefined
  return {
    submissions: list.slice(offset, offset + perPage).map(toItem),
    meta: { page, per_page: perPage, total_count: list.length, total_pages: totalPages, has_next_page: page < totalPages, has_prev_page: page > 1 },
    previous: offset > 0 && list[offset - 1] ? toItem(list[offset - 1]) : null,
    next: list[offset + perPage] ? toItem(list[offset + perPage]) : null,
    counts: { ungraded: byStatus(scoped, 'ungraded').length, redo: byStatus(scoped, 'redo').length, all: scoped.length },
    modules: [...modules.values()].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)).map(({ id, name, count }) => ({ id, name, count })),
    students: [...students.values()].sort((a, b) => a.name.localeCompare(b.name)).map(({ id, name, count }) => ({ id, name, count })),
    module_grids: [...grids.values()]
      .sort((a, b) => a.cohort_name.localeCompare(b.cohort_name) || a.position - b.position || a.module_name.localeCompare(b.module_name))
      .map(({ position: _position, ...grid }) => grid),
    lesson: lesson?.lesson_id ? { id: lesson.lesson_id, title: lesson.lesson_title } : null,
  }
}

/** Serve getGradingQueue from whatever api.getSubmissions returns for the same cohort scope. */
export function installGradingQueueFromSubmissions() {
  return vi.spyOn(api, 'getGradingQueue').mockImplementation(async (params, signal) => {
    const result = await api.getSubmissions(params.cohort_id ? { cohort_id: String(params.cohort_id) } : undefined, signal)
    if (!result.data) return { data: null, error: result.error || 'Could not load the grading queue.', fromCache: result.fromCache } as Awaited<ReturnType<typeof api.getGradingQueue>>
    return { ...result, data: gradingQueuePage(result.data.submissions, params) } as Awaited<ReturnType<typeof api.getGradingQueue>>
  })
}
