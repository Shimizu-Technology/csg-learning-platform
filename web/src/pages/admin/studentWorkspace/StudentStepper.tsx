import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PreviewLink as Link } from '../../../contexts/PreviewNavigationContext'
import { type ReturnContext } from '../../../lib/navigationContext'
import { cohortStudentPath, type StudentWorkspaceTab } from '../../../lib/routes'
import type { CohortDetail } from '../../../types/api'

export function StudentStepper({
  direction,
  student,
  cohortId,
  tab,
  state,
}: {
  direction: 'previous' | 'next'
  student: CohortDetail['students'][number] | null
  cohortId: number
  tab: StudentWorkspaceTab
  state?: ReturnContext
}) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
  if (!student) return <span className="hidden h-11 w-28 sm:block" />
  return (
    <Link
      to={cohortStudentPath(cohortId, student.user_id, tab)}
      state={state}
      title={student.full_name || student.email}
      className={
        'inline-flex min-h-11 max-w-48 items-center gap-1 rounded-xl px-2 text-xs ' +
        'font-semibold text-ink-secondary transition-colors duration-150 ' +
        'hover:bg-surface-raised hover:text-ink ' +
        (direction === 'next' ? 'sm:justify-self-end' : '')
      }
    >
      {direction === 'previous' && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="truncate">{student.full_name || student.email}</span>
      {direction === 'next' && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </Link>
  )
}
