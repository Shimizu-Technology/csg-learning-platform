import { useEffect, useMemo, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { api } from '../../../lib/api'
import { ALL_DAY_NAMES, SCHEDULE_DAY_INDICES } from '../../../lib/scheduleConstants'
import { Modal } from '../../../components/shared/Modal'
import { Button } from '../../../components/ui/Button'
import type { CurriculumDetail, LessonMoveImpact } from '../../../types/api'

type ModuleOption = CurriculumDetail['modules'][number]

interface Props {
  open: boolean
  onClose: () => void
  lesson: { id: number; title: string; module_id: number; release_day: number; updated_at: string }
  curriculumId: number
  /**
   * Called after the lesson moved. The dialog stays open, and can't be
   * dismissed, until the returned promise settles, so the editor can reload
   * before anyone edits it again.
   */
  onMoved: (summary: string) => Promise<void> | void
}

const dayKey = (releaseDay: number) => String(releaseDay)

function dayLabel(releaseDay: number) {
  return `Week ${Math.floor(releaseDay / 7) + 1} · ${ALL_DAY_NAMES[releaseDay % 7]}`
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

const changesAccess = (impact: LessonMoveImpact) => impact.learners_with_work_losing_access > 0 || impact.learners_losing_access > 0 || impact.learners_gaining_access > 0

/** The part of a dry run the person confirms; the server refuses the move if it no longer holds. */
const confirmedImpact = (impact: LessonMoveImpact) => ({
  learners_losing_access: impact.learners_losing_access,
  learners_gaining_access: impact.learners_gaining_access,
  self_paced_learners: impact.self_paced_learners,
})

/**
 * Move to week or day (T-12): any day and place in any module of this
 * lesson's curriculum. The lesson keeps its id, so students' progress and
 * work stay attached. A move to another module or day can change who sees
 * the lesson, so it's checked with a dry run first. The dry run belongs to
 * the exact destination it was asked for: a result that arrives after the
 * choice changed is dropped, and the move sends the impact it was confirmed
 * with, which the server checks again under its locks (impact_changed).
 */
export function MoveLessonDialog({ open, onClose, lesson, curriculumId, onMoved }: Props) {
  const [modules, setModules] = useState<ModuleOption[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [moduleId, setModuleId] = useState(lesson.module_id)
  const [releaseDay, setReleaseDay] = useState(lesson.release_day)
  const [position, setPosition] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ key: string; impact: LessonMoveImpact } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The destination the controls show now, for discarding answers to older requests. */
  const currentKeyRef = useRef('')

  useEffect(() => {
    if (!open) return
    let active = true
    setModules(null)
    setLoadError(null)
    setModuleId(lesson.module_id)
    setReleaseDay(lesson.release_day)
    setPosition(null)
    setPreview(null)
    setError(null)
    void api.getCurriculum(curriculumId).then((response) => {
      if (!active) return
      if (response.data) setModules(response.data.curriculum.modules)
      else setLoadError(response.error || 'The modules couldn\'t be loaded.')
    })
    return () => { active = false }
  }, [open, curriculumId, lesson.module_id, lesson.release_day])

  const target = modules?.find((mod) => mod.id === moduleId)
  const days = useMemo(() => {
    if (!target) return []
    const weekdays = SCHEDULE_DAY_INDICES[target.schedule_days] || SCHEDULE_DAY_INDICES.weekdays
    // The chosen day is always offered, even past the module's lessons (a
    // day-70 lesson moving into a one-week module keeps its week).
    const lastDay = Math.max(0, releaseDay, ...target.lessons.filter((item) => !item.archived_at).map((item) => item.release_day), target.id === lesson.module_id ? lesson.release_day : 0)
    const weeks = Math.max(target.week_count, Math.floor(lastDay / 7) + 1) + 1
    return Array.from({ length: weeks }, (_, week) => weekdays.map((weekday) => week * 7 + weekday)).flat()
  }, [lesson.module_id, lesson.release_day, releaseDay, target])
  const dayLessons = useMemo(() => (target?.lessons || [])
    .filter((item) => !item.archived_at && item.release_day === releaseDay && item.id !== lesson.id)
    .sort((a, b) => a.position - b.position || a.id - b.id), [lesson.id, releaseDay, target])
  const currentIndex = useMemo(() => {
    const own = target?.lessons.find((item) => item.id === lesson.id)
    if (!own || own.release_day !== releaseDay) return dayLessons.length
    return dayLessons.filter((item) => item.position < own.position || (item.position === own.position && item.id < own.id)).length
  }, [dayLessons, lesson.id, releaseDay, target])
  const chosenPosition = position ?? currentIndex
  const unchanged = moduleId === lesson.module_id && releaseDay === lesson.release_day && chosenPosition === currentIndex
  const placeOnly = moduleId === lesson.module_id && releaseDay === lesson.release_day
  const key = `${moduleId}:${releaseDay}:${chosenPosition}:${lesson.updated_at}`
  useEffect(() => { currentKeyRef.current = key }, [key])
  const impact = preview?.key === key ? preview.impact : null

  const chooseModule = (id: number) => {
    setModuleId(id)
    setPosition(null)
    setError(null)
    const mod = modules?.find((item) => item.id === id)
    const weekdays = mod ? SCHEDULE_DAY_INDICES[mod.schedule_days] || SCHEDULE_DAY_INDICES.weekdays : []
    if (mod && !weekdays.includes(releaseDay % 7)) setReleaseDay(Math.floor(releaseDay / 7) * 7 + weekdays[0])
  }

  const submit = async () => {
    if (!target || unchanged || busy) return
    const requestKey = key
    const stillCurrent = () => currentKeyRef.current === requestKey
    setBusy(true)
    setError(null)
    const body = { module_id: moduleId, release_day: releaseDay, position: chosenPosition, base_updated_at: lesson.updated_at }
    // Reordering within the same day doesn't change who can open the lesson.
    let confirmed = placeOnly ? null : impact
    if (!placeOnly && !confirmed) {
      const dryRun = await api.moveLesson(lesson.id, { ...body, dry_run: true })
      if (!stillCurrent()) return setBusy(false)
      if (!dryRun.data) {
        setBusy(false)
        setError(dryRun.error || 'The move couldn\'t be checked.')
        return
      }
      confirmed = dryRun.data.impact
      if (changesAccess(confirmed)) {
        setPreview({ key: requestKey, impact: confirmed })
        setBusy(false)
        return
      }
    }
    const response = await api.moveLesson(lesson.id, confirmed ? { ...body, expected_impact: confirmedImpact(confirmed) } : body)
    if (!response.data) {
      setBusy(false)
      if (response.errorCode === 'impact_changed' && response.errorImpact && stillCurrent()) setPreview({ key: requestKey, impact: response.errorImpact })
      setError(response.error || 'The lesson didn\'t move.')
      return
    }
    try {
      await onMoved(`Moved to ${target.name}, ${dayLabel(releaseDay)}.`)
    } finally {
      setBusy(false)
    }
  }

  const blocked = Boolean(impact && impact.learners_with_work_losing_access > 0)
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="md"
      title="Move lesson"
      subtitle={`"${lesson.title}" keeps its students' progress and work wherever it goes.`}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void submit()} disabled={!modules || unchanged || busy || blocked}>{busy ? 'Moving…' : impact && changesAccess(impact) ? 'Move anyway' : 'Move lesson'}</Button>
      </>}
    >
      {loadError ? <p role="alert" className="text-sm text-danger-ink">{loadError}</p> : !modules ? <p className="text-sm text-ink-muted">Loading modules…</p> : (
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-ink">Module
            <select className="app-control mt-1 w-full" value={moduleId} disabled={busy} onChange={(event) => chooseModule(Number(event.target.value))}>
              {modules.map((mod) => <option key={mod.id} value={mod.id}>{mod.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-ink">Week and day
            <select className="app-control mt-1 w-full" value={dayKey(releaseDay)} disabled={busy} onChange={(event) => { setReleaseDay(Number(event.target.value)); setPosition(null); setError(null) }}>
              {days.map((day) => <option key={day} value={dayKey(day)}>{dayLabel(day)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-ink">Place in that day
            <select className="app-control mt-1 w-full" value={chosenPosition} disabled={busy} onChange={(event) => { setPosition(Number(event.target.value)); setError(null) }}>
              <option value={0}>{dayLessons.length ? 'First' : 'Only lesson that day'}</option>
              {dayLessons.map((item, index) => <option key={item.id} value={index + 1}>After "{item.title}"</option>)}
            </select>
          </label>
          {impact && changesAccess(impact) && (
            <div role="alert" className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${blocked ? 'border-danger-line bg-danger-soft text-danger-ink' : 'border-warning-line bg-warning-soft text-warning-ink'}`}>
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{blocked
                ? `${plural(impact.learners_with_work_losing_access, 'student')} with work in this lesson couldn't open it in "${target?.name}" on that day: the module isn't assigned to them, that day hasn't opened for them yet, or it falls after their pause. Give them access there first, or choose a module and day that are already open to them.`
                : [
                    impact.learners_losing_access ? `${plural(impact.learners_losing_access, 'student')} will stop seeing this lesson.` : '',
                    impact.learners_gaining_access ? `${plural(impact.learners_gaining_access, 'student')} will start seeing it.` : '',
                    impact.self_paced_learners ? "Self-paced students' next lesson may change." : '',
                  ].filter(Boolean).join(' ')}</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
