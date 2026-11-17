import { useAuthContext } from '../contexts/AuthContext'
import { api } from './api'
import { useStaffResource } from './useStaffResource'
import { TERMS } from './glossary'
import type { CurriculumUsage, LessonUsage, ModuleUsage } from '../types/api'

/*
 * Where content is used (L-3.2, L-5): the staff curriculum, module and lesson
 * pages and the lesson editor's "Used in" panel read
 * GET /api/v1/records/:type/:id/usage. The server lists only cohorts the
 * viewer can see; others arrive as `other_cohorts_count`, never by name.
 */

export type UsageType = 'curriculum' | 'module' | 'lesson'
type UsageFor<T extends UsageType> = T extends 'curriculum' ? CurriculumUsage : T extends 'module' ? ModuleUsage : LessonUsage

export interface UsageState<T> {
  usage: T | null
  loading: boolean
  error: string | null
  /** True when the server answered 404: no such record, or the viewer may not see it. */
  missing: boolean
  reload: () => Promise<void>
}

/**
 * Loads one record's usage for the signed-in viewer. Scoped by viewer and
 * record, so another account (or record) never sees the previous answer.
 * `id` null waits.
 */
export function useRecordUsage<T extends UsageType>(type: T, id: number | null | undefined): UsageState<UsageFor<T>> {
  const viewerId = useAuthContext().user?.id ?? ''
  const valid = typeof id === 'number' && Number.isInteger(id) && id > 0
  const scope = valid ? `${viewerId}|usage:${type}:${id}` : 'none'
  const { data, loading, error, reload } = useStaffResource<{ usage: UsageFor<T> | null; missing: boolean }>(scope, async () => {
    if (!valid) return { data: { usage: null, missing: true } }
    const result = await api.getRecordUsage(type, id)
    if (result.status === 404 || result.status === 403) return { data: { usage: null, missing: true } }
    const usage = result.data?.usage
    // A body for another record type is treated as missing, never shown on the wrong page.
    if (usage && usage.type !== type) return { data: { usage: null, missing: true } }
    return { data: usage ? { usage: usage as UsageFor<T>, missing: false } : null, error: result.error }
  })
  return { usage: data?.usage ?? null, missing: Boolean(data?.missing), loading, error, reload }
}

/** "Live program", "Self-paced", with the cohort workspace's label for guided courses. */
export function deliveryLabel(delivery: string) {
  if (delivery === 'self_paced') return TERMS.selfPaced
  if (delivery === 'guided') return 'Focused course with meetings'
  return TERMS.liveProgram
}

/** Grading filtered to one cohort and, optionally, one module or lesson (GET /grading_queue filters, #281). */
export function gradingPath(filters: { cohortId?: number | null; moduleId?: number | null; lessonId?: number | null; all?: boolean }) {
  const params = new URLSearchParams()
  if (filters.cohortId) params.set('cohort_id', String(filters.cohortId))
  if (filters.moduleId) params.set('module_id', String(filters.moduleId))
  if (filters.lessonId) params.set('lesson_id', String(filters.lessonId))
  if (filters.all) params.set('filter', 'all')
  const query = params.toString()
  return `/admin/grading${query ? `?${query}` : ''}`
}

/** Support, scoped to one cohort. */
export function supportPath(cohortId?: number | null) {
  return `/admin/support${cohortId ? `?cohort_id=${cohortId}` : ''}`
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** "2 other cohorts use this curriculum": the cohorts an instructor doesn't teach, as a number only. */
export function otherCohortsLine(count: number) {
  if (!count) return null
  return `${plural(count, 'other cohort')} ${count === 1 ? 'uses' : 'use'} this curriculum. You don't teach ${count === 1 ? 'it' : 'them'}, so ${count === 1 ? 'it isn’t' : 'they aren’t'} listed or counted here.`
}
