import { useParams, useSearchParams } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Archive, BookOpen, ClipboardCheck, Code2, Copy, Eye, FileText, Files, FolderOpen, GitBranch, Layers, Layers3, LibraryBig,
  LifeBuoy, ListChecks, PencilLine, PlayCircle, RefreshCw, SquareTerminal, Target,
} from 'lucide-react'
import { ReturnOrigin } from '../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../components/shared/RelatedPanel'
import { RecordLink } from '../../components/shared/RecordLink'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { NoAccess } from '../../components/shared/NoAccess'
import { UsedInCohorts } from '../../components/admin/UsedInCohorts'
import { Badge } from '../../components/ui/Badge'
import { Button, LinkButton } from '../../components/ui/Button'
import { useBackLink } from '../../lib/recordOrigin'
import { cohortStudentViewLessonPath, curriculumPath, lessonEditorPath, moduleRecordPath } from '../../lib/routes'
import { gradingPath, plural, supportPath, useRecordUsage, type UsageState } from '../../lib/recordUsage'
import { formatShortDate } from '../../lib/format'
import { humanize, TERMS } from '../../lib/glossary'
import { shortAgo, type RelatedRow } from '../../lib/recordRelated'
import type { CurriculumUsage, LessonUsage, ModuleUsage, UsageLessonRef } from '../../types/api'

/*
 * Staff record pages for content (L-5): a curriculum, a module and a lesson,
 * each with a stable URL, a record header (spec §4.2) and a related panel
 * (§4.3), built from one request (GET /records/:type/:id/usage). The route is
 * staff-only; students get "No access" before anything loads.
 */

const BLOCK_ICONS: Record<string, LucideIcon> = { text: FileText, video: PlayCircle, recording: PlayCircle, exercise: Code2, code_challenge: SquareTerminal, checkpoint: ListChecks }
const BLOCK_LABELS: Record<string, string> = { text: 'Text', video: 'Video', recording: 'Recording', exercise: TERMS.exercise, code_challenge: 'Code challenge', checkpoint: TERMS.checkpoint }

function useRouteId() {
  const { id } = useParams<{ id: string }>()
  const value = Number(id)
  return Number.isInteger(value) && value > 0 ? value : null
}

/** Loading, missing and failed states shared by the three pages (spec §5). */
function UsageGate<T>({ state, label, children }: { state: UsageState<T>; label: string; children: (usage: T) => React.ReactNode }) {
  if (state.usage) return <>{children(state.usage)}</>
  if (state.missing) return <NoAccess />
  if (state.loading) return <LoadingSpinner message={`Loading ${label}…`} />
  return (
    <div className="app-page">
      <EmptyState icon={LibraryBig} title={`Couldn't load this ${label}`} description={state.error || 'Something went wrong. Try again.'}
        action={<Button onClick={() => void state.reload()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} />
    </div>
  )
}

function Section({ id, title, count, children, action }: { id: string; title: string; count?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="app-surface overflow-hidden" tabIndex={-1}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 id={`${id}-title`} className="text-base font-semibold text-ink">{title}</h2>
        <div className="flex items-center gap-2">
          {count && <span className="text-xs font-semibold tabular-nums text-ink-muted">{count}</span>}
          {action}
        </div>
      </div>
      {children}
    </section>
  )
}

function studioPath(curriculumId: number, moduleId?: number) {
  return `/admin/content?curriculum=${curriculumId}&pane=detail${moduleId ? `&open=${moduleId}` : ''}`
}

/**
 * The counts a page shows and the scope its links open, so every number equals
 * the list it leads to. Focused on one cohort (`?cohort_id=`, one the viewer can
 * see): that cohort's counts and lists. Otherwise: the totals across the
 * cohorts listed, and links without a cohort, which cover exactly those.
 */
function focusScope<C extends { id: number; name: string; submissions: number; waiting: number; open_help: number | null }>(
  focusId: number | null, cohorts: C[], totals: { submissions: number; waiting: number; open_help: number | null },
) {
  const focused = focusId ? cohorts.find((cohort) => cohort.id === focusId) ?? null : null
  return focused
    ? { cohortId: focused.id, name: focused.name, counts: { submissions: focused.submissions, waiting: focused.waiting, open_help: focused.open_help } }
    : { cohortId: null, name: null, counts: totals }
}

const inCohort = (label: string, name: string | null) => (name ? `${label} in ${name}` : label)

/* -------------------------------------------------------------------------- */
/* Lesson                                                                     */
/* -------------------------------------------------------------------------- */

export function LessonRecord() {
  const id = useRouteId()
  const state = useRecordUsage('lesson', id)
  return <UsageGate state={state} label="lesson">{(usage) => <LessonPage key={usage.id} usage={usage} />}</UsageGate>
}

function LessonPage({ usage }: { usage: LessonUsage }) {
  const [params] = useSearchParams()
  const focusId = Number(params.get('cohort_id')) || null
  const back = useBackLink({ returnTo: moduleRecordPath(usage.module.id), returnLabel: usage.module.name })
  const { cohortId, name: focusName, counts } = focusScope(focusId, usage.cohorts, usage.totals)
  const previewCohort = usage.cohorts.find((cohort) => cohort.id === focusId && cohort.assigned) || usage.cohorts.find((cohort) => cohort.assigned) || usage.cohorts[0]
  const label = `Lesson · ${usage.title}`
  const work = usage.blocks.filter((block) => block.has_work).length
  const help = counts.open_help
  const helpRequests = cohortId ? usage.help_requests.filter((request) => request.cohort_id === cohortId) : usage.help_requests
  const rows: RelatedRow[] = [
    { key: 'used_in', icon: Layers3, label: 'Used in cohorts', count: usage.cohorts.length, onSelect: () => scrollToSection('used-in') },
    { key: 'submissions', icon: Files, label: inCohort('Submissions', focusName), count: counts.submissions, to: gradingPath({ cohortId, lessonId: usage.id, all: true }) },
    { key: 'waiting', icon: ClipboardCheck, label: inCohort(TERMS.waitingForReview, focusName), count: counts.waiting, attention: counts.waiting > 0, to: gradingPath({ cohortId, lessonId: usage.id }) },
    ...(typeof help === 'number' ? [{ key: 'help', icon: LifeBuoy, label: inCohort('Open help requests', focusName), count: help, attention: help > 0, to: supportPath(cohortId, { lessonId: usage.id }) }] : []),
    { key: 'module', icon: Layers, label: 'Module', value: usage.module.name, to: moduleRecordPath(usage.module.id, cohortId) },
    { key: 'curriculum', icon: LibraryBig, label: 'Curriculum', value: usage.curriculum.name, to: curriculumPath(usage.curriculum.id) },
  ]

  return <ReturnOrigin label={label}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[
        { label: usage.curriculum.name, to: curriculumPath(usage.curriculum.id) },
        { label: usage.module.name, to: moduleRecordPath(usage.module.id, focusId) },
        { label: usage.title },
      ]}
      type={<span>Lesson · Week {usage.week}, {usage.day_name.slice(0, 3)} · {usage.required ? 'Required' : 'Optional'}</span>}
      title={usage.title}
      titleText={usage.title}
      status={usage.archived ? <Badge icon={<Archive className="h-3 w-3" aria-hidden="true" />}>Archived</Badge> : undefined}
      context={<>
        <RecordLink record={{ type: 'module', id: usage.module.id, cohortId: focusId }} variant="plain" touchTarget>{usage.module.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <RecordLink record={{ type: 'curriculum', id: usage.curriculum.id }} variant="plain" touchTarget className="font-normal text-ink-muted">{usage.curriculum.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{plural(usage.blocks.length, 'block')}{work ? ` · ${plural(work, 'piece', 'pieces')} of work` : ''}</span>
      </>}
      actions={<>
        {previewCohort
          ? <LinkButton to={cohortStudentViewLessonPath(previewCohort.id, usage.id)} variant="secondary" size="sm" className="max-w-full"><Eye className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{TERMS.viewAsStudent}</span></LinkButton>
          : <LinkButton to={lessonEditorPath(usage.id, { preview: true })} variant="secondary" size="sm"><Eye className="h-4 w-4" aria-hidden="true" />Preview</LinkButton>}
        <LinkButton to={lessonEditorPath(usage.id)} size="sm" variant={usage.can_edit ? 'primary' : 'secondary'}>
          {usage.can_edit ? <PencilLine className="h-4 w-4" aria-hidden="true" /> : <BookOpen className="h-4 w-4" aria-hidden="true" />}{usage.can_edit ? TERMS.editLesson : 'Open in editor'}
        </LinkButton>
      </>}
    />

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="min-w-0 space-y-6">
        <Section id="contents" title="What it is" count={plural(usage.blocks.length, 'block')}>
          {usage.blocks.length ? (
            <ol className="divide-y divide-line">
              {usage.blocks.map((block, index) => {
                const Icon = BLOCK_ICONS[block.block_type] || FileText
                return (
                  <li key={block.id} className="flex min-h-12 items-center gap-3 px-4 py-2 sm:px-5">
                    <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-ink-muted">{index + 1}</span>
                    <Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <span className="min-w-0 flex-1 text-sm font-medium text-ink [overflow-wrap:anywhere]">{block.title || BLOCK_LABELS[block.block_type] || humanize(block.block_type)}</span>
                    <span className="shrink-0 text-xs font-semibold text-ink-muted">{BLOCK_LABELS[block.block_type] || humanize(block.block_type)}</span>
                  </li>
                )
              })}
            </ol>
          ) : <p className="px-4 py-5 text-sm text-ink-muted sm:px-5">This lesson has no blocks yet.</p>}
          {usage.objectives.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
              <Target className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              <span className="text-xs font-semibold text-ink-muted">Objectives</span>
              {usage.objectives.map((objective) => <Badge key={objective.id} tone="neutral"><span className="font-mono">{objective.code}</span> {objective.title}</Badge>)}
            </div>
          )}
        </Section>

        <UsedInCohorts
          rows={usage.cohorts.map((cohort) => ({ kind: 'lesson' as const, cohort, lessonId: usage.id, moduleId: usage.module.id }))}
          otherCount={usage.other_cohorts_count}
          focusCohortId={focusId}
        />

        {typeof help === 'number' && (
          <Section id="help" title={inCohort('Open help requests', focusName)} count={String(help)} action={<LinkButton to={supportPath(cohortId, { lessonId: usage.id })} variant="quiet" size="sm">{help > helpRequests.length ? `See all ${help} in ${TERMS.support}` : `Open in ${TERMS.support}`}</LinkButton>}>
            {helpRequests.length ? (
              <ul className="divide-y divide-line">
                {helpRequests.map((request) => {
                  const cohort = usage.cohorts.find((item) => item.id === request.cohort_id)
                  return (
                    <li key={request.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
                      <LifeBuoy className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <RecordLink record={{ type: 'help_request', id: request.id }} variant="plain" touchTarget className="font-semibold">{request.student ? `${request.student.name}'s question` : 'Help request'}</RecordLink>
                        <p className="text-xs text-ink-muted">
                          {request.student && cohort ? <RecordLink record={{ type: 'student', id: request.student.id, cohortId: cohort.id }} variant="plain" className="font-normal text-ink-muted">{request.student.name}</RecordLink> : null}
                          {request.student && cohort ? ' · ' : ''}
                          {cohort && <><RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" className="font-normal text-ink-muted">{cohort.name}</RecordLink>{' · '}</>}
                          {humanize(request.category)}
                        </p>
                      </div>
                      {request.urgency === 'urgent' && <Badge tone="danger">Urgent</Badge>}
                      <span className="text-xs font-semibold tabular-nums text-ink-muted" title={formatShortDate(request.created_at)}>{shortAgo(request.created_at)}</span>
                    </li>
                  )
                })}
              </ul>
            ) : <p className="px-4 py-5 text-sm text-ink-muted sm:px-5">No open help requests on this lesson.</p>}
          </Section>
        )}
      </div>
      <RelatedPanel rows={rows} returnLabel={label} className="lg:sticky lg:top-20" />
    </div>
  </div></ReturnOrigin>
}

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

export function ModuleRecord() {
  const id = useRouteId()
  const state = useRecordUsage('module', id)
  return <UsageGate state={state} label="module">{(usage) => <ModulePage key={usage.id} usage={usage} />}</UsageGate>
}

function ModulePage({ usage }: { usage: ModuleUsage }) {
  const [params] = useSearchParams()
  const focusId = Number(params.get('cohort_id')) || null
  const back = useBackLink({ returnTo: curriculumPath(usage.curriculum.id), returnLabel: usage.curriculum.name })
  const { cohortId, name: focusName, counts } = focusScope(focusId, usage.cohorts, usage.totals)
  const label = `Module · ${usage.name}`
  const active = usage.lessons.filter((lesson) => !lesson.archived)
  const weeks = [...new Set(usage.lessons.map((lesson) => lesson.week))].sort((a, b) => a - b)
  const help = counts.open_help
  const rows: RelatedRow[] = [
    { key: 'lessons', icon: BookOpen, label: 'Lessons', count: active.length, onSelect: () => scrollToSection('lessons') },
    { key: 'used_in', icon: Layers3, label: 'Used in cohorts', count: usage.cohorts.length, onSelect: () => scrollToSection('used-in') },
    { key: 'submissions', icon: Files, label: inCohort('Submissions', focusName), count: counts.submissions, to: gradingPath({ cohortId, moduleId: usage.id, all: true }) },
    { key: 'waiting', icon: ClipboardCheck, label: inCohort(TERMS.waitingForReview, focusName), count: counts.waiting, attention: counts.waiting > 0, to: gradingPath({ cohortId, moduleId: usage.id }) },
    ...(typeof help === 'number' ? [{ key: 'help', icon: LifeBuoy, label: inCohort('Open help requests', focusName), count: help, attention: help > 0, to: supportPath(cohortId, { moduleId: usage.id }) }] : []),
    { key: 'curriculum', icon: LibraryBig, label: 'Curriculum', value: usage.curriculum.name, to: curriculumPath(usage.curriculum.id) },
  ]
  const days = usage.scheduled_day_names.length === 7 ? 'Every day' : usage.scheduled_day_names.map((name) => name.slice(0, 3)).join(', ')

  return <ReturnOrigin label={label}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: usage.curriculum.name, to: curriculumPath(usage.curriculum.id) }, { label: usage.name }]}
      type={<span>Module · {humanize(usage.module_type)} · {plural(usage.week_count, 'week')}</span>}
      title={usage.name}
      titleText={usage.name}
      context={<>
        <RecordLink record={{ type: 'curriculum', id: usage.curriculum.id }} variant="plain" touchTarget>{usage.curriculum.name}</RecordLink>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{plural(active.length, 'lesson')}</span>
        {days && <><span aria-hidden="true">·</span><span>{days}</span></>}
      </>}
      actions={<LinkButton to={studioPath(usage.curriculum.id, usage.id)} variant="secondary" size="sm"><FolderOpen className="h-4 w-4" aria-hidden="true" />Open in {TERMS.content}</LinkButton>}
    />

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="min-w-0 space-y-6">
        <UsedInCohorts
          title="Cohort schedules"
          rows={usage.cohorts.map((cohort) => ({ kind: 'module' as const, cohort, moduleId: usage.id }))}
          otherCount={usage.other_cohorts_count}
          focusCohortId={focusId}
        />
        <Section id="lessons" title="Lessons" count={plural(active.length, 'lesson')}>
          {usage.lessons.length ? weeks.map((week) => (
            <div key={week}>
              <h3 className="bg-surface-sunken px-4 py-1.5 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted sm:px-5">Week {week}</h3>
              <ul className="divide-y divide-line">
                {usage.lessons.filter((lesson) => lesson.week === week).map((lesson) => (
                  <li key={lesson.id} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
                    <span className="w-9 shrink-0 text-xs font-semibold text-ink-muted">{lesson.day_name.slice(0, 3)}</span>
                    <RecordLink record={{ type: 'lesson', id: lesson.id, cohortId: focusId }} variant="plain" touchTarget className={`min-w-0 flex-1 font-semibold ${lesson.archived ? 'text-ink-muted' : ''}`}>{lesson.title}</RecordLink>
                    {lesson.has_work && <Badge tone="neutral" icon={<Code2 className="h-3 w-3" aria-hidden="true" />}>{TERMS.exercise}</Badge>}
                    {!lesson.required && <Badge tone="neutral">Optional</Badge>}
                    {lesson.archived && <Badge icon={<Archive className="h-3 w-3" aria-hidden="true" />}>Archived</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )) : <p className="px-4 py-5 text-sm text-ink-muted sm:px-5">This module has no lessons yet.</p>}
        </Section>
      </div>
      <RelatedPanel rows={rows} returnLabel={label} className="lg:sticky lg:top-20" />
    </div>
  </div></ReturnOrigin>
}

/* -------------------------------------------------------------------------- */
/* Curriculum                                                                 */
/* -------------------------------------------------------------------------- */

export function CurriculumRecord() {
  const id = useRouteId()
  const state = useRecordUsage('curriculum', id)
  return <UsageGate state={state} label="curriculum">{(usage) => <CurriculumPage key={usage.id} usage={usage} />}</UsageGate>
}

const STATUS_TONES = { active: 'success', draft: 'pending', archived: 'neutral' } as const

function LessonRefs({ lessons }: { lessons: UsageLessonRef[] }) {
  if (!lessons.length) return <span className="text-xs text-ink-muted">Not used in a lesson yet</span>
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {lessons.map((lesson) => (
        <li key={lesson.id} className="min-w-0 text-sm">
          <RecordLink record={{ type: 'lesson', id: lesson.id }} variant="plain" touchTarget className={lesson.archived ? 'text-ink-muted' : ''}>{lesson.title}</RecordLink>
          {lesson.archived && <span className="ml-1 text-xs text-ink-muted">(archived)</span>}
        </li>
      ))}
    </ul>
  )
}

function CurriculumPage({ usage }: { usage: CurriculumUsage }) {
  const back = useBackLink({ returnTo: '/admin/content', returnLabel: TERMS.content })
  const label = `Curriculum · ${usage.name}`
  const lessons = usage.modules.reduce((sum, mod) => sum + mod.lessons_count, 0)
  const help = usage.totals.open_help
  const copies = usage.copies.length + usage.other_copies_count
  const rows: RelatedRow[] = [
    { key: 'used_in', icon: Layers3, label: 'Used in cohorts', count: usage.cohorts.length, onSelect: () => scrollToSection('used-in') },
    { key: 'waiting', icon: ClipboardCheck, label: TERMS.waitingForReview, count: usage.totals.waiting, attention: usage.totals.waiting > 0, ...(usage.cohorts.length === 1 ? { to: gradingPath({ cohortId: usage.cohorts[0].id }) } : { onSelect: () => scrollToSection('used-in') }) },
    ...(typeof help === 'number' ? [{ key: 'help', icon: LifeBuoy, label: 'Open help requests', count: help, attention: help > 0, ...(usage.cohorts.length === 1 ? { to: supportPath(usage.cohorts[0].id) } : { onSelect: () => scrollToSection('used-in') }) }] : []),
    { key: 'modules', icon: Layers, label: 'Modules', count: usage.modules.length, onSelect: () => scrollToSection('modules') },
    { key: 'copies', icon: GitBranch, label: 'Cohort copies', count: copies, onSelect: () => scrollToSection('copies') },
    { key: 'rubrics', icon: ListChecks, label: 'Rubrics', count: usage.rubrics.length, onSelect: () => scrollToSection('rubrics') },
    { key: 'objectives', icon: Target, label: 'Objectives', count: usage.objectives.length, onSelect: () => scrollToSection('objectives') },
    { key: 'files', icon: FolderOpen, label: 'Learner files', count: usage.totals.resources, to: `/admin/content?curriculum=${usage.id}&pane=files` },
  ]

  return <ReturnOrigin label={label}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: TERMS.content, to: '/admin/content' }, { label: usage.name }]}
      type={<span>Curriculum{usage.imported ? ` · Imported course package${usage.package_revision ? ` ${usage.package_revision}` : ''}` : ''}</span>}
      title={usage.name}
      titleText={usage.name}
      status={<Badge tone={STATUS_TONES[usage.status]}>{humanize(usage.status)}</Badge>}
      context={<>
        <span className="tabular-nums">{plural(usage.modules.length, 'module')} · {plural(lessons, 'lesson')}</span>
        {usage.copy_of && <>
          <span aria-hidden="true">·</span>
          <span>
            {usage.copy_of.cohort ? <><RecordLink record={{ type: 'cohort', id: usage.copy_of.cohort.id }} variant="plain">{usage.copy_of.cohort.name}</RecordLink>'s copy</> : 'A cohort copy'}
            {usage.copy_of.source_curriculum && <> of <RecordLink record={{ type: 'curriculum', id: usage.copy_of.source_curriculum.id }} variant="plain">{usage.copy_of.source_curriculum.name}</RecordLink></>}
          </span>
        </>}
      </>}
      actions={<LinkButton to={studioPath(usage.id)} variant="secondary" size="sm"><FolderOpen className="h-4 w-4" aria-hidden="true" />Open in {TERMS.content}</LinkButton>}
    >
      {usage.description && <p className="mt-3 max-w-3xl text-sm text-ink-secondary [overflow-wrap:anywhere]">{usage.description}</p>}
    </RecordHeader>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="min-w-0 space-y-6">
        <UsedInCohorts rows={usage.cohorts.map((cohort) => ({ kind: 'curriculum' as const, cohort }))} otherCount={usage.other_cohorts_count} />

        <Section id="modules" title="Modules" count={plural(usage.modules.length, 'module')}>
          {usage.modules.length ? (
            <ol className="divide-y divide-line">
              {usage.modules.map((mod, index) => (
                <li key={mod.id} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
                  <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-ink-muted">{index + 1}</span>
                  <RecordLink record={{ type: 'module', id: mod.id }} variant="plain" touchTarget className="min-w-0 flex-1 font-semibold">{mod.name}</RecordLink>
                  <span className="text-xs tabular-nums text-ink-muted">{humanize(mod.module_type)} · {plural(mod.lessons_count, 'lesson')}</span>
                </li>
              ))}
            </ol>
          ) : <p className="px-4 py-5 text-sm text-ink-muted sm:px-5">No modules yet. Add them in {TERMS.content}.</p>}
        </Section>

        <Section id="copies" title="Copy history" count={copies ? plural(copies, 'copy', 'copies') : undefined}>
          <div className="space-y-3 px-4 py-4 text-sm sm:px-5">
            {usage.copy_of && (
              <p className="flex gap-2 text-ink-secondary">
                <Copy className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <span>
                  Made {usage.copy_of.cohort ? <>for <RecordLink record={{ type: 'cohort', id: usage.copy_of.cohort.id }} variant="plain">{usage.copy_of.cohort.name}</RecordLink> </> : ''}
                  from {usage.copy_of.source_curriculum ? <RecordLink record={{ type: 'curriculum', id: usage.copy_of.source_curriculum.id }} variant="plain">{usage.copy_of.source_curriculum.name}</RecordLink> : 'a curriculum that no longer exists'}
                  {' '}on {formatShortDate(usage.copy_of.created_at, '', { withYear: false })}{usage.copy_of.created_by ? ` by ${usage.copy_of.created_by.name}` : ''}.
                  {' '}Changes to the shared version don't reach it.
                </span>
              </p>
            )}
            {usage.copies.length > 0 && (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {usage.copies.map((copy) => (
                  <li key={copy.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <GitBranch className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <RecordLink record={{ type: 'curriculum', id: copy.copy_curriculum.id }} variant="plain" touchTarget className="font-semibold">{copy.copy_curriculum.name}</RecordLink>
                      <p className="text-xs text-ink-muted">For <RecordLink record={{ type: 'cohort', id: copy.cohort.id }} variant="plain" className="font-normal text-ink-muted">{copy.cohort.name}</RecordLink>{copy.created_by ? ` · by ${copy.created_by.name}` : ''}{copy.lessons_count ? ` · ${plural(copy.lessons_count, 'lesson')}` : ''}</p>
                    </div>
                    <span className="text-xs tabular-nums text-ink-muted">{formatShortDate(copy.created_at, '', { withYear: false })}</span>
                  </li>
                ))}
              </ul>
            )}
            {usage.other_copies_count > 0 && <p className="text-xs text-ink-muted">{plural(usage.other_copies_count, 'more copy', 'more copies')} {usage.other_copies_count === 1 ? 'was' : 'were'} made for cohorts you don't teach.</p>}
            {!usage.copy_of && !copies && <p className="text-ink-muted">No cohort has made its own copy. When one does, it keeps its learners' progress and later changes here don't reach it.</p>}
          </div>
        </Section>

        <Section id="rubrics" title="Rubrics" count={plural(usage.rubrics.length, 'rubric')}>
          {usage.rubrics.length ? (
            <ul className="divide-y divide-line">
              {usage.rubrics.map((rubric) => (
                <li key={rubric.id} className="space-y-1.5 px-4 py-3 sm:px-5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    <ListChecks className="h-4 w-4 text-ink-muted" aria-hidden="true" />{rubric.title}
                    <span className="text-xs font-semibold tabular-nums text-ink-muted">{plural(rubric.criteria_count, 'criterion', 'criteria')}</span>
                    {!rubric.active && <Badge>Inactive</Badge>}
                  </p>
                  <LessonRefs lessons={rubric.lessons} />
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-5 text-sm text-ink-muted sm:px-5">No rubrics yet. Add one from an exercise in the lesson editor.</p>}
        </Section>

        <Section id="objectives" title="Objectives" count={plural(usage.objectives.length, 'objective')}>
          {usage.objectives.length ? (
            <ul className="divide-y divide-line">
              {usage.objectives.map((objective) => (
                <li key={objective.id} className="space-y-1.5 px-4 py-3 sm:px-5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    <span className="font-mono text-xs text-ink-secondary">{objective.code}</span>{objective.title}
                    {!objective.active && <Badge>Inactive</Badge>}
                  </p>
                  <LessonRefs lessons={objective.lessons} />
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-5 text-sm text-ink-muted sm:px-5">No objectives yet. Add them from the lesson editor's Lesson settings.</p>}
        </Section>
      </div>
      <RelatedPanel rows={rows} returnLabel={label} className="lg:sticky lg:top-20" />
    </div>
  </div></ReturnOrigin>
}
