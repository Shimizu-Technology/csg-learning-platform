import { brand } from '../../lib/brand'
import { useState } from 'react'

import { Modal } from '../../components/shared/Modal'
import { Button } from '../../components/ui/Button'
import { GradingScalePicker } from '../../components/admin/GradingScalePicker'
import { DEFAULT_NEW_CURRICULUM_SCALE, type GradingScale } from '../../lib/gradingScale'

interface Props {
  saving: boolean
  error?: string
  onClose: () => void
  onCreate: (data: { name: string; description?: string; status: string; grading_scale: GradingScale }) => Promise<void>
}

export function buildCurriculumPayload(name: string, description: string, gradingScale: GradingScale = DEFAULT_NEW_CURRICULUM_SCALE) {
  const normalizedName = name.trim()
  if (!normalizedName) return null

  return {
    name: normalizedName,
    description: description.trim() || undefined,
    status: 'draft',
    grading_scale: gradingScale,
  }
}

export function NewCurriculumModal({ saving, error, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [gradingScale, setGradingScale] = useState<GradingScale>(DEFAULT_NEW_CURRICULUM_SCALE)
  const [validationError, setValidationError] = useState('')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const payload = buildCurriculumPayload(name, description, gradingScale)
    if (!payload) {
      setValidationError('Name is required')
      return
    }

    setValidationError('')
    await onCreate(payload)
  }

  return (
    <Modal open title="New curriculum" subtitle="Create a reusable collection of modules before assigning it to a cohort." size="md" onClose={onClose}>
      {(validationError || error) && <p role="alert" className="mb-3 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-ink">{validationError || error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="curriculum-name" className="mb-1 block text-sm font-medium text-ink-secondary">Name</label>
          <input id="curriculum-name" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder={`e.g. ${brand.schoolAbbreviation} Alumni library`} className="app-control" autoFocus />
        </div>
        <div>
          <label htmlFor="curriculum-description" className="mb-1 block text-sm font-medium text-ink-secondary">Description</label>
          <textarea id="curriculum-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Who this curriculum is for and how it should be used" rows={4} className="app-control" />
        </div>
        <GradingScalePicker value={gradingScale} onChange={setGradingScale} disabled={saving} />
        <div className="flex gap-3 pt-2">
          <Button type="button" onClick={onClose} disabled={saving} variant="secondary" className="flex-1">Cancel</Button>
          <Button type="submit" disabled={saving} className="flex-1">{saving ? 'Creating...' : 'Create curriculum'}</Button>
        </div>
      </form>
    </Modal>
  )
}
