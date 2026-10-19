import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { isPostHogEnabled, withPostHog } from '../lib/posthogClient'

export { isPostHogEnabled }

/** Records a pageview per route change. PostHog itself loads lazily (see lib/posthogClient). */
export function PostHogPageView() {
  const location = useLocation()

  useEffect(() => {
    if (!isPostHogEnabled) return
    const url = `${window.location.origin}${location.pathname}`
    const pathname = location.pathname
    withPostHog((posthog) => {
      posthog.capture('$pageview', { $current_url: url, $pathname: pathname })
    })
  }, [location])

  return null
}
