import { useEffect, useState } from 'react'
import { ClerkFailed, ClerkLoading } from '@clerk/clerk-react'
import { RefreshCw, WifiOff } from 'lucide-react'
import { Button } from '../ui/Button'
import { SLOW_LOADING_MS } from '../shared/LoadingSpinner'

function SlowOrFailed({ failed = false }: { failed?: boolean }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md border border-warning-200 bg-warning-50 p-4 text-sm text-warning-800">
      <p className="flex items-start gap-2">
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{failed ? 'Sign-in could not load.' : 'Sign-in is taking longer than usual.'} Check your connection, then reload.</span>
      </p>
      <Button variant="secondary" shape="brand" className="self-start" onClick={() => window.location.reload()}>
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Reload
      </Button>
    </div>
  )
}

/** Placeholder while Clerk's widget script loads (it comes from Clerk's CDN), with a reload offer if it stalls. */
export function AuthWidgetLoading() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOADING_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-4 rounded-md border border-brand-line bg-surface-raised p-6 sm:p-8">
      <span className="sr-only">Loading sign-in</span>
      <div aria-hidden="true" className="h-7 w-48 animate-pulse rounded bg-brand-cream-sunken motion-reduce:animate-none" />
      <div aria-hidden="true" className="h-4 w-64 max-w-full animate-pulse rounded bg-brand-cream motion-reduce:animate-none" />
      <div aria-hidden="true" className="h-12 w-full animate-pulse rounded-md bg-brand-cream motion-reduce:animate-none" />
      <div aria-hidden="true" className="h-12 w-full animate-pulse rounded-md bg-brand-cream-sunken motion-reduce:animate-none" />
      {slow && <SlowOrFailed />}
    </div>
  )
}

export function AuthWidgetStatus() {
  return (
    <>
      <ClerkLoading><AuthWidgetLoading /></ClerkLoading>
      <ClerkFailed><SlowOrFailed failed /></ClerkFailed>
    </>
  )
}
