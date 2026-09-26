// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuthContext } from './AuthContext'

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

vi.mock('../providers/PostHogProvider', () => ({ isPostHogEnabled: false }))
vi.mock('posthog-js', () => ({ default: { identify: vi.fn(), reset: vi.fn() } }))

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
})
