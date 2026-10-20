import { useState } from 'react'
import { Modal } from '../../components/shared/Modal'
import { Button } from '../../components/ui/Button'

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
  { value: 'weekdays', label: 'MTWTF / Mon – Fri (5 days/week)' },
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
    <Modal open title="New module" subtitle="Set the module type and the days when learning content appears." size="md" onClose={onClose}>
        {(validationError || error) && <p role="alert" className="mb-3 rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">{validationError || error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Live Class"
              className="app-control"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1">Type</label>
            <select
              value={moduleType}
              onChange={e => setModuleType(e.target.value)}
              className="app-control"
            >
              {MODULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1">Schedule pattern</label>
            <select
              value={scheduleDays}
              onChange={e => setScheduleDays(e.target.value)}
              className="app-control"
            >
              {SCHEDULE_PATTERNS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-ink-muted">Which days of the week will have content</p>
          </div>
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
              {saving ? 'Creating...' : 'Create module'}
            </Button>
          </div>
        </form>
    </Modal>
  )
}
