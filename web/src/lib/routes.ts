export type StudentWorkspaceTab = 'overview' | 'work' | 'learning' | 'support' | 'communication' | 'access'

export function cohortPath(cohortId: number) {
  return `/admin/cohorts/${cohortId}`
}

export function cohortStudentPath(cohortId: number, userId: number, tab: StudentWorkspaceTab = 'overview') {
  return `${cohortPath(cohortId)}/students/${userId}/${tab}`
}

export function submissionPath(
  submissionId: number,
  context: { cohortId?: number; userId?: number; returnTo?: string } = {},
) {
  const params = new URLSearchParams()
  if (context.cohortId) params.set('cohort_id', String(context.cohortId))
  if (context.userId) params.set('student_id', String(context.userId))
  if (context.returnTo) params.set('return_to', context.returnTo)
  const query = params.toString()
  return `/admin/submissions/${submissionId}${query ? `?${query}` : ''}`
}

export function safeInternalReturnPath(value: string | null, fallback: string) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : fallback
}
