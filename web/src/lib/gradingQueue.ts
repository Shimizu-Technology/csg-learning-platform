import { getLatestSubmissionIds, type SubmissionQueueFilter } from './submissionQueue'

/*
 * The Grading workbench's queue (U-4.1, U-4.5). Its filters live in the
 * Grading page URL, and a submission record opened from it reads them back from
 * its return path (gradingQueueSource), so both walk the same list in the same
 * order. "Latest attempt" is the server's one definition (Submission.latest_attempts),
 * carried on each row as latest_submission_id and read by getLatestSubmissionIds.
 */

export type GradingSort = 'oldest' | 'newest'

export interface GradingFilters {
  filter: SubmissionQueueFilter
  moduleId?: number | null
  studentId?: number | null
  lessonId?: number | null
  sort?: GradingSort
}

export interface GradingQueueItem {
  id: number
  enrollment_id?: number | null
  cohort_id?: number | null
  latest_submission_id?: number | null
  user_id: number
  user_name?: string | null
  content_block_id: number
  grade: string | null
  created_at: string
  lesson_id?: number | null
  lesson_title?: string | null
  module_id?: number | null
  module_name?: string | null
  module_position?: number | null
  cohort_name?: string | null
}

function byStatus<T extends GradingQueueItem>(items: T[], filter: SubmissionQueueFilter) {
  const latest = getLatestSubmissionIds(items)
  return items.filter((item) => {
    if (filter === 'ungraded') return latest.has(item.id) && item.grade === null
    if (filter === 'redo') return latest.has(item.id) && item.grade === 'R'
    return true
  })
}

function byScope<T extends GradingQueueItem>(items: T[], filters: Omit<GradingFilters, 'filter' | 'sort'>) {
  return items.filter((item) =>
    (!filters.moduleId || item.module_id === filters.moduleId) &&
    (!filters.studentId || item.user_id === filters.studentId) &&
    (!filters.lessonId || item.lesson_id === filters.lessonId))
}

function time(value: string) {
  const at = new Date(value).getTime()
  return Number.isNaN(at) ? 0 : at
}

/** Oldest first by default: the work that has waited longest is graded first. Ids break ties. */
export function sortGradingQueue<T extends GradingQueueItem>(items: T[], sort: GradingSort = 'oldest') {
  const direction = sort === 'newest' ? -1 : 1
  return items.slice().sort((a, b) => direction * (time(a.created_at) - time(b.created_at) || a.id - b.id))
}

/** The queue the workbench shows: status, then module, student and lesson, in the chosen order. */
export function gradingQueue<T extends GradingQueueItem>(items: T[], filters: GradingFilters) {
  return sortGradingQueue(byScope(byStatus(items, filters.filter), filters), filters.sort)
}

/** Counts for the status chips, inside the module/student/lesson filters. */
export function gradingStatusCounts<T extends GradingQueueItem>(items: T[], filters: Omit<GradingFilters, 'filter' | 'sort'>) {
  return {
    ungraded: byScope(byStatus(items, 'ungraded'), filters).length,
    redo: byScope(byStatus(items, 'redo'), filters).length,
    all: byScope(items, filters).length,
  }
}

export interface GradingOption {
  id: number
  label: string
  count: number
}

/**
 * Modules and students that have work in the chosen status, with counts. Each
 * list respects the other filters (choosing a module narrows the students), and
 * empty entries are left out. The chosen entry is kept (count 0) so the select
 * never loses its value after the last item in it is graded.
 */
export function gradingFilterOptions<T extends GradingQueueItem>(items: T[], filters: GradingFilters) {
  const status = byStatus(items, filters.filter)
  const modules = new Map<number, GradingOption & { position: number }>()
  byScope(status, { studentId: filters.studentId, lessonId: filters.lessonId }).forEach((item) => {
    if (!item.module_id) return
    const current = modules.get(item.module_id)
    if (current) current.count += 1
    else modules.set(item.module_id, { id: item.module_id, label: item.module_name || `Module ${item.module_id}`, count: 1, position: item.module_position ?? Number.MAX_SAFE_INTEGER })
  })
  const students = new Map<number, GradingOption>()
  byScope(status, { moduleId: filters.moduleId, lessonId: filters.lessonId }).forEach((item) => {
    const current = students.get(item.user_id)
    if (current) current.count += 1
    else students.set(item.user_id, { id: item.user_id, label: item.user_name || `Student ${item.user_id}`, count: 1 })
  })
  const keep = <O extends GradingOption>(map: Map<number, O>, id: number | null | undefined, fallback: () => O) => {
    if (id && !map.has(id)) map.set(id, fallback())
  }
  keep(modules, filters.moduleId, () => {
    const known = items.find((item) => item.module_id === filters.moduleId)
    return { id: filters.moduleId!, label: known?.module_name || `Module ${filters.moduleId}`, count: 0, position: known?.module_position ?? Number.MAX_SAFE_INTEGER }
  })
  keep(students, filters.studentId, () => {
    const known = items.find((item) => item.user_id === filters.studentId)
    return { id: filters.studentId!, label: known?.user_name || `Student ${filters.studentId}`, count: 0 }
  })
  return {
    modules: Array.from(modules.values())
      .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label))
      .map((option): GradingOption => ({ id: option.id, label: option.label, count: option.count })),
    students: Array.from(students.values()).sort((a, b) => a.label.localeCompare(b.label)),
  }
}

export interface ModuleGridLink {
  cohortId: number
  cohortName: string
  moduleId: number
  moduleName: string
  /** Latest attempts waiting for review. */
  waiting: number
}

/**
 * "Grade by module" links (U-4.2): one per cohort and module that has any
 * submissions, with how many latest attempts are waiting. Modules with no
 * work are left out.
 */
export function moduleGridLinks<T extends GradingQueueItem>(items: T[]): ModuleGridLink[] {
  const latest = getLatestSubmissionIds(items)
  const links = new Map<string, ModuleGridLink & { position: number }>()
  items.forEach((item) => {
    if (!item.cohort_id || !item.module_id) return
    const key = `${item.cohort_id}:${item.module_id}`
    let link = links.get(key)
    if (!link) {
      link = {
        cohortId: item.cohort_id,
        cohortName: item.cohort_name || `Cohort ${item.cohort_id}`,
        moduleId: item.module_id,
        moduleName: item.module_name || `Module ${item.module_id}`,
        waiting: 0,
        position: item.module_position ?? Number.MAX_SAFE_INTEGER,
      }
      links.set(key, link)
    }
    if (latest.has(item.id) && item.grade === null) link.waiting += 1
  })
  return Array.from(links.values())
    .sort((a, b) => a.cohortName.localeCompare(b.cohortName) || a.position - b.position || a.moduleName.localeCompare(b.moduleName))
    .map((link): ModuleGridLink => ({ cohortId: link.cohortId, cohortName: link.cohortName, moduleId: link.moduleId, moduleName: link.moduleName, waiting: link.waiting }))
}

/** "5 h", "2 d", "3 wk" for a queue row; "now" under 5 minutes. */
export function waitingLabel(createdAt: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - time(createdAt)) / 60_000))
  if (minutes < 5) return 'now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return days < 28 ? `${days} d` : `${Math.floor(days / 7)} wk`
}

/** "Waiting 2 days" for the record header badge. */
export function waitingSentence(createdAt: string, now = Date.now()) {
  const hours = Math.max(0, Math.floor((now - time(createdAt)) / 3_600_000))
  if (hours < 1) return 'Waiting under an hour'
  if (hours < 24) return `Waiting ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const days = Math.floor(hours / 24)
  return `Waiting ${days} ${days === 1 ? 'day' : 'days'}`
}

/** Waiting a week or more: shown in the danger tone. */
export function waitingTooLong(createdAt: string, now = Date.now()) {
  return now - time(createdAt) >= 7 * 24 * 3_600_000
}

/** "Cohort 3 · Week 10", or "Python Fundamentals · self-paced". */
export function queueContextLabel(item: { cohort_name?: string | null; week_number?: number | null; course_delivery?: string | null }) {
  const cohort = item.cohort_name?.trim() || ''
  const where = item.course_delivery === 'self_paced' ? 'self-paced' : item.week_number ? `Week ${item.week_number}` : ''
  return [cohort, where].filter(Boolean).join(' · ')
}
