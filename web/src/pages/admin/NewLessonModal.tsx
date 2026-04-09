import { useState, useMemo } from 'react'
import { X } from 'lucide-react'

const ALL_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const SCHEDULE_DAY_INDICES: Record<string, number[]> = {
  weekdays: [0, 1, 2, 3, 4],
  weekdays_sat: [0, 1, 2, 3, 4, 5],
  mwf: [0, 2, 4],
  tth: [1, 3],
  daily: [0, 1, 2, 3, 4, 5, 6],
}

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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">New Lesson</h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">Adding to: <span className="font-medium text-slate-700">{moduleName}</span></p>
        {(validationError || error) && <p className="text-sm text-red-600 mb-3">{validationError || error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Introduction to Ruby"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <select
              value={lessonType}
              onChange={e => setLessonType(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {weekOptions.map(w => <option key={w} value={w}>Week {w}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Day</label>
              <select
                value={dayIndex}
                onChange={e => setDayIndex(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {availableDays.map(d => <option key={d.index} value={d.index}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-400 -mt-2">
            This places the lesson on Week {week}, {ALL_DAY_NAMES[dayIndex]} (release day {releaseDay})
          </p>
          <input type="hidden" value={position} />
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating...' : 'Create & Edit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
