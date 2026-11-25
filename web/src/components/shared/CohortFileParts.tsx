import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Download, FileText, Loader2, Upload, X } from 'lucide-react'
import {
  COHORT_FILE_ACCEPT,
  cohortFileProblem,
  downloadCohortFile,
  fileExtension,
  FILE_TYPE_ICONS,
  formatFileSize,
  titleFromFilename,
  uploadCohortFile,
  type CohortFile,
} from '../../lib/cohortFiles'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ProgressBar } from './ProgressBar'

/** One file: type icon, title, filename and size, badges, and the caller's actions (Download first). */
export function CohortFileRow({ cohortId, file, badges, actions, note, downloadDisabled = false }: {
  cohortId: number
  file: CohortFile
  badges?: ReactNode
  actions?: ReactNode
  note?: ReactNode
  /** File storage is unavailable: show Download disabled with a hint. */
  downloadDisabled?: boolean
}) {
  const Icon = FILE_TYPE_ICONS[fileExtension(file.filename)] || FileText
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const download = async () => {
    if (downloading) return
    setDownloading(true)
    setError('')
    try {
      await downloadCohortFile(cohortId, file)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{file.title}</h3>
            {badges}
          </div>
          <p className="mt-0.5 text-xs text-ink-muted [overflow-wrap:anywhere]">
            {file.filename} · <span className="tabular-nums">{formatFileSize(file.file_size)}</span>
            {note ? <> · {note}</> : null}
          </p>
          {file.description && <p className="mt-1 text-sm text-ink-secondary [overflow-wrap:anywhere]">{file.description}</p>}
          {error && <p role="alert" className="mt-1 text-sm text-danger-ink">{error}</p>}
          {downloadDisabled && <p id={`file-${file.id}-download-hint`} className="mt-1 text-xs text-ink-muted">Downloads are unavailable until file storage is set up.</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[3.25rem] sm:pl-0">
        <Button size="sm" variant="secondary" disabled={downloading || downloadDisabled} onClick={() => void download()} aria-label={`Download ${file.title}`}
          aria-describedby={downloadDisabled ? `file-${file.id}-download-hint` : undefined}>
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          {downloading ? 'Preparing…' : 'Download'}
        </Button>
        {actions}
      </div>
    </li>
  )
}

export function FolderBadge({ folder }: { folder: string }) {
  return <Badge>{folder}</Badge>
}

export function StaffOnlyBadge() {
  return <Badge tone="warning">Staff only</Badge>
}

/**
 * Pick or drop one file, then name it, choose a folder and (for staff) who can
 * see it. The title fills in from the filename. Shows upload progress and
 * keeps the form open with the error when an upload fails.
 */
export function CohortFileUploader({ cohortId, studentId, folderPresets, defaultFolder, allowVisibility = false, heading, description, disabled, disabledReason, onUploaded, onCancel }: {
  cohortId: number
  studentId?: number | null
  folderPresets: string[]
  defaultFolder?: string
  allowVisibility?: boolean
  heading: string
  description?: string
  disabled?: boolean
  disabledReason?: string
  onUploaded: (file: CohortFile) => void
  onCancel?: () => void
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState(defaultFolder || folderPresets[0] || 'General')
  const [customFolder, setCustomFolder] = useState('')
  const [notes, setNotes] = useState('')
  const [visibility, setVisibility] = useState<'students' | 'staff_only'>('students')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const uploading = progress !== null
  const chosenFolder = folder === '__custom' ? customFolder.trim() : folder

  const choose = (next: File | undefined) => {
    if (!next) return
    const problem = cohortFileProblem(next)
    setError(problem || '')
    if (problem) return
    setFile(next)
    setTitle(titleFromFilename(next.name))
  }
  const reset = () => {
    setFile(null)
    setTitle('')
    setNotes('')
    setProgress(null)
    if (inputRef.current) inputRef.current.value = ''
  }
  const submit = async () => {
    if (!file || uploading || !chosenFolder) return
    setError('')
    setProgress(0)
    try {
      const uploaded = await uploadCohortFile(cohortId, file, {
        title, folder: chosenFolder, description: notes, studentId,
        ...(allowVisibility ? { visibility } : {}),
      }, (next) => setProgress(next.percent))
      reset()
      onUploaded(uploaded)
    } catch (cause) {
      setProgress(null)
      setError(cause instanceof Error ? cause.message : 'Upload failed. Try again.')
    }
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!disabled && !uploading) choose(event.dataTransfer.files[0])
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="app-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${id}-heading`} className="text-base font-semibold text-ink [overflow-wrap:anywhere]">{heading}</h3>
          {description && <p className="mt-1 text-sm text-ink-secondary">{description}</p>}
        </div>
        {onCancel && (
          <Button size="sm" variant="quiet" onClick={onCancel} disabled={uploading}>
            <X className="h-4 w-4" aria-hidden="true" />
            Close
          </Button>
        )}
      </div>
      {disabled ? (
        <p className="mt-3 rounded-xl border border-line bg-surface-sunken px-3.5 py-3 text-sm text-ink-secondary">{disabledReason}</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-5 text-center transition-colors duration-150 ${dragging ? 'border-focus bg-surface-sunken' : 'border-line-strong'}`}
          >
            <Upload className="h-5 w-5 text-ink-muted" aria-hidden="true" />
            {file ? (
              <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{file.name} · <span className="tabular-nums">{formatFileSize(file.size)}</span></p>
            ) : (
              <p className="text-sm text-ink-secondary">Drop a file here, or choose one. Up to 100 MB.</p>
            )}
            <input ref={inputRef} id={`${id}-file`} type="file" accept={COHORT_FILE_ACCEPT} className="sr-only" disabled={uploading}
              onChange={(event) => choose(event.target.files?.[0])} />
            <Button size="sm" variant="secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
              {file ? 'Choose a different file' : 'Choose file'}
            </Button>
          </div>
          {file && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-ink sm:col-span-2">
                Title
                <input className="app-control mt-1 w-full" value={title} maxLength={160} disabled={uploading} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="block text-sm font-medium text-ink">
                Folder
                <select className="app-control mt-1 w-full" value={folder} disabled={uploading} onChange={(event) => setFolder(event.target.value)}>
                  {folderPresets.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
                  <option value="__custom">New folder…</option>
                </select>
              </label>
              {folder === '__custom' ? (
                <label className="block text-sm font-medium text-ink">
                  New folder name
                  <input className="app-control mt-1 w-full" value={customFolder} maxLength={80} disabled={uploading} onChange={(event) => setCustomFolder(event.target.value)} />
                </label>
              ) : <div className="hidden sm:block" />}
              <label className="block text-sm font-medium text-ink sm:col-span-2">
                Description <span className="font-normal text-ink-muted">(optional)</span>
                <textarea className="app-control mt-1 w-full" rows={2} maxLength={500} value={notes} disabled={uploading} onChange={(event) => setNotes(event.target.value)} />
              </label>
              {allowVisibility && (
                <fieldset className="sm:col-span-2">
                  <legend className="text-sm font-medium text-ink">Who can see it</legend>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    {([['students', 'Visible to students', 'Students see it as soon as it uploads.'], ['staff_only', 'Staff only (staging)', 'Review it first, then share it with one click.']] as const).map(([value, label, hint]) => (
                      <label key={value} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm ${visibility === value ? 'border-focus bg-surface-sunken' : 'border-line'}`}>
                        <input type="radio" name={`${id}-visibility`} className="mt-1" checked={visibility === value} disabled={uploading} onChange={() => setVisibility(value)} />
                        <span><span className="block font-semibold text-ink">{label}</span><span className="block text-ink-secondary">{hint}</span></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          )}
          {uploading && <ProgressBar value={progress} label={`Uploading ${file?.name ?? 'file'}`} size="sm" />}
          {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
          {file && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={uploading || !chosenFolder || !title.trim()} onClick={() => void submit()}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                {uploading ? 'Uploading…' : 'Upload file'}
              </Button>
              <Button variant="quiet" disabled={uploading} onClick={reset}>Clear</Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
