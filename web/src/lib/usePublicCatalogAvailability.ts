import { useEffect, useRef, useState } from 'react'
import { api, type PublicCourse } from './api'

/** Public school preference with automatic checkout availability as the default. */
export function usePublicCatalogAvailability(onOfferings?: (offerings: PublicCourse[]) => void) {
  const [available, setAvailable] = useState(false)
  const request = useRef<ReturnType<typeof api.getCourseOfferings> | null>(null)

  useEffect(() => {
    let active = true
    // Reuse the request if StrictMode replays the effect. No auth dependency or polling.
    request.current ??= api.getCourseOfferings()
    request.current.then((result) => {
      if (active) {
        onOfferings?.(!result.error && result.data?.public_catalog_mode !== 'hidden' ? result.data?.offerings.filter(offering => offering.checkout_available) || [] : [])
        setAvailable(!result.error && result.data?.public_catalog_mode !== 'hidden' && (result.data?.public_catalog_mode === 'always' || !!result.data?.offerings.some((offering) => offering.checkout_available === true)))
      }
    }).catch(() => {
      if (active) { setAvailable(false); onOfferings?.([]) }
    })
    return () => { active = false }
  }, [onOfferings])

  return available
}
