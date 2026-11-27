import { type ReactNode } from 'react'
import { Check, Download, ExternalLink, Info, MessageSquare, NotebookPen } from 'lucide-react'
import { formatFileSize, isStudentFolderItem, linkHost, safeExternalFileUrl, type CohortFile } from '../../lib/cohortFiles'
import { DRIVE_DRAG_MIME, driveToneSurface, fileTimestampIso, fileVisualMeta } from '../../lib/driveHelpers'
import { formatShortDateTime } from '../../lib/format'
import { Badge } from '../ui/Badge'
import { IconButton } from '../ui/Button'
import { ReviewStatusBadge, type ReviewAccess } from './CohortFileReview'

/**
 * Google Drive-style Grid card for one file, link, or Learn Doc.
 */
export function DriveFileGridCard({
  file,
  selected = false,
  inspected = false,
  canSelect = false,
  canDrag = false,
  downloadDisabled = false,
  review,
  note,
  onToggleSelect,
  onInspect,
  onOpen,
  onDownload,
  actions,
}: {
  file: CohortFile
  selected?: boolean
  inspected?: boolean
  canSelect?: boolean
  canDrag?: boolean
  downloadDisabled?: boolean
  review?: ReviewAccess
  note?: string
  onToggleSelect?: (fileId: number) => void
  onInspect?: (file: CohortFile) => void
  onOpen: (file: CohortFile, pane?: 'main' | 'review') => void
  onDownload?: (file: CohortFile) => void
  actions?: ReactNode
}) {
  const visual = fileVisualMeta(file)
  const Icon = visual.icon
  const link = file.kind === 'link'
  const doc = file.kind === 'doc'
  const href = link ? safeExternalFileUrl(file.external_url) : null
  const reviewing = review && isStudentFolderItem(file) ? review : undefined
  const updatedIso = fileTimestampIso(file)

  const handlePrimaryClick = () => {
    if (link) {
      if (href) window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    if (doc || (!downloadDisabled && file.previewable)) {
      onOpen(file, 'main')
      return
    }
    if (!downloadDisabled) onDownload?.(file)
  }

  return (
    <div
      draggable={canDrag}
      onDragStart={(event) => {
        if (!canDrag) return
        event.dataTransfer.setData(DRIVE_DRAG_MIME, String(file.id))
        event.dataTransfer.effectAllowed = 'move'
      }}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-surface-raised transition-all duration-150 ${
        selected || inspected
          ? 'border-action-primary ring-2 ring-focus'
          : 'border-line hover:border-line-strong hover:shadow-raised'
      }`}
    >
      {/* Visual preview header */}
      <div className="relative">
        <button
          type="button"
          onClick={handlePrimaryClick}
          className={`flex h-28 w-full flex-col items-center justify-center gap-1.5 border-b px-4 transition-opacity hover:opacity-95 ${driveToneSurface(visual.tone)}`}
          aria-label={link ? `Open link ${file.title}` : doc ? `Open ${file.title}` : `Preview ${file.title}`}
        >
          <Icon className="h-8 w-8" aria-hidden="true" />
          <span className="text-[11px] font-bold uppercase tracking-wider">{visual.badgeLabel}</span>
        </button>

        {canSelect && onToggleSelect && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`Select ${file.title}`}
            onClick={(event) => {
              event.stopPropagation()
              onToggleSelect(file.id)
            }}
            className="absolute left-1 top-1 flex h-11 w-11 items-center justify-center rounded-xl lg:left-1.5 lg:top-1.5 lg:h-9 lg:w-9"
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-lg border transition-colors ${
                selected
                  ? 'border-action-primary bg-action-primary text-on-action'
                  : 'border-line bg-surface-raised/90 text-transparent hover:border-line-strong group-hover:opacity-100'
              }`}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>
        )}

        <div className="absolute right-2 top-2 flex items-center gap-1">
          {file.visibility === 'staff_only' && <Badge tone="warning">Staff only</Badge>}
          {!link && !doc && file.version_number > 1 && <Badge tone="info">{`v${file.version_number}`}</Badge>}
        </div>
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={handlePrimaryClick}
            className="min-w-0 flex-1 text-left text-sm font-semibold text-ink line-clamp-2 hover:underline [overflow-wrap:anywhere]"
          >
            {file.title}
          </button>
          {onInspect && (
            <IconButton label={`Details for ${file.title}`} onClick={() => onInspect(file)}>
              <Info className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          )}
        </div>

        <p className="truncate text-xs text-ink-muted">
          {doc
            ? `Learn Doc${updatedIso ? ` · ${formatShortDateTime(updatedIso, '')}` : ''}`
            : link
              ? linkHost(file.external_url)
              : `${formatFileSize(file.file_size || 0)}${updatedIso ? ` · ${formatShortDateTime(updatedIso, '')}` : ''}`}
        </p>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-1.5 pt-1">
          <div className="flex flex-wrap items-center gap-1">
            <Badge>{file.folder}</Badge>
            {doc && <Badge tone="brand" icon={<NotebookPen className="h-3 w-3" aria-hidden="true" />}>Doc</Badge>}
            {reviewing && <ReviewStatusBadge status={file.review_status} />}
          </div>
          <div className="flex items-center gap-1">
            {reviewing && file.comment_count > 0 && (
              <button
                type="button"
                onClick={() => onOpen(file, 'review')}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-ink-secondary hover:bg-surface-sunken hover:text-ink lg:min-h-8 lg:px-2"
                aria-label={`${file.comment_count} comments on ${file.title}`}
              >
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                {file.comment_count}
              </button>
            )}
            {!link && !doc && !downloadDisabled && onDownload && (
              <IconButton label={`Download ${file.title}`} onClick={() => onDownload(file)}>
                <Download className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            )}
            {link && href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open link ${file.title} (opens in a new tab)`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-secondary hover:bg-surface-sunken hover:text-ink lg:h-9 lg:w-9"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
            {actions}
          </div>
        </div>
        {note && <p className="text-[11px] text-ink-muted">{note}</p>}
      </div>
    </div>
  )
}
