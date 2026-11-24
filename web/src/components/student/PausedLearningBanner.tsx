import { useEffect, useState } from 'react'
import { useAuthContext } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { brand } from '../../lib/brand'
import { formatShortDate } from '../../lib/format'
import { AnchorButton, LinkButton } from '../ui/Button'

export function useSelectedCoursePaused(cohortId?: number | null) {
  const { enrollments } = useAuthContext()
  return Boolean(cohortId && enrollments?.some((entry) => entry.cohort.id === cohortId && entry.status === 'paused'))
}

export function PausedLearningBanner({ cohortId, pausedSince }: { cohortId?: number | null; pausedSince?: string | null }) {
  const [pause, setPause] = useState<{ cohortId: number; since: string | null } | null>(null)
  useEffect(() => {
    if (!cohortId || pausedSince !== undefined) return
    let current = true
    void api.getDashboard(cohortId).then(({ data }) => {
      if (current && data?.dashboard.cohort?.id === cohortId) {
        setPause({ cohortId, since: data.dashboard.paused_since ?? null })
      }
    }).catch(() => { /* The pause notice and actions are still available. */ })
    return () => { current = false }
  }, [cohortId, pausedSince])

  const since = pausedSince ?? (pause?.cohortId === cohortId ? pause?.since : null)
  return (
    <section className="rounded-2xl border border-info-line bg-info-soft p-4 text-sm text-info-ink" aria-label="Paused enrollment">
      <p className="font-semibold">{since ? `Paused since ${formatShortDate(since)}` : 'Your enrollment is paused'}</p>
      <p className="mt-1">You can still use the lessons, recordings, and resources available when you paused and read your past feedback.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <LinkButton variant="secondary" to={`/my-work?${cohortId ? `cohort_id=${cohortId}&` : ''}tab=graded`}>View past work</LinkButton>
        <AnchorButton variant="secondary" href={`mailto:${brand.supportEmail}?subject=Resuming%20my%20course`}>Ask about resuming</AnchorButton>
      </div>
    </section>
  )
}
