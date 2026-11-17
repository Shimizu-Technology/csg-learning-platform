import { useRef, useState } from 'react'
import { Modal } from '../../components/shared/Modal'
import { Button } from '../../components/ui/Button'
import { api } from '../../lib/api'
import { humanize } from '../../lib/glossary'
import type { components } from '../../types/api.generated'

type Clone = components['schemas']['AuthoringCloneResult']['clone']
type Props = {
  kind: 'curricula' | 'modules' | 'cohorts'
  source: { id: number; name: string; curriculum_id?: number }
  curricula?: { id: number; name: string; modules_count?: number }[]
  onClose: () => void
  onCloned: (clone: Clone) => Promise<void>
}

export function AuthoringCloneDialog({ kind, source, curricula = [], onClose, onCloned }: Props) {
  const noun = kind === 'curricula' ? 'curriculum' : kind === 'modules' ? 'module' : 'cohort'
  const [name, setName] = useState(`${source.name} (copy)`)
  const [curriculumId, setCurriculumId] = useState(source.curriculum_id || curricula[0]?.id || 0)
  const [position, setPosition] = useState(0)
  const [startDate, setStartDate] = useState('')
  const [cloneCurriculum, setCloneCurriculum] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState<Clone | null>(null)
  const request = useRef({ signature: '', id: '' })

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    const options = { name: name.trim(), ...(kind === 'modules' ? { curriculum_id: curriculumId, position } : {}), ...(kind === 'cohorts' ? { start_date: startDate, clone_curriculum: cloneCurriculum } : {}) }
    const signature = JSON.stringify(options)
    if (request.current.signature !== signature) request.current = { signature, id: crypto.randomUUID() }
    setSaving(true)
    setError('')
    const result = await api.cloneAuthoring(kind, source.id, { ...options, client_request_id: request.current.id })
    setSaving(false)
    if (result.error || !result.data) { setError(result.error || 'Could not clone. Try again.'); return }
    setCompleted(result.data.clone)
  }

  return <Modal open title={completed ? `${noun[0].toUpperCase()}${noun.slice(1)} cloned` : `Clone ${noun}`} size="md" onClose={() => { if (!saving) onClose() }}>
    {completed ? <div className="space-y-4">
      <p className="text-sm text-ink-secondary"><strong>{completed.name}</strong> is ready. {kind === 'cohorts' ? 'Upcoming, with 0 learners and checkout off.' : kind === 'modules' ? 'Lessons are archived until you review and restore them.' : 'Draft, with no cohort assignments.'}</p>
      {completed.features && <div>
        <h3 className="font-semibold">Resulting feature switches</h3>
        <ul className="mt-2 divide-y divide-line">
          {Object.entries(completed.features).map(([key, enabled]) => {
            const override = completed.feature_overrides?.[key]
            return <li key={key} className="flex justify-between gap-3 py-2 text-sm"><span className="capitalize">{humanize(key)}</span><span>{override == null ? `Inherit → ${enabled ? 'On' : 'Off'}` : enabled ? 'On (explicit)' : 'Off (explicit)'}</span></li>
          })}
        </ul>
      </div>}
      <Button onClick={async () => { await onCloned(completed) }}>Open {noun}</Button>
    </div> : <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-ink-secondary">{kind === 'cohorts' ? 'Copy settings to the new start week. Module and meeting weekdays and breaks stay the same. The support instructor is assigned without lesson-editing access. No learners, purchases, messages or learner work are copied. Feature overrides keep On, Off or Inherit exactly. Checkout starts off.' : kind === 'modules' ? 'Copy content and schedule into a curriculum. The copied lessons start archived. Learner work stays on the original.' : 'Copy modules, lessons, schedules, rubrics and objectives into an independent draft. No learner data or cohort assignments are copied.'} Uploaded files and videos are shared by reference.</p>
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      <label className="block text-sm font-medium">New name<input className="app-control mt-1" required value={name} disabled={saving} onChange={e => setName(e.target.value)} autoFocus /></label>
      {kind === 'modules' && <>
        <label className="block text-sm font-medium">Destination curriculum<select aria-label="Destination curriculum" className="app-control mt-1" value={curriculumId} disabled={saving} onChange={e => { setCurriculumId(Number(e.target.value)); setPosition(0) }}>{curricula.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block text-sm font-medium">Position (0 is first)<input className="app-control mt-1" type="number" min={0} max={curricula.find(c => c.id === curriculumId)?.modules_count} required value={position} disabled={saving} onChange={e => setPosition(Number(e.target.value))} /></label>
      </>}
      {kind === 'cohorts' && <>
        <label className="block text-sm font-medium">New start date<input className="app-control mt-1" type="date" required value={startDate} disabled={saving} onChange={e => setStartDate(e.target.value)} /></label>
        <label className="block text-sm font-medium">Curriculum<select aria-label="Curriculum" className="app-control mt-1" value={cloneCurriculum ? 'clone' : 'same'} disabled={saving} onChange={e => setCloneCurriculum(e.target.value === 'clone')}><option value="same">Keep the same curriculum</option><option value="clone">Clone the curriculum too (draft)</option></select></label>
      </>}
      <div className="flex gap-3"><Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? 'Cloning…' : `Clone ${noun}`}</Button></div>
    </form>}
  </Modal>
}
