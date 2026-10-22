import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function useMeetingDestination(loading: boolean, version: unknown) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const cohortId = Number(params.get('cohort_id')) || null
  const bookingId = Number(params.get('booking_id')) || null
  const week = Number(params.get('week')) || null
  useEffect(() => {
    if (loading || !cohortId || !bookingId) return
    const target = document.getElementById(`booking-${bookingId}`) || (week ? document.getElementById(`meeting-${cohortId}-${week}`) : null)
    if (!target) return
    let parent = target.parentElement
    while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement }
    const frame = requestAnimationFrame(() => { target.scrollIntoView({ block: 'center', behavior: 'auto' }); target.focus({ preventScroll: true }) })
    return () => cancelAnimationFrame(frame)
  }, [loading, cohortId, bookingId, week, version])
  return { cohortId, bookingId, week }
}
