import { formatShortDateTime } from '../../lib/format'
import { useBackLink } from '../../lib/recordOrigin'
import { RESTORE_LIST_STATE } from '../../lib/navigationContext'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Clock3, List, PanelRight } from 'lucide-react'
import { api } from '../../lib/api'
import { learnerPaths } from '../../lib/routes'
import { useKeyboardAwareViewport } from '../../lib/visualViewport'
import { useMediaQuery } from '../../lib/useMediaQuery'
import type { HelpRequest, LessonDetail } from '../../types/api'
import { LessonRecordings } from './LessonRecordings'
import { ContextualHelp } from './ContextualHelp'
import { CourseCompletionCards } from './CourseCompletionCards'
import { PersonActions } from './PersonActions'
import { Button, LinkButton } from '../ui/Button'
import { Modal } from '../shared/Modal'
import { RecordLink } from '../shared/RecordLink'
import { StatusIcon } from '../shared/StatusBadge'
import { LearningObjectivesPanel } from '../shared/LearningObjectivesPanel'
import { PreviewLink } from '../../contexts/PreviewNavigationContext'

export function LessonExperience({
  lesson,
  children,
  readOnly,
  savedData,
  error,
  reload,
  helpRequests,
  helpRequestsLoading,
  setHelpRequests,
  refreshHelp,
}: {
  lesson: LessonDetail
  children: ReactNode
  readOnly: boolean
  savedData: boolean
  error: string | null
  reload: () => void | Promise<unknown>
  helpRequests: HelpRequest[]
  helpRequestsLoading: boolean
  setHelpRequests: (requests: HelpRequest[]) => void
  refreshHelp: () => Promise<void>
}) {
  const back = useBackLink({ returnTo: `/materials?cohort_id=${lesson.cohort_id}`, returnLabel: 'Learn' }, { legacyInbox: true })
  const backState = { returnTo: back.to, returnLabel: back.label }
  const lessonKey = `${lesson.cohort_id}:${lesson.id}`
  const currentLesson = useRef(lessonKey)
  currentLesson.current = lessonKey
  const ownership = useRef(0)
  useEffect(() => {
    ownership.current += 1
    return () => { ownership.current += 1 }
  }, [lesson.id, lesson.cohort_id])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const isWideDesktop = useMediaQuery('(min-width: 1280px)')
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return window.localStorage.getItem('csg-lesson-outline-sidebar') === '1'
    } catch {
      return false
    }
  })
  const [readProgress, setReadProgress] = useState(0)
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  useKeyboardAwareViewport(true)

  const toggleSidebar = () => {
    setSidebarOpen((current) => {
      const nextValue = !current
      try { window.localStorage.setItem('csg-lesson-outline-sidebar', nextValue ? '1' : '0') } catch { /* ignore */ }
      return nextValue
    })
  }

  useEffect(() => {
    const updateProgress = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      if (scrollable <= 80) {
        setReadProgress(0)
        return
      }
      setReadProgress(Math.max(0, Math.min(100, Math.round((window.scrollY / scrollable) * 100))))
    }
    updateProgress()
    window.addEventListener('scroll', updateProgress, { passive: true })
    window.addEventListener('resize', updateProgress, { passive: true })
    return () => {
      window.removeEventListener('scroll', updateProgress)
      window.removeEventListener('resize', updateProgress)
    }
  }, [lesson.id])
  const paths = learnerPaths(lesson.cohort_id)
  const outline = lesson.outline
  const navigation = savedData ? undefined : lesson.learning_navigation
  const completion = navigation?.course_completion
  const finished = completion ? completion.all_work_handed_in || completion.course_completed || Boolean(completion.certificate) : navigation?.course_complete
  const completionLabel = completion ? completion.course_completed ? 'Course completed' : completion.all_work_handed_in ? 'All work handed in' : 'Your certificate' : 'Course complete'
  const module = outline?.modules.find((item) => item.id === lesson.module_id)
  const group = module?.groups.find((item) => item.lessons.some((entry) => entry.id === lesson.id))
  const next = navigation?.next
  const isLibrary = outline?.mode === 'library'
  const section = outline?.mode === 'program' ? group?.label : module ? `Section ${module.number}` : undefined
  const nextLabel = navigation?.next_redo ? `Redo: ${next?.title}` : navigation?.next_module ? `Start next module: ${next?.title}` : `Next: ${next?.title}`

  const completeAndContinue = !readOnly && !isLibrary && next && lesson.learner_status !== 'done'
    && navigation?.manual_block_ids.length
    && lesson.content_blocks.some((block) => block.block_type === 'text')
    && lesson.content_blocks.every((block) => ['text', 'video', 'recording'].includes(block.block_type))
  const onCompletionScreen = search.get('complete') === '1' && finished && !readOnly

  async function markComplete(continueTo?: number) {
    if (saving || readOnly || !navigation) return
    const request = ++ownership.current
    const ownsRequest = () => currentLesson.current === lessonKey && ownership.current === request
    setSaving(true)
    setSaveError(null)
    try {
      for (const id of navigation.manual_block_ids) {
        const result = await api.updateProgress(id, 'completed', lesson.cohort_id)
        if (!ownsRequest()) return
        if (result.error || !result.data || result.fromCache)
          throw new Error(result.error || 'Couldn’t save your progress. Try again.')
      }
      if (ownsRequest()) await reload()
      if (ownsRequest() && continueTo) navigate(paths.lesson(continueTo), { state: backState })
    } catch (failure) {
      if (!ownsRequest()) return
      setSaveError(failure instanceof Error ? failure.message : 'Couldn’t save your progress. Try again.')
      await reload()
    } finally {
      if (ownsRequest()) setSaving(false)
    }
  }

  const navShortcutRef = useRef({
    previousId: navigation?.previous?.id,
    nextId: next?.id,
    completeAndContinue: Boolean(completeAndContinue),
    markComplete,
    navigate,
    paths,
    backState,
  })
  navShortcutRef.current = {
    previousId: navigation?.previous?.id,
    nextId: next?.id,
    completeAndContinue: Boolean(completeAndContinue),
    markComplete,
    navigate,
    paths,
    backState,
  }

  useEffect(() => {
    if (onCompletionScreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (saving || event.defaultPrevented || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
      if (document.querySelector('[data-app-modal]')) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
      const current = navShortcutRef.current
      if (event.key === 'ArrowLeft' && current.previousId) {
        event.preventDefault()
        current.navigate(current.paths.lesson(current.previousId), { state: current.backState })
      } else if (event.key === 'ArrowRight' && current.nextId) {
        event.preventDefault()
        if (current.completeAndContinue) void current.markComplete(current.nextId)
        else current.navigate(current.paths.lesson(current.nextId), { state: current.backState })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCompletionScreen, saving])
  const help = lesson.cohort_id && !savedData && (
    <ContextualHelp
      capabilities={lesson.capabilities}
      cohortId={lesson.cohort_id}
      contextType="lesson"
      contextId={lesson.id}
      contexts={[{ type: 'lesson', id: lesson.id, label: `Lesson: ${lesson.title}` }, ...lesson.content_blocks.filter(block => ['exercise', 'code_challenge', 'project', 'checkpoint'].includes(block.block_type) || helpRequests.some(request => request.cohort.id === lesson.cohort_id && request.context_type === 'exercise' && request.context_id === block.id)).map((block, index) => ({ type: 'exercise' as const, id: block.id, label: `Exercise ${index + 1}: ${block.title || 'Your answer'}` }))]}
      contextLabel={lesson.title}
      contextPath={`${window.location.origin}${paths.lesson(lesson.id)}`}
      requests={helpRequests}
      requestsLoading={helpRequestsLoading}
      onRequestsChange={setHelpRequests}
      onRequestsRefresh={refreshHelp}
    />
  )
  if (onCompletionScreen)
    return (
      <article data-testid="course-complete" className="app-page mx-auto max-w-3xl">
        <div className="grid justify-items-center gap-5 py-6 text-center">
          {completion?.all_work_handed_in && !completion.course_completed
            ? <Clock3 className="h-16 w-16 text-warning-ink" aria-hidden="true" />
            : <CheckCircle2 className="h-16 w-16 text-success-ink" aria-hidden="true" />}
          <h1 className="font-display text-3xl font-semibold text-ink lg:text-4xl">
            {completion ? completionLabel : `Course complete: You’ve finished ${outline?.course_title || 'your course'}.`}
          </h1>
          {completion
            ? <p className="text-ink-secondary">{completion.course_completed ? 'You’ve finished the required work. You can return to your lessons while you have access.' : completion.all_work_handed_in ? 'Your instructor will confirm completion after reviewing your work.' : 'View the certificate issued by your school.'}</p>
            : <p className="text-ink-secondary">
              {navigation?.counts.completed_lessons} of {navigation?.counts.total_lessons} lessons finished. Any work
              waiting for review will still receive instructor feedback.
            </p>}
          {lesson.instructor && lesson.cohort_id && lesson.capabilities?.support_mode === 'guided_help' && lesson.capabilities?.features?.help_requests === true && (
            <PersonActions person={lesson.instructor} cohortId={lesson.cohort_id} />
          )}
          <LinkButton to={`/materials?cohort_id=${lesson.cohort_id}`} variant="secondary">
            Review your course
          </LinkButton>
          <LinkButton to={`/dashboard?cohort_id=${lesson.cohort_id}`} variant="quiet">
            Back to Today
          </LinkButton>
        </div>
        {completion && <CourseCompletionCards completion={completion} />}
      </article>
    )
  const showDesktopSidebar = Boolean(isWideDesktop && sidebarOpen && outline?.modules.length)
  const outlineSections = (onPick?: () => void) => (
    <div className="space-y-5">
      {outline?.modules.map((mod) => (
        <section key={mod.id}>
          <h2 className="mb-2 font-bold text-ink">
            {outline.mode === 'self_paced' ? `Section ${mod.number} · ` : ''}
            <RecordLink
              record={{ type: 'module', id: mod.id, cohortId: lesson.cohort_id, view: 'learn' }} peek={false} touchTarget
            >
              {mod.name}
            </RecordLink>
          </h2>
          {mod.groups.map((item) => (
            <div key={item.key}>
              {item.label && <h3 className="mb-1 mt-3 text-sm font-semibold text-ink-muted">{item.label}</h3>}
              <ul>
                {item.lessons.map((entry) => (
                  <li key={entry.id}>
                    {entry.available ? (
                      <PreviewLink
                        to={paths.lesson(entry.id)}
                        onClick={onPick}
                        aria-current={entry.id === lesson.id ? 'page' : undefined}
                        className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink hover:bg-surface-hover aria-[current=page]:bg-surface-selected aria-[current=page]:font-bold"
                      >
                        {outline.mode !== 'library' && <StatusIcon status={entry.status} />}
                        <span className="min-w-0 [overflow-wrap:anywhere]">{entry.title}</span>
                      </PreviewLink>
                    ) : (
                      <span className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm text-ink-muted">
                        {entry.title} · Not open yet
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
  return (
    <div className={showDesktopSidebar ? 'mx-auto flex w-full max-w-6xl items-start gap-8' : undefined}>
    <article data-testid="lesson-experience" className="app-page mx-auto w-full max-w-3xl min-w-0 pb-4 lg:pb-8">
      {readProgress > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-30 h-0.5 bg-transparent"
        >
          <div className="h-full bg-action-primary transition-[width] duration-150" style={{ width: `${readProgress}%` }} />
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-2xl border border-warning-line bg-warning-soft p-4 text-warning-ink">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      )}
      {readOnly && (
        <p className="rounded-xl border border-line bg-surface-sunken p-4 text-sm text-ink-secondary">
          Your saved lessons and feedback are available to read.
        </p>
      )}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LinkButton to={back.to} state={RESTORE_LIST_STATE} variant="quiet">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {back.label}
          </LinkButton>
          <div className="flex items-center gap-2">
            {isWideDesktop && Boolean(outline?.modules.length) && (
              <Button variant="quiet" onClick={toggleSidebar} aria-pressed={sidebarOpen}>
                <PanelRight className="h-4 w-4" aria-hidden="true" />
                {sidebarOpen ? 'Hide sidebar' : 'Pin outline'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setOutlineOpen(true)}>
              <List className="h-4 w-4" aria-hidden="true" />
              Outline
            </Button>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink-muted">
            {section}
            {section && navigation ? ' · ' : ''}
            {navigation && !isLibrary && `Lesson ${navigation.number} of ${navigation.total}`}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-ink lg:text-3xl [overflow-wrap:anywhere]">{lesson.title}</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            {module && (
              <RecordLink
                record={{ type: 'module', id: module.id, cohortId: lesson.cohort_id, view: 'learn' }} peek={false} touchTarget
              >
                {module.name}
              </RecordLink>
            )}
          </p>
        </div>
        {/* One lesson-scoped help action: Ask for help. Messages stay in the navigation. */}
        <div id="help" className="flex flex-wrap items-center justify-between gap-3">
          {help}
        </div>
      </header>
      <LearningObjectivesPanel objectives={lesson.objectives || []} />
      {lesson.show_personal_deadline && lesson.submission_window?.submissions_close_at && <p className="text-sm text-ink-secondary">Submission deadline: {formatShortDateTime(lesson.submission_window.submissions_close_at)}</p>}
      {lesson.submission_window?.submissions_closed && (
        <p className="rounded-xl border border-line bg-surface-sunken p-4 text-sm text-ink-secondary">
          Submissions are closed for this week. Your work and feedback are saved.
        </p>
      )}
      <LessonRecordings lesson={lesson} />
      {children}
      {!savedData && lesson.learner_status === 'done' && !isLibrary && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl border border-success-line bg-success-soft px-4 py-3 text-sm font-semibold text-success-ink"
        >
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          Lesson complete
        </p>
      )}
      <nav
        aria-label="Lesson navigation"
        className="lesson-action-bar hide-with-keyboard sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-line bg-surface-overlay/95 px-2.5 py-2 shadow-overlay backdrop-blur-sm lg:static lg:mt-6 lg:gap-3 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:bg-transparent lg:px-0 lg:py-3 lg:shadow-none lg:backdrop-blur-none"
      >
        {saveError && (
          <p role="alert" className="w-full text-sm text-danger-ink">
            {saveError}
          </p>
        )}
        {navigation?.previous && (
          <LinkButton size="sm" variant="quiet" state={backState} to={paths.lesson(navigation.previous.id)} className="mr-auto">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only lg:not-sr-only">Previous: {navigation.previous.title}</span>
          </LinkButton>
        )}
        {!readOnly && Boolean(navigation?.manual_block_ids.length) && (
          <Button size="sm" variant={next && !completeAndContinue ? 'secondary' : 'primary'} onClick={() => void markComplete(completeAndContinue ? next.id : undefined)} disabled={saving}>
            {saving ? 'Saving…' : completeAndContinue ? 'Mark complete and continue' : 'Mark complete'}
          </Button>
        )}
        {next && !completeAndContinue && (
          <LinkButton
            size="sm"
            state={backState}
            to={paths.lesson(next.id)}
            variant="primary"
            aria-disabled={saving}
            onClick={(event) => {
              if (saving) event.preventDefault()
            }}
            className="max-w-full whitespace-normal text-left"
          >
            {nextLabel}
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </LinkButton>
        )}
        {finished && !readOnly && (
          <Button
            size="sm"
            onClick={() =>
              setSearch((current) => {
                current.set('complete', '1')
                return current
              })
            }
          >
            {completionLabel}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </nav>
      <Modal open={outlineOpen} onClose={() => setOutlineOpen(false)} title="Course outline" size="md" variant="drawer">
        {outlineSections(() => setOutlineOpen(false))}
        <LinkButton className="mt-4" variant="secondary" to={`/materials?cohort_id=${lesson.cohort_id}`}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          Full course outline
        </LinkButton>
      </Modal>
    </article>
    {showDesktopSidebar && (
      <aside aria-label="Course outline" className="app-surface sticky top-6 hidden max-h-[calc(100dvh-3rem)] w-72 shrink-0 overflow-y-auto p-4 xl:block">
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Course outline</span>
          <Button variant="quiet" size="sm" onClick={toggleSidebar}>Hide</Button>
        </div>
        {outlineSections()}
        <LinkButton className="mt-4 w-full justify-center" variant="secondary" to={`/materials?cohort_id=${lesson.cohort_id}`}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          Full course outline
        </LinkButton>
      </aside>
    )}
    </div>
  )
}
