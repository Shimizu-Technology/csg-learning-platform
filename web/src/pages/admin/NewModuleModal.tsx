import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  defaultPosition: number
  saving: boolean
  error?: string
  onClose: () => void
  onCreate: (data: { name: string; module_type: string; position: number; day_offset: number; total_days: number }) => Promise<void>
}

const MODULE_TYPES = [
  { value: 'prework', label: 'Prework' },
  { value: 'live_class', label: 'Live Class' },
  { value: 'capstone', label: 'Capstone' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'recording', label: 'Recording' },
]

export function NewModuleModal({ defaultPosition, saving, error, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [moduleType, setModuleType] = useState('live_class')
  const [position, setPosition] = useState(defaultPosition)
  const [dayOffset, setDayOffset] = useState(0)
  const [totalDays, setTotalDays] = useState(7)
  const [validationError, setValidationError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setValidationError('Name is required')
      return
    }
    setValidationError('')
    await onCreate({ name: name.trim(), module_type: moduleType, position, day_offset: dayOffset, total_days: totalDays })
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
              placeholder="e.g. Week 1 — Ruby Foundations"
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Position</label>
              <input type="number" min={0} value={position} onChange={e => setPosition(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Day Offset</label>
              <input type="number" min={0} value={dayOffset} onChange={e => setDayOffset(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Total Days</label>
              <input type="number" min={1} value={totalDays} onChange={e => setTotalDays(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
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
