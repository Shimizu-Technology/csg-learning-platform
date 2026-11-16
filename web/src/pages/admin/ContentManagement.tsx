import { LessonRow, SequenceLessons, type Lesson } from './contentStudio/LessonTable'
import { flushSync } from 'react-dom'
import { CurriculumStatusActions, ModuleActions, StructureEditor } from './StructureActions'
import { useEffect, useState, useMemo, useRef } from 'react'
import { applyUrlPatch, urlParsers, useUrlState } from '../../lib/useUrlState'
import { listLinkState, useListScrollMemory } from '../../lib/navigationContext'
import { PageHeader } from '../../components/ui/PageHeader'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Archive, ChevronDown, ChevronRight, Eye, Plus, RotateCcw, Upload, MoreHorizontal } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { NewExerciseModal } from './NewExerciseModal'
import { NewModuleModal } from './NewModuleModal'
import { NewCurriculumModal } from './NewCurriculumModal'
import { ImportCoursePackageModal } from './ImportCoursePackageModal'
import { CourseResourcesPanel } from './CourseResourcesPanel'
import { CopyForCohortAction } from './lessonEditor/CopyForCohortDialog'
import { ALL_DAY_NAMES, SCHEDULE_DAY_INDICES } from '../../lib/scheduleConstants'
import { useUpload } from '../../contexts/UploadContext'
import { useToast } from '../../contexts/ToastContext'
import { useAuthContext } from '../../contexts/AuthContext'
import { Button, LinkButton } from '../../components/ui/Button'
import { TabButton, TextButton } from '../../components/ui/Choice'
import { Collapse, TabList, TabPanel } from '../../components/ui/Motion'
import { Badge } from '../../components/ui/Badge'
import { RecordLink } from '../../components/shared/RecordLink'
import { useConfirm } from '../../contexts/ConfirmContext'
import type { CurriculumSummary, AccessibleCohort } from '../../types/api'
import { searchDestinationPath } from '../../lib/searchDestination'
import { lessonEditorPath } from '../../lib/routes'
import type { LessonEditAccess } from '../../types/api'

const CONTENT_URL = {
  curriculum: urlParsers.id(),
  q: urlParsers.text(),
  content: urlParsers.text(),
  status: urlParsers.oneOf(['all', 'active', 'draft', 'archived'] as const, 'all'),
  cohort: urlParsers.id(),
  pane: urlParsers.oneOf(['list', 'detail', 'files'] as const, 'list'),
  view: urlParsers.oneOf(['auto', 'sequence', 'calendar'] as const, 'auto'),
  open: urlParsers.ids(50),
  week: urlParsers.idMap(1, 52, 1)
}


interface Module {
  id: number
  description?: string | null
  submissions_count?: number
  deletion_blocked?: boolean
  curriculum_id?: number
  name: string
  module_type: string
  position: number
  schedule_days: string
  scheduled_day_names: string[]
  week_count: number
  updated_at: string
  lessons: Lesson[]
}

interface Curriculum {
  description?: string | null
  updated_at: string
  archive_blocked?: boolean
  live_checkout_offerings?: { id: number; name: string }[]
  active_self_paced_learners?: boolean
  id: number
  name: string
  status: string
  modules: Module[]
  /** Whether this staff member may edit the curriculum's lessons (admins always; instructors with editing access). */
  editing?: LessonEditAccess
}

function groupLessonsByDay(lessons: Lesson[]) {
  const groups: Record<number, Lesson[]> = {}
  for (const lesson of lessons) {
    if (!groups[lesson.release_day]) groups[lesson.release_day] = []
    groups[lesson.release_day].push(lesson)
  }
  return groups
}

const SCHEDULE_PATTERN_OPTIONS = [
  { value: 'weekdays', label: 'MTWTF / Mon–Fri' },
  { value: 'weekdays_sat', label: 'Mon–Sat' },
  { value: 'mwf', label: 'MWF' },
  { value: 'tth', label: 'Tue/Thu' },
  { value: 'daily', label: 'Every day' }
]

export function ContentManagement() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const searchRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLHeadingElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { attachUpload } = useUpload()
  const toast = useToast()
  const { user } = useAuthContext()
  const canManageModules = Boolean(user?.is_admin)
  const [summaries, setSummaries] = useState<CurriculumSummary[]>([])
  const [cohorts, setCohorts] = useState<AccessibleCohort[]>([])
  const [cohortsLoaded, setCohortsLoaded] = useState(false)
  const detailRequest = useRef<AbortController | null>(null)
  const currentId = useRef<number | undefined>(undefined)
  const focusedId = useRef<number | undefined>(undefined)
  const actionsRef = useRef<HTMLDetailsElement>(null)
  const [selected, setSelected] = useState<Curriculum | null>(null)
  const [searchResults, setSearchResults] = useState<{ title: string; path: string; type: string }[]>([])
  const [searchError, setSearchError] = useState('')
  const [searching, setSearching] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [reordering, setReordering] = useState(false)
  const [orderNotice, setOrderNotice] = useState('')
  const [loading, setLoading] = useState(true)
  // Open modules and their week tabs live in the URL (L-0.6), so Back from a lesson restores them.
  const location = useLocation()
  const [url, setUrlState] = useUrlState(CONTENT_URL)
  const { open: openModules, week: activeWeekTab } = url
  const expandedModules = useMemo(() => new Set(openModules), [openModules])
  useListScrollMemory(!loading)
  const [exerciseModal, setExerciseModal] = useState<{
    moduleId: number
    moduleName: string
    curriculumId: number
    scheduleDays: string
    weekCount: number
    defaultWeek: number
    defaultDayIndex: number
  } | null>(null)
  const [newModuleModal, setNewModuleModal] = useState<{ curriculumId: number; moduleCount: number } | null>(
    null
  )
  const [showNewCurriculum, setShowNewCurriculum] = useState(false)
  const [showPackageImport, setShowPackageImport] = useState(false)
  const [exerciseSaving, setExerciseSaving] = useState(false)
  const [moduleSaving, setModuleSaving] = useState(false)
  const [curriculumSaving, setCurriculumSaving] = useState(false)
  const [scheduleSavingId, setScheduleSavingId] = useState<number | null>(null)
  const [restoringLessonId, setRestoringLessonId] = useState<number | null>(null)
  const [exerciseCreateError, setExerciseCreateError] = useState('')
  const [moduleCreateError, setModuleCreateError] = useState('')
  const [curriculumCreateError, setCurriculumCreateError] = useState('')
  const ordered = useMemo(
    () =>
      [...summaries].sort(
        (a, b) =>
          ['active', 'draft', 'archived'].indexOf(a.status) -
            ['active', 'draft', 'archived'].indexOf(b.status) || a.name.localeCompare(b.name)
      ),
    [summaries]
  )
  const visible = ordered.filter(
    (c) =>
      (url.status === 'all' || c.status === url.status) &&
      (!url.cohort || cohorts.some((co) => co.id === url.cohort && co.curriculum_id === c.id)) &&
      `${c.name} ${c.description || ''}`.toLowerCase().includes(url.q.trim().toLowerCase())
  )
  const hashId = /^#curriculum-(\d+)$/.exec(location.hash)?.[1]
  const requestedId = hashId ? Number(hashId) : url.curriculum
  const selectedId = !loading && requestedId && summaries.some(c => c.id === requestedId) ? requestedId : !loading ? visible[0]?.id : undefined
  currentId.current = selectedId
  const curricula = selected && selected.id === selectedId ? [selected] : []
  const usedBy = cohorts.filter((co) => co.curriculum_id === selectedId)
  const usage = summaries.find(c => c.id === selectedId)
  const deliveryModes = usage?.course_delivery_modes || usedBy.map(co => co.course_delivery)
  const sequence =
    url.view === 'sequence' ||
    (url.view === 'auto' && deliveryModes.length > 0 && deliveryModes.every(mode => mode === 'self_paced'))

  const refreshDetail = async (id: number) => {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    const res = await api.getCurriculum(id, controller.signal)
    if (controller.signal.aborted || currentId.current !== id) return
    setSelected(res.data?.curriculum || null)
    setDetailError(res.error || '')
    setDetailLoading(false)
  }
  const loadCurricula = async () => {
    const res = await api.getCurricula()
    if (res.data) setSummaries(res.data.curricula)
    else toast.error(res.error || 'Could not load curricula')
    setLoading(false)
    // Read the current selection after the summaries return, never a captured selection.
    if (currentId.current) await refreshDetail(currentId.current)
  }
  useEffect(() => {
    void api.getCurricula().then(res => {
      if (res.data) setSummaries(res.data.curricula)
      else toast.error(res.error || 'Could not load curricula')
      setLoading(false)
    })
    void api.getAccessibleCohorts().then(res => {
      if (res.data) {
        setCohorts(res.data.cohorts)
        setCohortsLoaded(true)
      }
    })
  }, [])
  useEffect(() => {
    if (cohortsLoaded && url.cohort && !cohorts.some(co => co.id === url.cohort))
      setUrlState({ cohort: null }, { history: 'replace' })
  }, [cohortsLoaded, cohorts, url.cohort, setUrlState])
  useEffect(() => {
    if (loading || !requestedId || summaries.some(c => c.id === requestedId)) return
    navigate({
      pathname: location.pathname,
      search: applyUrlPatch(location.search, CONTENT_URL, { curriculum: null }),
      hash: ''
    }, { replace: true })
  }, [loading, requestedId, summaries, navigate, location.pathname, location.search])
  useEffect(() => {
    if (!selectedId) return
    setDetailLoading(true)
    setDetailError('')
    void refreshDetail(selectedId).catch(() => {
      if (currentId.current === selectedId && !detailRequest.current?.signal.aborted) {
        setDetailError('Could not load curriculum. Try again.')
        setDetailLoading(false)
      }
    })
    return () => { detailRequest.current?.abort() }
  }, [selectedId, revision])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && !document.querySelector('[aria-modal="true"]') && (event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault()
        setUrlState({ pane: 'list' })
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [setUrlState])
  useEffect(() => {
    if (detailLoading || selected?.id !== selectedId) return
    if (focusedId.current !== selectedId) {
      headingRef.current?.focus({ preventScroll: true })
      focusedId.current = selectedId
    }
    if (/^#(curriculum|module)-\d+$/.test(location.hash)) {
      const target = document.getElementById(location.hash.slice(1))
      if (!target) return
      target.scrollIntoView({ block: hashId ? 'start' : 'center' })
      navigate({
        pathname: location.pathname,
        search: applyUrlPatch(location.search, CONTENT_URL, { curriculum: selectedId, pane: 'detail' }),
        hash: ''
      }, { replace: true })
    }
  }, [selectedId, selected, detailLoading, location, hashId, navigate])
  useEffect(() => {
    const close = (event: Event) => {
      const menu = actionsRef.current
      if (!menu?.open) return
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        menu.open = false
        menu.querySelector('summary')?.focus()
      } else if (event.type === 'pointerdown' && !menu.contains(event.target as Node)) menu.open = false
    }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('pointerdown', close)
    }
  }, [])
  useEffect(() => {
    setSearchResults([])
    setSearchError('')
    if (url.q.trim().length < 2) {
      setSearching(false)
      return
    }
    let ignore = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      api
        .searchEverything(url.q.trim())
        .then((res) => {
          if (ignore) return
          setSearching(false)
          setSearchError(
            res.error || (res.data?.partial ? 'Some search results are unavailable. Refine your search.' : '')
          )
          setSearchResults(
            (res.data?.groups || [])
              .filter((g) => ['module', 'lesson'].includes(g.type))
              .flatMap((g) =>
                g.results.map((r) => ({
                  title: r.title,
                  type: g.type,
                  path:
                    searchDestinationPath(r.destination, { is_staff: true, is_admin: canManageModules }) || ''
                }))
              )
              .filter((r) => r.path)
          )
        })
        .catch(() => {
          if (!ignore) {
            setSearching(false)
            setSearchError('Library search is unavailable. Try again.')
          }
        })
    }, 250)
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [url.q, canManageModules])
  const selectCurriculum = (id: number) => {
    navigate({
      pathname: location.pathname,
      search: applyUrlPatch(location.search, CONTENT_URL, { curriculum: id, pane: 'detail', view: 'auto' }),
      hash: ''
    })
  }
  const jumpToCurriculum = (id: number, moduleId?: number) => {
    const params = new URLSearchParams(location.search)
    params.set('curriculum', String(id))
    params.set('pane', 'detail')
    params.delete('view')
    params.delete('status')
    params.delete('q')
    params.delete('cohort')
    params.delete('content')
    if (moduleId) params.set('open', Array.from(new Set([...openModules, moduleId])).join(','))
    navigate({
      pathname: location.pathname,
      search: params.toString(),
      hash: moduleId ? `#module-${moduleId}` : ''
    })
  }

  useEffect(() => {
    if (url.pane === 'files') filesRef.current?.focus()
    if (url.pane === 'list' && url.curriculum && !location.hash) searchRef.current?.focus({ preventScroll: true })
  }, [url.pane, url.curriculum, location.hash])
  const deleteCurriculum = async (curriculum: Curriculum) => {
    if (!await confirm({ title: `Delete ${curriculum.name}?`, description: 'This permanently deletes the curriculum and its content. Curricula used by cohorts, learner work or learner files cannot be deleted.', confirmLabel: 'Delete permanently', tone: 'danger' })) return
    const res = await api.deleteCurriculum(curriculum.id)
    if (res.error) { toast.error(res.error); return }
    setSelected(null)
    await loadCurricula()
    setUrlState({ curriculum: null, pane: 'list' })
    toast.success('Curriculum deleted')
  }

  const moveModule = async (curriculum: Curriculum, from: number, to: number) => {
    if (reordering || from === to || from < 0 || to < 0) return
    if (
      curriculum.active_self_paced_learners &&
      !(await confirm({
        title: 'Change module order?',
        description: "Reordering changes active self-paced learners' next lesson. Save this order?",
        confirmLabel: 'Save order'
      }))
    )
      return
    const movedId = curriculum.modules[from].id
    const direction = to < from ? 'up' : 'down'
    const focusDirection = to === 0 ? 'down' : to === curriculum.modules.length - 1 ? 'up' : direction
    const ids = curriculum.modules.map((mod) => mod.id)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setReordering(true)
    const result = await api.reorderModules(curriculum.id, ids)
    if (result.error) toast.error(result.error)
    else {
      await loadCurricula()
      setOrderNotice('Module order saved')
    }
    flushSync(() => setReordering(false))
    if (!result.error)
      document
        .querySelector<HTMLButtonElement>(
          `button[data-module-move="${movedId}"][data-direction="${focusDirection}"]`
        )
        ?.focus()
  }

  // Opening a module replaces the entry (it's like scrolling); choosing a week pushes one.
  const toggleModule = (moduleId: number) => {
    const next = new Set(expandedModules)
    if (next.has(moduleId)) {
      next.delete(moduleId)
    } else {
      next.add(moduleId)
    }
    setUrlState({ open: Array.from(next) }, { history: 'replace' })
  }
  useEffect(() => {
    if (!url.content.trim() || !selected) return
    setUrlState({ open: Array.from(new Set([...openModules, ...selected.modules
      .filter(mod => `${mod.name} ${mod.lessons.map(l => l.title).join(' ')}`.toLowerCase().includes(url.content.trim().toLowerCase()))
      .map(mod => mod.id)])) }, { history: 'replace' })
    // Only a new search expands matching modules; toggles remain independent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url.content, selected?.id])
  const setWeek = (moduleId: number, week: number) =>
    setUrlState({ week: { ...activeWeekTab, [moduleId]: week } })

  const openExerciseForDay = (mod: Module, week: number, dayIndex: number) => {
    setExerciseCreateError('')
    setExerciseModal({
      moduleId: mod.id,
      moduleName: mod.name,
      curriculumId: mod.curriculum_id || 0,
      scheduleDays: mod.schedule_days || 'weekdays',
      weekCount: mod.week_count || 1,
      defaultWeek: week,
      defaultDayIndex: dayIndex
    })
  }

  const updateModuleSchedule = async (mod: Module, scheduleDays: string) => {
    if (mod.schedule_days === scheduleDays) return

    const added = (SCHEDULE_DAY_INDICES[scheduleDays] || []).filter(
      (day) => !(SCHEDULE_DAY_INDICES[mod.schedule_days] || []).includes(day)
    )
    const copy = added.length
      ? `Adds ${added.map((day) => ALL_DAY_NAMES[day]).join('/')} slots. Existing exercises keep their days.`
      : 'Existing exercises keep their days. Days with existing exercises cannot be removed.'
    if (
      !(await confirm({
        title: 'Change schedule?',
        description: copy,
        confirmLabel: 'Save schedule',
        icon: 'calendar'
      }))
    )
      return

    setScheduleSavingId(mod.id)
    const res = await api.updateModule(mod.id, {
      schedule_days: scheduleDays,
      base_updated_at: mod.updated_at
    })
    if (res.error) {
      toast.error(res.error)
      setScheduleSavingId(null)
      return
    }

    await loadCurricula()
    setScheduleSavingId(null)
    toast.success(`Updated ${mod.name} schedule`)
  }

  const restoreLesson = async (lesson: Lesson) => {
    setRestoringLessonId(lesson.id)
    const res = await api.restoreLesson(lesson.id, lesson.updated_at)
    if (res.error) {
      toast.error(res.error)
    } else {
      await loadCurricula()
      toast.success(`Restored "${lesson.title}"`)
    }
    setRestoringLessonId(null)
  }

  if (loading) return <LoadingSpinner message="Loading content..." />

  return (
    <div className="app-page-wide">
      <PageHeader
        title="Content"
        description={
          <>
            {summaries.length === 1 ? '1 curriculum' : `${summaries.length} curricula`} ·{' '}
            {canManageModules
              ? 'Shape reusable modules and lessons before assigning them to a cohort.'
              : selected?.editing?.can_edit
                ? 'You can edit lessons in curricula marked "You can edit". Admins change everything else.'
                : 'Only admins can change the shared course library.'}
          </>
        }
        actions={
          canManageModules ? (
            <>
              <Button variant="secondary" onClick={() => setShowPackageImport(true)}>
                <Upload className="h-4 w-4" /> Import course package
              </Button>
              <Button
                onClick={() => {
                  setCurriculumCreateError('')
                  setShowNewCurriculum(true)
                }}
              >
                <Plus className="h-4 w-4" /> New curriculum
              </Button>
            </>
          ) : null
        }
      />

      <p role="status" className="sr-only">
        {orderNotice}
      </p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_260px]">
        <nav
          aria-label="Curricula"
          className={`app-surface min-w-0 p-3 ${url.pane !== 'list' || location.hash ? 'hidden lg:block' : ''}`}
        >
          <label className="block text-sm font-semibold">
            Search library
            <input
              ref={searchRef}
              aria-keyshortcuts="Meta+/ Control+/"
              type="search"
              className="app-control mt-2 w-full"
              value={url.q}
              onChange={(e) => setUrlState({ q: e.target.value }, { history: 'replace' })}
            />
          </label>
          <div role="group" aria-label="Curriculum status" className="my-3 flex flex-wrap gap-1">
            {(['all', 'active', 'draft', 'archived'] as const).map((status) => (
              <Button
                key={status}
                variant={url.status === status ? 'primary' : 'quiet'}
                aria-pressed={url.status === status}
                onClick={() => setUrlState({ status })}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Button>
            ))}
          </div>
          <label className="block text-sm">
            Used by cohort
            <select
              className="app-control my-2 w-full"
              value={url.cohort || ''}
              onChange={(e) => setUrlState({ cohort: Number(e.target.value) || null })}
            >
              <option value="">All cohorts</option>
              {cohorts.map((co) => (
                <option key={co.id} value={co.id}>
                  {co.name}
                </option>
              ))}
            </select>
          </label>
          {visible.length === 0 && <p role="status">No curricula match these filters.</p>}
          {(['active', 'draft', 'archived'] as const).map((status) => (
            <div key={status}>
              {visible.some((c) => c.status === status) && (
                <h2 className="mt-4 px-2 text-xs font-bold uppercase text-ink-muted">{status}</h2>
              )}
              {visible
                .filter((c) => c.status === status)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-current={selectedId === c.id ? 'true' : undefined}
                    onClick={() => selectCurriculum(c.id)}
                    className={`my-1 min-h-11 w-full rounded-xl p-3 text-left hover:bg-surface-hover ${selectedId === c.id ? 'bg-surface-selected' : ''}`}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${status === 'active' ? 'bg-success-ink' : status === 'draft' ? 'bg-warning-ink' : 'bg-ink-muted'}`}
                      />
                      <span className="min-w-0 break-words font-semibold">{c.name}</span>
                    </span>
                    <span className="mt-1 block text-xs text-ink-muted">
                      {c.modules_count} modules ·{' '}
                      {(c.cohorts_count ?? cohorts.filter(co => co.curriculum_id === c.id).length) > 0 ? `${c.cohorts_count ?? cohorts.filter(co => co.curriculum_id === c.id).length} cohorts` : 'Not assigned'}
                    </span>
                  </button>
                ))}
            </div>
          ))}
          {searching && (
            <p role="status" className="p-2 text-sm">
              Searching modules and lessons…
            </p>
          )}
          {searchError && (
            <p role="alert" className="p-2 text-sm text-danger-ink">
              {searchError}
            </p>
          )}
          {searchResults.length > 0 && (
            <section aria-label="Matching modules and lessons" className="mt-3 border-t border-line pt-3">
              <h2 className="text-xs font-bold uppercase text-ink-muted">Modules and lessons</h2>
              {searchResults.map((r, i) => (
                <Link
                  key={`${r.path}-${i}`}
                  to={r.path}
                  state={listLinkState(location, 'Content')}
                  className="block min-h-11 break-words rounded-xl p-2 text-sm hover:bg-surface-hover"
                >
                  {r.title}
                  <span className="block text-xs text-ink-muted">{r.type}</span>
                </Link>
              ))}
            </section>
          )}
        </nav>
        <section
          aria-label="Curriculum outline"
          className={`min-w-0 ${url.pane !== 'detail' && !(location.hash && url.pane === 'list') ? 'hidden lg:block' : ''}`}
        >
          <Button variant="quiet" className="mb-3 lg:hidden" onClick={() => navigate({ pathname: location.pathname, search: applyUrlPatch(location.search, CONTENT_URL, { pane: 'list' }), hash: '' })}>
            Back to curricula
          </Button>
          {detailLoading ? (
            <LoadingSpinner message="Loading curriculum..." />
          ) : detailError ? (
            <div role="alert">
              {detailError}
              <Button onClick={() => setRevision((v) => v + 1)}>Retry</Button>
            </div>
          ) : (
            curricula.map((curriculum) => (
              <div
                id={`curriculum-${curriculum.id}`}
                key={curriculum.id}
                className="app-surface overflow-hidden"
              >
                <div className="px-4 py-4 border-b border-line bg-surface-sunken sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2
                        ref={headingRef}
                        tabIndex={-1}
                        className="break-words text-lg font-bold text-ink"
                        title={curriculum.name}
                      >
                        {curriculum.name}
                      </h2>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone={curriculum.status === 'active' ? 'success' : 'neutral'}>
                          {curriculum.status === 'active'
                            ? 'Active'
                            : curriculum.status.charAt(0).toUpperCase() + curriculum.status.slice(1)}
                        </Badge>
                        {!canManageModules && curriculum.editing?.reason === 'granted' && <Badge tone="info">You can edit</Badge>}
                        {!canManageModules && curriculum.editing?.reason === 'shared' && (
                          <Badge tone="neutral">Read only: shared with other cohorts</Badge>
                        )}
                        {curriculum.editing?.copy_of && (
                          <span className="inline-flex min-h-6 items-center text-xs font-semibold text-ink-secondary">
                            <RecordLink record={{ type: 'cohort', id: curriculum.editing.copy_of.cohort.id }} variant="plain">{curriculum.editing.copy_of.cohort.name}</RecordLink>'s copy
                          </span>
                        )}
                      </div>
                    </div>
                    {curriculum.editing && (curriculum.editing.copy_cohorts ?? []).length > 0 && (
                      <CopyForCohortAction
                        variant={canManageModules ? 'secondary' : 'primary'}
                        className="shrink-0"
                        curriculumId={curriculum.id}
                        cohorts={curriculum.editing.copy_cohorts ?? []}
                        onCopied={async (copy) => {
                          toast.success(copy.already_copied ? `Opened ${copy.cohort.name}'s copy` : `Made ${copy.cohort.name}'s copy`)
                          // The cohort now uses its copy: the cohort filter and
                          // "used by" read this list, so move it here too.
                          setCohorts((list) => list.map((co) => co.id === copy.cohort.id ? { ...co, curriculum_id: copy.copy_curriculum.id } : co))
                          await loadCurricula()
                          selectCurriculum(copy.copy_curriculum.id)
                        }}
                      />
                    )}
                    {canManageModules && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                          setModuleCreateError('')
                          setNewModuleModal({
                            curriculumId: curriculum.id,
                            moduleCount: curriculum.modules?.length || 0
                          })
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        New module
                      </Button>
                    )}
                  </div>
                  {curriculum.description && (
                    <p className="mt-2 text-sm text-ink-secondary">{curriculum.description}</p>
                  )}
                  {canManageModules && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StructureEditor record={curriculum} kind="curriculum" onSaved={loadCurricula} />
                      <details ref={actionsRef} className="relative">
                        <summary
                          className="flex min-h-11 cursor-pointer items-center rounded-xl border border-line px-4"
                          aria-label="More curriculum actions"
                        ><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></summary>
                        <div className="absolute right-0 z-10 mt-1 flex w-64 flex-wrap gap-2 rounded-xl border border-line bg-surface-raised p-3 shadow-raised">
                          <CurriculumStatusActions curriculum={curriculum} onSaved={loadCurricula} />
                          <Button variant="danger" onClick={() => void deleteCurriculum(curriculum)}>Delete curriculum</Button>
                        </div>
                      </details>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
                  <Button variant="secondary" onClick={() => setUrlState({ pane: 'files' })}>
                    Learner files
                  </Button>
                  {usedBy.map((co) => (
                    <Link
                      key={co.id}
                      to={`/admin/cohorts/${co.id}`}
                      className="inline-flex min-h-11 items-center text-sm underline"
                    >
                      {co.name}
                    </Link>
                  ))}
                  <div role="group" aria-label="Outline view" className="flex gap-1">
                    {(['sequence', 'calendar'] as const).map((view) => (
                      <Button
                        key={view}
                        variant={(sequence ? 'sequence' : 'calendar') === view ? 'primary' : 'quiet'}
                        aria-pressed={(sequence ? 'sequence' : 'calendar') === view}
                        onClick={() => setUrlState({ view })}
                      >
                        {view === 'sequence' ? 'Sequence' : 'Calendar'}
                      </Button>
                    ))}
                  </div>
                  <label className="w-full text-sm">
                    Search modules and lessons
                    <input
                      type="search"
                      className="app-control mt-1 w-full"
                      value={url.content}
                      onChange={(e) => setUrlState({ content: e.target.value }, { history: 'replace' })}
                    />
                  </label>
                </div>
                <div className="divide-y divide-line">
                  {curriculum.modules
                    ?.filter(
                      (mod) =>
                        !url.content.trim() ||
                        `${mod.name} ${mod.lessons.map((l) => l.title).join(' ')}`
                          .toLowerCase()
                          .includes(url.content.trim().toLowerCase())
                    )
                    .map((mod) => (
                      <div
                        id={`module-${mod.id}`}
                        key={mod.id}
                        onDragOver={(event) => {
                          if (canManageModules && !reordering) event.preventDefault()
                        }}
                        onDrop={(event) => {
                          if (!canManageModules || reordering) return
                          event.preventDefault()
                          const from = curriculum.modules.findIndex(
                            (item) =>
                              item.id === Number(event.dataTransfer.getData('application/x-csg-module-id'))
                          )
                          void moveModule(curriculum, from, curriculum.modules.indexOf(mod))
                        }}
                      >
                        {canManageModules && (
                          <ModuleActions
                            mod={mod}
                            index={curriculum.modules.indexOf(mod)}
                            count={curriculum.modules.length}
                            busy={reordering}
                            onMove={(from, to) => {
                              void moveModule(curriculum, from, to)
                            }}
                            onSaved={loadCurricula}
                          />
                        )}
                        <ModuleSection
                          mod={mod}
                          search={url.content}
                          sequence={sequence}
                          expanded={expandedModules.has(mod.id)}
                          activeWeek={activeWeekTab[mod.id] || 1}
                          onToggle={() => toggleModule(mod.id)}
                          onSetWeek={(w) => setWeek(mod.id, w)}
                          onAddExercise={(week, dayIndex) => openExerciseForDay(mod, week, dayIndex)}
                          onChangeSchedule={(scheduleDays) => updateModuleSchedule(mod, scheduleDays)}
                          canManageModules={canManageModules}
                          canEditLessons={canManageModules || Boolean(curriculum.editing?.can_edit)}
                          scheduleSaving={scheduleSavingId === mod.id}
                          restoringLessonId={restoringLessonId}
                          onRestoreLesson={restoreLesson}
                        />
                      </div>
                    ))}
                </div>
              </div>
            ))
          )}
        </section>
        <aside
          aria-label="Curriculum details and learner files"
          className={`app-surface min-w-0 ${url.pane === 'files' ? '' : 'hidden xl:block'}`}
        >
          <Button variant="quiet" className="m-3 xl:hidden" onClick={() => setUrlState({ pane: 'detail' })}>
            Back to outline
          </Button>
          {selected && selected.id === selectedId && (
            <>
              <div className="p-4">
                <h2 ref={filesRef} tabIndex={-1} className="break-words font-bold">{selected.name}</h2>
                <p className="mt-2 text-sm text-ink-secondary">
                  {selected.modules.length} modules ·{' '}
                  {selected.modules.reduce((n, m) => n + m.lessons.filter((l) => !l.archived_at).length, 0)}{' '}
                  lessons
                </p>
                <p className="mt-3 text-sm text-ink-muted">
                  Submission: learners send work for review. GitHub repo: a repository link is required.
                </p>
              </div>
              <CourseResourcesPanel
                key={selected.id}
                curriculumId={selected.id}
                draft={selected.status === 'draft'}
              />
            </>
          )}
        </aside>
      </div>

      {canManageModules && exerciseModal && (
        <NewExerciseModal
          moduleName={exerciseModal.moduleName}
          scheduleDays={exerciseModal.scheduleDays}
          weekCount={exerciseModal.weekCount}
          defaultWeek={exerciseModal.defaultWeek}
          defaultDayIndex={exerciseModal.defaultDayIndex}
          saving={exerciseSaving}
          error={exerciseCreateError}
          onClose={() => {
            setExerciseCreateError('')
            setExerciseModal(null)
          }}
          onCreate={async (data) => {
            setExerciseSaving(true)
            setExerciseCreateError('')
            const { upload_id, ...payload } = data
            const createPayload = {
              ...payload,
              video_upload_pending: Boolean(upload_id && !payload.s3_video_key)
            }
            const res = await api.createExercise(exerciseModal.moduleId, createPayload)
            if (res.error) {
              setExerciseCreateError(res.error)
              toast.error(res.error)
              setExerciseSaving(false)
              return
            }
            // If a video upload is still in flight, attach the new lesson/content block to it
            // so the background uploader can finish persisting the S3 video onto the new row.
            if (upload_id && res.data?.lesson) {
              const lesson = res.data.lesson
              const videoBlock = lesson.content_blocks?.find((cb) => cb.block_type === 'video')
              attachUpload(upload_id, {
                contentBlockId: videoBlock?.id,
                persistedS3Key: videoBlock?.s3_video_key,
                linkTo: lessonEditorPath(lesson.id),
                linkLabel: `Exercise: ${lesson.title}`
              })
            }
            setExerciseSaving(false)
            setExerciseModal(null)
            await loadCurricula()
            if (res.data?.lesson)
              navigate(lessonEditorPath(res.data.lesson.id), { state: listLinkState(location, 'Content') })
            toast.success(`Created exercise "${payload.title}"`)
          }}
        />
      )}

      {canManageModules && newModuleModal && (
        <NewModuleModal
          defaultPosition={newModuleModal.moduleCount}
          saving={moduleSaving}
          error={moduleCreateError}
          onClose={() => {
            setModuleCreateError('')
            setNewModuleModal(null)
          }}
          onCreate={async (data) => {
            setModuleSaving(true)
            setModuleCreateError('')
            const createRes = await api.createModule(newModuleModal.curriculumId, data)
            if (createRes.error) {
              setModuleCreateError(createRes.error)
              toast.error(createRes.error)
              setModuleSaving(false)
              return
            }
            await loadCurricula()
            setModuleSaving(false)
            setNewModuleModal(null)
            jumpToCurriculum(newModuleModal.curriculumId, createRes.data?.module.id)
            toast.success(`Created module "${data.name}"`)
          }}
        />
      )}

      {canManageModules && showPackageImport && (
        <ImportCoursePackageModal
          onClose={() => setShowPackageImport(false)}
          onImported={async (id) => {
            await loadCurricula()
            jumpToCurriculum(id)
            toast.success('Course package draft is ready for editing')
          }}
        />
      )}

      {canManageModules && showNewCurriculum && (
        <NewCurriculumModal
          saving={curriculumSaving}
          error={curriculumCreateError}
          onClose={() => {
            setCurriculumCreateError('')
            setShowNewCurriculum(false)
          }}
          onCreate={async (data) => {
            setCurriculumSaving(true)
            setCurriculumCreateError('')
            const res = await api.createCurriculum(data)
            if (res.error) {
              setCurriculumCreateError(res.error)
              toast.error(res.error)
              setCurriculumSaving(false)
              return
            }
            await loadCurricula()
            setCurriculumSaving(false)
            setShowNewCurriculum(false)
            if (res.data?.curriculum) jumpToCurriculum(res.data.curriculum.id)
            toast.success(`Created curriculum "${data.name}"`)
          }}
        />
      )}
    </div>
  )
}

function ModuleSection({
  mod,
  sequence,
  search,
  expanded,
  activeWeek: requestedWeek,
  onToggle,
  onSetWeek,
  onAddExercise,
  onChangeSchedule,
  canManageModules,
  canEditLessons,
  scheduleSaving,
  restoringLessonId,
  onRestoreLesson
}: {
  mod: Module
  sequence: boolean
  search: string
  expanded: boolean
  activeWeek: number
  onToggle: () => void
  onSetWeek: (w: number) => void
  onAddExercise: (week: number, dayIndex: number) => void
  onChangeSchedule: (scheduleDays: string) => void
  canManageModules: boolean
  canEditLessons: boolean
  scheduleSaving: boolean
  restoringLessonId: number | null
  onRestoreLesson: (lesson: Lesson) => void
}) {
  const location = useLocation()
  const matches = (lesson: Lesson) => !search.trim() || mod.name.toLowerCase().includes(search.trim().toLowerCase()) || lesson.title.toLowerCase().includes(search.trim().toLowerCase())
  const [showEmptyDays, setShowEmptyDays] = useState(false)
  const activeLessons = useMemo(
    () => (mod.lessons || []).filter((lesson) => !lesson.archived_at),
    [mod.lessons]
  )
  const archivedLessons = useMemo(
    () => (mod.lessons || []).filter((lesson) => lesson.archived_at),
    [mod.lessons]
  )
  const lessonsByDay = useMemo(() => groupLessonsByDay(activeLessons), [activeLessons])
  const scheduleIndices = SCHEDULE_DAY_INDICES[mod.schedule_days] || SCHEDULE_DAY_INDICES.weekdays

  const weekNumbers = useMemo(() => {
    const weeks = new Set<number>()
    for (const l of activeLessons) {
      weeks.add(Math.floor(l.release_day / 7) + 1)
    }
    if (weeks.size === 0) return []
    return Array.from(weeks).sort((a, b) => a - b)
  }, [activeLessons])
  // A week from the URL that this module doesn't have shows its first week.
  const activeWeek = weekNumbers.includes(requestedWeek) ? requestedWeek : (weekNumbers[0] ?? 1)

  const scheduleLabel =
    SCHEDULE_PATTERN_OPTIONS.find((option) => option.value === mod.schedule_days)?.label || 'MTWTF / Mon–Fri'

  const exerciseCount = activeLessons.length

  const daysInActiveWeek = useMemo(() => {
    return scheduleIndices.map((dayIdx) => {
      const releaseDay = (activeWeek - 1) * 7 + dayIdx
      const exercises = lessonsByDay[releaseDay] || []
      return { dayIdx, releaseDay, exercises }
    })
  }, [activeWeek, scheduleIndices, lessonsByDay])

  return (
    <div>
      {/* Module header */}
      <div className="w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 hover:bg-surface-sunken transition-colors duration-150">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="pressable flex min-h-11 flex-1 items-center gap-2 sm:gap-3 rounded-xl text-left min-w-0"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-ink-muted shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-muted shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="break-words text-sm font-semibold text-ink" title={mod.name}>
              {mod.name}
            </p>
            <p className="text-xs text-ink-muted capitalize tabular-nums">
              {mod.module_type.replace('_', ' ')} · {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''} ·{' '}
              {weekNumbers.length} week{weekNumbers.length !== 1 ? 's' : ''} · {scheduleLabel}
              {archivedLessons.length > 0 ? ` · ${archivedLessons.length} archived` : ''}
            </p>
          </div>
        </button>
        <div className="flex flex-wrap items-center gap-1 pl-6 sm:pl-0 shrink-0">
          {canManageModules && (
            <select
              value={mod.schedule_days}
              disabled={scheduleSaving}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onChangeSchedule(event.target.value)}
              className="app-control px-2"
              aria-label={`Schedule pattern for ${mod.name}`}
            >
              {SCHEDULE_PATTERN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
          {canManageModules && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const si = scheduleIndices
                  const lastDay =
                    activeLessons.length > 0 ? Math.max(...activeLessons.map((l) => l.release_day)) : -1
                  const lastWeek = Math.floor(lastDay / 7) + 1
                  const lastDayIdx = lastDay % 7
                  const pos = si.indexOf(lastDayIdx)
                  let nextWeek = lastWeek,
                    nextDay = si[0]
                  if (pos >= 0 && pos < si.length - 1) nextDay = si[pos + 1]
                  else nextWeek = lastWeek + 1
                  if (lastDay < 0) {
                    nextWeek = 1
                    nextDay = si[0]
                  }
                  onAddExercise(nextWeek, nextDay)
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Exercise
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Expanded content: week tabs + day list (like prework grader) */}
      <Collapse open={expanded}>
        <div className="px-4 sm:px-6 pb-5">
          {sequence ? (
            <SequenceLessons lessons={activeLessons.filter(matches)} canEdit={canEditLessons} />
          ) : weekNumbers.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-ink-muted mb-3">No exercises yet</p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-ink-muted">Scroll for more weeks →</p>
              <TabList
                label={`${mod.name} weeks`}
                className="flex items-center gap-1 border-b border-line mb-4 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0"
              >
                {weekNumbers.map((w) => (
                  <TabButton
                    key={w}
                    asTab
                    dense
                    selected={activeWeek === w}
                    onClick={() => onSetWeek(w)}
                    className="shrink-0 tabular-nums"
                  >
                    Week {w}
                  </TabButton>
                ))}
              </TabList>

              {daysInActiveWeek.some((day) => !day.exercises.length) && (
                <Button
                  variant="quiet"
                  aria-expanded={showEmptyDays}
                  onClick={() => setShowEmptyDays((value) => !value)}
                  className="mb-3"
                >
                  {showEmptyDays
                    ? 'Hide empty days'
                    : `Show empty days (${daysInActiveWeek.filter((day) => !day.exercises.length).length})`}
                </Button>
              )}
              {/* Days in the active week */}
              <TabPanel key={activeWeek} aria-label={`Week ${activeWeek}`} className="space-y-4">
                {daysInActiveWeek
                  .filter((day) => showEmptyDays || day.exercises.length > 0)
                  .map(({ dayIdx, exercises }) => (
                    <div key={dayIdx} className="rounded-xl border border-line overflow-hidden">
                      {/* Day header */}
                      <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-surface-sunken border-b border-line">
                        <h4 className="text-sm font-semibold text-ink">
                          Day {dayIdx + 1} · {ALL_DAY_NAMES[dayIdx]}
                        </h4>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-ink-muted tabular-nums">
                            {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
                          </span>
                          {canManageModules && (
                            <Button
                              variant="quiet"
                              size="sm"
                              onClick={() => onAddExercise(activeWeek, dayIdx)}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Exercises in this day */}
                      {exercises.length === 0 ? (
                        <div className="px-4 py-1">
                          {canManageModules && (
                            <TextButton
                              tone="quiet"
                              className="text-xs"
                              onClick={() => onAddExercise(activeWeek, dayIdx)}
                            >
                              + Add first exercise for this day
                            </TextButton>
                          )}
                        </div>
                      ) : (
                        <table className="w-full table-fixed" aria-label="Lessons for this day"><tbody>
                          {exercises.filter(matches)
                            .sort((a, b) => a.position - b.position)
                            .map((lesson) => {
                              return <LessonRow key={lesson.id} lesson={lesson} canEdit={canEditLessons} />
                            })}
                        </tbody></table>
                      )}
                    </div>
                  ))}
              </TabPanel>
            </>
          )}

          {archivedLessons.length > 0 && (
            <details className="app-surface-muted mt-5 overflow-hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-surface-hover">
                <Archive className="h-4 w-4 text-ink-muted" />
                Archived exercises
                <Badge tone="neutral" className="shrink-0 tabular-nums">
                  {archivedLessons.length}
                </Badge>
              </summary>
              <div className="divide-y divide-line border-t border-line bg-surface-raised">
                {archivedLessons.filter(matches).map((lesson) => {
                  const week = Math.floor(lesson.release_day / 7) + 1
                  const day = lesson.release_day % 7
                  return (
                    <div
                      key={lesson.id}
                      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-ink" title={lesson.title}>
                          <RecordLink
                            record={{ type: 'lesson', id: lesson.id }}
                            returnLabel="Content"
                            variant="plain"
                            touchTarget
                            truncate
                            className="font-semibold"
                          >
                            {lesson.title}
                          </RecordLink>
                        </p>
                        <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
                          Week {week} · {ALL_DAY_NAMES[day]}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <LinkButton
                          variant="quiet"
                          size="sm"
                          to={lessonEditorPath(lesson.id, { preview: true })}
                          state={listLinkState(location, 'Content')}
                        >
                          <Eye className="h-4 w-4" />
                          Review
                        </LinkButton>
                        {canManageModules && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onRestoreLesson(lesson)}
                            disabled={restoringLessonId === lesson.id}
                          >
                            <RotateCcw className="h-4 w-4" />
                            {restoringLessonId === lesson.id ? 'Restoring...' : 'Restore'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </details>
          )}
        </div>
      </Collapse>
    </div>
  )
}
