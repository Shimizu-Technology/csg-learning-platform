import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ListPlus, Search } from 'lucide-react'
import { Modal } from '../../shared/Modal'
import { Button } from '../../ui/Button'
import { StatusBadge } from '../../shared/StatusBadge'
import { groupPlanLessons, isFinished, lessonCountLabel, visibleLessonCount } from '../../../lib/learningPlanLessons'
import type { LearningPlanEditorLesson } from '../../../types/api'

export interface LessonPickerProps {
  open: boolean
  /** "Add lessons to Milestone 1: Catch up on JavaScript" */
  title: string
  subtitle?: string
  lessons: LearningPlanEditorLesson[]
  /** Lessons already placed in this target: shown checked, not selectable. */
  current?: ReadonlySet<number>
  /** Lessons placed elsewhere in the plan, with where ("Milestone 2"): shown, not selectable. */
  placedElsewhere?: ReadonlyMap<number, string>
  /** Extra context for a lesson, e.g. what an exception would change. */
  describe?: (lesson: LearningPlanEditorLesson) => string | null
  onAdd: (lessonIds: number[]) => void
  onClose: () => void
}

/**
 * Searchable multi-select of the student's assigned lessons, grouped by module
 * and week (U-4.9). Finished lessons are hidden unless asked for; lessons the
 * plan already uses are shown with where they are. Keyboard: type to search,
 * Down/Up (and Home/End) move between lessons, Space selects, Ctrl/Cmd+Enter adds.
 */
export function LessonPicker(props: LessonPickerProps) {
  // Mount the body only while open so every opening starts with a clean search and selection.
  return <Modal open={props.open} onClose={props.onClose} title={props.title} subtitle={props.subtitle} size="xl" fixedHeight>
    {props.open && <PickerBody {...props} />}
  </Modal>
}

function PickerBody({ lessons, current = new Set(), placedElsewhere = new Map(), describe, onAdd, onClose }: LessonPickerProps) {
  const [query, setQuery] = useState('')
  const [showFinished, setShowFinished] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const searchId = useId()
  const statusId = useId()
  const placed = useMemo(() => new Set([...current, ...placedElsewhere.keys()]), [current, placedElsewhere])
  const modules = useMemo(() => groupPlanLessons(lessons, { query, showFinished, placed }), [lessons, query, showFinished, placed])
  const finishedCount = useMemo(() => lessons.filter(isFinished).length, [lessons])
  const shown = visibleLessonCount(modules)
  const selectedSet = new Set(selected)
  const anyWeeks = lessons.some((lesson) => lesson.week !== null)
  // The dialog focuses its first control (Close) on the next frame; start in the search box instead.
  useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => document.getElementById(searchId)?.focus()) })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [searchId])

  const toggle = (id: number) => setSelected((value) => value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  const selectRemaining = (ids: number[]) => setSelected((value) => {
    const allSelected = ids.every((id) => value.includes(id))
    return allSelected ? value.filter((id) => !ids.includes(id)) : [...value, ...ids.filter((id) => !value.includes(id))]
  })
  const add = () => {
    if (selected.length === 0) return
    // Course order, whatever order they were ticked in.
    const order = new Map(lessons.map((lesson, index) => [lesson.id, index]))
    onAdd([...selected].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)))
  }

  const options = () => Array.from(listRef.current?.querySelectorAll<HTMLInputElement>('input[data-picker-option]:not([disabled])') || [])
  function onListKey(event: KeyboardEvent<HTMLElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      add()
      return
    }
    const target = event.target as HTMLElement
    const isSearch = target.id === searchId
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    if (isSearch && event.key !== 'ArrowDown') return
    const list = options()
    if (list.length === 0) return
    const index = list.indexOf(target as HTMLInputElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : event.key === 'ArrowDown' ? Math.min(index + 1, list.length - 1) : index - 1
    event.preventDefault()
    if (next < 0) document.getElementById(searchId)?.focus()
    else list[next].focus()
  }

  return <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onListKey}>
    <div className="space-y-3 border-b border-line pb-3">
      <label htmlFor={searchId} className="sr-only">Search lessons</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={anyWeeks ? 'Search by lesson, module or week' : 'Search by lesson or module'} className="app-control w-full pl-9" autoComplete="off" aria-describedby={statusId} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-secondary">
          <input type="checkbox" className="h-4 w-4 accent-action-primary" checked={showFinished} onChange={(event) => setShowFinished(event.target.checked)} />
          Show finished lessons <span className="tabular-nums text-ink-muted">({finishedCount})</span>
        </label>
        <p id={statusId} aria-live="polite" className="text-xs tabular-nums text-ink-muted">{shown === 0 ? 'No lessons match' : `${lessonCountLabel(shown)} shown`}{selected.length > 0 ? ` · ${selected.length} selected` : ''}</p>
      </div>
    </div>
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="group" aria-label="Lessons">
      {shown === 0 && <div className="px-1 py-8 text-center">
        <p className="font-semibold text-ink">{query ? `No lessons match “${query}”` : 'Every lesson here is finished'}</p>
        <p className="mt-1 text-sm text-ink-muted">{query ? 'Try part of the lesson title, the module or “week 3”.' : 'Turn on “Show finished lessons” to plan a review of finished work.'}</p>
      </div>}
      {modules.map((mod) => {
        const visible = mod.weeks.reduce((sum, week) => sum + week.lessons.length, 0)
        if (visible === 0) return null
        const remainingIds = mod.remaining.map((lesson) => lesson.id)
        const allRemainingSelected = remainingIds.length > 0 && remainingIds.every((id) => selectedSet.has(id))
        return <section key={mod.id} aria-label={mod.name} className="border-b border-line last:border-b-0">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-surface-raised py-2">
            <h3 className="min-w-0 text-sm font-bold text-ink [overflow-wrap:anywhere]">{mod.name}</h3>
            {remainingIds.length > 0
              ? <Button type="button" size="sm" variant="quiet" aria-pressed={allRemainingSelected} onClick={() => selectRemaining(remainingIds)}>
                {allRemainingSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : <ListPlus className="h-4 w-4" aria-hidden="true" />}
                {allRemainingSelected ? `All ${remainingIds.length} remaining selected` : `Select all remaining (${remainingIds.length})`}
              </Button>
              : <span className="text-xs text-ink-muted">Nothing left to add</span>}
          </div>
          {mod.weeks.map((week) => <div key={`${mod.id}:${week.week ?? 'all'}`} className="pb-2">
            {week.week !== null && <p className="px-1 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Week {week.week}</p>}
            <ul>{week.lessons.map((lesson) => {
              const here = current.has(lesson.id)
              const elsewhere = placedElsewhere.get(lesson.id)
              const disabled = here || Boolean(elsewhere)
              const note = here ? 'Already here' : elsewhere ? `In ${elsewhere}` : describe?.(lesson)
              return <li key={lesson.id}>
                <label className={`flex min-h-11 items-start gap-3 rounded-xl px-2 py-2 ${disabled ? 'text-ink-muted' : 'cursor-pointer hover:bg-surface-hover'} ${selectedSet.has(lesson.id) ? 'bg-surface-selected' : ''}`}>
                  <input type="checkbox" data-picker-option className="mt-0.5 h-4 w-4 shrink-0 accent-action-primary" checked={here || selectedSet.has(lesson.id)} disabled={disabled} onChange={() => toggle(lesson.id)} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold [overflow-wrap:anywhere] ${disabled ? '' : 'text-ink'}`}>{lesson.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">{lesson.standard_required ? 'Required' : 'Optional'}{note ? ` · ${note}` : ''}</span>
                  </span>
                  {lesson.status !== 'open' && lesson.status !== 'upcoming' && <StatusBadge status={lesson.status} short className="shrink-0" />}
                </label>
              </li>
            })}</ul>
          </div>)}
        </section>
      })}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
      {selected.length > 0 && <Button type="button" variant="quiet" onClick={() => setSelected([])}>Clear selection</Button>}
      <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="button" disabled={selected.length === 0} onClick={add} aria-keyshortcuts="Control+Enter Meta+Enter">{selected.length === 0 ? 'Add lessons' : `Add ${lessonCountLabel(selected.length)}`}</Button>
    </div>
  </div>
}
