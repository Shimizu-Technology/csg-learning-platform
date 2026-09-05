import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import posthog from 'posthog-js'
import { api, clearApiCache, setApiCacheScope, setAuthTokenGetter } from '../lib/api'
import { isPostHogEnabled } from '../providers/PostHogProvider'
import { isAccessDeniedResponse } from '../lib/sessionAccess'
import { clearComposerStateFromWindow } from '../lib/messageComposerState'
import type { User } from '../types/api'

type UserData = User

interface AuthContextType {
  isSignedIn: boolean
  isLoading: boolean
  user: UserData | null
  sessionError: string | null
  accessDenied: boolean
  syncSession: () => Promise<boolean>
}

const AuthContext = createContext<AuthContextType>({
  isSignedIn: false,
  isLoading: true,
  user: null,
  sessionError: null,
  accessDenied: false,
  syncSession: async () => false,
})

export function useAuthContext() {
  return useContext(AuthContext)
}

function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const { user: clerkUser } = useUser()
  const [user, setUser] = useState<UserData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const clerkUserId = clerkUser?.id
  const cacheScopeRef = useRef<string | null>(null)
  const applicationUserIdRef = useRef<number | null>(null)
  const sessionRequestGenerationRef = useRef(0)

  useEffect(() => {
    setAuthTokenGetter(async (forceRefresh = false) => {
      try {
        return await getToken({ skipCache: forceRefresh })
      } catch {
        return null
      }
    })
  }, [getToken])

  useEffect(() => {
    const scope = clerkUserId ? `clerk:${clerkUserId}` : null
    if (!scope && cacheScopeRef.current) {
      clearApiCache(cacheScopeRef.current)
    }
    cacheScopeRef.current = scope
    setApiCacheScope(scope)
  }, [clerkUserId])

  const syncSession = useCallback(async () => {
    if (!isSignedIn) return false
    const requestGeneration = ++sessionRequestGenerationRef.current
    setSessionError(null)
    setAccessDenied(false)

    try {
      const res = await api.createSession()
      if (requestGeneration !== sessionRequestGenerationRef.current) return false
      if (res.data?.user) {
        applicationUserIdRef.current = res.data.user.id
        setUser(res.data.user)
        if (isPostHogEnabled) {
          const activeCohortId = res.data.enrollments.find((enrollment) => enrollment.status === 'active')?.cohort.id
          posthog.identify(String(res.data!.user.id), {
            role: res.data!.user.role,
            ...(activeCohortId ? { cohort_id: activeCohortId } : {}),
          })
        }
        return true
      }

      const denied = isAccessDeniedResponse(res)
      setUser(null)
      setAccessDenied(denied)
      if (denied && cacheScopeRef.current) clearApiCache(cacheScopeRef.current)
      setSessionError(res.error || 'Could not connect to your CSG account. Check your connection and try again.')
      return false
    } catch (err) {
      console.error('Session sync failed:', err)
      setUser(null)
      setAccessDenied(false)
      setSessionError(err instanceof Error ? err.message : 'Could not connect to your CSG account.')
      return false
    }
  }, [isSignedIn])

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      sessionRequestGenerationRef.current += 1
      const signedOutUserId = applicationUserIdRef.current
      applicationUserIdRef.current = null
      if (signedOutUserId && typeof window !== 'undefined') clearComposerStateFromWindow(signedOutUserId, window)
      setUser(null)
      setSessionError(null)
      setAccessDenied(false)
      setIsLoading(false)
      if (isPostHogEnabled) {
        posthog.reset()
      }
      return
    }

    syncSession().finally(() => setIsLoading(false))
  }, [isLoaded, isSignedIn, clerkUserId, syncSession])

  return (
    <AuthContext.Provider
      value={{
        isSignedIn: isSignedIn ?? false,
        isLoading: !isLoaded || isLoading,
        user,
        sessionError,
        accessDenied,
        syncSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <ClerkAuthProvider>{children}</ClerkAuthProvider>
}
