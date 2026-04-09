import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  defaultPosition: number
  saving: boolean
  error?: string
  onClose: () => void
  onCreate: (data: { name: string; module_type: string; position: number; day_offset: number; total_days: number; schedule_days: string }) => Promise<void>
}

const MODULE_TYPES = [
  { value: 'prework', label: 'Prework' },
  { value: 'live_class', label: 'Live Class' },
  { value: 'capstone', label: 'Capstone' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'recording', label: 'Recording' },
]

const SCHEDULE_PATTERNS = [
  { value: 'weekdays', label: 'Mon – Fri (5 days/week)' },
  { value: 'weekdays_sat', label: 'Mon – Sat (6 days/week)' },
  { value: 'mwf', label: 'Mon / Wed / Fri' },
  { value: 'tth', label: 'Tue / Thu' },
  { value: 'daily', label: 'Every day (7 days/week)' },
]

export function NewModuleModal({ defaultPosition, saving, error, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [moduleType, setModuleType] = useState('live_class')
  const [scheduleDays, setScheduleDays] = useState('weekdays')
  const [validationError, setValidationError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setValidationError('Name is required')
      return
    }
    setValidationError('')
    await onCreate({
      name: name.trim(),
      module_type: moduleType,
      position: defaultPosition,
      day_offset: 0,
      total_days: 0,
      schedule_days: scheduleDays,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">New Module</h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {(validationError || error) && <p className="text-sm text-red-600 mb-3">{validationError || error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Live Class"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <select
              value={moduleType}
              onChange={e => setModuleType(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {MODULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Schedule Pattern</label>
            <select
              value={scheduleDays}
              onChange={e => setScheduleDays(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {SCHEDULE_PATTERNS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-400">Which days of the week will have content</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors">
              {saving ? 'Creating...' : 'Create Module'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
