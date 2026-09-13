import { useState } from 'react'

import { Modal } from '../../components/shared/Modal'
import { Button } from '../../components/ui/Button'

interface Props {
  saving: boolean
  error?: string
  onClose: () => void
  onCreate: (data: { name: string; description?: string; status: string }) => Promise<void>
}

export function buildCurriculumPayload(name: string, description: string) {
  const normalizedName = name.trim()
  if (!normalizedName) return null

  return {
    name: normalizedName,
    description: description.trim() || undefined,
    status: 'active',
  }
}

export function NewCurriculumModal({ saving, error, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [validationError, setValidationError] = useState('')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const payload = buildCurriculumPayload(name, description)
    if (!payload) {
      setValidationError('Name is required')
      return
    }

    setValidationError('')
    await onCreate(payload)
  }

  return (
    <Modal open title="New curriculum" subtitle="Create a reusable collection of modules before assigning it to a cohort." size="md" onClose={onClose}>
      {(validationError || error) && <p className="mb-3 text-sm text-red-600">{validationError || error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="curriculum-name" className="mb-1 block text-sm font-medium text-slate-700">Name</label>
          <input id="curriculum-name" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. CSG Alumni Learning Library" className="app-control" autoFocus />
        </div>
        <div>
          <label htmlFor="curriculum-description" className="mb-1 block text-sm font-medium text-slate-700">Description</label>
          <textarea id="curriculum-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Who this curriculum is for and how it should be used" rows={4} className="app-control" />
        </div>
        <div className="flex gap-3 pt-2">
          <Button type="button" onClick={onClose} disabled={saving} variant="secondary" className="flex-1">Cancel</Button>
          <Button type="submit" disabled={saving} className="flex-1">{saving ? 'Creating...' : 'Create curriculum'}</Button>
        </div>
      </form>
    </Modal>
  )
}
