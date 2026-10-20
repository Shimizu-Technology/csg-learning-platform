import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { cohortStudentPath } from '../../lib/routes'

interface Learner { user_id: number; full_name?: string | null; email?: string | null }

/**
 * Staff-only warning: an active learner with no assigned module sees an empty
 * course ("Your course isn't open yet"), which is easy to miss before a pilot.
 */
export function UnassignedLearnersWarning({ cohortId, count, learners = [] }: { cohortId: number; count: number; learners?: Learner[] }) {
  if (count <= 0) return null
  return (
    <section role="status" className="rounded-2xl border border-warning-200 bg-warning-50 p-4 text-warning-800 sm:p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            {count === 1 ? '1 active learner has no module assigned' : `${count} active learners have no module assigned`}
          </h2>
          <p className="mt-1 text-sm leading-6">They can sign in but see “Your course isn’t open yet” and no lessons. Open each learner and assign the course module.</p>
          {learners.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {learners.slice(0, 6).map((learner) => (
                <li key={learner.user_id} className="min-w-0 max-w-full">
                  <Link to={cohortStudentPath(cohortId, learner.user_id)} className="inline-flex min-h-11 max-w-full items-center gap-1.5 pressable rounded-xl border border-warning-200 bg-surface-raised px-3 text-sm font-semibold text-ink hover:border-warning-300">
                    <span className="truncate" title={learner.full_name || learner.email || 'Learner'}>{learner.full_name || learner.email || 'Learner'}</span>
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
