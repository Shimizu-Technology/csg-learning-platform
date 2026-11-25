import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, CopyPlus, Eye, EyeOff, FolderLock, FolderOpen, Pencil, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import {
  CLASS_FOLDER_PRESETS,
  STUDENT_FOLDER_PRESETS,
  matchesFileQuery,
  type CohortFile,
  type CohortFilesResponse,
  type CohortStudentFolder,
} from '../../lib/cohortFiles'
import { CohortFileRow, CohortFileUploader, FolderBadge, StaffOnlyBadge } from '../shared/CohortFileParts'
import { EmptyState } from '../shared/EmptyState'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { RecordLink } from '../shared/RecordLink'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { OverflowMenu } from '../ui/OverflowMenu'

type View = 'class' | 'students'

const STATUS_LABELS: Record<CohortStudentFolder['enrollment_status'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  expired: { label: 'Access ended', tone: 'neutral' },
}

function useCohortFiles(cohortId: number) {
  const [data, setData] = useState<CohortFilesResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    const result = await api.getCohortFiles(cohortId)
    if (result.data) {
      setData(result.data)
      setError('')
    } else {
      setError(result.error || 'Could not load files.')
    }
    setLoading(false)
  }, [cohortId])
  useEffect(() => { void load() }, [load])
  return { data, setData, error, loading, load }
}

function folderOptions(presets: string[], files: CohortFile[]) {
  return [...new Set([...presets, ...files.map((file) => file.folder)])]
}

/** Cohort workspace Files tab: shared class files (with staging) and one private folder per student. */
export function CohortFilesPanel({ cohortId }: { cohortId: number }) {
  const { data, setData, error, loading, load } = useCohortFiles(cohortId)
  const [view, setView] = useState<View>('class')
  const [openStudentId, setOpenStudentId] = useState<number | null>(null)

  if (loading && !data) return <LoadingSpinner message="Loading files…" />
  if (!data) return <LoadError message={error} onRetry={() => void load()} />

  const folders = data.student_folders || []
  const replaceFiles = (update: (files: CohortFile[]) => CohortFile[], studentId: number | null) => setData((current) => current && (studentId === null
    ? { ...current, class_files: update(current.class_files) }
    : {
        ...current,
        student_folders: (current.student_folders || []).map((folder) => {
          if (folder.student_id !== studentId) return folder
          const files = update(folder.files)
          return { ...folder, files, file_count: files.length }
        }),
      }))

  return (
    <section className="space-y-5" aria-label="Files">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-ink">Files</h2>
          <p className="mt-1 text-sm text-ink-secondary">Share class files, stage drafts for staff, and keep a private folder for every student.</p>
        </div>
        <div role="tablist" aria-label="File views" className="inline-flex w-full rounded-xl border border-line bg-surface-sunken p-1 sm:w-auto">
          {([['class', 'Class files', data.class_files.length], ['students', 'Student folders', folders.length]] as const).map(([value, label, count]) => (
            <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => { setView(value); setOpenStudentId(null) }}
              className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 sm:flex-none ${view === value ? 'bg-surface-raised text-ink shadow-raised' : 'text-ink-secondary hover:text-ink'}`}>
              {label}
              <span className="tabular-nums text-ink-muted">{count}</span>
            </button>
          ))}
        </div>
      </div>
      {!data.storage_configured && (
        <p role="status" className="rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          File storage isn't set up for this school yet, so uploads and downloads are unavailable.
        </p>
      )}
      {view === 'class' ? (
        <ClassFiles cohortId={cohortId} files={data.class_files} storage={data.storage_configured}
          studentCount={folders.filter((folder) => folder.enrollment_status === 'active').length}
          onChange={(update) => replaceFiles(update, null)} onCopied={() => void load()} />
      ) : (
        <StudentFolders cohortId={cohortId} folders={folders} storage={data.storage_configured}
          openStudentId={openStudentId} onOpen={setOpenStudentId}
          onChange={replaceFiles} />
      )}
    </section>
  )
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="app-surface">
      <EmptyState icon={FolderOpen} title="Could not load files" description={message}
        action={<Button onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} />
    </div>
  )
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} aria-label={label} className="app-control w-full pl-10" />
    </div>
  )
}

function ClassFiles({ cohortId, files, storage, studentCount, onChange, onCopied }: {
  cohortId: number
  files: CohortFile[]
  storage: boolean
  studentCount: number
  onChange: (update: (files: CohortFile[]) => CohortFile[]) => void
  onCopied: () => void
}) {
  const [folder, setFolder] = useState('All')
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const folders = useMemo(() => [...new Set(files.map((file) => file.folder))].sort(), [files])
  const shown = files.filter((file) => (folder === 'All' || file.folder === folder) && matchesFileQuery(file, query))

  return (
    <div className="space-y-4">
      {uploading ? (
        <CohortFileUploader cohortId={cohortId} heading="Upload a class file" allowVisibility
          description="Choose Staff only to review a file before students can see it."
          folderPresets={folderOptions(CLASS_FOLDER_PRESETS, files)} disabled={!storage} disabledReason="File storage isn't set up yet."
          onCancel={() => setUploading(false)}
          onUploaded={(file) => { onChange((current) => [...current, file]); setUploading(false) }} />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchBox value={query} onChange={setQuery} label="Search class files" />
          <Button onClick={() => setUploading(true)} disabled={!storage}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload file
          </Button>
        </div>
      )}
      {folders.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by folder">
          {['All', ...folders].map((name) => (
            <button key={name} type="button" aria-pressed={folder === name} onClick={() => setFolder(name)}
              className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors duration-150 lg:min-h-9 ${folder === name ? 'border-primary-soft-line bg-primary-soft text-primary-ink' : 'border-line bg-surface-raised text-ink-secondary hover:border-line-strong hover:text-ink'}`}>
              {name}
            </button>
          ))}
        </div>
      )}
      {files.length === 0 ? (
        <div className="app-surface">
          <EmptyState icon={FolderOpen} title="No class files yet" description="Upload slides, guides, templates and starter kits. Students see them on Resources." />
        </div>
      ) : shown.length === 0 ? (
        <p className="app-surface px-4 py-6 text-center text-sm text-ink-secondary">No class files match this view.</p>
      ) : (
        <ul className="app-surface divide-y divide-line overflow-hidden" aria-label="Class files">
          {shown.map((file) => (
            <ClassFileItem key={file.id} cohortId={cohortId} file={file} studentCount={studentCount} storage={storage}
              onSaved={(saved) => onChange((current) => current.map((item) => (item.id === saved.id ? saved : item)))}
              onDeleted={() => onChange((current) => current.filter((item) => item.id !== file.id))}
              onCopied={onCopied} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ClassFileItem({ cohortId, file, studentCount, storage, onSaved, onDeleted, onCopied }: {
  cohortId: number
  file: CohortFile
  studentCount: number
  storage: boolean
  onSaved: (file: CohortFile) => void
  onDeleted: () => void
  onCopied: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const staged = file.visibility === 'staff_only'

  const toggle = async () => {
    setBusy(true)
    const result = await api.updateCohortFile(cohortId, file.id, { visibility: staged ? 'students' : 'staff_only' })
    setBusy(false)
    if (!result.data) return toast.error(result.error || 'Could not change who can see this file.')
    onSaved(result.data.file)
    toast.success(staged ? `Shared ${file.title} with students` : `${file.title} is staff only`)
  }
  const copy = async () => {
    const ok = await confirm({
      title: `Copy ${file.title} to every student?`,
      description: `Each active student (${studentCount}) gets their own copy in their private folder. Students who already have one are skipped, so you can run this again after new students join.`,
      confirmLabel: 'Copy to all students',
    })
    if (!ok) return
    setBusy(true)
    const result = await api.copyCohortFileToStudents(cohortId, file.id)
    setBusy(false)
    if (!result.data) return toast.error(result.error || 'Could not copy this file.')
    const { copied_count: copied, skipped_count: skipped } = result.data
    toast.success(`Copied to ${copied} student${copied === 1 ? '' : 's'}${skipped ? ` (${skipped} already had it)` : ''}`)
    onCopied()
  }
  const remove = async () => {
    const ok = await confirm({ title: `Delete ${file.title}?`, description: 'Students lose access to it right away. Copies already in student folders stay.', confirmLabel: 'Delete file', tone: 'danger' })
    if (!ok) return
    setBusy(true)
    const result = await api.deleteCohortFile(cohortId, file.id)
    setBusy(false)
    if (result.error) return toast.error(result.error)
    onDeleted()
    toast.success(`Deleted ${file.title}`)
  }

  if (editing) return <EditFile cohortId={cohortId} file={file} presets={CLASS_FOLDER_PRESETS} onCancel={() => setEditing(false)} onSaved={(saved) => { onSaved(saved); setEditing(false) }} />
  return (
    <CohortFileRow cohortId={cohortId} file={file} downloadDisabled={!storage}
      badges={<><FolderBadge folder={file.folder} />{staged && <StaffOnlyBadge />}</>}
      actions={<>
        <Button size="sm" variant={staged ? 'primary' : 'quiet'} disabled={busy} onClick={() => void toggle()}>
          {staged ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
          {staged ? 'Share with students' : 'Move to staff only'}
        </Button>
        <OverflowMenu size="sm" label={`More actions for ${file.title}`} items={[
          ...(storage && studentCount > 0 ? [{ key: 'copy', label: 'Copy to all students', icon: <CopyPlus className="h-4 w-4" aria-hidden="true" />, onSelect: () => void copy() }] : []),
          { key: 'edit', label: 'Edit', icon: <Pencil className="h-4 w-4" aria-hidden="true" />, onSelect: () => setEditing(true) },
          { key: 'delete', label: 'Delete', tone: 'danger' as const, icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, onSelect: () => void remove() },
        ]} />
      </>} />
  )
}

function EditFile({ cohortId, file, presets, onCancel, onSaved }: {
  cohortId: number
  file: CohortFile
  presets: string[]
  onCancel: () => void
  onSaved: (file: CohortFile) => void
}) {
  const [title, setTitle] = useState(file.title)
  const [folder, setFolder] = useState(file.folder)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const listId = `folders-${file.id}`
  const save = async () => {
    setSaving(true)
    const result = await api.updateCohortFile(cohortId, file.id, { title, folder })
    setSaving(false)
    if (!result.data) return setError(result.error || 'Could not save.')
    onSaved(result.data.file)
  }
  return (
    <li className="space-y-3 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          Title
          <input className="app-control mt-1 w-full" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-ink">
          Folder
          <input className="app-control mt-1 w-full" list={listId} value={folder} maxLength={80} onChange={(event) => setFolder(event.target.value)} />
          <datalist id={listId}>{presets.map((preset) => <option key={preset} value={preset} />)}</datalist>
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={saving || !title.trim() || !folder.trim()} onClick={() => void save()}>
          <Check className="h-4 w-4" aria-hidden="true" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="quiet" disabled={saving} onClick={onCancel}>
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </li>
  )
}

function StudentFolders({ cohortId, folders, storage, openStudentId, onOpen, onChange }: {
  cohortId: number
  folders: CohortStudentFolder[]
  storage: boolean
  openStudentId: number | null
  onOpen: (studentId: number | null) => void
  onChange: (update: (files: CohortFile[]) => CohortFile[], studentId: number) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = folders.filter((folder) => !q || folder.student_name.toLowerCase().includes(q) || folder.student_email.toLowerCase().includes(q))
  const open = folders.find((folder) => folder.student_id === openStudentId) || null

  if (folders.length === 0) {
    return (
      <div className="app-surface">
        <EmptyState icon={FolderLock} title="No student folders yet" description="Every enrolled student gets a private folder automatically." />
      </div>
    )
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:items-start">
      <div className={`space-y-3 ${open ? 'max-lg:hidden' : ''}`}>
        <SearchBox value={query} onChange={setQuery} label="Search students" />
        <ul className="app-surface divide-y divide-line overflow-hidden" aria-label="Student folders">
          {shown.map((folder) => {
            const status = STATUS_LABELS[folder.enrollment_status]
            return (
              <li key={folder.student_id}>
                <button type="button" onClick={() => onOpen(folder.student_id)} aria-current={folder.student_id === openStudentId ? 'true' : undefined}
                  className={`flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-sunken ${folder.student_id === openStudentId ? 'nav-selected' : ''}`}>
                  <FolderLock className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink [overflow-wrap:anywhere]">{folder.student_name}</span>
                    <span className="block text-xs text-ink-muted [overflow-wrap:anywhere]">{folder.student_email}</span>
                  </span>
                  {folder.enrollment_status !== 'active' && <Badge tone={status.tone}>{status.label}</Badge>}
                  <Badge>{`${folder.file_count} file${folder.file_count === 1 ? '' : 's'}`}</Badge>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                </button>
              </li>
            )
          })}
          {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-secondary">No students match.</li>}
        </ul>
      </div>
      {open ? (
        <div className="min-w-0 space-y-3">
          <Button variant="quiet" className="lg:hidden" onClick={() => onOpen(null)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All student folders
          </Button>
          <StudentFolderView cohortId={cohortId} folder={open} storage={storage} onChange={(update) => onChange(update, open.student_id)} />
        </div>
      ) : (
        <div className="app-surface max-lg:hidden">
          <EmptyState icon={FolderOpen} title="Choose a student" description="Open a folder to see what you and the student have shared." />
        </div>
      )}
    </div>
  )
}

/** One student's private folder for staff. Also used on the student page's Files tab. */
export function StudentFolderView({ cohortId, folder, storage, onChange }: {
  cohortId: number
  folder: CohortStudentFolder
  storage: boolean
  onChange: (update: (files: CohortFile[]) => CohortFile[]) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [uploading, setUploading] = useState(false)
  const firstName = folder.student_name.split(' ')[0] || folder.student_name
  const remove = async (file: CohortFile) => {
    const ok = await confirm({ title: `Delete ${file.title}?`, description: `${folder.student_name} loses access to it right away.`, confirmLabel: 'Delete file', tone: 'danger' })
    if (!ok) return
    const result = await api.deleteCohortFile(cohortId, file.id)
    if (result.error) return toast.error(result.error)
    onChange((files) => files.filter((item) => item.id !== file.id))
    toast.success(`Deleted ${file.title}`)
  }
  return (
    <section className="space-y-3" aria-label={`${folder.student_name}'s folder`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
            <RecordLink record={{ type: 'student', id: folder.student_id, cohortId }} variant="plain" touchTarget>{folder.student_name}</RecordLink>'s folder
          </h3>
          <p className="mt-1 text-sm text-ink-secondary">Private: only {firstName} and cohort staff can see these files.</p>
        </div>
        {!uploading && (
          <Button onClick={() => setUploading(true)} disabled={!storage}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Upload to {firstName}'s folder
          </Button>
        )}
      </div>
      {uploading && (
        <CohortFileUploader cohortId={cohortId} studentId={folder.student_id} heading={`Upload to ${firstName}'s folder`}
          folderPresets={folderOptions(STUDENT_FOLDER_PRESETS, folder.files)} disabled={!storage} disabledReason="File storage isn't set up yet."
          onCancel={() => setUploading(false)}
          onUploaded={(file) => { onChange((files) => [...files, file]); setUploading(false); toast.success(`Uploaded ${file.title}`) }} />
      )}
      {folder.files.length === 0 ? (
        <div className="app-surface">
          <EmptyState icon={FolderOpen} title="This folder is empty" description={`Files you or ${firstName} upload appear here. Use Copy to all students on a class file to add a template.`} />
        </div>
      ) : (
        <ul className="app-surface divide-y divide-line overflow-hidden" aria-label={`Files in ${folder.student_name}'s folder`}>
          {folder.files.map((file) => (
            <CohortFileRow key={file.id} cohortId={cohortId} file={file} downloadDisabled={!storage}
              note={file.uploaded_by_role === 'student' ? 'Uploaded by student' : 'Shared by staff'}
              badges={<><FolderBadge folder={file.folder} />{file.visibility === 'staff_only' && <StaffOnlyBadge />}</>}
              actions={
                <Button size="sm" variant="quiet" onClick={() => void remove(file)} aria-label={`Delete ${file.title}`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete
                </Button>
              } />
          ))}
        </ul>
      )}
    </section>
  )
}

/** The student page's Files tab: that student's private folder in this cohort. */
export function StudentFilesTab({ cohortId, studentId }: { cohortId: number; studentId: number }) {
  const { data, setData, error, loading, load } = useCohortFiles(cohortId)
  if (loading && !data) return <LoadingSpinner message="Loading files…" />
  if (!data) return <LoadError message={error} onRetry={() => void load()} />
  const folder = data.student_folders?.find((item) => item.student_id === studentId)
  if (!folder) {
    return (
      <div className="app-surface">
        <EmptyState icon={FolderLock} title="No folder for this student" description="Folders are kept for active and paused students in this cohort." />
      </div>
    )
  }
  return (
    <StudentFolderView cohortId={cohortId} folder={folder} storage={data.storage_configured}
      onChange={(update) => setData((current) => current && {
        ...current,
        student_folders: (current.student_folders || []).map((item) => {
          if (item.student_id !== studentId) return item
          const files = update(item.files)
          return { ...item, files, file_count: files.length }
        }),
      })} />
  )
}
