export type StudentWorkspaceTab = 'overview' | 'work' | 'learning' | 'support' | 'communication' | 'access'

export function cohortPath(cohortId: number) {
  return `/admin/cohorts/${cohortId}`
}

export function cohortStudentPath(cohortId: number, userId: number, tab: StudentWorkspaceTab = 'overview') {
  return `${cohortPath(cohortId)}/students/${userId}/${tab}`
}

export function submissionPath(
  submissionId: number,
  context: { cohortId?: number; userId?: number; returnTo?: string; queue?: 'ungraded' | 'redo' | 'all' } = {},
) {
  const params = new URLSearchParams()
  if (context.cohortId) params.set('cohort_id', String(context.cohortId))
  if (context.userId) params.set('student_id', String(context.userId))
  if (context.returnTo) params.set('return_to', context.returnTo)
  if (context.queue) params.set('queue', context.queue)
  const query = params.toString()
  return `/admin/submissions/${submissionId}${query ? `?${query}` : ''}`
}

export function helpRequestPath(helpRequestId: number, returnTo?: string) {
  const params = new URLSearchParams()
  if (returnTo) params.set('return_to', returnTo)
  const query = params.toString()
  return `/admin/help-requests/${helpRequestId}${query ? `?${query}` : ''}`
}

export function directMessagePath(
  conversationId: number,
  source?: { type: 'submission' | 'help_request'; id: number; label: string },
) {
  const params = new URLSearchParams()
  if (source) {
    params.set('source_type', source.type)
    params.set('source_id', String(source.id))
    params.set('source_label', source.label)
  }
  const query = params.toString()
  return `/messages/dm/${conversationId}${query ? `?${query}` : ''}`
}

export function safeInternalReturnPath(value: string | null, fallback: string) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : fallback
}
