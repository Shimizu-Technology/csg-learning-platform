import {
  Activity,
  BookOpen,
  CalendarDays,
  GraduationCap,
  MessageSquareText,
  PlayCircle,
  Settings2,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useAuthContext } from '../../../contexts/AuthContext'
import { useCohortContext } from '../../../contexts/CohortContext'
import { api } from '../../../lib/api'
import { TERMS } from '../../../lib/glossary'
import { unavailableResponse } from '../../../lib/loadFailure'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordRelated } from '../../../lib/recordRelated'
import { type CohortWorkspaceTab } from '../../../lib/routes'
import type { CohortDetail, CohortHome, LearningInsights } from '../../../types/api'

export const DELIVERY_LABELS: Record<string, string> = {
  program: TERMS.liveProgram,
  guided: TERMS.smallClass,
  self_paced: TERMS.selfPaced,
}

export type CohortTab = CohortWorkspaceTab

export const tabs: Array<{ id: CohortTab; label: string; icon: typeof Users }> = [
  { id: 'overview', label: 'Overview', icon: GraduationCap },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'learning', label: 'Learning', icon: BookOpen },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'recordings', label: 'Recordings', icon: PlayCircle },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'communication', label: 'Communication', icon: MessageSquareText },
  { id: 'settings', label: 'Settings', icon: Settings2 },
  { id: 'team', label: 'Teaching team', icon: Users },
]
export function useCohortWorkspace({ cohortId }: { cohortId: number }) {
  const [searchParams] = useSearchParams()
  const { user, schoolFeatures } = useAuthContext()
  const { cohorts } = useCohortContext()
  const features = cohorts?.find((cohort) => cohort.id === cohortId)?.features || schoolFeatures
  const enabled = (key: string) => features?.[key] !== false
  const visibleTabs = tabs.filter(
    (tab) =>
      (!['team', 'settings'].includes(tab.id) || user?.is_admin) &&
      (tab.id !== 'recordings' || enabled('recordings')) &&
      (tab.id !== 'schedule' || enabled('office_hours') || enabled('private_meetings')) &&
      (tab.id !== 'communication' || enabled('class_channels') || enabled('announcements')),
  )
  const requestedTab = searchParams.get('tab')
  // An unknown tab, or one this viewer can't open (Teaching team is admin-only), shows the overview.
  const activeTab =
    requestedTab === 'insights' || visibleTabs.some((tab) => tab.id === requestedTab)
      ? (requestedTab as CohortTab)
      : 'overview'
  const [cohort, setCohort] = useState<CohortDetail | null>(null)
  const [home, setHome] = useState<CohortHome | null>(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [homeAttempt, setHomeAttempt] = useState(0)
  const retryHome = () => setHomeAttempt((value) => value + 1)
  const location = useLocation()
  // The cohort page reads no return_to beyond Activity; other origins arrive as router state.
  const back = useBackLink({ returnTo: '/admin/cohorts', returnLabel: 'Cohorts' }, { accept: 'activity' })
  const related = useRecordRelated('cohort', Number.isInteger(cohortId) && cohortId > 0 ? cohortId : null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [noAccess, setNoAccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [insights, setInsights] = useState<LearningInsights | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState<string | null>(null)

  useEffect(() => {
    if (!Number.isInteger(cohortId) || cohortId <= 0) {
      setError('This cohort address is invalid.')
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    void api
      .getCohort(cohortId)
      .then((result) => {
        if (!active) return
        setNoAccess(unavailableResponse(result))
        if (result.data) {
          setCohort(result.data.cohort)
          setError(null)
        } else setError(result.error || 'Could not load this cohort.')
        setLoading(false)
      })
      .catch(() => {
        if (active) {
          setError('Could not load this cohort.')
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [cohortId, loadAttempt])

  useEffect(() => {
    if (!Number.isInteger(cohortId) || cohortId <= 0) {
      setHomeLoading(false)
      return
    }
    let active = true
    setHomeLoading(true)
    setHomeError(null)
    void api
      .getCohortHome(cohortId)
      .then((result) => {
        if (!active) return
        if (result.data && !result.error && !result.fromCache) setHome(result.data.home)
        else {
          setHome(null)
          setHomeError(result.error || 'Could not load cohort updates.')
        }
      })
      .catch(() => {
        if (active) {
          setHome(null)
          setHomeError('Could not load cohort updates.')
        }
      })
      .finally(() => {
        if (active) setHomeLoading(false)
      })
    return () => {
      active = false
    }
  }, [cohortId, homeAttempt, loadAttempt])

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true)
    setInsightsError(null)
    const result = await api.getLearningInsights(cohortId)
    if (result.data && !result.error && !result.fromCache) setInsights(result.data.learning_insights)
    else setInsightsError(result.error || 'Could not load learning evidence.')
    setInsightsLoading(false)
  }, [cohortId])

  useEffect(() => {
    if (activeTab === 'insights' && !insights && !insightsLoading && !insightsError) void loadInsights()
  }, [activeTab, insights, insightsLoading, insightsError, loadInsights])

  const activeStudents = useMemo(
    () => cohort?.students.filter((student) => student.status === 'active') || [],
    [cohort],
  )

  return {
    searchParams,
    user,
    enabled,
    visibleTabs,
    activeTab,
    cohort,
    setCohort,
    home,
    homeLoading,
    homeError,
    retryHome,
    location,
    back,
    related,
    setLoadAttempt,
    loading,
    noAccess,
    error,
    insights,
    insightsLoading,
    insightsError,
    loadInsights,
    activeStudents,
  }
}
