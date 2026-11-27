import { useEffect, useRef, useState } from 'react'
import { BookOpen, Check, Download, ExternalLink, Eye, FolderInput, Info, Loader2, X } from 'lucide-react'
import { api } from '../../lib/api'
import {
  downloadCohortFile,
  formatFileSize,
  isStudentFolderItem,
  LINK_PROVIDERS,
  linkHost,
  safeExternalFileUrl,
  type CohortFile,
} from '../../lib/cohortFiles'
import { driveToneSurface, fileTimestampIso, fileVisualMeta } from '../../lib/driveHelpers'
import { formatShortDateTime } from '../../lib/format'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { Badge } from '../ui/Badge'
import { AnchorButton, Button, IconButton } from '../ui/Button'
import {
  CohortFileReviewPanel,
  ReviewStatusBadge,
  type CohortFileCommentsSnapshot,
  type ReviewAccess,
} from './CohortFileReview'
import { Modal } from './Modal'

/**
 * Google Drive-style details, quick folder move, and review/comments inspector.
 * Renders as a sticky right-hand side panel on desktop and as a real slide-over
 * modal drawer on phones and tablets.
 */
export function DriveInspectorDrawer({
  cohortId,
  file,
  folderOptions,
  downloadDisabled = false,
  review,
  desktopBreakpoint = 'lg',
  onClose,
  onOpenPreview,
  onFileChange,
}: {
  cohortId: number
  file: CohortFile | null
  folderOptions: string[]
  downloadDisabled?: boolean
  review?: ReviewAccess
  desktopBreakpoint?: 'lg' | 'xl'
  onClose: () => void
  onOpenPreview: (file: CohortFile, pane?: 'main' | 'review') => void
  onFileChange?: (file: CohortFile) => void
}) {
  const isDesktop = useMediaQuery(desktopBreakpoint === 'xl' ? '(min-width: 1280px)' : '(min-width: 1024px)')
  const [targetFolder, setTargetFolder] = useState(file?.folder || '')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [reviewDraft, setReviewDraft] = useState('')
  const [commentsSnapshot, setCommentsSnapshot] = useState<CohortFileCommentsSnapshot | null>(null)
  const commentsSnapshotRef = useRef<CohortFileCommentsSnapshot | null>(null)
  const updateCommentsSnapshot = (next: CohortFileCommentsSnapshot | null) => {
    commentsSnapshotRef.current = next
    setCommentsSnapshot(next)
  }
  const [pendingTokensByFile, setPendingTokensByFile] = useState<Record<number, number>>({})
  const pendingTokensRef = useRef(new Map<number, number>())
  const nextRequestTokenRef = useRef(0)
  const visitGenerationRef = useRef(0)
  const [commentPostError, setCommentPostError] = useState('')
  const activeFileIdRef = useRef<number | null>(file?.id ?? null)
  activeFileIdRef.current = file?.id ?? null
  const postingComment = file ? Boolean(pendingTokensByFile[file.id]) : false
  const asideRef = useRef<HTMLElement>(null)
  const reviewContainerRef = useRef<HTMLDivElement>(null)
  const prevIsDesktopRef = useRef(isDesktop)
  const wasEditingReviewRef = useRef(false)

  useEffect(() => {
    setTargetFolder(file?.folder || '')
    setMoveError('')
    setDownloadError('')
  }, [file])

  useEffect(() => {
    visitGenerationRef.current += 1
    setReviewDraft('')
    updateCommentsSnapshot(null)
    setCommentPostError('')
    wasEditingReviewRef.current = false
  }, [file?.id])

  useEffect(() => {
    const previous = prevIsDesktopRef.current
    prevIsDesktopRef.current = isDesktop
    if (!file || previous === isDesktop) return

    const restoreReviewFocus = wasEditingReviewRef.current
    const frame = requestAnimationFrame(() => {
      if (isDesktop) {
        if (document.querySelector('[data-app-modal]')) return
        const textarea = restoreReviewFocus ? reviewContainerRef.current?.querySelector<HTMLTextAreaElement>('textarea') : null
        if (textarea) {
          textarea.focus()
          textarea.setSelectionRange(textarea.value.length, textarea.value.length)
        } else {
          asideRef.current?.focus()
        }
        return
      }
      if (restoreReviewFocus) {
        const textarea = reviewContainerRef.current?.querySelector<HTMLTextAreaElement>('textarea')
        if (textarea) {
          textarea.focus()
          textarea.setSelectionRange(textarea.value.length, textarea.value.length)
        }
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [file, isDesktop])

  if (!file) return null

  const visual = fileVisualMeta(file)
  const Icon = visual.icon
  const link = file.kind === 'link'
  const doc = file.kind === 'doc'
  const href = link ? safeExternalFileUrl(file.external_url) : null
  const reviewing = review && isStudentFolderItem(file) ? review : undefined
  const updatedIso = fileTimestampIso(file)
  const allFolders = [...new Set([file.folder, ...folderOptions])].sort((a, b) => a.localeCompare(b))

  const handleMove = async () => {
    if (!targetFolder || targetFolder === file.folder || moving) return
    setMoving(true)
    setMoveError('')
    const result = await api.updateCohortFile(cohortId, file.id, { folder: targetFolder })
    setMoving(false)
    if (!result.data) {
      setMoveError(result.error || 'Could not move this item.')
      return
    }
    onFileChange?.(result.data.file)
  }

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    setDownloadError('')
    try {
      await downloadCohortFile(cohortId, file)
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  const handleSubmitComment = async (body: string) => {
    if (pendingTokensRef.current.has(file.id)) return
    const submittingFile = file
    const submittedRaw = reviewDraft
    const submittedVisit = visitGenerationRef.current
    const token = ++nextRequestTokenRef.current
    pendingTokensRef.current.set(submittingFile.id, token)
    setPendingTokensByFile((prev) => ({ ...prev, [submittingFile.id]: token }))
    setCommentPostError('')
    try {
      const result = await api.createCohortFileComment(cohortId, submittingFile.id, body)
      if (pendingTokensRef.current.get(submittingFile.id) !== token) return
      if (activeFileIdRef.current !== submittingFile.id) return
      if (!result.data) {
        setCommentPostError(result.error || 'Could not post your comment.')
        return
      }
      const created = result.data.comment
      const existing = commentsSnapshotRef.current?.comments ?? []
      const merged = existing.some((item) => item.id === created.id) ? existing : [...existing, created]
      updateCommentsSnapshot({
        comments: merged,
        canComment: commentsSnapshotRef.current?.canComment ?? true,
      })
      if (visitGenerationRef.current === submittedVisit) {
        setReviewDraft((current) => (current === submittedRaw ? '' : current))
      }
      onFileChange?.({ ...submittingFile, comment_count: merged.length })
    } finally {
      if (pendingTokensRef.current.get(submittingFile.id) === token) {
        pendingTokensRef.current.delete(submittingFile.id)
        setPendingTokensByFile((prev) => {
          if (prev[submittingFile.id] !== token) return prev
          const next = { ...prev }
          delete next[submittingFile.id]
          return next
        })
      }
    }
  }

  const body = (
    <div className="flex flex-col gap-4">
      <div className={`flex flex-col items-center justify-center gap-2 rounded-2xl border px-4 py-6 text-center ${driveToneSurface(visual.tone)}`}>
        <Icon className="h-9 w-9" aria-hidden="true" />
        <span className="text-xs font-bold uppercase tracking-wider">{visual.badgeLabel}</span>
      </div>

      <div className="space-y-1.5">
        <p className="text-base font-bold text-ink [overflow-wrap:anywhere]">{file.title}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{file.folder}</Badge>
          {file.visibility === 'staff_only' && <Badge tone="warning">Staff only</Badge>}
          {!link && !doc && file.version_number > 1 && <Badge tone="info">{`v${file.version_number}`}</Badge>}
          {reviewing && <ReviewStatusBadge status={file.review_status} />}
        </div>
        {file.description && (
          <p className="pt-1 text-sm leading-relaxed text-ink-secondary [overflow-wrap:anywhere]">{file.description}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {doc ? (
          <Button size="sm" onClick={() => onOpenPreview(file, 'main')} className="flex-1">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            {file.can_edit_doc ? 'Open and edit' : 'Open doc'}
          </Button>
        ) : link ? (
          href && (
            <AnchorButton size="sm" href={href} target="_blank" rel="noopener noreferrer" className="flex-1">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Open link
            </AnchorButton>
          )
        ) : (
          <>
            {file.previewable && !downloadDisabled && (
              <Button size="sm" onClick={() => onOpenPreview(file, 'main')} className="flex-1">
                <Eye className="h-4 w-4" aria-hidden="true" />
                Preview
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={downloading || downloadDisabled}
              onClick={() => void handleDownload()}
              className="flex-1"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              {downloading ? 'Preparing…' : 'Download'}
            </Button>
          </>
        )}
      </div>
      {downloadError && <p role="alert" className="text-xs text-danger-ink">{downloadError}</p>}

      <dl className="divide-y divide-line border-y border-line text-xs">
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-ink-muted">Type</dt>
          <dd className="font-medium text-ink">
            {doc ? 'Learn Doc' : link ? LINK_PROVIDERS[file.link_provider || 'web'].label : (file.filename || 'File')}
          </dd>
        </div>
        {!link && !doc && (
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-ink-muted">Size</dt>
            <dd className="font-medium tabular-nums text-ink">{formatFileSize(file.file_size || 0)}</dd>
          </div>
        )}
        {link && file.external_url && (
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-ink-muted">Host</dt>
            <dd className="truncate font-medium text-ink">{linkHost(file.external_url)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-ink-muted">Added by</dt>
          <dd className="font-medium text-ink">{file.uploaded_by_name || (file.uploaded_by_role === 'student' ? 'Student' : 'Staff')}</dd>
        </div>
        {updatedIso && (
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-ink-muted">Updated</dt>
            <dd className="font-medium tabular-nums text-ink">{formatShortDateTime(updatedIso, '')}</dd>
          </div>
        )}
      </dl>

      {file.can_manage && onFileChange && (
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-secondary">
            <FolderInput className="h-3.5 w-3.5" aria-hidden="true" />
            Move to folder
          </label>
          <div className="flex items-center gap-2">
            <select
              aria-label={`Move ${file.title} to folder`}
              value={targetFolder}
              disabled={moving}
              onChange={(event) => setTargetFolder(event.target.value)}
              className="app-control min-w-0 flex-1 text-sm"
            >
              {allFolders.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={moving || !targetFolder || targetFolder === file.folder}
              onClick={() => void handleMove()}
            >
              {moving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
              Move
            </Button>
          </div>
          {moveError && <p role="alert" className="text-xs text-danger-ink">{moveError}</p>}
        </div>
      )}

      {reviewing && onFileChange && (
        <div
          ref={reviewContainerRef}
          className="border-t border-line pt-3"
          onFocusCapture={(event) => {
            wasEditingReviewRef.current = event.target instanceof HTMLTextAreaElement
          }}
          onBlurCapture={(event) => {
            if (!(event.target instanceof HTMLTextAreaElement)) return
            const nextTarget = event.relatedTarget
            if (nextTarget instanceof Node) wasEditingReviewRef.current = false
          }}
        >
          <CohortFileReviewPanel
            cohortId={cohortId}
            file={file}
            access={reviewing}
            draft={reviewDraft}
            onDraftChange={setReviewDraft}
            initialCommentsSnapshot={commentsSnapshot}
            onCommentsSnapshotChange={updateCommentsSnapshot}
            postingComment={postingComment}
            commentPostError={commentPostError}
            onSubmitComment={handleSubmitComment}
            onFileChange={onFileChange}
          />
        </div>
      )}
    </div>
  )

  if (!isDesktop) {
    return (
      <Modal
        open
        onClose={onClose}
        title="File details"
        subtitle={file.title}
        icon={<Info className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />}
        size="md"
        variant="drawer"
      >
        {body}
      </Modal>
    )
  }

  return (
    <aside
      ref={asideRef}
      aria-label={`Details for ${file.title}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        if (document.querySelector('[role="dialog"][aria-modal="true"], [data-app-modal]')) return
        event.stopPropagation()
        onClose()
      }}
      className="app-surface flex flex-col gap-4 p-4 focus:outline-none lg:sticky lg:top-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Info className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <h3 className="truncate text-sm font-bold text-ink">File details</h3>
        </div>
        <IconButton label="Close file details" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>
      {body}
    </aside>
  )
}
