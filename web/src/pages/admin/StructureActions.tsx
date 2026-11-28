import { useRef, useState, type ReactNode } from 'react'
import { Archive, ArrowDown, ArrowUp, Copy, Eye, EyeOff, FileEdit, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { Button, IconButton } from '../../components/ui/Button'
import { OverflowMenu, type OverflowMenuItem } from '../../components/ui/OverflowMenu'
import { Modal } from '../../components/shared/Modal'
import { useToast } from '../../contexts/ToastContext'
import { GradingScalePicker } from '../../components/admin/GradingScalePicker'
import { normalizeGradingScale, type GradingScale } from '../../lib/gradingScale'

export interface EditableStructure {
  id: number
  name: string
  description?: string | null
  updated_at: string
  /** Curricula only. */
  grading_scale?: string | null
}

export function StructureEditor({ record, kind, onSaved, inline = false }: { record: EditableStructure; kind: 'curriculum' | 'module'; onSaved: () => Promise<void>; inline?: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [gradingScale, setGradingScale] = useState<GradingScale>('letter_abc_redo')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const savedScale = normalizeGradingScale(record.grading_scale)
  return <>
    <Button ref={triggerRef} variant="secondary" size="sm" onClick={() => { setName(record.name); setDescription(record.description || ''); setGradingScale(savedScale); setError(''); setOpen(true) }}><Pencil className="h-4 w-4" />Edit {kind}</Button>
    {open && <EditorSurface inline={inline} title={`Edit ${kind}`} onClose={() => { if (!busy) setOpen(false) }}>
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault()
        setBusy(true)
        const data = { name: name.trim(), description: description.trim(), base_updated_at: record.updated_at }
        const result = kind === 'curriculum'
          ? await api.updateCurriculum(record.id, { ...data, ...(gradingScale !== savedScale ? { grading_scale: gradingScale } : {}) })
          : await api.updateModule(record.id, data)
        setBusy(false)
        if (result.error) { setError(result.error); return }
        await onSaved()
        setOpen(false)
        requestAnimationFrame(() => triggerRef.current?.focus())
      }}>
        {error && <p role="alert" className="text-danger-ink">{error}</p>}
        <label className="block">Name<input className="app-control" required value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="block">Description<textarea className="app-control" rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
        {kind === 'curriculum' && <GradingScalePicker value={gradingScale} onChange={setGradingScale} disabled={busy} hint="Changing the scale keeps grades already saved. New grades use the new scale." />}
        <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save changes'}</Button>
      </form>
    </EditorSurface>}
  </>
}

function EditorSurface({ inline, title, onClose, children }: { inline: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return inline ? <section aria-label={title} className="w-full rounded-xl border border-line bg-surface-sunken p-3"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">{title}</h3><Button variant="quiet" onClick={onClose}>Cancel</Button></div>{children}</section> : <Modal open title={title} onClose={onClose}>{children}</Modal>
}

type StatusCurriculum = EditableStructure & { status: string; archive_blocked?: boolean; live_checkout_offerings?: { id: number; name: string }[] }

function CurriculumStatusModal({ curriculum, pending, onClose, onSaved }: { curriculum: StatusCurriculum; pending: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [salesConfirmed, setSalesConfirmed] = useState(false)
  return (
    <Modal open title={pending === 'active' ? 'Publish curriculum?' : pending === 'draft' ? 'Unpublish curriculum?' : 'Archive curriculum?'} onClose={() => { if (!busy) onClose() }}>
      <div className="space-y-4">
        <p>{pending === 'active' ? 'Publishing makes this curriculum available for purchases.' : pending === 'draft' ? 'This curriculum will become a draft. New purchases will be unavailable; existing learners keep their access.' : "Archived curricula can't be used for new cohorts or purchases."}</p>
        {pending === 'draft' && Boolean(curriculum.live_checkout_offerings?.length) && <div className="space-y-3">
          <p>This stops new purchases for: {curriculum.live_checkout_offerings!.map(offering => offering.name).join(', ')}</p>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={salesConfirmed} onChange={event => setSalesConfirmed(event.target.checked)} />I confirm that new purchases for these offerings will stop.</label>
        </div>}
        {pending === 'archived' && curriculum.archive_blocked && <p role="alert" className="text-danger-ink">Archive blocked: close upcoming or active cohorts and disable checkout for offerings first.</p>}
        {error && <p role="alert" className="text-danger-ink">{error}</p>}
        <Button disabled={busy || (pending === 'draft' && Boolean(curriculum.live_checkout_offerings?.length) && !salesConfirmed) || (pending === 'archived' && curriculum.archive_blocked)} onClick={async () => {
          setBusy(true)
          const result = await api.updateCurriculum(curriculum.id, { status: pending, base_updated_at: curriculum.updated_at })
          setBusy(false)
          if (result.error) { setError(result.error); return }
          await onSaved(); onClose(); toast.success('Curriculum status updated')
        }}>Confirm {pending === 'active' ? 'publish' : pending === 'draft' ? 'unpublish' : 'archive'}</Button>
      </div>
    </Modal>
  )
}

export function CurriculumStatusActions({ curriculum, onSaved }: { curriculum: StatusCurriculum; onSaved: () => Promise<void> }) {
  const [pending, setPending] = useState<string | null>(null)
  return <>
    <Button variant="secondary" size="sm" onClick={() => setPending(curriculum.status === 'active' ? 'draft' : 'active')}>{curriculum.status === 'active' ? 'Unpublish' : 'Publish'}</Button>
    {curriculum.status === 'archived' && <Button variant="secondary" size="sm" onClick={() => setPending('draft')}>Move to draft</Button>}
    {curriculum.status !== 'archived' && <Button variant="secondary" size="sm" onClick={() => setPending('archived')}>Archive</Button>}
    {pending && <CurriculumStatusModal key={pending} curriculum={curriculum} pending={pending} onClose={() => setPending(null)} onSaved={onSaved} />}
  </>
}

export function CurriculumActionsMenu({
  curriculum,
  onSaved,
  onDelete,
  extraItems = [],
}: {
  curriculum: StatusCurriculum
  onSaved: () => Promise<void>
  onDelete: () => void
  extraItems?: OverflowMenuItem[]
}) {
  const [pending, setPending] = useState<string | null>(null)
  const items: OverflowMenuItem[] = [
    ...extraItems,
    {
      key: 'toggle-publish',
      label: curriculum.status === 'active' ? 'Unpublish' : 'Publish',
      icon: curriculum.status === 'active' ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />,
      onSelect: () => setPending(curriculum.status === 'active' ? 'draft' : 'active'),
    },
    ...(curriculum.status === 'archived'
      ? [{ key: 'draft', label: 'Move to draft', icon: <FileEdit aria-hidden="true" />, onSelect: () => setPending('draft') }]
      : []),
    ...(curriculum.status !== 'archived'
      ? [{ key: 'archive', label: 'Archive', icon: <Archive aria-hidden="true" />, onSelect: () => setPending('archived') }]
      : []),
    { key: 'delete', label: 'Delete curriculum', icon: <Trash2 aria-hidden="true" />, tone: 'danger', onSelect: onDelete },
  ]
  return <>
    <OverflowMenu size="sm" label="More curriculum actions" items={items} />
    {pending && <CurriculumStatusModal key={pending} curriculum={curriculum} pending={pending} onClose={() => setPending(null)} onSaved={onSaved} />}
  </>
}

export function ModuleActions({ mod, index, count, busy, onMove, onSaved, onClone, compact = false }: {
  mod: EditableStructure & { submissions_count?: number; deletion_blocked?: boolean; lessons: unknown[] }
  index: number; count: number; busy: boolean; onMove: (from: number, to: number) => void; onSaved: () => Promise<void>
  onClone?: () => void
  compact?: boolean
}) {
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')

  const deleteModal = confirm && (
    <Modal open title={`Delete ${mod.name}?`} onClose={() => { if (!deleting) setConfirm(false) }}>
      <div className="space-y-4">
        <p>{mod.deletion_blocked ? 'This module has student work.' : <>This module contains {mod.lessons.length} {mod.lessons.length === 1 ? 'lesson' : 'lessons'} (including archived lessons) and {mod.submissions_count ?? 0} {(mod.submissions_count ?? 0) === 1 ? 'submission' : 'submissions'}. Deletion cannot be undone.</>}</p>
        {mod.deletion_blocked && <p role="alert" className="text-danger-ink">Learner data prevents deletion. Archive the lessons instead.</p>}
        {error && <p role="alert" className="text-danger-ink">{error}</p>}
        <Button variant="danger" disabled={deleting || mod.deletion_blocked} onClick={async () => {
          setDeleting(true); const result = await api.deleteModule(mod.id); setDeleting(false)
          if (result.error) { setError(result.error); return }
          await onSaved(); setConfirm(false)
        }}>Delete permanently</Button>
      </div>
    </Modal>
  )

  if (compact) {
    const items: OverflowMenuItem[] = [
      {
        key: 'edit',
        label: 'Edit module',
        icon: <Pencil aria-hidden="true" />,
        onSelect: () => {
          setName(mod.name)
          setDescription(mod.description || '')
          setEditError('')
          setEditing(true)
        },
      },
      ...(onClone ? [{
        key: 'clone',
        label: 'Clone module',
        icon: <Copy aria-hidden="true" />,
        onSelect: onClone,
      }] : []),
      {
        key: 'delete',
        label: 'Delete module',
        icon: <Trash2 aria-hidden="true" />,
        tone: 'danger' as const,
        onSelect: () => { setError(''); setConfirm(true) },
      },
    ]
    return <>
      <OverflowMenu size="sm" label={`More actions for ${mod.name}`} items={items} />
      {editing && (
        <Modal open title="Edit module" onClose={() => { if (!savingEdit) setEditing(false) }}>
          <form className="space-y-4" onSubmit={async (event) => {
            event.preventDefault()
            setSavingEdit(true)
            const result = await api.updateModule(mod.id, { name: name.trim(), description: description.trim(), base_updated_at: mod.updated_at })
            setSavingEdit(false)
            if (result.error) { setEditError(result.error); return }
            await onSaved()
            setEditing(false)
          }}>
            {editError && <p role="alert" className="text-danger-ink">{editError}</p>}
            <label className="block">Name<input className="app-control mt-1 w-full" required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="block">Description<textarea className="app-control mt-1 w-full" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <Button type="submit" disabled={savingEdit || !name.trim()}>{savingEdit ? 'Saving…' : 'Save changes'}</Button>
          </form>
        </Modal>
      )}
      {deleteModal}
    </>
  }

  return <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
    <span draggable={!busy} onDragStart={event => { event.dataTransfer.setData('application/x-csg-module-id', String(mod.id)); event.dataTransfer.effectAllowed = 'move' }} className="cursor-grab p-2 text-ink-muted" role="img" aria-label={`Drag ${mod.name}`}><GripVertical className="h-5 w-5" aria-hidden="true" /></span>
    <IconButton label={`Move ${mod.name} up`} data-module-move={mod.id} data-direction="up" aria-disabled={busy || index === 0} onClick={() => { if (busy || index === 0) return; onMove(index, index - 1) }}><ArrowUp className="h-4 w-4" /></IconButton>
    <IconButton label={`Move ${mod.name} down`} data-module-move={mod.id} data-direction="down" aria-disabled={busy || index === count - 1} onClick={() => { if (busy || index === count - 1) return; onMove(index, index + 1) }}><ArrowDown className="h-4 w-4" /></IconButton>
    <StructureEditor inline record={mod} kind="module" onSaved={onSaved} />
    <Button variant="secondary" size="sm" onClick={() => { setError(''); setConfirm(true) }}><Trash2 className="h-4 w-4" />Delete module</Button>
    {deleteModal}
  </div>
}
