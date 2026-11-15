import type { ActivityEvent } from '../types/api'
import { toWebPath } from './recordDestination'
import { safeInternalReturnPath, submissionPath } from './routes'
export function activityDestination(event: ActivityEvent, returnTo: string, preserveReturn = false) {
  const target = event.destination
  if (!target || event.event_type === 'account_signed_in') return null
  const canonical = toWebPath(target)
  if (!canonical && target.kind === 'submission' && target.submission_id) return submissionPath(target.submission_id, { cohortId: target.cohort_id, userId: target.student_id, returnTo })
  const path = canonical || safeInternalReturnPath(target.destination_path || null, '')
  if (!path) return null
  if (!preserveReturn && target.kind !== 'submission') return path
  const url = new URL(path, 'https://csg.invalid')
  url.searchParams.set('return_to', returnTo)
  return `${url.pathname}${url.search}${url.hash}`
}
