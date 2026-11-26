import { useEffect, useId, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import {
  CSV_PREVIEW_LIMITS,
  downloadCohortFile,
  formatFileSize,
  parseCsv,
  type CohortFile,
  type CohortFilePreview,
  type CohortFileVersion,
} from '../../lib/cohortFiles'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { AnchorButton, Button } from '../ui/Button'
import { CohortFileReviewPanel, type ReviewAccess } from './CohortFileReview'
import { Modal } from './Modal'

/** Storage links must be https; anything else is never put in an src. */
function storageUrl(url: string | null) {
  const safe = url ? sanitizeUrl(url) : '#'
  return safe.startsWith('https://') ? safe : null
}

/**
 * Shows a file inside the app: PDFs in a frame, images, audio and video from a
 * short-lived inline link, and Markdown, text and CSV from text the API read,
 * so storage needs no CORS. Markdown is rendered without raw HTML. Office
 * files and ZIPs show a download card. Files with more than one version get a
 * version switcher. With `review`, the item's review status and comments sit
 * beside the preview (a tab on phones).
 */
export function CohortFilePreviewModal({ cohortId, file, open, onClose, downloadDisabled = false, review, onFileChange, initialPane = 'preview', onPrev, onNext, positionLabel }: {
  cohortId: number
  file: CohortFile
  open: boolean
  onClose: () => void
  downloadDisabled?: boolean
  review?: ReviewAccess
  onFileChange?: (file: CohortFile) => void
  initialPane?: 'preview' | 'review'
  onPrev?: () => void
  onNext?: () => void
  positionLabel?: string
}) {
  const id = useId()
  const [pane, setPane] = useState<'preview' | 'review'>(review ? initialPane : 'preview')
  // The file as review changes leave it (status and comment count), shown in the panel.
  const [current, setCurrent] = useState(file)
  useEffect(() => { setCurrent(file) }, [file])
  const [versionSelection, setVersionSelection] = useState<{ fileId: number; versionId: number | null }>({ fileId: file.id, versionId: null })
  const versionId = versionSelection.fileId === file.id ? versionSelection.versionId : null
  const setVersionId = (nextVersionId: number | null) => setVersionSelection({ fileId: file.id, versionId: nextVersionId })
  const [versions, setVersions] = useState<CohortFileVersion[]>([])
  const [versionsError, setVersionsError] = useState('')
  const [versionsAttempt, setVersionsAttempt] = useState(0)
  const [preview, setPreview] = useState<CohortFilePreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const hasVersions = file.version_number > 1

  useEffect(() => {
    setVersionSelection({ fileId: file.id, versionId: null })
    setVersions([])
    setVersionsError('')
    setPreview(null)
    setError('')
    setDownloadError('')
    setPane(review ? initialPane : 'preview')
  }, [cohortId, file.id, initialPane, review])

  useEffect(() => {
    if (!open || !hasVersions) return
    let live = true
    setVersionsError('')
    void api.getCohortFileVersions(cohortId, file.id).then((result) => {
      if (!live) return
      if (result.data) setVersions(result.data.versions)
      else setVersionsError(result.error || 'Could not load earlier versions.')
    })
    return () => { live = false }
  }, [cohortId, file.id, file.version_number, hasVersions, open, versionsAttempt])

  useEffect(() => {
    if (!open) return
    let live = true
    // Never show the previous version's PDF or text while another one loads.
    setPreview(null)
    setLoading(true)
    setError('')
    void api.getCohortFilePreview(cohortId, file.id, versionId).then((result) => {
      if (!live) return
      setLoading(false)
      if (result.data) setPreview(result.data)
      else {
        setPreview(null)
        setError(result.error || 'Could not open this file.')
      }
    })
    return () => { live = false }
  }, [attempt, cohortId, file.id, file.version_number, open, versionId])

  useEffect(() => {
    if (!open || (!onPrev && !onNext)) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (event.key === 'ArrowLeft' && onPrev) {
        event.preventDefault()
        onPrev()
      } else if (event.key === 'ArrowRight' && onNext) {
        event.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onNext, onPrev, open])

  const close = () => {
    setVersionId(null)
    setPreview(null)
    setDownloadError('')
    onClose()
  }
  const download = async () => {
    if (downloading) return
    setDownloading(true)
    setDownloadError('')
    try {
      await downloadCohortFile(cohortId, { id: file.id, filename: preview?.filename || file.filename }, versionId)
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }
  const shownNumber = preview?.version_number ?? file.version_number
  const subtitle = preview ? `${preview.filename} · ${formatFileSize(preview.file_size)}${hasVersions ? ` · Version ${shownNumber}` : ''}` : file.filename || undefined

  return (
    <Modal open={open} onClose={close} title={file.title} subtitle={subtitle} size="xl" fixedHeight
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {versions.length > 1 || versionsError ? (
            <div className="flex flex-col gap-2">
              {versions.length > 1 && (
                <label className="flex flex-col gap-1 text-sm font-medium text-ink sm:flex-row sm:items-center sm:gap-2" htmlFor={`${id}-version`}>
                  Version
                  <select id={`${id}-version`} className="app-control w-full sm:w-auto" value={versionId ?? ''}
                    onChange={(event) => setVersionId(event.target.value ? Number(event.target.value) : null)}>
                    {versions.map((version) => (
                      <option key={version.id} value={version.current ? '' : version.id}>
                        {`v${version.version_number}${version.current ? ' (current)' : ''}${version.note ? ` · ${version.note}` : ''}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {/* A failed refresh still shows, with Retry, even when an earlier list is on screen. */}
              {versionsError && (
                <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-ink">
                  <span>{versionsError}</span>
                  <Button size="sm" variant="secondary" onClick={() => setVersionsAttempt((value) => value + 1)}>
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    Retry
                  </Button>
                </div>
              )}
            </div>
          ) : <span className="hidden sm:block" />}
          <div className="flex flex-wrap items-center gap-2">
            {(onPrev || onNext) && (
              <div className="flex items-center gap-1 pr-1" role="group" aria-label="Switch previewed file">
                <Button size="sm" variant="quiet" disabled={!onPrev} onClick={onPrev} aria-label="Previous file">
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                {positionLabel && <span className="px-1 text-xs font-medium tabular-nums text-ink-muted">{positionLabel}</span>}
                <Button size="sm" variant="quiet" disabled={!onNext} onClick={onNext} aria-label="Next file">
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            )}
            {preview?.preview_mode === 'pdf' && storageUrl(preview.url) && (
              <AnchorButton href={storageUrl(preview.url)!} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open in new tab
              </AnchorButton>
            )}
            <Button variant="secondary" disabled={downloading || downloadDisabled || loading} onClick={() => void download()}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              {downloading ? 'Preparing…' : 'Download'}
            </Button>
          </div>
          {downloadError && <p role="alert" className="text-sm text-danger-ink sm:basis-full">{downloadError}</p>}
        </div>
      }>
      {review && (
        <div role="tablist" aria-label="Preview sections" className="mb-3 inline-flex w-full rounded-xl border border-line bg-surface-sunken p-1 lg:hidden">
          {([['preview', 'Preview'], ['review', 'Review']] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={pane === value} aria-controls={`${id}-${value}`} onClick={() => setPane(value)}
              className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors duration-150 ${pane === value ? 'bg-surface-raised text-ink shadow-raised' : 'text-ink-secondary hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-5">
        <div id={`${id}-preview`} className={`min-h-0 min-w-0 flex-1 flex-col ${review && pane !== 'preview' ? 'hidden lg:flex' : 'flex'}`}>
          {loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-secondary" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Opening {file.title}…
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-ink-secondary">{error}</p>
              <Button size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : preview ? (
            <PreviewBody preview={preview} title={file.title} />
          ) : null}
        </div>
        {review && (
          <aside id={`${id}-review`} aria-label="Review and comments"
            className={`min-h-0 w-full overflow-y-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-line lg:pl-5 ${pane === 'review' ? 'block' : 'hidden lg:block'}`}>
            <CohortFileReviewPanel cohortId={cohortId} file={current} access={review} onFileChange={(next) => { setCurrent(next); onFileChange?.(next) }} />
          </aside>
        )}
      </div>
    </Modal>
  )
}

function PreviewBody({ preview, title }: { preview: CohortFilePreview; title: string }) {
  const url = storageUrl(preview.url)
  const truncatedNote = preview.truncated && (
    <p className="mb-3 rounded-xl border border-line bg-surface-sunken px-3.5 py-2.5 text-sm text-ink-secondary">
      Showing the first 512 KB. Download the file to see all of it.
    </p>
  )
  switch (preview.preview_mode) {
    case 'pdf':
      return url ? <iframe src={url} title={`${title} (PDF)`} referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 rounded-xl border border-line bg-surface-sunken" /> : <Unavailable />
    case 'image':
      return url ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-xl bg-surface-sunken p-2">
          <img src={url} alt={title} referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" />
        </div>
      ) : <Unavailable />
    case 'audio':
      return url ? (
        <div className="flex flex-1 items-center justify-center">
          <audio controls src={url} className="w-full max-w-xl" aria-label={title}>
            Your browser can't play this audio. Download it instead.
          </audio>
        </div>
      ) : <Unavailable />
    case 'video':
      return url ? (
        <video controls src={url} className="min-h-0 w-full flex-1 rounded-xl bg-surface-sunken" aria-label={title}>
          Your browser can't play this video. Download it instead.
        </video>
      ) : <Unavailable />
    case 'markdown':
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {truncatedNote}
          <div className="prose prose-tokens prose-sm max-w-none prose-a:text-primary-ink [overflow-wrap:anywhere]">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']} unwrapDisallowed
              components={{ a: ({ href, children }) => <a href={sanitizeUrl(href || '')} target="_blank" rel="noopener noreferrer">{children}</a> }}>
              {preview.text || ''}
            </ReactMarkdown>
          </div>
        </div>
      )
    case 'csv':
      return <CsvTable text={preview.text || ''} note={truncatedNote} />
    case 'text':
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {truncatedNote}
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-surface-sunken p-4 font-mono text-sm text-ink">{preview.text}</pre>
        </div>
      )
    default:
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-sunken text-ink-secondary">
            <FileText className="h-6 w-6" aria-hidden="true" />
          </span>
          <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{preview.filename}</p>
          <p className="max-w-sm text-sm text-ink-secondary">This type of file can't be shown in the app. Download it to open it on your computer.</p>
        </div>
      )
  }
}

function CsvTable({ text, note }: { text: string; note: React.ReactNode }) {
  const { rows, clippedRows, clippedColumns } = useMemo(() => parseCsv(text), [text])
  if (!rows.length) return <p className="text-sm text-ink-secondary">This CSV file is empty.</p>
  const [header, ...body] = rows
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {note}
      <div className="overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label="CSV preview">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-surface-sunken">
            <tr>{header.map((cell, index) => <th key={index} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold text-ink">{cell}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {body.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, index) => <td key={index} className="whitespace-nowrap px-3 py-2 text-ink-secondary">{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {(clippedRows || clippedColumns) && <p className="mt-2 text-xs text-ink-muted">{csvClippedNote(clippedRows, clippedColumns)}</p>}
    </div>
  )
}

/** Says which part of a large CSV the preview leaves out. */
function csvClippedNote(rows: boolean, columns: boolean) {
  const parts = [rows && `${CSV_PREVIEW_LIMITS.rows} rows`, columns && `${CSV_PREVIEW_LIMITS.columns} columns`].filter(Boolean).join(' and ')
  return `Showing the first ${parts}. Download the file to see all of it.`
}

function Unavailable() {
  return <p className="text-sm text-ink-secondary">This preview link isn't available. Try again or download the file.</p>
}
