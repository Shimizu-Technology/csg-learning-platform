import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Check, Download, Eye, EyeOff, FileText, FolderOpen, Link2, Loader2, NotebookPen, Pencil, RefreshCw, Repeat, Trash2, Upload, X } from 'lucide-react'
import type { components } from '../../types/api.generated'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import {
  CLASS_FOLDER_PRESETS,
  COHORT_FILE_ACCEPT,
  LINK_PROVIDERS,
  MAX_DOC_LENGTH,
  FILE_TYPE_ICONS,
  cohortFileProblem,
  fileExtension,
  formatFileSize,
  linkHost,
  linkUrlProblem,
  safeExternalFileUrl,
  titleFromFilename,
} from '../../lib/cohortFiles'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { uploadToS3 } from '../../lib/uploadToS3'
import { EmptyState } from '../shared/EmptyState'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'
import { Modal } from '../shared/Modal'
import { Badge } from '../ui/Badge'
import { AnchorButton, Button } from '../ui/Button'
import { OverflowMenu } from '../ui/OverflowMenu'
import { AutoCopyBadge } from '../shared/CohortFileParts'

export type CurriculumFile = components['schemas']['CurriculumFile']
type Visibility = CurriculumFile['visibility']
type Adding = 'file' | 'link' | 'doc' | null

const TEMPLATE_FOLDERS = [...CLASS_FOLDER_PRESETS, 'Week 1', 'Instructor Notes']

/**
 * Content Management, Files pane: the template files, links and docs every
 * new cohort on this curriculum starts with. Cohorts get their own copies,
 * so a change here reaches only cohorts that import it later. Admins manage
 * templates on draft and active curricula; other staff can open them.
 */
export function CurriculumTemplateFilesPanel({ curriculumId }: { curriculumId: number }) {
  const [files, setFiles] = useState<CurriculumFile[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [storage, setStorage] = useState(false)
  const [error, setError] = useState('')
  const [folder, setFolder] = useState('All')
  const [adding, setAdding] = useState<Adding>(null)
  const [openDocId, setOpenDocId] = useState<number | null>(null)
  const load = useCallback(async () => {
    const result = await api.getCurriculumFiles(curriculumId)
    if (!result.data) return setError(result.error || 'Could not load template files.')
    setFiles(result.data.files)
    setCanManage(result.data.can_manage)
    setStorage(result.data.storage_configured)
    setError('')
  }, [curriculumId])
  useEffect(() => { void load() }, [load])

  const folders = useMemo(() => [...new Set((files || []).map((file) => file.folder))].sort(), [files])
  const activeFolder = folder !== 'All' && folders.includes(folder) ? folder : 'All'
  const shown = (files || []).filter((file) => activeFolder === 'All' || file.folder === activeFolder)
  const presets = [...new Set([...TEMPLATE_FOLDERS, ...folders])]
  const replace = (saved: CurriculumFile) => setFiles((current) => current && current.map((file) => (file.id === saved.id ? saved : file)))
  const add = (saved: CurriculumFile) => setFiles((current) => [...(current || []), saved])
  const openDoc = files?.find((file) => file.id === openDocId) || null

  return (
    <section className="@container border-t border-line px-4 py-4 sm:px-6" aria-labelledby={`templates-${curriculumId}`} data-curriculum-id={curriculumId}>
      <h3 id={`templates-${curriculumId}`} className="text-base font-semibold text-ink">Template files</h3>
      <p className="mt-1 text-sm text-ink-secondary">
        Every new cohort on this course starts with a copy of these. Cohorts keep their own copies, so changes here reach a cohort when staff use Import from curriculum.
      </p>
      {error && !files ? (
        <div role="alert" className="mt-3 space-y-2">
          <p className="text-sm text-danger-ink">{error}</p>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      ) : !files ? (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-ink-secondary">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading template files…
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {canManage && (adding ? (
            <TemplateAddForm key={adding} curriculumId={curriculumId} mode={adding} presets={presets} storage={storage}
              defaultFolder={activeFolder === 'All' ? 'General' : activeFolder}
              onAdded={(saved) => { add(saved); if (saved.kind === 'doc') setOpenDocId(saved.id) }}
              onDone={() => setAdding(null)} />
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Add template files">
              <Button size="sm" onClick={() => setAdding('file')} disabled={!storage} title={storage ? undefined : "File storage isn't set up yet."}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Upload files
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAdding('link')}>
                <Link2 className="h-4 w-4" aria-hidden="true" />
                Add link
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAdding('doc')}>
                <NotebookPen className="h-4 w-4" aria-hidden="true" />
                New doc
              </Button>
            </div>
          ))}
          {folders.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter template files by folder">
              {['All', ...folders].map((name) => (
                <button key={name} type="button" aria-pressed={activeFolder === name} onClick={() => setFolder(name)}
                  className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors duration-150 lg:min-h-9 ${activeFolder === name ? 'border-primary-soft-line bg-primary-soft text-primary-ink' : 'border-line bg-surface-raised text-ink-secondary hover:border-line-strong hover:text-ink'}`}>
                  {name}
                </button>
              ))}
            </div>
          )}
          {files.length === 0 ? (
            <div className="rounded-2xl border border-line">
              <EmptyState icon={FolderOpen} title="No template files yet"
                description={canManage ? 'Add guides, checklists and links every cohort should start with.' : 'An admin can add files every cohort starts with.'} />
            </div>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label="Template files">
              {shown.map((file) => (
                <TemplateRow key={file.id} curriculumId={curriculumId} file={file} canManage={canManage} storage={storage} presets={presets}
                  onOpenDoc={() => setOpenDocId(file.id)} onSaved={replace}
                  onDeleted={() => setFiles((current) => current && current.filter((item) => item.id !== file.id))} />
              ))}
            </ul>
          )}
        </div>
      )}
      {openDoc && <TemplateDocModal curriculumId={curriculumId} file={openDoc} canEdit={canManage} onClose={() => setOpenDocId(null)} onSaved={replace} />}
    </section>
  )
}

function AutoCopyField({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line px-3.5 py-2.5 text-sm @md:col-span-2">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="block font-semibold text-ink">Auto-copy to students</span>
        <span className="block text-ink-secondary">Every student also gets their own copy in their folder, including students who join later.</span>
      </span>
    </label>
  )
}

function VisibilityChoice({ value, onChange, disabled }: { value: Visibility; onChange: (value: Visibility) => void; disabled?: boolean }) {
  const name = useId()
  return (
    <fieldset className="@md:col-span-2">
      <legend className="text-sm font-medium text-ink">Who can see each cohort's copy</legend>
      <div className="mt-1 grid gap-2 @md:grid-cols-2">
        {([['students', 'Share with students'], ['staff_only', 'Staff only']] as const).map(([option, label]) => (
          <label key={option} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-semibold text-ink ${value === option ? 'border-focus bg-surface-sunken' : 'border-line'}`}>
            <input type="radio" name={name} checked={value === option} disabled={disabled} onChange={() => onChange(option)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

interface QueuedUpload { key: string; file: File; status: 'ready' | 'uploading' | 'done' | 'failed'; progress: number; error: string }

/** Upload files, add a link or start a doc, with folder, sharing and auto-copy. */
function TemplateAddForm({ curriculumId, mode, presets, storage, defaultFolder, onAdded, onDone }: {
  curriculumId: number
  mode: Exclude<Adding, null>
  presets: string[]
  storage: boolean
  defaultFolder: string
  onAdded: (file: CurriculumFile) => void
  onDone: () => void
}) {
  const toast = useToast()
  const listId = useId()
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState(defaultFolder)
  const [url, setUrl] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('students')
  const [autoCopy, setAutoCopy] = useState(false)
  const [queue, setQueue] = useState<QueuedUpload[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const shared = { folder: folder.trim() || 'General', visibility, auto_copy_to_students: visibility === 'students' && autoCopy }
  const update = (key: string, change: Partial<QueuedUpload>) => setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)))

  const pick = (list: FileList | null) => {
    const picked = Array.from(list || [])
    const problems = picked.map(cohortFileProblem).filter(Boolean)
    setError(problems.join(' '))
    setQueue((current) => [...current, ...picked.filter((file) => !cohortFileProblem(file)).map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, status: 'ready' as const, progress: 0, error: '' }))])
  }
  const uploadAll = async () => {
    setSaving(true)
    let failed = 0
    for (const item of queue.filter((entry) => entry.status === 'ready' || entry.status === 'failed')) {
      update(item.key, { status: 'uploading', error: '', progress: 0 })
      let pendingId: number | null = null
      try {
        const started = await api.createCurriculumFileUpload(curriculumId, { filename: item.file.name, content_type: item.file.type, file_size: item.file.size, title: titleFromFilename(item.file.name), ...shared })
        if (!started.data) throw new Error(started.error || 'Could not start the upload.')
        pendingId = started.data.file.id
        await uploadToS3(started.data.upload_url, started.data.fields, item.file, (progress) => update(item.key, { progress: progress.percent }))
        const completed = await api.completeCurriculumFile(curriculumId, pendingId)
        if (!completed.data) throw new Error(completed.error || 'The upload could not be saved.')
        pendingId = null
        update(item.key, { status: 'done', progress: 100 })
        onAdded(completed.data.file)
      } catch (cause) {
        failed += 1
        update(item.key, { status: 'failed', error: cause instanceof Error ? cause.message : 'Upload failed.' })
        if (pendingId) void api.deleteCurriculumFile(curriculumId, pendingId, { pendingOnly: true })
      }
    }
    setSaving(false)
    if (!failed) {
      toast.success('Template files uploaded')
      onDone()
    }
  }
  const save = async () => {
    if (mode === 'link') {
      const problem = linkUrlProblem(url)
      if (problem) return setError(problem)
    }
    setSaving(true)
    setError('')
    const result = mode === 'link'
      ? await api.createCurriculumLink(curriculumId, { external_url: url.trim(), ...(title.trim() ? { title: title.trim() } : {}), ...shared })
      : await api.createCurriculumDoc(curriculumId, { title: title.trim() || 'Untitled doc', doc_content: '', ...shared })
    setSaving(false)
    if (!result.data) return setError(result.error || 'Could not save.')
    toast.success(`Added ${result.data.file.title}`)
    onAdded(result.data.file)
    onDone()
  }
  const heading = mode === 'file' ? 'Upload template files' : mode === 'link' ? 'Add a template link' : 'New template doc'
  return (
    <form className="space-y-3 rounded-2xl border border-line p-4" aria-label={heading} onSubmit={(event) => { event.preventDefault(); void (mode === 'file' ? uploadAll() : save()) }}>
      <h4 className="text-sm font-semibold text-ink">{heading}</h4>
      <div className="grid gap-3 @md:grid-cols-2">
        {mode === 'file' ? (
          <label className="block text-sm font-medium text-ink @md:col-span-2">
            Files
            <input type="file" multiple accept={COHORT_FILE_ACCEPT} disabled={saving || !storage} onChange={(event) => { pick(event.target.files); event.target.value = '' }}
              className="mt-1 block min-h-11 w-full text-sm" />
          </label>
        ) : (
          <>
            {mode === 'link' && (
              <label className="block text-sm font-medium text-ink @md:col-span-2">
                Link
                <input className="app-control mt-1 w-full" type="url" inputMode="url" spellCheck={false} placeholder="https://" value={url} maxLength={2048} disabled={saving} onChange={(event) => setUrl(event.target.value)} />
              </label>
            )}
            <label className="block text-sm font-medium text-ink">
              Title
              <input className="app-control mt-1 w-full" value={title} maxLength={160} disabled={saving} placeholder={mode === 'link' ? 'Uses the site name when blank' : 'Untitled doc'} onChange={(event) => setTitle(event.target.value)} />
            </label>
          </>
        )}
        <label className="block text-sm font-medium text-ink">
          Folder
          <input className="app-control mt-1 w-full" list={listId} value={folder} maxLength={80} disabled={saving} onChange={(event) => setFolder(event.target.value)} />
          <datalist id={listId}>{presets.map((preset) => <option key={preset} value={preset} />)}</datalist>
        </label>
        <VisibilityChoice value={visibility} disabled={saving} onChange={(value) => { setVisibility(value); if (value === 'staff_only') setAutoCopy(false) }} />
        {visibility === 'students' && <AutoCopyField checked={autoCopy} disabled={saving} onChange={setAutoCopy} />}
      </div>
      {queue.length > 0 && (
        <ul className="space-y-2" aria-label="Files to upload">
          {queue.map((item) => (
            <li key={item.key} className="rounded-xl border border-line px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">{item.file.name}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">{item.status === 'uploading' ? `${item.progress}%` : item.status === 'done' ? 'Uploaded' : item.status === 'failed' ? 'Failed' : formatFileSize(item.file.size)}</span>
              </div>
              {item.error && <p role="alert" className="mt-1 text-danger-ink">{item.error}</p>}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving || (mode === 'file' ? !queue.some((item) => item.status === 'ready' || item.status === 'failed') : mode === 'link' && !url.trim())}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          {saving ? 'Saving…' : mode === 'file' ? 'Upload' : mode === 'link' ? 'Add link' : 'Create doc'}
        </Button>
        <Button size="sm" variant="quiet" disabled={saving} onClick={onDone}>
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </form>
  )
}

function TemplateRow({ curriculumId, file, canManage, storage, presets, onOpenDoc, onSaved, onDeleted }: {
  curriculumId: number
  file: CurriculumFile
  canManage: boolean
  storage: boolean
  presets: string[]
  onOpenDoc: () => void
  onSaved: (file: CurriculumFile) => void
  onDeleted: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const staged = file.visibility === 'staff_only'
  const Icon = file.kind === 'doc' ? NotebookPen : file.kind === 'link' ? LINK_PROVIDERS[file.link_provider || 'web'].icon : FILE_TYPE_ICONS[fileExtension(file.filename || '')] || FileText
  const href = file.kind === 'link' ? safeExternalFileUrl(file.external_url) : null
  const meta = file.kind === 'link' ? linkHost(file.external_url) : file.kind === 'doc' ? 'Learn Doc' : `${file.filename} · ${formatFileSize(file.file_size || 0)}`

  const change = async (data: components['schemas']['CurriculumFileUpdateInput'], message: string) => {
    setBusy(true)
    const result = await api.updateCurriculumFile(curriculumId, file.id, data)
    setBusy(false)
    if (!result.data) return toast.error(result.error || 'Could not save this change.')
    onSaved(result.data.file)
    toast.success(message)
  }
  const download = async () => {
    setBusy(true)
    const result = await api.downloadCurriculumFile(curriculumId, file.id)
    setBusy(false)
    const url = result.data ? sanitizeUrl(result.data.url) : ''
    if (!url.startsWith('https://')) return toast.error(result.error || 'Could not download this file.')
    const link = document.createElement('a')
    link.href = url
    link.download = result.data?.filename || 'download'
    link.rel = 'noreferrer'
    link.click()
  }
  const remove = async () => {
    const ok = await confirm({ title: `Delete ${file.title}?`, description: 'New cohorts won\'t start with it. Cohorts that already have a copy keep theirs.', confirmLabel: 'Delete template', tone: 'danger' })
    if (!ok) return
    setBusy(true)
    const result = await api.deleteCurriculumFile(curriculumId, file.id)
    setBusy(false)
    if (result.error) return toast.error(result.error)
    onDeleted()
    toast.success(`Deleted ${file.title}`)
  }

  if (editing) {
    return <TemplateDetailsEditor curriculumId={curriculumId} file={file} presets={presets} onCancel={() => setEditing(false)} onSaved={(saved) => { onSaved(saved); setEditing(false) }} />
  }
  return (
    <li className="flex flex-col gap-3 px-4 py-3 @lg:flex-row @lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{file.title}</p>
          <p className="text-xs text-ink-muted [overflow-wrap:anywhere]">{meta}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge>{file.folder}</Badge>
            {staged && <Badge tone="warning">Staff only</Badge>}
            {file.auto_copy_to_students && <AutoCopyBadge />}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {file.kind === 'doc' ? (
          <Button size="sm" variant="secondary" onClick={onOpenDoc} aria-label={`Open ${file.title}`}>
            <NotebookPen className="h-4 w-4" aria-hidden="true" />
            Open doc
          </Button>
        ) : file.kind === 'link' ? (
          href && (
            <AnchorButton size="sm" variant="secondary" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${file.title} (opens in a new tab)`}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Open link
            </AnchorButton>
          )
        ) : (
          <Button size="sm" variant="secondary" disabled={busy || !storage} onClick={() => void download()} aria-label={`Download ${file.title}`}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download
          </Button>
        )}
        {canManage && (
          <OverflowMenu size="sm" label={`More actions for ${file.title}`} items={[
            staged
              ? { key: 'share', label: 'Share with students', icon: <Eye className="h-4 w-4" aria-hidden="true" />, onSelect: () => void change({ visibility: 'students' }, `${file.title} is shared with students`) }
              : { key: 'stage', label: 'Staff only', icon: <EyeOff className="h-4 w-4" aria-hidden="true" />, onSelect: () => void change({ visibility: 'staff_only', ...(file.auto_copy_to_students ? { auto_copy_to_students: false } : {}) }, `${file.title} is staff only`) },
            ...(!staged ? [{ key: 'auto-copy', label: file.auto_copy_to_students ? 'Turn off auto-copy' : 'Auto-copy to students', icon: <Repeat className="h-4 w-4" aria-hidden="true" />,
              onSelect: () => void change({ auto_copy_to_students: !file.auto_copy_to_students }, file.auto_copy_to_students ? `${file.title} no longer auto-copies` : `${file.title} auto-copies to students`) }] : []),
            { key: 'edit', label: 'Edit details', icon: <Pencil className="h-4 w-4" aria-hidden="true" />, onSelect: () => setEditing(true) },
            { key: 'delete', label: 'Delete', tone: 'danger' as const, icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, onSelect: () => void remove() },
          ]} />
        )}
      </div>
    </li>
  )
}

function TemplateDetailsEditor({ curriculumId, file, presets, onCancel, onSaved }: {
  curriculumId: number
  file: CurriculumFile
  presets: string[]
  onCancel: () => void
  onSaved: (file: CurriculumFile) => void
}) {
  const listId = useId()
  const [title, setTitle] = useState(file.title)
  const [folder, setFolder] = useState(file.folder)
  const [url, setUrl] = useState(file.external_url || '')
  const [baseVersion, setBaseVersion] = useState(file.doc_version)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const link = file.kind === 'link'
  const save = async () => {
    if (link && linkUrlProblem(url)) return setError(linkUrlProblem(url) || '')
    setSaving(true)
    const result = await api.updateCurriculumFile(curriculumId, file.id, {
      title, folder, ...(link ? { external_url: url.trim() } : {}), ...(file.kind === 'doc' && baseVersion ? { base_doc_version: baseVersion } : {}),
    })
    setSaving(false)
    if (result.status === 409) {
      const latest = await api.getCurriculumDoc(curriculumId, file.id)
      if (!latest.data) return setError(`This doc changed since you opened it, and the latest version couldn't be loaded (${latest.error || 'try again'}). Cancel, then open it again.`)
      setBaseVersion(latest.data.doc_version)
      return setError(`This doc changed since you opened it (now "${latest.data.file.title}"). Save again to rename it.`)
    }
    if (!result.data) return setError(result.error || 'Could not save.')
    onSaved(result.data.file)
  }
  return (
    <li className="space-y-3 px-4 py-4">
      <div className="grid gap-3 @md:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          Title
          <input className="app-control mt-1 w-full" value={title} maxLength={160} disabled={saving} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-ink">
          Folder
          <input className="app-control mt-1 w-full" list={listId} value={folder} maxLength={80} disabled={saving} onChange={(event) => setFolder(event.target.value)} />
          <datalist id={listId}>{presets.map((preset) => <option key={preset} value={preset} />)}</datalist>
        </label>
        {link && (
          <label className="block text-sm font-medium text-ink @md:col-span-2">
            Link
            <input className="app-control mt-1 w-full" type="url" inputMode="url" spellCheck={false} value={url} maxLength={2048} disabled={saving} onChange={(event) => setUrl(event.target.value)} />
          </label>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={saving || !title.trim() || !folder.trim() || (link && !url.trim())} onClick={() => void save()}>
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

/**
 * A template doc: rendered for reading, a Markdown editor for admins. Saves
 * carry the version that was loaded; when someone else saved first, nothing
 * is overwritten and the latest version can be loaded.
 */
function TemplateDocModal({ curriculumId, file, canEdit, onClose, onSaved }: {
  curriculumId: number
  file: CurriculumFile
  canEdit: boolean
  onClose: () => void
  onSaved: (file: CurriculumFile) => void
}) {
  const textareaId = useId()
  const [loaded, setLoaded] = useState<components['schemas']['CurriculumDocResponse'] | null>(null)
  const [content, setContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<components['schemas']['CurriculumDocConflictResponse'] | null>(null)
  // Someone else saved first, and their version hasn't loaded yet: saving
  // waits for it, so the stale version is never sent again.
  const [stale, setStale] = useState(false)
  const [conflictError, setConflictError] = useState('')
  const [fetchingLatest, setFetchingLatest] = useState(false)
  useEffect(() => {
    let ignore = false
    void api.getCurriculumDoc(curriculumId, file.id).then((result) => {
      if (ignore) return
      if (!result.data) return setError(result.error || 'Could not open this doc.')
      setLoaded(result.data)
      setContent(result.data.doc_content)
    })
    return () => { ignore = true }
  }, [curriculumId, file.id])
  const save = async () => {
    if (!loaded || saving) return
    setSaving(true)
    setError('')
    const result = await api.updateCurriculumFile(curriculumId, file.id, { doc_content: content, base_doc_version: loaded.doc_version })
    setSaving(false)
    if (result.status === 409) {
      setStale(true)
      return fetchLatest()
    }
    if (!result.data) return setError(result.error || 'Could not save this doc.')
    onSaved(result.data.file)
    setLoaded({ ...loaded, file: result.data.file, doc_content: content, doc_version: result.data.file.doc_version ?? loaded.doc_version + 1 })
    setEditing(false)
  }
  const fetchLatest = async () => {
    setFetchingLatest(true)
    setConflictError('')
    const latest = await api.getCurriculumDoc(curriculumId, file.id)
    setFetchingLatest(false)
    if (!latest.data) return setConflictError(latest.error || 'Could not load the latest version.')
    setConflict({ error: 'This doc was saved by someone else.', ...latest.data })
  }
  const loadLatest = () => {
    if (!conflict) return
    setLoaded(conflict)
    setContent(conflict.doc_content)
    setConflict(null)
    setStale(false)
    onSaved(conflict.file)
  }
  const cancelEdit = () => {
    if (!loaded) return
    setEditing(false)
    setContent(loaded.doc_content)
    setConflict(null)
    setConflictError('')
    setStale(false)
  }
  const tooLong = content.length > MAX_DOC_LENGTH
  return (
    <Modal open onClose={onClose} title={file.title} subtitle={editing ? 'Editing the template. Cohort copies keep their own version.' : 'Template doc'} size="xl"
      footer={canEdit && loaded ? (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {editing ? (
            <>
              <Button variant="quiet" disabled={saving} onClick={cancelEdit}>Cancel</Button>
              <Button disabled={saving || tooLong || content === loaded.doc_content || stale} onClick={() => void save()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                {saving ? 'Saving…' : 'Save doc'}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit doc
            </Button>
          )}
        </div>
      ) : undefined}>
      {!loaded ? (
        error ? <p role="alert" className="text-sm text-danger-ink">{error}</p> : (
          <p role="status" className="flex items-center gap-2 text-sm text-ink-secondary">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Opening doc…
          </p>
        )
      ) : editing ? (
        <div className="space-y-2">
          {stale && !conflict && (
            <div role="alert" aria-busy={fetchingLatest || undefined} className="space-y-2 rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink">
              <p>
                Someone else saved this doc while you were editing. Your text is still here.{' '}
                {fetchingLatest ? 'Loading their version…' : `Their version couldn't be loaded${conflictError ? `: ${conflictError}` : ''}.`}
              </p>
              <Button size="sm" variant="secondary" disabled={fetchingLatest} onClick={() => void fetchLatest()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try loading again
              </Button>
            </div>
          )}
          {conflict && (
            <div role="alert" className="space-y-2 rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink">
              <p>Someone else saved this doc while you were editing. Your text is still here; copy anything you need, then load their version.</p>
              <Button size="sm" variant="secondary" onClick={loadLatest}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Load latest version
              </Button>
            </div>
          )}
          <label htmlFor={textareaId} className="block text-sm font-medium text-ink">Markdown</label>
          <textarea id={textareaId} className="app-control min-h-80 w-full font-mono text-sm" value={content} disabled={saving} onChange={(event) => setContent(event.target.value)} />
          {tooLong && <p role="alert" className="text-sm text-danger-ink">This doc is longer than {MAX_DOC_LENGTH.toLocaleString()} characters.</p>}
          {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        </div>
      ) : loaded.doc_content.trim() ? (
        <div className="min-w-0 [overflow-wrap:anywhere]"><MarkdownRenderer content={loaded.doc_content} variant="doc" /></div>
      ) : (
        <p className="text-sm text-ink-secondary">This doc is empty.{canEdit ? ' Choose Edit doc to write it.' : ''}</p>
      )}
    </Modal>
  )
}
