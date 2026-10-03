import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthContext } from './AuthContext'
import { api } from '../lib/api'
import type { AccessibleCohort } from '../types/api'

interface CohortContextValue {
  cohorts: AccessibleCohort[]
  selectedCohort: AccessibleCohort | null
  selectedCohortId: number | null
  loading: boolean
  error: string | null
  setSelectedCohort: (id: number | null, options?: { searchParams?: URLSearchParams }) => void
  selectCohort: (id: number | null) => void
  refreshCohorts: () => Promise<void>
}

const CohortContext = createContext<CohortContextValue>({
  cohorts: [], selectedCohort: null, selectedCohortId: null, loading: false, error: null,
  setSelectedCohort: () => {}, selectCohort: () => {}, refreshCohorts: async () => {},
})

export function useCohortContext() { return useContext(CohortContext) }

function cohortIdFromLocation(pathname: string, search: string): number | null {
  const match = pathname.match(/^\/(?:admin\/)?cohorts\/(\d+)(?:\/|$)/)
  const candidate = match ? Number(match[1]) : Number(new URLSearchParams(search).get('cohort_id'))
  return Number.isInteger(candidate) && candidate > 0 ? candidate : null
}

export function CohortProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthContext()
  const location = useLocation()
  const navigate = useNavigate()
  const [cohorts, setCohorts] = useState<AccessibleCohort[]>([])
  const [cohortsOwnerId, setCohortsOwnerId] = useState<number | null>(null)
  const [preferredId, setPreferredId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestGenerationRef = useRef(0)
  const userId = user?.id
  const isStaff = Boolean(user?.is_staff)
  const storageKey = userId ? `csg-selected-cohort:${userId}` : null

  const refreshCohorts = useCallback(async () => {
    if (!userId) return
    const requestGeneration = ++requestGenerationRef.current
    setLoading(true)
    const result = await api.getAccessibleCohorts()
    if (requestGeneration !== requestGenerationRef.current) return
    if (result.data && !result.error && !result.fromCache) {
      setCohorts(result.data.cohorts)
      setCohortsOwnerId(userId)
      setError(null)
    } else {
      // Access lists must be current. A cached list cannot authorize a cohort.
      setCohorts([])
      setCohortsOwnerId(null)
      setError(result.error || 'Could not load your cohorts.')
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    if (!userId) { requestGenerationRef.current += 1; setCohorts([]); setCohortsOwnerId(null); setPreferredId(null); return }
    let stored: number | null = null
    try {
      const candidate = Number(localStorage.getItem(`csg-selected-cohort:${userId}`))
      if (Number.isInteger(candidate) && candidate > 0) stored = candidate
    } catch { /* Storage can be unavailable. */ }
    setPreferredId(stored)
    void refreshCohorts()
  }, [userId, refreshCohorts])

  useEffect(() => {
    if (!userId) return
    const onFocus = () => { void refreshCohorts() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [userId, refreshCohorts])

  const visibleCohorts = cohortsOwnerId === userId ? cohorts : []
  const explicitId = cohortIdFromLocation(location.pathname, location.search)
  let storedId: number | null = null
  if (storageKey) try {
    const candidate = Number(localStorage.getItem(storageKey))
    if (Number.isInteger(candidate) && candidate > 0) storedId = candidate
  } catch { /* Storage can be unavailable. */ }
  const selectedCohort = useMemo(() => {
    if (explicitId) return visibleCohorts.find((cohort) => cohort.id === explicitId) || null
    const id = explicitId || preferredId
    return visibleCohorts.find((cohort) => cohort.id === id) || (!isStaff ? visibleCohorts.find((cohort) => !['completed', 'archived'].includes(cohort.status)) || visibleCohorts[0] || null : null)
  }, [visibleCohorts, explicitId, preferredId, isStaff])
  const selectedCohortId = explicitId || (cohortsOwnerId === userId ? selectedCohort?.id || null : preferredId || storedId)

  useEffect(() => {
    if (!selectedCohort || !storageKey) return
    try { localStorage.setItem(storageKey, String(selectedCohort.id)) } catch { /* Storage can be unavailable. */ }
  }, [selectedCohort, storageKey])

  const setSelectedCohort = useCallback((id: number | null, options?: { searchParams?: URLSearchParams }) => {
    const syncExplicitQuery = (cohortId: number | null) => {
      const search = options?.searchParams
        ? new URLSearchParams(options.searchParams)
        : new URLSearchParams(location.search)
      if (!options?.searchParams && !search.has('cohort_id')) return
      if (cohortId === null) search.delete('cohort_id')
      else search.set('cohort_id', String(cohortId))
      const nextSearch = search.toString()
      navigate({ pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' }, { replace: true })
    }

    if (id === null && isStaff) {
      setPreferredId(null)
      if (storageKey) try { localStorage.removeItem(storageKey) } catch { /* Storage can be unavailable. */ }
      syncExplicitQuery(null)
      return
    }
    const cohort = visibleCohorts.find((item) => item.id === id)
    if (!cohort) return
    setPreferredId(cohort.id)
    if (storageKey) try { localStorage.setItem(storageKey, String(cohort.id)) } catch { /* Storage can be unavailable. */ }
    syncExplicitQuery(cohort.id)
  }, [visibleCohorts, isStaff, storageKey, location.pathname, location.search, navigate])

  const selectCohort = useCallback((id: number | null) => {
    if (id === null && isStaff) {
      setSelectedCohort(null)
      navigate('/admin')
      return
    }
    const cohort = visibleCohorts.find((item) => item.id === id)
    if (!cohort) return
    setSelectedCohort(cohort.id)
    navigate(isStaff ? `/admin/cohorts/${cohort.id}` : `/cohorts/${cohort.id}`)
  }, [visibleCohorts, isStaff, navigate, setSelectedCohort])

  const value = useMemo(() => ({ cohorts: visibleCohorts, selectedCohort, selectedCohortId, loading, error, setSelectedCohort, selectCohort, refreshCohorts }),
    [visibleCohorts, selectedCohort, selectedCohortId, loading, error, setSelectedCohort, selectCohort, refreshCohorts])
  return <CohortContext.Provider value={value}>{children}</CohortContext.Provider>
}
