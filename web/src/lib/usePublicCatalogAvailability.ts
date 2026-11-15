import { useEffect, useRef, useState } from 'react'
import { api } from './api'

/** Public school preference with automatic checkout availability as the default. */
export function usePublicCatalogAvailability() {
  const [available, setAvailable] = useState(false)
  const request = useRef<ReturnType<typeof api.getCourseOfferings> | null>(null)

  useEffect(() => {
    let active = true
    // Reuse the request if StrictMode replays the effect. No auth dependency or polling.
    request.current ??= api.getCourseOfferings()
    request.current.then((result) => {
      if (active) {
        setAvailable(!result.error && result.data?.public_catalog_mode !== 'hidden' && (result.data?.public_catalog_mode === 'always' || !!result.data?.offerings.some((offering) => offering.checkout_available === true)))
      }
    }).catch(() => {
      if (active) setAvailable(false)
    })
    return () => { active = false }
  }, [])

  return available
}
