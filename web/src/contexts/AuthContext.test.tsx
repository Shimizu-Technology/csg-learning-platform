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

function SessionProbe({ onUser }: { onUser: (userId: number | null) => void }) {
  const { user } = useAuthContext()
  useEffect(() => { onUser(user?.id ?? null) }, [onUser, user])
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
})
