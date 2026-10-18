export interface SubmissionDraft {
  version: 1
  text?: string
  repoUrl?: string
  prUrl?: string
  liveUrl?: string
  branch?: string
  commitSha?: string
  notes?: string
  savedAt: string
}

const PREFIX = 'csg-learn:submission-draft:v1'

export function submissionDraftKey(scope: { userId?: number | null; cohortId?: number | null; blockId: number }) {
  return `${PREFIX}:${scope.userId ?? 'me'}:${scope.cohortId ?? 'none'}:${scope.blockId}`
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readSubmissionDraft(key: string, store: Storage | null = storage()): SubmissionDraft | null {
  try {
    const raw = store?.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SubmissionDraft
    return parsed && parsed.version === 1 && typeof parsed.savedAt === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function hasDraftContent(draft: Omit<SubmissionDraft, 'version' | 'savedAt'>) {
  return Object.values(draft).some((value) => typeof value === 'string' && value.trim().length > 0)
}

export function writeSubmissionDraft(key: string, draft: Omit<SubmissionDraft, 'version' | 'savedAt'>, store: Storage | null = storage()) {
  try {
    if (!hasDraftContent(draft)) {
      store?.removeItem(key)
      return
    }
    store?.setItem(key, JSON.stringify({ ...draft, version: 1, savedAt: new Date().toISOString() }))
  } catch {
    // Private browsing or a full quota: the in-memory draft still works.
  }
}

export function clearSubmissionDraft(key: string, store: Storage | null = storage()) {
  try {
    store?.removeItem(key)
  } catch {
    // Ignore storage failures.
  }
}
