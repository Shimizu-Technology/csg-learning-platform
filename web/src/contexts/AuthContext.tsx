import { brand } from '../lib/brand'
import { configureSchoolTime } from '../lib/schoolTime'
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { api, clearApiCache, setApiCacheScope, setAuthTokenGetter } from '../lib/api'
import { isPostHogEnabled, setPostHogIdentity } from '../lib/posthogClient'
import { isAccessDeniedResponse } from '../lib/sessionAccess'
import { clearComposerStateFromWindow } from '../lib/messageComposerState'
import { peekController } from '../lib/peekController'
import { clearRecordRelatedCache } from '../lib/recordRelatedCache'
import { clearRecordSummaryCache } from '../lib/recordSummary'
import { clearRecordQueueCache } from '../lib/recordQueueCache'
import { clearRosters } from '../lib/recordQueue'
import { clearViewerLocalDrafts } from '../pages/admin/lessonEditor/localDraft'
import { applyServerEditorPreferences } from '../lib/editorPreferences'
import type { SessionEnrollment, User } from '../types/api'

type UserData = User

/** Peek-card summaries, related panels, record queues and remembered rosters are one viewer's facts: drop them, and any open card, when the account changes. */
function forgetViewerSummaries() {
  clearRecordSummaryCache()
  clearRecordRelatedCache()
  clearRecordQueueCache()
  clearRosters()
  peekController.close()
}

interface AuthContextType {
  isSignedIn: boolean
  isLoading: boolean
  user: UserData | null
  schoolFeatures?: Record<string, boolean>
  enrollments: SessionEnrollment[]
  sessionError: string | null
  sessionErrorCode?: string | null
  accessDenied: boolean
  syncSession: () => Promise<boolean>
  signOut?: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  isSignedIn: false,
  isLoading: true,
  user: null,
  enrollments: [],
  sessionError: null,
  sessionErrorCode: null,
  accessDenied: false,
  syncSession: async () => false,
  signOut: async () => {},
})

export function useAuthContext() {
  return useContext(AuthContext)
}

function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn, signOut: clerkSignOut } = useAuth()
  const { user: clerkUser } = useUser()
  const [user, setUser] = useState<UserData | null>(null)
  const [schoolFeatures, setSchoolFeatures] = useState<Record<string, boolean>>({})
  const [enrollments, setEnrollments] = useState<SessionEnrollment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [sessionErrorCode, setSessionErrorCode] = useState<string | null>(null)
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
    if (scope !== cacheScopeRef.current) forgetViewerSummaries()
    cacheScopeRef.current = scope
    setApiCacheScope(scope)
  }, [clerkUserId])

  const syncSession = useCallback(async () => {
    if (!isSignedIn) return false
    const requestGeneration = ++sessionRequestGenerationRef.current

    try {
      const res = await api.createSession()
      if (requestGeneration !== sessionRequestGenerationRef.current) return false
      if (res.data?.user) {
        if (applicationUserIdRef.current !== res.data.user.id) {
          forgetViewerSummaries()
          // Another account took over this browser: the last one's unsaved lesson backups go.
          if (applicationUserIdRef.current !== null) clearViewerLocalDrafts(applicationUserIdRef.current)
        }
        applicationUserIdRef.current = res.data.user.id
        configureSchoolTime(res.data.school)
        setSchoolFeatures(res.data.school?.features || {})
        // Before any editor opens: the account's editor mode and Enter-to-send become this browser's.
        applyServerEditorPreferences(res.data.user.id, res.data.user.editor_preferences)
        setUser(res.data.user)
        setEnrollments(res.data.enrollments)
        setAccessDenied(false)
        setSessionError(null)
        setSessionErrorCode(null)
        if (isPostHogEnabled) {
          const activeCohortId = res.data.enrollments.find((enrollment) => enrollment.status === 'active')?.cohort.id
          setPostHogIdentity({
            kind: 'user',
            id: String(res.data.user.id),
            properties: { role: res.data.user.role, ...(activeCohortId ? { cohort_id: activeCohortId } : {}) },
          })
        }
        return true
      }

      const denied = isAccessDeniedResponse(res)
      setUser(null)
      setEnrollments([])
      setAccessDenied(denied)
      if (denied && cacheScopeRef.current) clearApiCache(cacheScopeRef.current)
      setSessionErrorCode(res.errorCode ?? null)
      setSessionError(res.error || `Could not connect to your ${brand.schoolAbbreviation} account. Check your connection and try again.`)
      return false
    } catch (err) {
      if (requestGeneration !== sessionRequestGenerationRef.current) return false
      console.error('Session sync failed:', err)
      setUser(null)
      setEnrollments([])
      setAccessDenied(false)
      setSessionErrorCode(null)
      setSessionError(err instanceof Error ? err.message : `Could not connect to your ${brand.schoolAbbreviation} account.`)
      return false
    }
  }, [isSignedIn])

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      sessionRequestGenerationRef.current += 1
      const signedOutUserId = applicationUserIdRef.current
      applicationUserIdRef.current = null
      forgetViewerSummaries()
      if (signedOutUserId && typeof window !== 'undefined') clearComposerStateFromWindow(signedOutUserId, window)
      // Unsaved lesson backups leave with the viewer; pending backup writes are cancelled.
      clearViewerLocalDrafts(signedOutUserId)
      setUser(null)
      setEnrollments([])
      setSessionError(null)
      setSessionErrorCode(null)
      setAccessDenied(false)
      setIsLoading(false)
      // Signed out: drop any identity persisted from an earlier session before
      // queued events flush. Recording it does not load analytics by itself.
      if (isPostHogEnabled) setPostHogIdentity({ kind: 'anonymous' })
      return
    }

    syncSession().finally(() => setIsLoading(false))
  }, [isLoaded, isSignedIn, clerkUserId, syncSession])

  const signOut = useCallback(async () => {
    await clerkSignOut?.({ redirectUrl: '/sign-in' })
  }, [clerkSignOut])

  return (
    <AuthContext.Provider
      value={{
        isSignedIn: isSignedIn ?? false,
        isLoading: !isLoaded || isLoading,
        user,
        enrollments,
        schoolFeatures,
        sessionError,
        sessionErrorCode,
        accessDenied,
        syncSession,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <ClerkAuthProvider>{children}</ClerkAuthProvider>
}
