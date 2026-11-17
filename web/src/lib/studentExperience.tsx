import { createContext, useContext, useRef, type ReactNode } from 'react'
import { useAuthContext } from '../contexts/AuthContext'
import { useCohortContext } from '../contexts/CohortContext'

/**
 * The redesigned student experience (W8), one feature switch for every
 * redesigned view: school default on, with per-cohort overrides in School
 * settings and a cohort's Settings tab. Cohorts already running when it
 * shipped (Cohort 3) have it off, and see today's views unchanged.
 *
 * Each later W8 view gates on `useStudentExperience().v2` the same way Learn
 * does: render the new view when on, the old view untouched when off, and the
 * old view's spinner until `ready`. The server sends the switch with every
 * cohort's resolved features (dashboard, session, the accessible cohorts list).
 */
export const STUDENT_EXPERIENCE_SWITCH = 'student_experience_v2'

/** Whether a resolved feature map has the redesign on. Missing means the school default, which is on. */
export function studentExperienceOn(features: Record<string, boolean> | null | undefined) {
  return features?.[STUDENT_EXPERIENCE_SWITCH] !== false
}

const StudentExperienceOverride = createContext<boolean | null>(null)

/** Staff "View as student" shows the previewed cohort's experience, not the viewer's. */
export function StudentExperienceProvider({ v2, children }: { v2: boolean; children: ReactNode }) {
  return <StudentExperienceOverride.Provider value={v2}>{children}</StudentExperienceOverride.Provider>
}

/**
 * `{ ready, v2 }` for the cohort being viewed. Until the cohort list loads it
 * is not ready, so a cohort with the switch off never flashes the new view.
 * If the list fails to load before anything was decided, the current
 * experience is the safe answer; once decided, a later failed refresh doesn't
 * switch views under the learner.
 */
export function useStudentExperience(): { ready: boolean; v2: boolean } {
  const override = useContext(StudentExperienceOverride)
  const { selectedCohort, ready, error } = useCohortContext()
  const { schoolFeatures } = useAuthContext()
  const decided = useRef<boolean | null>(null)
  if (override !== null) return { ready: true, v2: override }
  if (ready === false) return decided.current === null ? { ready: false, v2: false } : { ready: true, v2: decided.current }
  let v2: boolean
  if (selectedCohort) v2 = studentExperienceOn(selectedCohort.capabilities?.features || selectedCohort.features)
  else if (error) v2 = decided.current ?? false
  else v2 = studentExperienceOn(schoolFeatures)
  decided.current = v2
  return { ready: true, v2 }
}
