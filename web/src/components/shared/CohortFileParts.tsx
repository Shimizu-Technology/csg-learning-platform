import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { BookOpen, Check, Download, Eye, ExternalLink, FileUp, History, Info, Link2, Loader2, NotebookPen, Repeat, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { api } from '../../lib/api'
import {
  COHORT_FILE_ACCEPT,
  cohortFileProblem,
  downloadCohortFile,
  formatFileSize,
  isStudentFolderItem,
  LINK_PROVIDERS,
  linkHost,
  linkProviderFor,
  linkUrlProblem,
  safeExternalFileUrl,
  titleFromFilename,
  abandonCohortUpload,
  uploadCohortFile,
  uploadCohortFileVersion,
  type CohortFile,
  type CohortUploadState,
  type LinkProvider,
} from '../../lib/cohortFiles'
import { DRIVE_DRAG_MIME, driveToneSurface, fileVisualMeta } from '../../lib/driveHelpers'
import { Badge } from '../ui/Badge'
import { AnchorButton, Button, IconButton } from '../ui/Button'
import { formatShortDateTime } from '../../lib/format'
import { CohortDocEditorModal } from './CohortDocEditorModal'
import { CohortFilePreviewModal } from './CohortFilePreviewModal'
import { CohortFileReviewModal, CommentCountChip, ReviewStatusBadge, type ReviewAccess } from './CohortFileReview'
import { ProgressBar } from './ProgressBar'

// A full 44px tap target on phones; a plain underlined title on desktop.
const TITLE_CONTROL = 'inline-flex min-h-11 items-center text-left underline-offset-2 hover:underline focus-visible:underline lg:min-h-0'

type OpenView = { pane: 'main' | 'review' }

/**
 * One file, link or Learn Doc: icon, title, details, badges, and the caller's
 * actions. Files get Preview (when the type can show in the app) and
 * Download, a version badge and Versions once there is more than one
 * version, and Upload new version for people who manage them. Links get Open
 * link; docs open in the doc editor. With `review`, items in a student's
 * folder show their review status and comment count, and open with review
 * and comments beside them.
 */
export function CohortFileRow({ cohortId, file, badges, actions, note, downloadDisabled = false, canUploadVersion = false, onVersionUploaded, review, onFileChange, selected = false, canSelect = false, onToggleSelect, canDrag = false, inspected = false, onInspect, onPrevPreview, onNextPreview, previewPosition }: {
  cohortId: number
  file: CohortFile
  badges?: ReactNode
  actions?: ReactNode
  note?: ReactNode
  /** File storage is unavailable: show Download disabled with a hint. */
  downloadDisabled?: boolean
  canUploadVersion?: boolean
  onVersionUploaded?: (file: CohortFile) => void
  review?: ReviewAccess
  /** A doc save, review change or comment changed the file. */
  onFileChange?: (file: CohortFile) => void
  selected?: boolean
  canSelect?: boolean
  onToggleSelect?: (fileId: number) => void
  canDrag?: boolean
  inspected?: boolean
  onInspect?: (file: CohortFile) => void
  onPrevPreview?: () => void
  onNextPreview?: () => void
  previewPosition?: string
}) {
  const doc = file.kind === 'doc'
  const visual = fileVisualMeta(file)
  const Icon = visual.icon
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [opened, setOpened] = useState<OpenView | null>(null)
  const [addingVersion, setAddingVersion] = useState(false)
  const link = file.kind === 'link'
  const href = link ? safeExternalFileUrl(file.external_url) : null
  const canPreview = !link && !doc && file.previewable && !downloadDisabled
  const reviewing = review && isStudentFolderItem(file) ? review : undefined
  const changed = (next: CohortFile) => onFileChange?.(next)
  const open = (pane: OpenView['pane'] = 'main') => setOpened({ pane })
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
  const details = doc
    ? <>Learn Doc{file.doc_updated_at ? <> · Updated {formatShortDateTime(file.doc_updated_at, '')}{file.doc_updated_by_name ? ` by ${file.doc_updated_by_name}` : ''}</> : null}</>
    : link
      ? <>{LINK_PROVIDERS[file.link_provider || 'web'].label} · {linkHost(file.external_url)}</>
      : <>{file.filename} · <span className="tabular-nums">{formatFileSize(file.file_size || 0)}</span></>

  return (
    <li
      draggable={canDrag}
      onDragStart={(event) => {
        if (!canDrag) return
        event.dataTransfer.setData(DRIVE_DRAG_MIME, String(file.id))
        event.dataTransfer.effectAllowed = 'move'
      }}
      className={`px-4 py-3.5 transition-colors duration-150 ${
        selected || inspected ? 'bg-primary-soft/35' : 'hover:bg-surface-sunken/50'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {canSelect && onToggleSelect && (
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={`Select ${file.title}`}
              onClick={() => onToggleSelect(file.id)}
              className={`mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                selected ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-surface-raised text-transparent hover:border-ink-muted'
              }`}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${driveToneSurface(visual.tone)}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">
                {canPreview || doc ? (
                  <button type="button" onClick={() => open()} className={TITLE_CONTROL}>{file.title}</button>
                ) : link && href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className={TITLE_CONTROL}>{file.title}</a>
                ) : file.title}
              </h3>
              {link && <LinkProviderBadge provider={file.link_provider || 'web'} />}
              {doc && <Badge tone="brand" icon={<NotebookPen className="h-3 w-3" aria-hidden="true" />}>Learn Doc</Badge>}
              {!link && !doc && file.version_number > 1 && <Badge tone="info">{`v${file.version_number}`}</Badge>}
              {reviewing && <ReviewStatusBadge status={file.review_status} />}
              {badges}
            </div>
            <p className="mt-0.5 text-xs text-ink-muted [overflow-wrap:anywhere]">
              {details}
              {note ? <> · {note}</> : null}
            </p>
            {file.description && <p className="mt-1 text-sm text-ink-secondary [overflow-wrap:anywhere]">{file.description}</p>}
            {error && <p role="alert" className="mt-1 text-sm text-danger-ink">{error}</p>}
            {!link && !doc && downloadDisabled && <p id={`file-${file.id}-download-hint`} className="mt-1 text-xs text-ink-muted">Downloads are unavailable until file storage is set up.</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-[3.25rem] sm:max-w-[60%] sm:shrink-0 sm:justify-end sm:pl-0">
          {doc ? (
            <Button size="sm" variant="secondary" onClick={() => open()} aria-label={`Open ${file.title}`}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              {file.can_edit_doc ? 'Open and edit' : 'Open'}
            </Button>
          ) : link ? (
            href ? (
              <AnchorButton size="sm" variant="secondary" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open link ${file.title} (opens in a new tab)`}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open link
              </AnchorButton>
            ) : <span className="text-xs text-ink-muted">This link can't be opened.</span>
          ) : (
            <>
              {canPreview && (
                <Button size="sm" variant="secondary" onClick={() => open()} aria-label={`Preview ${file.title}`}>
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  Preview
                </Button>
              )}
              <Button size="sm" variant={canPreview ? 'quiet' : 'secondary'} disabled={downloading || downloadDisabled} onClick={() => void download()} aria-label={`Download ${file.title}`}
                aria-describedby={downloadDisabled ? `file-${file.id}-download-hint` : undefined}>
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                {downloading ? 'Preparing…' : 'Download'}
              </Button>
              {file.version_number > 1 && !downloadDisabled && (
                <Button size="sm" variant="quiet" onClick={() => open()} aria-label={`Versions of ${file.title}`}>
                  <History className="h-4 w-4" aria-hidden="true" />
                  Versions
                </Button>
              )}
              {canUploadVersion && !downloadDisabled && !addingVersion && (
                <Button size="sm" variant="quiet" onClick={() => setAddingVersion(true)} aria-label={`Upload new version of ${file.title}`}>
                  <FileUp className="h-4 w-4" aria-hidden="true" />
                  Upload new version
                </Button>
              )}
            </>
          )}
          {reviewing && <CommentCountChip count={file.comment_count} title={file.title} onClick={() => open('review')} />}
          {onInspect && (
            <IconButton label={`Details for ${file.title}`} onClick={() => onInspect(file)}>
              <Info className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          )}
          {actions}
        </div>
      </div>
      {addingVersion && (
        <CohortFileVersionUploader cohortId={cohortId} file={file} onCancel={() => setAddingVersion(false)}
          onUploaded={(saved) => { setAddingVersion(false); onVersionUploaded?.(saved) }} />
      )}
      {opened && doc && (
        <CohortDocEditorModal key={`${cohortId}-${file.id}`} cohortId={cohortId} file={file} open onClose={() => setOpened(null)} onFileChange={changed}
          reviewAccess={reviewing} initialPane={opened.pane === 'review' ? 'review' : 'doc'} />
      )}
      {/* Versions opens the preview for any uploaded file; a download-only type shows its download card there. */}
      {opened && !doc && !link && (canPreview || opened.pane === 'main') && (
        <CohortFilePreviewModal key={`${cohortId}-${file.id}`} cohortId={cohortId} file={file} open onClose={() => setOpened(null)} downloadDisabled={downloadDisabled}
          review={reviewing} onFileChange={changed} initialPane={opened.pane === 'review' ? 'review' : 'preview'}
          onPrev={onPrevPreview} onNext={onNextPreview} positionLabel={previewPosition} />
      )}
      {opened && opened.pane === 'review' && !doc && !canPreview && reviewing && (
        <CohortFileReviewModal cohortId={cohortId} file={file} access={reviewing} open onClose={() => setOpened(null)} onFileChange={changed} />
      )}
    </li>
  )
}

export function FolderBadge({ folder }: { folder: string }) {
  return <Badge>{folder}</Badge>
}

export function StaffOnlyBadge() {
  return <Badge tone="warning">Staff only</Badge>
}

/** Class items every learner gets a copy of, now and when they join. */
export function AutoCopyBadge() {
  return <Badge tone="info" icon={<Repeat className="h-3 w-3" aria-hidden="true" />}>Auto-copy</Badge>
}

export function LinkProviderBadge({ provider }: { provider: LinkProvider }) {
  const { label, icon: Icon } = LINK_PROVIDERS[provider]
  return <Badge tone="brand" icon={<Icon className="h-3 w-3" aria-hidden="true" />}>{label}</Badge>
}

/** Choose a preset folder or name a new one. */
function FolderField({ presets, value, custom, onChange, onCustomChange, disabled }: {
  presets: string[]
  value: string
  custom: string
  onChange: (value: string) => void
  onCustomChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <>
      <label className="block text-sm font-medium text-ink">
        Folder
        <select className="app-control mt-1 w-full" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {presets.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
          <option value="__custom">New folder…</option>
        </select>
      </label>
      {value === '__custom' ? (
        <label className="block text-sm font-medium text-ink">
          New folder name
          <input className="app-control mt-1 w-full" value={custom} maxLength={80} disabled={disabled} onChange={(event) => onCustomChange(event.target.value)} />
        </label>
      ) : <div className="hidden sm:block" />}
    </>
  )
}

function VisibilityField({ name, value, onChange, disabled }: { name: string; value: 'students' | 'staff_only'; onChange: (value: 'students' | 'staff_only') => void; disabled?: boolean }) {
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-sm font-medium text-ink">Who can see it</legend>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        {([['students', 'Visible to students', 'Students see it as soon as it is added.'], ['staff_only', 'Staff only (staging)', 'Review it first, then share it with one click.']] as const).map(([option, label, hint]) => (
          <label key={option} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm ${value === option ? 'border-focus bg-surface-sunken' : 'border-line'}`}>
            <input type="radio" name={name} className="mt-1" checked={value === option} disabled={disabled} onChange={() => onChange(option)} />
            <span><span className="block font-semibold text-ink">{label}</span><span className="block text-ink-secondary">{hint}</span></span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

type QueueStatus = 'ready' | 'uploading' | 'done' | 'failed'
interface QueuedFile {
  key: string
  file: File
  title: string
  status: QueueStatus
  progress: number
  error: string
  removing?: boolean
}

/**
 * Pick or drop one or more files, then name each one and choose a shared
 * folder and (for staff) who can see them. Titles fill in from filenames.
 * Files upload one after another with their own progress; a failed file stays
 * in the list with its error and a Retry button.
 */
export function CohortFileUploader({ cohortId, studentId, folderPresets, defaultFolder, initialFiles, onInitialFilesConsumed, allowVisibility = false, heading, description, disabled, disabledReason, onUploaded, onFinished, onCancel }: {
  cohortId: number
  studentId?: number | null
  folderPresets: string[]
  defaultFolder?: string
  initialFiles?: File[]
  onInitialFilesConsumed?: () => void
  allowVisibility?: boolean
  heading: string
  description?: string
  disabled?: boolean
  disabledReason?: string
  /** Called for each file as it publishes. */
  onUploaded: (file: CohortFile) => void
  /** Called once every queued file has uploaded. */
  onFinished?: () => void
  onCancel?: () => void
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const sequence = useRef(0)
  const [queue, setQueue] = useState<QueuedFile[]>([])
  // The queue as of the latest change, read by a running batch so rows
  // removed or retitled while they wait are honored.
  const queueRef = useRef<QueuedFile[]>([])
  // Each row's resumable upload, so Retry confirms the same pending file.
  const uploads = useRef(new Map<string, CohortUploadState>())
  // Set when the uploader goes away (another folder opened, form closed):
  // a running batch stops before starting its next file.
  const unmounted = useRef(false)
  useEffect(() => {
    unmounted.current = false
    return () => { unmounted.current = true }
  }, [])
  const [folder, setFolder] = useState(defaultFolder || folderPresets[0] || 'General')
  const [customFolder, setCustomFolder] = useState('')
  const [notes, setNotes] = useState('')
  const [visibility, setVisibility] = useState<'students' | 'staff_only'>('students')
  const [problems, setProblems] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [running, setRunning] = useState(false)
  const chosenFolder = folder === '__custom' ? customFolder.trim() : folder
  const pending = queue.filter((item) => item.status !== 'done')
  const single = queue.length === 1
  // Keep default destination synced when switching folders only while the queue is empty.
  useEffect(() => {
    if (queueRef.current.length > 0 || running) return
    setFolder(defaultFolder || folderPresets[0] || 'General')
  }, [defaultFolder, folderPresets, running])

  const commitQueue = (change: (current: QueuedFile[]) => QueuedFile[]) => {
    queueRef.current = change(queueRef.current)
    setQueue(queueRef.current)
  }
  const update = (key: string, change: Partial<QueuedFile>) => commitQueue((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)))
  // Removes a row once its pending file (if any) is abandoned. If the server
  // can't confirm that, the row stays with the error so nothing is left behind silently.
  const remove = async (key: string) => {
    const item = queueRef.current.find((entry) => entry.key === key)
    if (!item) return true
    if (item.status === 'uploading' || item.removing) return false
    const state = uploads.current.get(key)
    if (state && item.status !== 'done') {
      update(key, { removing: true })
      try {
        if ((await abandonCohortUpload(cohortId, state)) === 'published') {
          // It published after all (a lost confirmation): show it instead of losing it.
          const published = await api.completeCohortFile(cohortId, state.fileId!)
          if (!published.data) throw new Error(published.error || 'This file was already published, but could not be loaded.')
          onUploaded(published.data.file)
        }
      } catch (cause) {
        update(key, { removing: false, status: 'failed', error: `Couldn't cancel this upload. ${cause instanceof Error ? cause.message : ''}`.trim() })
        return false
      }
    }
    uploads.current.delete(key)
    commitQueue((current) => current.filter((entry) => entry.key !== key))
    return true
  }
  const choose = (files: FileList | File[] | null | undefined) => {
    if (!files?.length) return
    const added: QueuedFile[] = []
    const refused: string[] = []
    Array.from(files).forEach((file) => {
      const problem = cohortFileProblem(file)
      if (problem) refused.push(problem)
      else {
        sequence.current += 1
        added.push({ key: `${sequence.current}`, file, title: titleFromFilename(file.name), status: 'ready', progress: 0, error: '' })
      }
    })
    setProblems(refused)
    commitQueue((current) => [...current.filter((item) => item.status !== 'done'), ...added])
    if (inputRef.current) inputRef.current.value = ''
  }
  const appliedInitialFiles = useRef<File[] | undefined>(undefined)
  useEffect(() => {
    if (!initialFiles?.length || appliedInitialFiles.current === initialFiles || disabled) return
    appliedInitialFiles.current = initialFiles
    choose(initialFiles)
    onInitialFilesConsumed?.()
  }, [disabled, initialFiles, onInitialFilesConsumed])
  const reset = async () => {
    const results = await Promise.all(queueRef.current.map((item) => remove(item.key)))
    if (results.every(Boolean)) {
      setNotes('')
      setProblems([])
    }
    if (inputRef.current) inputRef.current.value = ''
  }
  const uploadOne = async (item: QueuedFile) => {
    update(item.key, { status: 'uploading', progress: 0, error: '' })
    const state = uploads.current.get(item.key) || {}
    uploads.current.set(item.key, state)
    try {
      const uploaded = await uploadCohortFile(cohortId, item.file, {
        title: item.title, folder: chosenFolder, description: single ? notes : undefined, studentId,
        ...(allowVisibility ? { visibility } : {}),
      }, (next) => update(item.key, { progress: next.percent }), state)
      uploads.current.delete(item.key)
      update(item.key, { status: 'done', progress: 100 })
      onUploaded(uploaded)
      return true
    } catch (cause) {
      update(item.key, { status: 'failed', error: cause instanceof Error ? cause.message : 'Upload failed. Try again.' })
      return false
    }
  }
  const run = async (keys: string[]) => {
    if (running || !chosenFolder || !keys.length) return
    setRunning(true)
    for (const key of keys) {
      if (unmounted.current) return
      // Read the row as it is now: it may have been removed or retitled while it waited.
      const item = queueRef.current.find((entry) => entry.key === key)
      if (item && !item.removing && (item.status === 'ready' || item.status === 'failed')) await uploadOne(item)
    }
    setRunning(false)
    if (unmounted.current) return
    if (queueRef.current.every((item) => item.status === 'done')) {
      uploads.current.clear()
      commitQueue(() => [])
      setNotes('')
      setProblems([])
      onFinished?.()
    }
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!disabled && !running) choose(event.dataTransfer.files)
  }
  const ready = pending.filter((item) => !item.removing && (item.status === 'ready' || item.status === 'failed'))

  return (
    <section aria-labelledby={`${id}-heading`} className="app-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${id}-heading`} className="text-base font-semibold text-ink [overflow-wrap:anywhere]">{heading}</h3>
          {description && <p className="mt-1 text-sm text-ink-secondary">{description}</p>}
        </div>
        {onCancel && (
          <Button size="sm" variant="quiet" onClick={onCancel} disabled={running}>
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
            <p className="text-sm text-ink-secondary">Drop files here, or choose them. Up to 100 MB each.</p>
            <input ref={inputRef} id={`${id}-file`} type="file" multiple accept={COHORT_FILE_ACCEPT} className="sr-only" disabled={running} aria-label={heading}
              onChange={(event) => choose(event.target.files)} />
            <Button size="sm" variant="secondary" disabled={running} onClick={() => inputRef.current?.click()}>
              {queue.length ? 'Add more files' : 'Choose files'}
            </Button>
          </div>
          {problems.length > 0 && (
            <ul role="alert" className="space-y-1 text-sm text-danger-ink">
              {problems.map((problem) => <li key={problem} className="[overflow-wrap:anywhere]">{problem}</li>)}
            </ul>
          )}
          {queue.length > 0 && (
            <>
              <ul className="divide-y divide-line rounded-2xl border border-line" aria-label="Files to upload">
                {queue.map((item) => (
                  <li key={item.key} className="space-y-2 px-3.5 py-3">
                    <div className="flex items-start gap-2">
                      <input className="app-control min-w-0 flex-1" value={item.title} maxLength={160} aria-label={`Title for ${item.file.name}`}
                        disabled={item.status === 'uploading' || item.status === 'done' || item.removing} onChange={(event) => update(item.key, { title: event.target.value })} />
                      {item.status === 'done' ? (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center text-success-ink lg:h-9 lg:w-9" aria-label="Uploaded"><Check className="h-5 w-5" aria-hidden="true" /></span>
                      ) : (
                        <IconButton size="sm" label={`Remove ${item.file.name}`} disabled={item.status === 'uploading' || item.removing}
                          onClick={() => void remove(item.key)}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </IconButton>
                      )}
                    </div>
                    <p className="text-xs text-ink-muted [overflow-wrap:anywhere]">{item.file.name} · <span className="tabular-nums">{formatFileSize(item.file.size)}</span></p>
                    {item.status === 'uploading' && <ProgressBar value={item.progress} label={`Uploading ${item.file.name}`} size="sm" />}
                    {item.status === 'failed' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <p role="alert" className="min-w-0 flex-1 text-sm text-danger-ink [overflow-wrap:anywhere]">{item.error}</p>
                        <Button size="sm" variant="secondary" disabled={running || !chosenFolder || item.removing} onClick={() => void run([item.key])}>
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                          Retry
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <div className="grid gap-3 sm:grid-cols-2">
                <FolderField presets={folderPresets} value={folder} custom={customFolder} onChange={setFolder} onCustomChange={setCustomFolder} disabled={running} />
                {single && (
                  <label className="block text-sm font-medium text-ink sm:col-span-2">
                    Description <span className="font-normal text-ink-muted">(optional)</span>
                    <textarea className="app-control mt-1 w-full" rows={2} maxLength={500} value={notes} disabled={running} onChange={(event) => setNotes(event.target.value)} />
                  </label>
                )}
                {allowVisibility && <VisibilityField name={`${id}-visibility`} value={visibility} onChange={setVisibility} disabled={running} />}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={running || !chosenFolder || !ready.length || ready.some((item) => !item.title.trim())} onClick={() => void run(ready.map((item) => item.key))}>
                  {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                  {running ? 'Uploading…' : ready.length > 1 ? `Upload ${ready.length} files` : 'Upload file'}
                </Button>
                <Button variant="quiet" disabled={running} onClick={() => void reset()}>Clear</Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Save a web link (Google Docs, Figma, Notion, Canva, anything https) into a
 * folder. Shows which service it is while typing. Needs no file storage.
 */
export function CohortLinkForm({ cohortId, studentId, folderPresets, defaultFolder, allowVisibility = false, heading = 'Add a link', onSaved, onCancel }: {
  cohortId: number
  studentId?: number | null
  folderPresets: string[]
  defaultFolder?: string
  allowVisibility?: boolean
  heading?: string
  onSaved: (file: CohortFile) => void
  onCancel?: () => void
}) {
  const id = useId()
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState(defaultFolder || folderPresets[0] || 'General')
  const [customFolder, setCustomFolder] = useState('')
  const [notes, setNotes] = useState('')
  const [staffOnly, setStaffOnly] = useState(false)
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState('')
  const chosenFolder = folder === '__custom' ? customFolder.trim() : folder
  const problem = linkUrlProblem(url)
  const provider = url.trim() && !problem ? linkProviderFor(url) : null

  const save = async () => {
    setTouched(true)
    if (problem || !chosenFolder || saving) return
    setSaving(true)
    setError('')
    const result = await api.createCohortLink(cohortId, {
      external_url: url.trim(), folder: chosenFolder,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(notes.trim() ? { description: notes.trim() } : {}),
      ...(studentId ? { student_id: studentId } : {}),
      ...(allowVisibility ? { visibility: staffOnly ? 'staff_only' as const : 'students' as const } : {}),
    })
    setSaving(false)
    if (!result.data) return setError(result.error || 'Could not save this link.')
    setUrl('')
    setTitle('')
    setNotes('')
    setTouched(false)
    onSaved(result.data.file)
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="app-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${id}-heading`} className="flex items-center gap-2 text-base font-semibold text-ink"><Link2 className="h-4 w-4 text-ink-muted" aria-hidden="true" />{heading}</h3>
          <p className="mt-1 text-sm text-ink-secondary">Google Docs, Sheets and Slides, Figma, Notion, Canva or any https:// page.</p>
        </div>
        {onCancel && (
          <Button size="sm" variant="quiet" onClick={onCancel} disabled={saving}>
            <X className="h-4 w-4" aria-hidden="true" />
            Close
          </Button>
        )}
      </div>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" noValidate onSubmit={(event) => { event.preventDefault(); void save() }}>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-url`} className="block text-sm font-medium text-ink">Link</label>
          <input id={`${id}-url`} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://docs.google.com/…" className="app-control mt-1 w-full"
            value={url} maxLength={2048} disabled={saving} aria-invalid={touched && Boolean(problem)} aria-describedby={`${id}-url-hint`}
            onChange={(event) => setUrl(event.target.value)} onBlur={() => setTouched(Boolean(url))} />
          <div id={`${id}-url-hint`} className="mt-1.5 min-h-6 text-sm" aria-live="polite">
            {touched && problem ? <span className="text-danger-ink">{problem}</span> : provider ? <LinkProviderBadge provider={provider} /> : null}
          </div>
        </div>
        <label className="block text-sm font-medium text-ink sm:col-span-2">
          Title <span className="font-normal text-ink-muted">(optional, defaults to the site name)</span>
          <input className="app-control mt-1 w-full" value={title} maxLength={160} disabled={saving} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <FolderField presets={folderPresets} value={folder} custom={customFolder} onChange={setFolder} onCustomChange={setCustomFolder} disabled={saving} />
        <label className="block text-sm font-medium text-ink sm:col-span-2">
          Description <span className="font-normal text-ink-muted">(optional)</span>
          <textarea className="app-control mt-1 w-full" rows={2} maxLength={500} value={notes} disabled={saving} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {allowVisibility && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink sm:col-span-2">
            <input type="checkbox" checked={staffOnly} disabled={saving} onChange={(event) => setStaffOnly(event.target.checked)} />
            <span><span className="font-semibold">Staff only</span> <span className="text-ink-secondary">(share it with students later)</span></span>
          </label>
        )}
        {error && <p role="alert" className="text-sm text-danger-ink sm:col-span-2">{error}</p>}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={saving || !url.trim() || !chosenFolder}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save link'}
          </Button>
        </div>
      </form>
    </section>
  )
}

/**
 * Start a Learn Doc: a title and folder, then it opens in the editor. Docs are
 * Markdown saved in the app, so they work without file storage.
 */
export function CohortDocForm({ cohortId, studentId, folderPresets, defaultFolder, allowVisibility = false, heading = 'New doc', description, onCreated, onCancel }: {
  cohortId: number
  studentId?: number | null
  folderPresets: string[]
  defaultFolder?: string
  allowVisibility?: boolean
  heading?: string
  description?: string
  onCreated: (file: CohortFile) => void
  onCancel?: () => void
}) {
  const id = useId()
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState(defaultFolder || folderPresets[0] || 'General')
  const [customFolder, setCustomFolder] = useState('')
  const [notes, setNotes] = useState('')
  const [staffOnly, setStaffOnly] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const chosenFolder = folder === '__custom' ? customFolder.trim() : folder

  const save = async () => {
    if (!title.trim() || !chosenFolder || saving) return
    setSaving(true)
    setError('')
    const result = await api.createCohortDoc(cohortId, {
      title: title.trim(), folder: chosenFolder, doc_content: '',
      ...(notes.trim() ? { description: notes.trim() } : {}),
      ...(studentId ? { student_id: studentId } : {}),
      ...(allowVisibility ? { visibility: staffOnly ? 'staff_only' as const : 'students' as const } : {}),
    })
    setSaving(false)
    if (!result.data) return setError(result.error || 'Could not create this doc.')
    setTitle('')
    setNotes('')
    onCreated(result.data.file)
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="app-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${id}-heading`} className="flex items-center gap-2 text-base font-semibold text-ink [overflow-wrap:anywhere]"><NotebookPen className="h-4 w-4 text-ink-muted" aria-hidden="true" />{heading}</h3>
          <p className="mt-1 text-sm text-ink-secondary">{description || 'A Learn Doc you write right here: notes, plans, checklists and tables. It saves as you type and keeps its history.'}</p>
        </div>
        {onCancel && (
          <Button size="sm" variant="quiet" onClick={onCancel} disabled={saving}>
            <X className="h-4 w-4" aria-hidden="true" />
            Close
          </Button>
        )}
      </div>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" noValidate onSubmit={(event) => { event.preventDefault(); void save() }}>
        <label className="block text-sm font-medium text-ink sm:col-span-2">
          Title
          <input className="app-control mt-1 w-full" value={title} maxLength={160} disabled={saving} placeholder="Job search plan" onChange={(event) => setTitle(event.target.value)} />
        </label>
        <FolderField presets={folderPresets} value={folder} custom={customFolder} onChange={setFolder} onCustomChange={setCustomFolder} disabled={saving} />
        <label className="block text-sm font-medium text-ink sm:col-span-2">
          Description <span className="font-normal text-ink-muted">(optional)</span>
          <textarea className="app-control mt-1 w-full" rows={2} maxLength={500} value={notes} disabled={saving} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {allowVisibility && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink sm:col-span-2">
            <input type="checkbox" checked={staffOnly} disabled={saving} onChange={(event) => setStaffOnly(event.target.checked)} />
            <span><span className="font-semibold">Staff only</span> <span className="text-ink-secondary">(share it with students later)</span></span>
          </label>
        )}
        {error && <p role="alert" className="text-sm text-danger-ink sm:col-span-2">{error}</p>}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={saving || !title.trim() || !chosenFolder}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <NotebookPen className="h-4 w-4" aria-hidden="true" />}
            {saving ? 'Creating…' : 'Create doc'}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** Inline form under a file row: pick the new file, add an optional note, upload with progress. */
function CohortFileVersionUploader({ cohortId, file, onUploaded, onCancel }: {
  cohortId: number
  file: CohortFile
  onUploaded: (file: CohortFile) => void
  onCancel: () => void
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  // Kept across Retry so a lost confirmation publishes the same pending version.
  const upload = useRef<CohortUploadState>({})
  const [noteLocked, setNoteLocked] = useState(false)
  const uploading = progress !== null
  const choose = (next: File | undefined) => {
    if (!next) return
    const problem = cohortFileProblem(next)
    setError(problem || '')
    setPicked(problem ? null : next)
    upload.current = {}
    setNoteLocked(false)
  }
  const submit = async () => {
    if (!picked || uploading) return
    setError('')
    setProgress(0)
    try {
      const saved = await uploadCohortFileVersion(cohortId, file.id, picked, note, (next) => setProgress(next.percent), upload.current)
      onUploaded(saved)
    } catch (cause) {
      setProgress(null)
      setNoteLocked(Boolean(upload.current.versionId && (upload.current.uploaded || upload.current.s3Attempted)))
      setError(cause instanceof Error ? cause.message : 'Upload failed. Try again.')
    }
  }
  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-line bg-surface-sunken p-3.5 sm:ml-[3.25rem]" role="group" aria-labelledby={`${id}-heading`}>
      <p id={`${id}-heading`} className="text-sm font-semibold text-ink">{`Upload a new version of ${file.title}`}</p>
      <p className="text-xs text-ink-secondary">Everyone sees the new version right away. Earlier versions stay in Versions.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept={COHORT_FILE_ACCEPT} className="sr-only" disabled={uploading} aria-label={`New version of ${file.title}`}
          onChange={(event) => choose(event.target.files?.[0])} />
        <Button size="sm" variant="secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>{picked ? 'Choose a different file' : 'Choose file'}</Button>
        {picked && <span className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">{picked.name} · <span className="tabular-nums">{formatFileSize(picked.size)}</span></span>}
      </div>
      <label className="block text-sm font-medium text-ink">
        What changed <span className="font-normal text-ink-muted">(optional)</span>
        <input className="app-control mt-1 w-full" value={note} maxLength={300} disabled={uploading || noteLocked} onChange={(event) => setNote(event.target.value)} />
        {noteLocked && <span className="mt-1 block text-xs font-normal text-ink-muted">Note is locked while retrying this upload. Choose a different file to start over.</span>}
      </label>
      {uploading && <ProgressBar value={progress} label={`Uploading ${picked?.name ?? 'file'}`} size="sm" />}
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!picked || uploading} onClick={() => void submit()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileUp className="h-4 w-4" aria-hidden="true" />}
          {uploading ? 'Uploading…' : 'Upload version'}
        </Button>
        <Button size="sm" variant="quiet" disabled={uploading} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
