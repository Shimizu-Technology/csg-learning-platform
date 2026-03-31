import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  moduleName: string
  defaultPosition: number
  defaultReleaseDay: number
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

export function NewLessonModal({ moduleName, defaultPosition, defaultReleaseDay, saving, error, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [lessonType, setLessonType] = useState('reading')
  const [position, setPosition] = useState(defaultPosition)
  const [releaseDay, setReleaseDay] = useState(defaultReleaseDay)
  const [validationError, setValidationError] = useState('')

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
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Position</label>
              <input
                type="number"
                min={0}
                value={position}
                onChange={e => setPosition(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Release Day</label>
              <input
                type="number"
                min={0}
                value={releaseDay}
                onChange={e => setReleaseDay(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
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
