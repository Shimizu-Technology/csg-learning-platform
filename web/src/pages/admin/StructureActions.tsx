import { useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, IconButton } from '../../components/ui/Button'
import { Modal } from '../../components/shared/Modal'
import { useToast } from '../../contexts/ToastContext'

export interface EditableStructure {
  id: number
  name: string
  description?: string | null
  updated_at: string
}

export function StructureEditor({ record, kind, onSaved }: { record: EditableStructure; kind: 'curriculum' | 'module'; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <>
    <Button variant="secondary" size="sm" onClick={() => { setName(record.name); setDescription(record.description || ''); setError(''); setOpen(true) }}><Pencil className="h-4 w-4" />Edit {kind}</Button>
    {open && <Modal open title={`Edit ${kind}`} onClose={() => { if (!busy) setOpen(false) }}>
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault()
        setBusy(true)
        const data = { name: name.trim(), description: description.trim(), base_updated_at: record.updated_at }
        const result = kind === 'curriculum' ? await api.updateCurriculum(record.id, data) : await api.updateModule(record.id, data)
        setBusy(false)
        if (result.error) { setError(result.error); return }
        await onSaved()
        setOpen(false)
      }}>
        {error && <p role="alert" className="text-danger-ink">{error}</p>}
        <label className="block">Name<input className="app-control" required value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="block">Description<textarea className="app-control" rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save changes'}</Button>
      </form>
    </Modal>}
  </>
}

export function CurriculumStatusActions({ curriculum, onSaved }: { curriculum: EditableStructure & { status: string; archive_blocked?: boolean }; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <>
    <Button variant="secondary" size="sm" onClick={() => { setError(''); setPending(curriculum.status === 'active' ? 'draft' : 'active') }}>{curriculum.status === 'active' ? 'Unpublish' : 'Publish'}</Button>
    {curriculum.status !== 'archived' && <Button variant="secondary" size="sm" onClick={() => { setError(''); setPending('archived') }}>Archive</Button>}
    {pending && <Modal open title={pending === 'active' ? 'Publish curriculum?' : pending === 'draft' ? 'Unpublish curriculum?' : 'Archive curriculum?'} onClose={() => { if (!busy) setPending(null) }}>
      <div className="space-y-4">
        <p>{pending === 'active' ? 'Publishing makes this curriculum available for cohorts and purchases.' : pending === 'draft' ? 'This curriculum will become a draft. New purchases will be unavailable; existing learners keep their access.' : 'Archived curricula are unavailable for new cohorts and purchases.'}</p>
        {pending === 'archived' && curriculum.archive_blocked && <p role="alert" className="text-danger-ink">Archive blocked: close upcoming or active cohorts and disable checkout for offerings first.</p>}
        {error && <p role="alert" className="text-danger-ink">{error}</p>}
        <Button disabled={busy || (pending === 'archived' && curriculum.archive_blocked)} onClick={async () => {
          setBusy(true)
          const result = await api.updateCurriculum(curriculum.id, { status: pending, base_updated_at: curriculum.updated_at })
          setBusy(false)
          if (result.error) { setError(result.error); return }
          await onSaved(); setPending(null); toast.success('Curriculum status updated')
        }}>Confirm {pending === 'active' ? 'publish' : pending === 'draft' ? 'unpublish' : 'archive'}</Button>
      </div>
    </Modal>}
  </>
}

export function ModuleActions({ mod, index, count, busy, onMove, onSaved }: {
  mod: EditableStructure & { submissions_count?: number; deletion_blocked?: boolean; lessons: unknown[] }
  index: number; count: number; busy: boolean; onMove: (from: number, to: number) => void; onSaved: () => Promise<void>
}) {
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  return <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
    <span draggable={!busy} onDragStart={event => { event.dataTransfer.setData('text/plain', String(mod.id)); event.dataTransfer.effectAllowed = 'move' }} className="cursor-grab p-2 text-ink-muted" aria-label={`Drag ${mod.name}`}><GripVertical className="h-5 w-5" /></span>
    <IconButton label={`Move ${mod.name} up`} disabled={busy || index === 0} onClick={() => onMove(index, index - 1)}><ArrowUp className="h-4 w-4" /></IconButton>
    <IconButton label={`Move ${mod.name} down`} disabled={busy || index === count - 1} onClick={() => onMove(index, index + 1)}><ArrowDown className="h-4 w-4" /></IconButton>
    <StructureEditor record={mod} kind="module" onSaved={onSaved} />
    <Button variant="secondary" size="sm" onClick={() => { setError(''); setConfirm(true) }}><Trash2 className="h-4 w-4" />Delete module</Button>
    {confirm && <Modal open title={`Delete ${mod.name}?`} onClose={() => { if (!deleting) setConfirm(false) }}><div className="space-y-4">
      <p>This module contains {mod.lessons.length} lessons (including archived lessons) and {mod.submissions_count ?? 0} submissions. Deletion cannot be undone.</p>
      {mod.deletion_blocked && <p role="alert" className="text-danger-ink">Learner data prevents deletion. Archive the lessons instead.</p>}
      {error && <p role="alert" className="text-danger-ink">{error}</p>}
      <Button variant="danger" disabled={deleting || mod.deletion_blocked} onClick={async () => {
        setDeleting(true); const result = await api.deleteModule(mod.id); setDeleting(false)
        if (result.error) { setError(result.error); return }
        await onSaved(); setConfirm(false)
      }}>Delete permanently</Button>
    </div></Modal>}
  </div>
}
