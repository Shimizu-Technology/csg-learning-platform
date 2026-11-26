import { useState, type DragEvent } from 'react'
import { ChevronRight, Folder, FolderOpen, FolderPen, Home } from 'lucide-react'
import { DRIVE_DRAG_MIME, type DriveFolderSummary } from '../../lib/driveHelpers'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

/**
 * Google Drive-style folder cards with drag-and-drop file move targets.
 */
export function DriveFolderGrid({
  folders,
  activeFolder,
  onSelectFolder,
  onDropFileToFolder,
  label = 'Folders',
}: {
  folders: DriveFolderSummary[]
  activeFolder: string
  onSelectFolder: (folder: string) => void
  onDropFileToFolder?: (fileId: number, targetFolder: string) => void
  label?: string
}) {
  const [dragTarget, setDragTarget] = useState<string | null>(null)

  if (folders.length === 0) return null

  const handleDragOver = (event: DragEvent<HTMLButtonElement>, folderName: string) => {
    if (!onDropFileToFolder) return
    if (event.dataTransfer.types.includes(DRIVE_DRAG_MIME)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dragTarget !== folderName) setDragTarget(folderName)
    }
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>, folderName: string) => {
    setDragTarget(null)
    if (!onDropFileToFolder) return
    const raw = event.dataTransfer.getData(DRIVE_DRAG_MIME)
    const fileId = Number(raw)
    if (Number.isInteger(fileId) && fileId > 0) {
      event.preventDefault()
      onDropFileToFolder(fileId, folderName)
    }
  }

  return (
    <div className="space-y-2" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</p>
        {onDropFileToFolder && (
          <p className="hidden text-xs text-ink-muted sm:block">Drag any item onto a folder to move it</p>
        )}
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {folders.map((folder) => {
          const selected = activeFolder === folder.name
          const dropping = dragTarget === folder.name
          return (
            <button
              key={folder.name}
              type="button"
              onClick={() => onSelectFolder(selected ? 'All' : folder.name)}
              onDragOver={(event) => handleDragOver(event, folder.name)}
              onDragLeave={() => setDragTarget((current) => (current === folder.name ? null : current))}
              onDrop={(event) => handleDrop(event, folder.name)}
              aria-pressed={selected}
              className={`group flex min-h-14 items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all duration-150 ${
                dropping
                  ? 'border-primary bg-primary-soft shadow-raised ring-2 ring-focus'
                  : selected
                    ? 'border-primary-soft-line bg-primary-soft/60 text-ink shadow-raised'
                    : 'border-line bg-surface-raised text-ink hover:border-line-strong hover:bg-surface-sunken'
              }`}
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                  selected || dropping ? 'bg-primary-soft text-primary-ink' : 'bg-surface-sunken text-ink-secondary group-hover:text-ink'
                }`}
              >
                {selected || dropping ? <FolderOpen className="h-5 w-5" aria-hidden="true" /> : <Folder className="h-5 w-5" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{folder.name}</span>
                <span className="block text-xs text-ink-muted tabular-nums">
                  {folder.count} {folder.count === 1 ? 'item' : 'items'}
                  {folder.staffOnlyCount > 0 ? ` · ${folder.staffOnlyCount} staff only` : ''}
                </span>
              </span>
              {folder.needsReviewCount > 0 && (
                <Badge tone="warning">{folder.needsReviewCount}</Badge>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Breadcrumb bar shown when drilling into a single folder inside Drive.
 */
export function DriveBreadcrumbs({
  rootLabel,
  activeFolder,
  onReset,
  onRename,
  trailing,
}: {
  rootLabel: string
  activeFolder: string
  onReset: () => void
  onRename?: () => void
  trailing?: React.ReactNode
}) {
  if (activeFolder === 'All') return null
  return (
    <nav aria-label="Folder path" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface-sunken/70 px-3.5 py-2">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        <li>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 font-medium text-ink-secondary transition-colors hover:bg-surface-raised hover:text-ink lg:min-h-8"
          >
            <Home className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {rootLabel}
          </button>
        </li>
        <li aria-hidden="true" className="text-ink-muted">
          <ChevronRight className="h-4 w-4" />
        </li>
        <li className="min-w-0 truncate px-1 font-semibold text-ink" aria-current="location">
          {activeFolder}
        </li>
      </ol>
      <div className="flex flex-wrap items-center gap-1.5">
        {onRename && (
          <Button size="sm" variant="quiet" onClick={onRename} aria-label={`Rename folder ${activeFolder}`}>
            <FolderPen className="h-4 w-4" aria-hidden="true" />
            Rename folder
          </Button>
        )}
        {trailing}
      </div>
    </nav>
  )
}
