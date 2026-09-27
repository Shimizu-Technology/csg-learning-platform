import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import { hasCourseAccess } from '../../lib/courseAccess'

const STORAGE_KEY = 'csg-selected-course-id'

function savedCourseId(): number {
  try {
    return Number(globalThis.localStorage?.getItem(STORAGE_KEY))
  } catch {
    return 0
  }
}

export function useSelectedCourse() {
  const { enrollments } = useAuthContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const active = useMemo(() => enrollments.filter(hasCourseAccess), [enrollments])
  const requestedId = Number(searchParams.get('cohort_id'))
  const savedId = savedCourseId()
  const selectedId = active.find((entry) => entry.cohort.id === requestedId)?.cohort.id ||
    active.find((entry) => entry.cohort.id === savedId)?.cohort.id || active[0]?.cohort.id

  useEffect(() => {
    try {
      if (selectedId) globalThis.localStorage?.setItem(STORAGE_KEY, String(selectedId))
    } catch {
      // A private browser may not expose local storage.
    }
  }, [selectedId])

  const switcher = active.length > 1 ? (
    <label className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-700">
      <span>Course</span>
      <select aria-label="Choose course" value={selectedId || ''} onChange={(event) => {
        const next = new URLSearchParams(searchParams)
        next.set('cohort_id', event.target.value)
        setSearchParams(next)
      }} className="min-h-11 max-w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900">
        {active.map((entry) => <option key={entry.id} value={entry.cohort.id}>{entry.cohort.name}</option>)}
      </select>
    </label>
  ) : null

  return { selectedId, switcher }
}
