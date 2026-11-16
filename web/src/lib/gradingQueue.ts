import type { SubmissionQueueFilter } from './submissionQueue'

/*
 * The Grading workbench's queue (U-4.1, U-4.5). Its filters live in the
 * Grading page URL, and a submission record opened from it reads them back from
 * its return path (gradingQueueSource), so both walk the same list in the same
 * order. The list, its counts and its filter options come one page at a time
 * from GET /grading_queue (useGradingQueue); this file keeps the row labels.
 */

export type GradingSort = 'oldest' | 'newest'

export interface GradingFilters {
  filter: SubmissionQueueFilter
  moduleId?: number | null
  studentId?: number | null
  lessonId?: number | null
  sort?: GradingSort
}

function time(value: string) {
  const at = new Date(value).getTime()
  return Number.isNaN(at) ? 0 : at
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
