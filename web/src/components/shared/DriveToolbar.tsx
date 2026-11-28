import { useState } from 'react'
import {
  ArrowDownUp,
  Check,
  Eye,
  EyeOff,
  FolderInput,
  LayoutGrid,
  List,
  Trash2,
  X,
} from 'lucide-react'
import type { DriveSort, DriveTypeFilter, DriveViewMode } from '../../lib/driveHelpers'
import { Button } from '../ui/Button'

const TYPE_OPTIONS: Array<{ value: DriveTypeFilter; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'doc', label: 'Docs' },
  { value: 'file', label: 'Files' },
  { value: 'link', label: 'Links' },
]

const SORT_OPTIONS: Array<{ value: DriveSort; label: string }> = [
  { value: 'updated_desc', label: 'Recently updated' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'size_desc', label: 'Largest first' },
  { value: 'type', label: 'File type' },
]

/**
 * Compact Google Drive controls bar: type filter pills, sort order, and Grid/List switcher.
 */
export function DriveControlsBar({
  typeFilter,
  onTypeFilterChange,
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
  showNeedsReview = false,
  needsReviewCount = 0,
  totalCount,
}: {
  typeFilter: DriveTypeFilter
  onTypeFilterChange: (next: DriveTypeFilter) => void
  sort: DriveSort
  onSortChange: (next: DriveSort) => void
  viewMode: DriveViewMode
  onViewModeChange: (next: DriveViewMode) => void
  showNeedsReview?: boolean
  needsReviewCount?: number
  totalCount: number
}) {
  const options = showNeedsReview
    ? [...TYPE_OPTIONS, { value: 'needs_review' as const, label: needsReviewCount > 0 ? `Needs review (${needsReviewCount})` : 'Needs review' }]
    : TYPE_OPTIONS

  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by item type">
        {options.map((option) => {
          const active = typeFilter === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onTypeFilterChange(option.value)}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold transition-colors duration-150 lg:min-h-8 ${
                active
                  ? 'border-primary-soft-line bg-primary-soft text-primary-ink'
                  : 'border-line bg-surface-raised text-ink-secondary hover:border-line-strong hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
        <span className="text-xs font-medium tabular-nums text-ink-muted">
          {totalCount} {totalCount === 1 ? 'item' : 'items'}
        </span>
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <ArrowDownUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">Sort files</span>
          <select
            aria-label="Sort files"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as DriveSort)}
            className="app-control min-h-11 py-1 pr-7 text-xs font-semibold lg:min-h-8"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <div role="group" aria-label="Layout view" className="inline-flex rounded-xl border border-line bg-surface-sunken p-0.5">
          <button
            type="button"
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
            onClick={() => onViewModeChange('list')}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors lg:h-8 lg:w-8 ${
              viewMode === 'list' ? 'bg-surface-raised text-ink shadow-raised' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <List className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
            onClick={() => onViewModeChange('grid')}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors lg:h-8 lg:w-8 ${
              viewMode === 'grid' ? 'bg-surface-raised text-ink shadow-raised' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Bulk selection action bar shown when one or more items are selected in Drive.
 */
export function DriveBulkBar({
  selectedCount,
  folderOptions,
  busy = false,
  canToggleVisibility = false,
  onMove,
  onSetVisibility,
  onDelete,
  onClear,
}: {
  selectedCount: number
  folderOptions: string[]
  busy?: boolean
  canToggleVisibility?: boolean
  onMove: (targetFolder: string) => void
  onSetVisibility?: (visibility: 'students' | 'staff_only') => void
  onDelete: () => void
  onClear: () => void
}) {
  const [moving, setMoving] = useState(false)
  const [target, setTarget] = useState(folderOptions[0] || 'General')

  if (selectedCount === 0) return null

  return (
    <div
      role="region"
      aria-label="Bulk file actions"
      className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-primary-soft-line bg-primary-soft/50 px-4 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold tabular-nums text-ink">
          {selectedCount} selected
        </span>
        <Button size="sm" variant="quiet" disabled={busy} onClick={onClear}>
          <X className="h-4 w-4" aria-hidden="true" />
          Clear
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {moving ? (
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Choose destination folder"
              value={target}
              disabled={busy}
              onChange={(event) => setTarget(event.target.value)}
              className="app-control min-h-11 py-1 text-sm lg:min-h-9"
            >
              {folderOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={busy || !target}
              onClick={() => {
                onMove(target)
                setMoving(false)
              }}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Move
            </Button>
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => setMoving(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setTarget(folderOptions[0] || 'General'); setMoving(true) }}>
            <FolderInput className="h-4 w-4" aria-hidden="true" />
            Move to folder
          </Button>
        )}

        {canToggleVisibility && onSetVisibility && (
          <>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetVisibility('students')}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              Share with students
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetVisibility('staff_only')}>
              <EyeOff className="h-4 w-4" aria-hidden="true" />
              Staff only
            </Button>
          </>
        )}

        <Button size="sm" variant="quiet" disabled={busy} onClick={onDelete} className="text-danger-ink hover:bg-danger-soft">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </Button>
      </div>
    </div>
  )
}
