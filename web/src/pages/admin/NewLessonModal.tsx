import { useState, useMemo } from 'react'
import { ALL_DAY_NAMES, SCHEDULE_DAY_INDICES } from '../../lib/scheduleConstants'
import { Modal } from '../../components/shared/Modal'
import { Button } from '../../components/ui/Button'

interface Props {
  moduleName: string
  scheduleDays: string
  weekCount: number
  defaultPosition: number
  defaultWeek: number
  defaultDayIndex: number
  saving: boolean
  error?: string
  onClose: () => void
  onCreate: (data: { title: string; lesson_type: string; position: number; release_day: number }) => Promise<void>
}

const LESSON_TYPES = [
  { value: 'video', label: 'Video' },
  { value: 'exercise', label: 'Exercise' },
  { value: 'reading', label: 'Reading' },
  { value: 'project', label: 'Project' },
  { value: 'checkpoint', label: 'Checkpoint' },
]

export function NewLessonModal({
  moduleName,
  scheduleDays,
  weekCount,
  defaultPosition,
  defaultWeek,
  defaultDayIndex,
  saving,
  error,
  onClose,
  onCreate,
}: Props) {
  const [title, setTitle] = useState('')
  const [lessonType, setLessonType] = useState('reading')
  const [position] = useState(defaultPosition)
  const [week, setWeek] = useState(defaultWeek)
  const [dayIndex, setDayIndex] = useState(defaultDayIndex)
  const [validationError, setValidationError] = useState('')

  const availableDays = useMemo(() => {
    const indices = SCHEDULE_DAY_INDICES[scheduleDays] || SCHEDULE_DAY_INDICES.weekdays
    return indices.map(i => ({ index: i, name: ALL_DAY_NAMES[i] }))
  }, [scheduleDays])

  const releaseDay = (week - 1) * 7 + dayIndex

  const weekOptions = useMemo(() => {
    const max = Math.max(weekCount + 2, week + 1, 12)
    return Array.from({ length: max }, (_, i) => i + 1)
  }, [weekCount, week])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setValidationError('Title is required')
      return
    }
    setValidationError('')
    await onCreate({ title: title.trim(), lesson_type: lessonType, position, release_day: releaseDay })
  }

  return (
    <Modal open title="New lesson" subtitle={`Adding to ${moduleName}`} size="md" onClose={onClose}>
        {(validationError || error) && <p className="text-sm text-red-600 mb-3">{validationError || error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Introduction to Ruby"
              className="app-control"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <select
              value={lessonType}
              onChange={e => setLessonType(e.target.value)}
              className="app-control"
            >
              {LESSON_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Week</label>
              <select
                value={week}
                onChange={e => setWeek(Number(e.target.value))}
                className="app-control"
              >
                {weekOptions.map(w => <option key={w} value={w}>Week {w}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Day</label>
              <select
                value={dayIndex}
                onChange={e => setDayIndex(Number(e.target.value))}
                className="app-control"
              >
                {availableDays.map(d => <option key={d.index} value={d.index}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-400 -mt-2">
            This places the lesson on Week {week}, {ALL_DAY_NAMES[dayIndex]} (Day {releaseDay + 1} in the release calendar)
          </p>
          <input type="hidden" value={position} />
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              onClick={onClose}
              disabled={saving}
              variant="secondary"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? 'Creating...' : 'Create and edit'}
            </Button>
          </div>
        </form>
    </Modal>
  )
}
