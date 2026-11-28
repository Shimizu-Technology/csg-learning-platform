import { PausedLearningBanner } from '../../components/student/PausedLearningBanner'
import { PageHeader } from '../../components/ui/PageHeader'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { ArrowRight, BookOpen, CheckCircle2, ChevronRight, Code2, FileText, FolderGit2, Info, ListChecks, Lock, PlayCircle, RefreshCw, Search, SearchX, Video, WifiOff, type LucideIcon } from 'lucide-react'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { api } from '../../lib/api'
import { learnerLearnPath } from '../../lib/routes'
import { brand } from '../../lib/brand'
import { formatShortDate } from '../../lib/format'
import { LEARNER_STATUS } from '../../lib/learningStatus'
import { listLinkState, shouldRestoreList, useListScrollMemory } from '../../lib/navigationContext'
import { urlParsers, useUrlSearch, useUrlState } from '../../lib/useUrlState'
import { useLearnerPaths } from '../../lib/useRecordPath'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { StatusIcon } from '../../components/shared/StatusBadge'
import { Badge } from '../../components/ui/Badge'
import { Button, LinkButton } from '../../components/ui/Button'
import { Collapse } from '../../components/ui/Motion'
import type { CourseOutline as Outline, CourseOutlineGroup, CourseOutlineLesson, LessonKind } from '../../types/api'

/*
 * Learn, redesigned (W8 PR 8.1; C-2, U-5.6, S-1, S-9). One outline for every
 * delivery mode, read from GET /api/v1/course_outline: statuses, counts, the
 * next lesson and each lesson's kind all come from the server (LearnerProgress
 * and LessonKind), so this page only shows them, searches titles and filters
 * by the server's own buckets. Shown when the cohort's "New student
 * experience" switch is on; `Materials` is the page when it is off.
 */

const SHOW_FILTERS = ['all', 'todo', 'redo'] as const
type ShowFilter = typeof SHOW_FILTERS[number]
// Search, the filter and the open week live in the URL (L-0.6), so Back from a lesson restores them.
const OUTLINE_URL = { show: urlParsers.oneOf(SHOW_FILTERS, 'all'), open: urlParsers.text(40), module: urlParsers.id(), week: urlParsers.id() }

const KINDS: Record<LessonKind, { label: string; icon: LucideIcon }> = {
  exercise: { label: 'Exercise', icon: Code2 },
  project: { label: 'Project', icon: FolderGit2 },
  video: { label: 'Video', icon: PlayCircle },
  recording: { label: 'Recording', icon: Video },
  checkpoint: { label: 'Check', icon: ListChecks },
  reading: { label: 'Reading', icon: FileText },
}

// Status icon colours by the shared status tones.
const STATUS_INK: Record<CourseOutlineLesson['status'], string> = {
  done: 'text-success-ink',
  awaiting_review: 'text-info-ink',
  redo: 'text-warning-ink',
  in_progress: 'text-primary-ink',
  open: 'text-ink-disabled',
  upcoming: 'text-ink-disabled',
  closed: 'text-ink-muted',
}

interface CourseOutlineProps {
  /** Staff View as student: the previewed learner, whose outline is read instead of the viewer's. */
  previewStudentId?: number
  previewCohortId?: number
}

export function CourseOutline({ previewStudentId, previewCohortId }: CourseOutlineProps = {}) {
  const { user } = useAuthContext()
  const { selectedCohortId } = useCohortContext()
  const cohortId = previewCohortId ?? selectedCohortId
  const paths = useLearnerPaths(cohortId)
  const navigate = useNavigate()
  const location = useLocation()
  const preview = previewStudentId !== undefined
  const [outline, setOutline] = useState<Outline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notEnrolled, setNotEnrolled] = useState(false)
  const [query, setQuery] = useUrlSearch('q')
  const [{ show, open, module: moduleId, week: weekNumber }, setUrlState] = useUrlState(OUTLINE_URL)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const request = useRef(0)
  useListScrollMemory(!loading && Boolean(outline))
  const navigationType = useNavigationType()
  const scrolledToTarget = useRef(shouldRestoreList(navigationType, location.state))
  const lessonLinkState = listLinkState(location, 'Learn')

  const load = useCallback(() => {
    const current = ++request.current
    if (user?.is_staff && !preview) { navigate('/admin', { replace: true }); return }
    setLoading(true)
    setError(null)
    setNotEnrolled(false)
    api.getCourseOutline(cohortId, previewStudentId).then((result) => {
      if (current !== request.current) return
      if (result.data?.outline) setOutline(result.data.outline)
      else if (result.errorKind === 'not_found') setNotEnrolled(true)
      else setError(result.error || 'Unable to load Learn right now.')
    }).catch((reason: unknown) => {
      if (current === request.current) setError(reason instanceof Error ? reason.message : 'Unable to load Learn right now.')
    }).finally(() => { if (current === request.current) setLoading(false) })
  }, [cohortId, navigate, preview, previewStudentId, user?.is_staff])

  useEffect(() => { load() }, [load])

  const initializedOutline = useRef<{ outline: Outline; week: number | null } | null>(null)

  // Open the current week (the one holding the next lesson), the week named in the
  // URL, or the module a link asked for. Search and filters open every match instead.
  useEffect(() => {
    if (!outline) return
    const groups = outline.modules.flatMap((mod) => mod.groups)
    const initial = new Set<string>()
    const initialLoad = initializedOutline.current?.outline !== outline
    const newWeekHint = weekNumber && initializedOutline.current?.week !== weekNumber
    initializedOutline.current = { outline, week: weekNumber }
    const requestedGroups = weekNumber ? groups.filter((group) => group.week === weekNumber) : []
    const fallback = outline.current_group_key ?? groups.find((group) => group.this_week)?.key ?? (outline.mode === 'library' ? groups[0]?.key : undefined)
    if ((initialLoad || newWeekHint) && requestedGroups.length) requestedGroups.forEach((group) => initial.add(group.key))
    else if ((initialLoad || newWeekHint) && fallback) initial.add(fallback)
    if (open && groups.some((group) => group.key === open)) initial.add(open)
    const linkedModule = moduleId ? outline.modules.find((mod) => mod.id === moduleId) : undefined
    if (linkedModule?.groups.length) initial.add((linkedModule.groups.find((group) => group.current) ?? linkedModule.groups[0]).key)
    setOpenGroups(current => initialLoad ? initial : new Set([...current, ...initial]))
  }, [outline, open, moduleId, weekNumber])

  useEffect(() => {
    if (!outline || scrolledToTarget.current || !moduleId) return
    scrolledToTarget.current = true
    document.getElementById(`learn-module-${moduleId}`)?.scrollIntoView?.({ block: 'start' })
  }, [outline, moduleId])

  const toggleGroup = (key: string) => {
    const opening = !openGroups.has(key)
    setOpenGroups((current) => {
      const next = new Set(current)
      if (opening) next.add(key)
      else next.delete(key)
      return next
    })
    // Opening a week names it in the URL; closing the named week clears it. Replaces: it's like scrolling.
    if (opening) setUrlState({ open: key, week: null, module: null }, { history: 'replace' })
    else setUrlState({ open: open === key ? '' : open, week: null, module: null }, { history: 'replace' })
  }

  const visible = useMemo(() => {
    if (!outline) return null
    const q = query.trim().toLowerCase()
    const matches = (lesson: CourseOutlineLesson, moduleName: string) => {
      if (show === 'todo' && !lesson.todo) return false
      if (show === 'redo' && lesson.status !== 'redo') return false
      return !q || lesson.title.toLowerCase().includes(q) || moduleName.toLowerCase().includes(q)
    }
    const modules = outline.modules.map((mod) => ({
      ...mod,
      groups: mod.groups.map((group) => ({ ...group, lessons: group.lessons.filter((lesson) => matches(lesson, mod.name)) })).filter((group) => group.lessons.length > 0),
    })).filter((mod) => mod.groups.length > 0)
    return { modules, narrowed: Boolean(q) || show !== 'all' }
  }, [outline, query, show])

  if (loading && !outline) return <LoadingSpinner message="Loading Learn…" />
  if (error && !outline) {
    return <EmptyState headingLevel={1} icon={WifiOff} title="Could not load Learn" description={error} action={<Button onClick={load}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} />
  }
  if (notEnrolled || !outline || !visible) {
    return <EmptyState headingLevel={1} icon={BookOpen} title="No lessons yet" description="Your modules and lessons will appear here once you are enrolled in a course." action={<Link to="/courses" className="app-link inline-flex min-h-11 items-center">Browse courses</Link>} />
  }

  const requestedModule = new URLSearchParams(location.search).get('module')
  if (!loading && requestedModule && !outline.modules.some((mod) => mod.id === moduleId)) {
    return <EmptyState headingLevel={1} icon={BookOpen} title="Module not found" description="This module is not available in your course." action={<LinkButton to={learnerLearnPath(cohortId)} variant="secondary">Back to Learn</LinkButton>} />
  }

  const library = outline.mode === 'library'
  const selfPaced = outline.mode === 'self_paced'
  const next = outline.next_lesson
  const lessonPath = (lesson: Pick<CourseOutlineLesson, 'id' | 'redo_block_id'>) => paths.lesson(lesson.id, lesson.redo_block_id ? `block-${lesson.redo_block_id}` : undefined)
  const filters: Array<{ key: ShowFilter; label: string; count?: number }> = library ? [] : [
    { key: 'all', label: 'All' },
    ...(outline.read_only ? [] : [{ key: 'todo' as const, label: 'To do', count: outline.filters.todo }]),
    { key: 'redo', label: 'Needs redo', count: outline.filters.redo },
  ]
  const context: ReactNode[] = library
    ? ['Workshops and new material for graduates. Watch anything, in any order.']
    : [
        outline.personal_pace ? paceLabel(outline.personal_pace) : selfPaced ? 'Self-paced' : outline.cohort.name,
        outline.counts && <span key="counts" className="tabular-nums">{outline.counts.completed_lessons} of {outline.counts.total_lessons} lessons</span>,
        outline.course_week && <span key="week" className="tabular-nums">Week {outline.course_week.current} of {outline.course_week.total}</span>,
        outline.personal_pace?.ends_on && <span key="ends" className="tabular-nums">{outline.personal_pace.final_project ? 'Final project due' : 'Plan ends'} {formatShortDate(outline.personal_pace.ends_on, '', { withYear: false, weekday: true })}</span>,
      ].filter(Boolean)

  return (
    <div className="app-page max-w-4xl space-y-4 lg:space-y-5" data-testid="course-outline">
      {next && (
        <div className="sticky top-16 z-30 lg:top-4">
          <div className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface-raised/95 px-3 py-2 shadow-raised backdrop-blur sm:px-4" data-testid="continue-bar">
            <PlayCircle className="h-5 w-5 shrink-0 text-primary-ink" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-ink-muted">Continue{selfPaced ? <span className="tabular-nums"> · lesson {next.number} of {outline.lesson_count}</span> : null}</p>
              <p className="truncate text-sm font-bold text-ink">{next.title}</p>
            </div>
            <LinkButton to={lessonPath(next)} state={lessonLinkState} size="sm" className="shrink-0">Open<ArrowRight className="h-4 w-4" aria-hidden="true" /></LinkButton>
          </div>
        </div>
      )}

      <PageHeader title={library ? `${brand.schoolAbbreviation} Alumni library` : outline.course_title} description={<>{context.map((item, index) => <span key={index}>{index > 0 && ' · '}{item}</span>)}</>} />

      {outline.enrollment_status === 'paused' && <PausedLearningBanner cohortId={cohortId} pausedSince={outline.paused_since} />}
      {outline.read_only && outline.enrollment_status !== 'paused' && (
        <div className="flex items-start gap-3 rounded-2xl border border-info-line bg-info-soft px-4 py-3 text-sm text-info-ink" role="status">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>This course is read-only. Past lessons and feedback stay open to read.</p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={library ? 'Search the library' : 'Search this course'} aria-label={library ? 'Search the library' : 'Search this course'} className="app-control w-full pl-10 text-base sm:text-sm" />
        </div>
        {filters.length > 0 && (
          <div role="group" aria-label="Show" className="flex shrink-0 rounded-xl border border-line bg-surface-sunken p-1">
            {filters.map((item) => (
              <button key={item.key} type="button" aria-pressed={show === item.key} onClick={() => setUrlState({ show: item.key })}
                className={`pressable min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold sm:flex-none ${show === item.key ? 'bg-surface-raised text-ink shadow-raised' : 'text-ink-secondary hover:text-ink'}`}>
                {item.label}{item.count !== undefined && item.count > 0 && <span className="ml-1.5 tabular-nums text-ink-muted">{item.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {outline.modules.length === 0 ? (
        <EmptyState icon={BookOpen} title="Your course isn’t open yet" description="Your lessons will appear here as soon as your instructor opens them." />
      ) : visible.modules.length === 0 ? (
        <EmptyState icon={SearchX} title={query.trim() ? `No lessons match “${query.trim()}”` : show === 'redo' ? 'No redos right now' : 'Nothing to do right now'}
          description={query.trim() ? 'Search looks through every week of this course. Try a shorter word, or clear the filter.' : 'Switch to All to see every lesson in this course.'}
          action={<Button variant="secondary" onClick={() => { setQuery(''); setUrlState({ show: 'all' }) }}>{query.trim() ? 'Clear search' : 'Show all lessons'}</Button>} />
      ) : (
        <div className="space-y-6">
          {visible.modules.map((mod) => {
            const labelled = mod.groups.some((group) => group.label)
            return (
              <section key={mod.id} id={`learn-module-${mod.id}`} aria-labelledby={`learn-module-title-${mod.id}`} className="scroll-mt-36 space-y-2 lg:scroll-mt-24">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
                  <h2 id={`learn-module-title-${mod.id}`} className="text-lg font-bold text-ink [overflow-wrap:anywhere]"><Link to={`/materials?cohort_id=${outline.cohort.id}&module=${mod.id}`} className="app-link inline-flex min-h-11 min-w-11 items-center">{selfPaced ? `${mod.number}. ${mod.name}` : mod.name}</Link></h2>
                  {mod.counts && <span className="text-sm tabular-nums text-ink-muted">{selfPaced ? '' : `Module ${mod.number} · `}{mod.counts.completed_lessons} of {mod.counts.total_lessons}</span>}
                  {!mod.available && !outline.read_only && <Lock className="h-4 w-4 text-ink-muted" aria-label="Not open yet" />}
                </div>
                <div className="app-surface overflow-hidden">
                  {mod.groups.map((group, index) => {
                    const expanded = visible.narrowed || openGroups.has(group.key)
                    const rows = <LessonRows group={group} outline={outline} lessonPath={lessonPath} linkState={lessonLinkState} />
                    if (!labelled) {
                      // One group: the module heading names it, so the rows sit in the card, collapsible from a slim bar.
                      return (
                        <div key={group.key}>
                          <GroupTrigger library={library} expanded={expanded} onToggle={() => toggleGroup(group.key)} controls={`learn-group-${group.key}`} disabled={visible.narrowed}
                            title={<span className="text-sm font-semibold text-ink-secondary">{expanded ? 'Lessons' : `Show ${group.lessons.length} ${group.lessons.length === 1 ? 'lesson' : 'lessons'}`}</span>} group={group} />
                          <Collapse open={expanded} id={`learn-group-${group.key}`}>{rows}</Collapse>
                        </div>
                      )
                    }
                    return (
                      <div key={group.key} className={index > 0 ? 'border-t border-line' : ''}>
                        <GroupTrigger library={library} expanded={expanded} onToggle={() => toggleGroup(group.key)} controls={`learn-group-${group.key}`} disabled={visible.narrowed} group={group}
                          title={<span className="font-bold text-ink">{group.label}</span>} />
                        <Collapse open={expanded} id={`learn-group-${group.key}`}>{rows}</Collapse>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GroupTrigger({ expanded, onToggle, controls, disabled, title, group, library }: { expanded: boolean; onToggle: () => void; controls: string; disabled: boolean; title: ReactNode; group: CourseOutlineGroup; library: boolean }) {
  // The alumni library is browsed, not tracked (U-5.10): no redo, progress or next badges.
  const redos = library ? 0 : group.lessons.filter((lesson) => lesson.status === 'redo').length
  const complete = group.counts && group.counts.total_lessons > 0 && group.counts.completed_lessons === group.counts.total_lessons
  return (
    <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={controls} disabled={disabled}
      className="flex min-h-[52px] w-full items-center gap-2.5 px-4 py-2 text-left transition-colors duration-150 hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent sm:px-5">
      <ChevronRight className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200 ease-[var(--ease-out)] motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
        {title}
        {group.this_week && <Badge tone="brand">This week</Badge>}
        {!group.available && group.opens_on && <span className="text-sm text-ink-muted">Opens {formatShortDate(group.opens_on, '', { withYear: false, weekday: true })}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {redos > 0 && <Badge tone="warning">{redos} {redos === 1 ? 'redo' : 'redos'}</Badge>}
        {group.counts && group.available && <span className="text-sm tabular-nums text-ink-muted">{group.counts.completed_lessons} of {group.counts.total_lessons}</span>}
        {complete && <CheckCircle2 className="h-4 w-4 shrink-0 text-success-ink" aria-label="All done" />}
        {!group.available && <Lock className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />}
      </span>
    </button>
  )
}

function LessonRows({ group, outline, lessonPath, linkState }: { group: CourseOutlineGroup; outline: Outline; lessonPath: (lesson: CourseOutlineLesson) => string; linkState: ReturnType<typeof listLinkState> }) {
  const library = outline.mode === 'library'
  const selfPaced = outline.mode === 'self_paced'
  return (
    <ul className="divide-y divide-line border-t border-line">
      {group.lessons.map((lesson) => {
        const kind = KINDS[lesson.kind]
        const KindIcon = kind.icon
        const current = outline.next_lesson?.id === lesson.id
        const meta = [kind.label, !library && statusText(lesson), dueText(lesson), !lesson.required && 'Optional', current && 'Next up'].filter(Boolean).join(' · ')
        const body = (
          <>
            {selfPaced && <span className="w-7 shrink-0 text-right text-xs font-bold tabular-nums text-ink-muted" aria-hidden="true">{lesson.number}</span>}
            {!library && (
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${current ? 'text-primary-ink' : STATUS_INK[lesson.status]}`}>
                <StatusIcon status={lesson.status} className="h-[18px] w-[18px]" />
                <span className="sr-only">{LEARNER_STATUS[lesson.status].shortLabel}</span>
              </span>
            )}
            <KindIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span data-lesson-title className="block line-clamp-2 text-[15px] font-semibold leading-5 text-ink [overflow-wrap:anywhere] sm:truncate">{lesson.title}</span>
              <span className="block truncate text-xs text-ink-muted">{meta}</span>
            </span>
            {current && <span className="hidden rounded-xl bg-action-primary px-3 py-1.5 text-sm font-semibold text-on-action sm:inline-flex">Continue</span>}
            {lesson.available && !current && <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />}
          </>
        )
        const rowClass = `flex min-h-[52px] items-center gap-3 px-4 py-2 sm:px-5 ${current ? 'bg-surface-selected shadow-[inset_3px_0_0_var(--brand-ruby)]' : ''}`
        return (
          <li key={lesson.id} data-lesson-status={lesson.status} data-lesson-kind={lesson.kind}>
            {lesson.available
              ? <Link to={lessonPath(lesson)} state={linkState} aria-current={current ? 'step' : undefined} className={`pressable ${rowClass} hover:bg-surface-hover`}>{body}</Link>
              : <div className={`${rowClass} opacity-80`} aria-disabled="true">{body}</div>}
          </li>
        )
      })}
    </ul>
  )
}

/** "Your pace: 4 weeks from Nov 18" for a course with learner-chosen pace (W9.1). */
function paceLabel(pace: NonNullable<Outline['personal_pace']>) {
  const from = pace.starts_on ? ` from ${formatShortDate(pace.starts_on, '', { withYear: false })}` : ''
  return `${pace.weeks ? `Your pace: ${pace.weeks} weeks` : 'Your own pace'}${from}`
}

/** The lesson's soft milestone date in the learner's plan, until it's handed in. */
function dueText(lesson: CourseOutlineLesson) {
  if (!lesson.due_on || lesson.status === 'done' || lesson.status === 'awaiting_review') return null
  return `Weekly target ${formatShortDate(lesson.due_on, '', { withYear: false, weekday: true })}`
}

function statusText(lesson: CourseOutlineLesson) {
  switch (lesson.status) {
    case 'upcoming': return lesson.opens_on ? `Opens ${formatShortDate(lesson.opens_on, '', { withYear: false, weekday: true })}` : 'Not open yet'
    case 'open': return null
    case 'awaiting_review': return 'Waiting for review'
    case 'redo': return 'Redo requested'
    default: return LEARNER_STATUS[lesson.status].shortLabel
  }
}

export function CourseOutlineRoute() {
  return <CourseOutline />
}
