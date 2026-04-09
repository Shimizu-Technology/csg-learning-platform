import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import posthog from 'posthog-js'
import { api, setAuthTokenGetter } from '../lib/api'
import { isPostHogEnabled } from '../providers/PostHogProvider'
import type { User } from '../types/api'

type UserData = User

interface AuthContextType {
  isClerkEnabled: boolean
  isSignedIn: boolean
  isLoading: boolean
  user: UserData | null
  syncSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  isClerkEnabled: false,
  isSignedIn: false,
  isLoading: true,
  user: null,
  syncSession: async () => {},
})

export function useAuthContext() {
  return useContext(AuthContext)
}

function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const { user: clerkUser } = useUser()
  const [user, setUser] = useState<UserData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        return await getToken()
      } catch {
        return null
      }
    })
  }, [getToken])

  const syncSession = useCallback(async () => {
    if (!isSignedIn) return
    try {
      const res = await api.createSession()
      if (res.data?.user) {
        setUser(res.data.user)
        if (isPostHogEnabled) {
          posthog.identify(String(res.data!.user.id), {
            email: res.data!.user.email,
            name: res.data!.user.full_name,
            role: res.data!.user.role,
          })
        }
      }
    } catch (err) {
      console.error('Session sync failed:', err)
    }
  }, [isSignedIn])

  const clerkUserId = clerkUser?.id
  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      setUser(null)
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
        isClerkEnabled: true,
        isSignedIn: isSignedIn ?? false,
        isLoading: !isLoaded || isLoading,
        user,
        syncSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

function NoAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const syncSession = useCallback(async () => {
    try {
      const res = await api.createSession()
      if (res.data?.user) setUser(res.data.user)
    } catch (err) {
      console.error('Dev session sync failed:', err)
    }
  }, [])

  useEffect(() => {
    setAuthTokenGetter(async () => 'dev_bypass_token')
    syncSession().finally(() => setIsLoading(false))
  }, [syncSession])

  return (
    <AuthContext.Provider
      value={{
        isClerkEnabled: false,
        isSignedIn: !!user,
        isLoading,
        user,
        syncSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

interface AuthProviderProps {
  children: ReactNode
  isClerkEnabled: boolean
}

export function AuthProvider({ children, isClerkEnabled }: AuthProviderProps) {
  if (isClerkEnabled) {
    return <ClerkAuthProvider>{children}</ClerkAuthProvider>
  }
  return <NoAuthProvider>{children}</NoAuthProvider>
}
