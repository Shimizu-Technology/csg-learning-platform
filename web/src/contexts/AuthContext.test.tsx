// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuthContext } from './AuthContext'
import { localDraftGeneration, localDraftKey, writeLocalDraft } from '../pages/admin/lessonEditor/localDraft'

const authState = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  clerkUserId: 'clerk-user',
}))
const createSession = vi.hoisted(() => vi.fn())

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue('token'),
    isLoaded: authState.isLoaded,
    isSignedIn: authState.isSignedIn,
  }),
  useUser: () => ({ user: authState.clerkUserId ? { id: authState.clerkUserId } : null }),
}))

vi.mock('../lib/api', () => ({
  api: { createSession },
  clearApiCache: vi.fn(),
  setApiCacheScope: vi.fn(),
  setAuthTokenGetter: vi.fn(),
}))

const clearRecordSummaryCache = vi.hoisted(() => vi.fn())
vi.mock('../lib/recordSummary', () => ({ clearRecordSummaryCache }))
const clearRecordRelatedCache = vi.hoisted(() => vi.fn())
vi.mock('../lib/recordRelatedCache', () => ({ clearRecordRelatedCache }))

const setPostHogIdentity = vi.hoisted(() => vi.fn())
vi.mock('../lib/posthogClient', () => ({ isPostHogEnabled: true, setPostHogIdentity }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

function SessionProbe({
  onUser,
  onError = () => undefined,
  onEnrollmentIds = () => undefined,
}: {
  onUser: (userId: number | null) => void
  onError?: (error: string | null) => void
  onEnrollmentIds?: (enrollmentIds: number[]) => void
}) {
  const { user, enrollments, sessionError } = useAuthContext()
  useEffect(() => { onUser(user?.id ?? null) }, [onUser, user])
  useEffect(() => { onError(sessionError) }, [onError, sessionError])
  useEffect(() => { onEnrollmentIds(enrollments.map((enrollment) => enrollment.id)) }, [enrollments, onEnrollmentIds])
  return null
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  authState.isLoaded = true
  authState.isSignedIn = true
  authState.clerkUserId = 'clerk-user'
  createSession.mockReset()
  setPostHogIdentity.mockReset()
  clearRecordSummaryCache.mockReset()
  clearRecordRelatedCache.mockReset()
})

describe('AuthProvider session lifecycle', () => {
  it('keeps session enrollments available for cohort-aware navigation', async () => {
    createSession.mockResolvedValue({
      data: {
        user: { id: 41, role: 'student' },
        enrollments: [{
          id: 17,
          cohort: { id: 9, name: 'CSG Alumni', cohort_type: 'alumni', start_date: '2026-09-26', status: 'active' },
          status: 'active',
          enrolled_at: '2026-09-26T00:00:00Z',
        }],
      },
      error: null,
    })
    const seenEnrollmentIds: number[][] = []
    const onEnrollmentIds = (ids: number[]) => seenEnrollmentIds.push(ids)
    container = document.createElement('div')
    root = createRoot(container)

    await act(async () => {
      root?.render(<AuthProvider><SessionProbe onUser={() => undefined} onEnrollmentIds={onEnrollmentIds} /></AuthProvider>)
      await Promise.resolve()
    })

    expect(seenEnrollmentIds.at(-1)).toEqual([17])
  })

  it('ignores a session response that resolves after sign-out', async () => {
    let resolveSession: ((value: unknown) => void) | undefined
    createSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve }))
    const seenUserIds: Array<number | null> = []
    const onUser = (userId: number | null) => seenUserIds.push(userId)
    container = document.createElement('div')
    root = createRoot(container)

    await act(async () => {
      root?.render(<AuthProvider><SessionProbe onUser={onUser} /></AuthProvider>)
    })
    expect(createSession).toHaveBeenCalledOnce()

    authState.isSignedIn = false
    authState.clerkUserId = ''
    await act(async () => {
      root?.render(<AuthProvider><SessionProbe onUser={onUser} /></AuthProvider>)
    })

    await act(async () => {
      resolveSession?.({
        data: {
          user: { id: 41, role: 'student' },
          enrollments: [],
        },
        error: null,
      })
      await Promise.resolve()
    })

    expect(seenUserIds.at(-1)).toBeNull()
    expect(seenUserIds).not.toContain(41)
  })

  it('ignores a session failure that rejects after sign-out', async () => {
    let rejectSession: ((reason?: unknown) => void) | undefined
    createSession.mockReturnValue(new Promise((_resolve, reject) => { rejectSession = reject }))
    const seenErrors: Array<string | null> = []
    const onUser = () => undefined
    const onError = (error: string | null) => seenErrors.push(error)
    container = document.createElement('div')
    root = createRoot(container)

    await act(async () => {
      root?.render(<AuthProvider><SessionProbe onUser={onUser} onError={onError} /></AuthProvider>)
    })
    expect(createSession).toHaveBeenCalledOnce()

    authState.isSignedIn = false
    authState.clerkUserId = ''
    await act(async () => {
      root?.render(<AuthProvider><SessionProbe onUser={onUser} onError={onError} /></AuthProvider>)
    })

    await act(async () => {
      rejectSession?.(new Error('Late network failure'))
      await Promise.resolve()
    })

    expect(seenErrors.at(-1)).toBeNull()
    expect(seenErrors).not.toContain('Late network failure')
  })

  it('keeps accessDenied visible while a retry syncSession is in flight and clears it only after success', async () => {
    createSession.mockResolvedValueOnce({
      data: null,
      error: 'Not invited yet',
      status: 403,
      errorCode: 'account_not_authorized',
    })
    let resolveRetry: ((value: unknown) => void) | undefined
    createSession.mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve }))

    const seenDenied: boolean[] = []
    let triggerSync: (() => Promise<boolean>) | undefined
    function AccessDeniedProbe() {
      const { accessDenied, syncSession } = useAuthContext()
      useEffect(() => { seenDenied.push(accessDenied) }, [accessDenied])
      useEffect(() => { triggerSync = syncSession }, [syncSession])
      return null
    }

    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(<AuthProvider><AccessDeniedProbe /></AuthProvider>)
      await Promise.resolve()
    })
    expect(seenDenied.at(-1)).toBe(true)

    let retryPromise: Promise<boolean> | undefined
    await act(async () => {
      retryPromise = triggerSync?.()
      await Promise.resolve()
    })
    // Denial must stay true while retry is in flight so AccessDeniedCard never unmounts prematurely.
    expect(seenDenied.at(-1)).toBe(true)

    await act(async () => {
      resolveRetry?.({
        data: { user: { id: 41, role: 'student' }, enrollments: [] },
        error: null,
      })
      await retryPromise
    })
    expect(seenDenied.at(-1)).toBe(false)
  })
})

describe('AuthProvider analytics identity', () => {
  async function renderProvider() {
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(<AuthProvider><SessionProbe onUser={() => undefined} /></AuthProvider>)
      await Promise.resolve()
    })
  }

  const userIdentities = () => setPostHogIdentity.mock.calls.map(([identity]) => identity).filter((identity) => identity.kind === 'user')

  it('reports the signed-in application user with role and active cohort', async () => {
    createSession.mockResolvedValue({
      data: {
        user: { id: 41, role: 'student' },
        enrollments: [{ id: 17, cohort: { id: 9, name: 'Pilot', cohort_type: 'workshop', start_date: '2026-12-01', status: 'active' }, status: 'active', enrolled_at: '2026-12-01T00:00:00Z' }],
      },
      error: null,
    })
    await renderProvider()
    expect(setPostHogIdentity).toHaveBeenCalledWith({ kind: 'user', id: '41', properties: { role: 'student', cohort_id: 9 } })
  })

  it('reports an anonymous identity when Clerk is signed out', async () => {
    authState.isSignedIn = false
    authState.clerkUserId = ''
    await renderProvider()
    expect(setPostHogIdentity).toHaveBeenCalledWith({ kind: 'anonymous' })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('does not report a user identity when the session request fails', async () => {
    createSession.mockResolvedValue({ data: null, error: 'Network down', status: 0 })
    await renderProvider()
    expect(userIdentities()).toEqual([])
  })

  it('does not report a user identity when the account is not on the class list', async () => {
    createSession.mockResolvedValue({ data: null, error: 'No access', status: 403, errorCode: 'account_not_authorized' })
    await renderProvider()
    expect(userIdentities()).toEqual([])
  })

  it('forgets peek-card summaries and related panels when the account switches or signs out', async () => {
    createSession.mockResolvedValueOnce({ data: { user: { id: 41, role: 'student' }, enrollments: [] }, error: null })
    const onUser = () => undefined
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(<AuthProvider><SessionProbe onUser={onUser} /></AuthProvider>)
    })
    clearRecordSummaryCache.mockClear()
    clearRecordRelatedCache.mockClear()

    authState.clerkUserId = 'other-clerk-user'
    createSession.mockResolvedValueOnce({ data: { user: { id: 42, role: 'student' }, enrollments: [] }, error: null })
    await act(async () => {
      root?.render(<AuthProvider><SessionProbe onUser={onUser} /></AuthProvider>)
    })
    expect(clearRecordSummaryCache).toHaveBeenCalled()
    expect(clearRecordRelatedCache).toHaveBeenCalled()

    clearRecordSummaryCache.mockClear()
    clearRecordRelatedCache.mockClear()
    authState.isSignedIn = false
    authState.clerkUserId = ''
    await act(async () => {
      root?.render(<AuthProvider><SessionProbe onUser={onUser} /></AuthProvider>)
    })
    expect(clearRecordSummaryCache).toHaveBeenCalled()
    expect(clearRecordRelatedCache).toHaveBeenCalled()
  })
})

describe('AuthProvider lesson editor backups', () => {
  const backup = { savedAt: 1, baseUpdatedAt: '2026-11-16T00:00:00.000000Z', draft: { title: 'Private draft', required: true, release_day: 0, blocks: [], removed_block_ids: [], alignments: [] } }
  const render = async () => {
    await act(async () => {
      root?.render(<AuthProvider><SessionProbe onUser={() => undefined} /></AuthProvider>)
    })
  }

  afterEach(() => window.localStorage.clear())

  it('removes the departing viewer\'s unsaved lesson backups on sign-out and drops backups still waiting to be written', async () => {
    createSession.mockResolvedValueOnce({ data: { user: { id: 41, role: 'admin' }, enrollments: [] }, error: null })
    container = document.createElement('div')
    root = createRoot(container)
    await render()

    window.localStorage.setItem(localDraftKey(41, 2), JSON.stringify(backup))
    window.localStorage.setItem(localDraftKey(41, 3), JSON.stringify(backup))
    window.localStorage.setItem(localDraftKey(77, 2), JSON.stringify(backup))
    window.localStorage.setItem('csg:unrelated', 'kept')
    // The editor's backup timer was scheduled before sign-out and fires after it.
    const scheduledIn = localDraftGeneration()

    authState.isSignedIn = false
    authState.clerkUserId = ''
    await render()
    writeLocalDraft(localDraftKey(41, 4), backup, scheduledIn)

    expect(window.localStorage.getItem(localDraftKey(41, 2))).toBeNull()
    expect(window.localStorage.getItem(localDraftKey(41, 3))).toBeNull()
    expect(window.localStorage.getItem(localDraftKey(41, 4))).toBeNull()
    expect(window.localStorage.getItem(localDraftKey(77, 2))).not.toBeNull()
    expect(window.localStorage.getItem('csg:unrelated')).toBe('kept')
  })

  it('removes every lesson backup when the viewer signs out before their session loads', async () => {
    window.localStorage.setItem(localDraftKey(41, 2), JSON.stringify(backup))
    createSession.mockReturnValueOnce(new Promise(() => undefined))
    container = document.createElement('div')
    root = createRoot(container)
    await render()

    authState.isSignedIn = false
    authState.clerkUserId = ''
    await render()

    expect(window.localStorage.getItem(localDraftKey(41, 2))).toBeNull()
  })

  it('removes the previous viewer\'s backups when another account signs in', async () => {
    createSession.mockResolvedValueOnce({ data: { user: { id: 41, role: 'admin' }, enrollments: [] }, error: null })
    container = document.createElement('div')
    root = createRoot(container)
    await render()
    window.localStorage.setItem(localDraftKey(41, 2), JSON.stringify(backup))

    authState.clerkUserId = 'other-clerk-user'
    createSession.mockResolvedValueOnce({ data: { user: { id: 42, role: 'admin' }, enrollments: [] }, error: null })
    await render()

    expect(window.localStorage.getItem(localDraftKey(41, 2))).toBeNull()
    writeLocalDraft(localDraftKey(42, 2), backup)
    expect(window.localStorage.getItem(localDraftKey(42, 2))).not.toBeNull()
  })
})
