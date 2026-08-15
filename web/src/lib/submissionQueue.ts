export type SubmissionQueueFilter = 'ungraded' | 'redo' | 'all'

interface QueueSubmission {
  id: number
  user_id: number
  content_block_id: number
  grade: string | null
  created_at: string
}

export function orderSubmissionQueue<T extends QueueSubmission>(submissions: T[], filter: SubmissionQueueFilter) {
  const latestIds = getLatestSubmissionIds(submissions)

  return submissions.filter((submission) => {
    if (filter === 'ungraded') return submission.grade === null
    if (filter === 'redo') return submission.grade === 'R'
    return true
  }).sort((a, b) => {
    const aLatest = latestIds.has(a.id)
    const bLatest = latestIds.has(b.id)
    if (aLatest !== bLatest) return aLatest ? -1 : 1
    return compareNewestFirst(a, b)
  })
}

export function getLatestSubmissionIds<T extends QueueSubmission>(submissions: T[]) {
  const latestByAssignment = new Map<string, T>()
  submissions.forEach((submission) => {
    const key = `${submission.user_id}:${submission.content_block_id}`
    const current = latestByAssignment.get(key)
    if (!current || compareNewestFirst(submission, current) < 0) latestByAssignment.set(key, submission)
  })
  return new Set(Array.from(latestByAssignment.values(), (submission) => submission.id))
}

function compareNewestFirst(a: QueueSubmission, b: QueueSubmission) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id
}
