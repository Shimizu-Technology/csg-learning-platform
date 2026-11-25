import { useEffect, useId, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import {
  downloadCohortFile,
  formatFileSize,
  parseCsv,
  type CohortFile,
  type CohortFilePreview,
  type CohortFileVersion,
} from '../../lib/cohortFiles'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { AnchorButton, Button } from '../ui/Button'
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
 * version switcher.
 */
export function CohortFilePreviewModal({ cohortId, file, open, onClose, downloadDisabled = false }: {
  cohortId: number
  file: CohortFile
  open: boolean
  onClose: () => void
  downloadDisabled?: boolean
}) {
  const id = useId()
  const [versionId, setVersionId] = useState<number | null>(null)
  const [versions, setVersions] = useState<CohortFileVersion[]>([])
  const [preview, setPreview] = useState<CohortFilePreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const hasVersions = file.version_number > 1

  useEffect(() => {
    if (!open || !hasVersions) return
    let live = true
    void api.getCohortFileVersions(cohortId, file.id).then((result) => {
      if (live && result.data) setVersions(result.data.versions)
    })
    return () => { live = false }
  }, [cohortId, file.id, file.version_number, hasVersions, open])

  useEffect(() => {
    if (!open) return
    let live = true
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
          {versions.length > 1 ? (
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
          ) : <span className="hidden sm:block" />}
          <div className="flex flex-wrap gap-2">
            {preview?.preview_mode === 'pdf' && storageUrl(preview.url) && (
              <AnchorButton href={storageUrl(preview.url)!} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open in new tab
              </AnchorButton>
            )}
            <Button variant="secondary" disabled={downloading || downloadDisabled} onClick={() => void download()}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              {downloading ? 'Preparing…' : 'Download'}
            </Button>
          </div>
          {downloadError && <p role="alert" className="text-sm text-danger-ink sm:basis-full">{downloadError}</p>}
        </div>
      }>
      {loading && !preview ? (
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
  const { rows, clipped } = useMemo(() => parseCsv(text), [text])
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
      {clipped && <p className="mt-2 text-xs text-ink-muted">Showing the first 500 rows.</p>}
    </div>
  )
}

function Unavailable() {
  return <p className="text-sm text-ink-secondary">This preview link isn't available. Try again or download the file.</p>
}
