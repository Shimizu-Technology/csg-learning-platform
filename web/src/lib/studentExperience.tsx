import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuthContext } from '../contexts/AuthContext'
import { useCohortContext } from '../contexts/CohortContext'

/**
 * The redesigned student experience (W8), one feature switch for every
 * redesigned view: school default on, with per-cohort overrides in School
 * settings and a cohort's Settings tab. Cohorts already running when it
 * shipped (Cohort 3) have it off, and see today's views unchanged.
 *
 * Only an explicit, resolved `true` for the cohort being viewed shows the new
 * experience. Anything else (off, a missing key in a cached or older payload,
 * no cohort, still loading, a failed lookup) keeps today's views.
 *
 * Each later W8 view gates on `useStudentExperience()` the same way Learn
 * does (see `StudentExperienceSwitch`): the new view when `v2`, the old view
 * untouched otherwise, and the old view's loading state until `ready`. The
 * server sends the switch with every cohort's resolved features (dashboard,
 * session, the accessible cohorts list).
 */
export const STUDENT_EXPERIENCE_SWITCH = 'student_experience_v2'

/** Whether a resolved feature map turns the redesign on. Only an explicit `true` does. */
export function studentExperienceOn(features: Record<string, boolean> | null | undefined) {
  return features?.[STUDENT_EXPERIENCE_SWITCH] === true
}

const StudentExperienceOverride = createContext<boolean | null>(null)

/** Staff "View as student" shows the previewed cohort's experience, not the viewer's. */
export function StudentExperienceProvider({ v2, children }: { v2: boolean; children: ReactNode }) {
  return <StudentExperienceOverride.Provider value={v2}>{children}</StudentExperienceOverride.Provider>
}

interface Decision { userId: number | null; cohortId: number; v2: boolean }

export interface StudentExperience {
  /** The switch is known for this cohort, or the lookup failed and today's views are the answer. */
  ready: boolean
  v2: boolean
  /** The cohort list couldn't be loaded, so today's views are shown without a decision. */
  failed: boolean
  retry: () => void
}

/**
 * The switch for the cohort being viewed. Until the cohort list loads it is
 * not ready, so a cohort with it off never shows the new view, even for a
 * frame. A failed lookup shows today's views (`failed`, with `retry`). A
 * decision is kept through a failed refresh only for the same signed-in user
 * and the same cohort; any other cohort falls back to today's views.
 */
export function useStudentExperience(): StudentExperience {
  const override = useContext(StudentExperienceOverride)
  const { selectedCohort, selectedCohortId, ready, error, refreshCohorts } = useCohortContext()
  const { user } = useAuthContext()
  const decided = useRef<Decision | null>(null)
  const retry = () => { void refreshCohorts?.() }
  if (override !== null) return { ready: true, v2: override, failed: false, retry }
  const userId = user?.id ?? null
  const cohortId = selectedCohort?.id ?? selectedCohortId ?? null
  const kept = decided.current && cohortId !== null && decided.current.userId === userId && decided.current.cohortId === cohortId ? decided.current.v2 : null
  if (selectedCohort && ready !== false) {
    const v2 = studentExperienceOn(selectedCohort.capabilities?.features || selectedCohort.features)
    decided.current = { userId, cohortId: selectedCohort.id, v2 }
    return { ready: true, v2, failed: false, retry }
  }
  if (kept !== null) return { ready: true, v2: kept, failed: false, retry }
  if (ready === false) return { ready: false, v2: false, failed: false, retry }
  return { ready: true, v2: false, failed: Boolean(error), retry }
}

/** How long the cohort switch may take before the page stops waiting and shows today's view. */
export const STUDENT_EXPERIENCE_WAIT_MS = 10_000

/**
 * The one way a student route chooses between today's view and the redesign.
 * While the switch is unknown it shows `loading` (today's own loading state);
 * after STUDENT_EXPERIENCE_WAIT_MS, or when the lookup fails, it shows today's
 * view with a notice and Retry, never an endless spinner.
 */
export function StudentExperienceSwitch({ on, off, loading }: { on: ReactNode; off: ReactNode; loading: ReactNode }) {
  const { ready, v2, failed, retry } = useStudentExperience()
  const [waitedTooLong, setWaitedTooLong] = useState(false)
  useEffect(() => {
    if (ready) return
    const timer = window.setTimeout(() => setWaitedTooLong(true), STUDENT_EXPERIENCE_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [ready])
  if (!ready && !waitedTooLong) return <>{loading}</>
  if (ready && v2) return <>{on}</>
  if (ready && !failed) return <>{off}</>
  return (
    <>
      <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink">
        <span>{ready ? 'We couldn’t load your course settings.' : 'Your course settings are taking a while to load.'} Showing the standard view.</span>
        <button type="button" onClick={() => { setWaitedTooLong(false); retry() }} className="pressable min-h-11 rounded-xl border border-warning-line bg-surface-raised px-3 font-semibold text-ink hover:bg-surface-sunken">Try again</button>
      </div>
      {off}
    </>
  )
}
