import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, ChevronRight, CircleDot, CopyPlus, Eye, EyeOff, FolderLock, FolderOpen, FolderPen, Link2, NotebookPen, Pencil, Plus, RefreshCw, Repeat, Search, Trash2, Upload, X } from 'lucide-react'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import {
  CLASS_FOLDER_PRESETS,
  STUDENT_FOLDER_PRESETS,
  downloadCohortFile,
  isStudentFolderItem,
  linkUrlProblem,
  matchesFileQuery,
  type CohortFile,
  type CohortFilesResponse,
  type CohortStudentFolder,
} from '../../lib/cohortFiles'
import {
  DRIVE_DRAG_MIME,
  matchesDriveTypeFilter,
  readStoredDriveView,
  saveStoredDriveView,
  sortDriveFiles,
  summarizeFolders,
  type DriveSort,
  type DriveTypeFilter,
  type DriveViewMode,
} from '../../lib/driveHelpers'
import { AutoCopyBadge, CohortDocForm, CohortFileRow, CohortFileUploader, CohortLinkForm, FolderBadge, StaffOnlyBadge } from '../shared/CohortFileParts'
import { CohortDocEditorModal } from '../shared/CohortDocEditorModal'
import { CohortFilePreviewModal } from '../shared/CohortFilePreviewModal'
import { CohortFileReviewModal } from '../shared/CohortFileReview'
import { DriveFileGridCard } from '../shared/DriveFileGrid'
import { DriveBreadcrumbs, DriveFolderGrid } from '../shared/DriveFolderGrid'
import { DriveInspectorDrawer } from '../shared/DriveInspectorDrawer'
import { DriveBulkBar, DriveControlsBar } from '../shared/DriveToolbar'
import { FolderZipButton } from '../shared/FolderZipButton'
import { CohortFileImportControls } from './CohortFileImportControls'
import type { ReviewAccess } from '../shared/CohortFileReview'
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

const STAFF_REVIEW: ReviewAccess = { staff: true, canChange: true }

/** A student folder with its counts recomputed from its files. */
function withFolderFiles(folder: CohortStudentFolder, files: CohortFile[]): CohortStudentFolder {
  return { ...folder, files, file_count: files.length, needs_review_count: files.filter((file) => isStudentFolderItem(file) && file.review_status === 'needs_review').length }
}

/** A positive whole-number search param, or null. */
function idParam(value: string | null) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Cohort workspace Files tab: shared class files (with staging) and one
 * private folder per student. `?student=S&file=Y` (a review notification)
 * opens that student's folder and the item.
 */
export function CohortFilesPanel({ cohortId }: { cohortId: number }) {
  const { data, setData, error, loading, load } = useCohortFiles(cohortId)
  const [searchParams] = useSearchParams()
  const linkedStudentId = idParam(searchParams.get('student'))
  const linkedFileParam = idParam(searchParams.get('file'))
  const [view, setView] = useState<View>(linkedStudentId ? 'students' : 'class')
  const [openStudentId, setOpenStudentId] = useState<number | null>(linkedStudentId)
  // The linked item opens once; moving to another folder or view drops it.
  const [linkedFileId, setLinkedFileId] = useState<number | null>(linkedFileParam)
  useEffect(() => {
    if (!linkedStudentId && !linkedFileParam) return
    setView(linkedStudentId ? 'students' : 'class')
    setOpenStudentId(linkedStudentId)
    setLinkedFileId(linkedFileParam)
  }, [linkedFileParam, linkedStudentId])
  const openFolder = (studentId: number | null) => {
    setOpenStudentId(studentId)
    setLinkedFileId(null)
  }

  if (loading && !data) return <LoadingSpinner message="Loading files…" />
  if (!data) return <LoadError message={error} onRetry={() => void load()} />

  const folders = data.student_folders || []
  const replaceFiles = (update: (files: CohortFile[]) => CohortFile[], studentId: number | null) => setData((current) => current && (studentId === null
    ? { ...current, class_files: update(current.class_files) }
    : {
        ...current,
        student_folders: (current.student_folders || []).map((folder) => (folder.student_id === studentId ? withFolderFiles(folder, update(folder.files)) : folder)),
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
            <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => { setView(value); openFolder(null) }}
              className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 sm:flex-none ${view === value ? 'bg-surface-raised text-ink shadow-raised' : 'text-ink-secondary hover:text-ink'}`}>
              {label}
              <span className="tabular-nums text-ink-muted">{count}</span>
            </button>
          ))}
        </div>
      </div>
      {!data.storage_configured && (
        <p role="status" className="rounded-2xl border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          File storage isn't set up for this school yet, so uploads and downloads are unavailable. You can still add links and docs.
        </p>
      )}
      {view === 'class' ? (
        <ClassFiles key={`class-${linkedFileId ?? ''}`} cohortId={cohortId} files={data.class_files} storage={data.storage_configured} linkedFileId={linkedStudentId ? null : linkedFileId}
          studentCount={folders.filter((folder) => folder.enrollment_status === 'active').length}
          onChange={(update) => replaceFiles(update, null)} onCopied={() => void load()} />
      ) : (
        <StudentFolders cohortId={cohortId} folders={folders} storage={data.storage_configured}
          openStudentId={openStudentId} onOpen={openFolder} linkedFileId={linkedFileId}
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

function ClassFiles({ cohortId, files, storage, studentCount, linkedFileId, onChange, onCopied }: {
  cohortId: number
  files: CohortFile[]
  storage: boolean
  studentCount: number
  linkedFileId: number | null
  onChange: (update: (files: CohortFile[]) => CohortFile[]) => void
  onCopied: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [folder, setFolder] = useState('All')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<DriveTypeFilter>('all')
  const [sort, setSort] = useState<DriveSort>('updated_desc')
  const [viewMode, setViewMode] = useState<DriveViewMode>(() => readStoredDriveView())
  const [adding, setAdding] = useState<'file' | 'link' | 'doc' | null>(null)
  const [droppedFiles, setDroppedFiles] = useState<File[] | undefined>(undefined)
  const [dropActive, setDropActive] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [inspectedId, setInspectedId] = useState<number | null>(null)
  const [gridOpened, setGridOpened] = useState<{ fileId: number; pane: 'main' | 'review' } | null>(null)
  // A new doc opens in the editor; a linked file opens once.
  const [openFileId, setOpenFileId] = useState<number | null>(linkedFileId)
  const [renaming, setRenaming] = useState(false)

  const handleViewMode = (mode: DriveViewMode) => {
    setViewMode(mode)
    saveStoredDriveView(mode)
  }

  const folders = useMemo(() => [...new Set(files.map((file) => file.folder))].sort(), [files])
  const folderSummaries = useMemo(() => summarizeFolders(files), [files])
  const activeFolder = folder !== 'All' && folders.includes(folder) ? folder : 'All'
  const shown = useMemo(
    () => sortDriveFiles(
      files.filter((file) => (activeFolder === 'All' || file.folder === activeFolder) && matchesFileQuery(file, query) && matchesDriveTypeFilter(file, typeFilter)),
      sort,
    ),
    [activeFolder, files, query, sort, typeFilter],
  )
  const presets = folderOptions(CLASS_FOLDER_PRESETS, files)
  const defaultFolder = activeFolder === 'All' ? undefined : activeFolder
  const inspectedFile = useMemo(() => files.find((item) => item.id === inspectedId) || null, [files, inspectedId])
  const gridOpenedFile = useMemo(() => (gridOpened ? files.find((item) => item.id === gridOpened.fileId) || null : null), [files, gridOpened])
  const previewableShown = useMemo(() => shown.filter((item) => item.kind === 'file' && item.previewable && storage), [shown, storage])

  const activeSelectedIds = useMemo(() => {
    const valid = new Set(shown.map((item) => item.id))
    return [...selectedIds].filter((id) => valid.has(id))
  }, [selectedIds, shown])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [cohortId, activeFolder, query, typeFilter])

  useEffect(() => {
    if (!openFileId) return
    const target = files.find((item) => item.id === openFileId)
    if (!target) return
    setOpenFileId(null)
    if (target.kind === 'doc' || target.kind === 'file') {
      setGridOpened({ fileId: target.id, pane: 'main' })
    }
  }, [files, openFileId])

  const toggleSelect = (fileId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  const moveFileToFolder = async (fileId: number, targetFolder: string) => {
    const target = files.find((item) => item.id === fileId)
    if (!target || target.folder === targetFolder) return
    const result = await api.updateCohortFile(cohortId, fileId, { folder: targetFolder })
    if (!result.data) {
      toast.error(result.error || `Could not move ${target.title}.`)
      return
    }
    onChange((current) => current.map((item) => (item.id === fileId ? result.data!.file : item)))
    toast.success(`Moved ${target.title} to ${targetFolder}`)
  }

  const handleBulkMove = async (targetFolder: string) => {
    if (!activeSelectedIds.length || bulkBusy) return
    setBulkBusy(true)
    let movedCount = 0
    let failures = 0
    for (const id of activeSelectedIds) {
      const item = files.find((entry) => entry.id === id)
      if (!item || item.folder === targetFolder) continue
      const result = await api.updateCohortFile(cohortId, id, { folder: targetFolder })
      if (result.data) {
        const saved = result.data.file
        movedCount += 1
        onChange((current) => current.map((entry) => (entry.id === saved.id ? saved : entry)))
      } else {
        failures += 1
      }
    }
    if (movedCount > 0) {
      toast.success(`Moved ${movedCount} ${movedCount === 1 ? 'item' : 'items'} to ${targetFolder}`)
    }
    if (failures > 0) toast.error(`Could not move ${failures} ${failures === 1 ? 'item' : 'items'}.`)
    setSelectedIds(new Set())
    setBulkBusy(false)
  }

  const handleBulkVisibility = async (visibility: 'students' | 'staff_only') => {
    if (!activeSelectedIds.length || bulkBusy) return
    setBulkBusy(true)
    let updatedCount = 0
    let failures = 0
    for (const id of activeSelectedIds) {
      const item = files.find((entry) => entry.id === id)
      if (!item || item.visibility === visibility) continue
      const result = await api.updateCohortFile(
        cohortId,
        id,
        visibility === 'staff_only' && item.auto_copy_to_students ? { visibility, auto_copy_to_students: false } : { visibility },
      )
      if (result.data) {
        const saved = result.data.file
        updatedCount += 1
        onChange((current) => current.map((entry) => (entry.id === saved.id ? saved : entry)))
      } else {
        failures += 1
      }
    }
    if (updatedCount > 0) {
      toast.success(visibility === 'students' ? `Shared ${updatedCount} ${updatedCount === 1 ? 'item' : 'items'} with students` : `Moved ${updatedCount} ${updatedCount === 1 ? 'item' : 'items'} to staff only`)
    }
    if (failures > 0) toast.error(`Could not update ${failures} ${failures === 1 ? 'item' : 'items'}.`)
    setSelectedIds(new Set())
    setBulkBusy(false)
  }

  const handleBulkDelete = async () => {
    if (!activeSelectedIds.length || bulkBusy) return
    const ok = await confirm({
      title: `Delete ${activeSelectedIds.length} ${activeSelectedIds.length === 1 ? 'item' : 'items'}?`,
      description: 'Students lose access to them right away. Copies already in student folders stay.',
      confirmLabel: `Delete ${activeSelectedIds.length}`,
      tone: 'danger',
    })
    if (!ok) return
    setBulkBusy(true)
    const deleted = new Set<number>()
    let failures = 0
    for (const id of activeSelectedIds) {
      const result = await api.deleteCohortFile(cohortId, id)
      if (!result.error) deleted.add(id)
      else failures += 1
    }
    if (deleted.size > 0) {
      onChange((current) => current.filter((item) => !deleted.has(item.id)))
      if (inspectedId && deleted.has(inspectedId)) setInspectedId(null)
      toast.success(`Deleted ${deleted.size} ${deleted.size === 1 ? 'item' : 'items'}`)
    }
    if (failures > 0) toast.error(`Could not delete ${failures} ${failures === 1 ? 'item' : 'items'}.`)
    setSelectedIds(new Set())
    setBulkBusy(false)
  }

  const onCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!storage || adding === 'file') return
    if (event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes(DRIVE_DRAG_MIME)) {
      event.preventDefault()
      if (!dropActive) setDropActive(true)
    }
  }

  const onCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    setDropActive(false)
    if (!storage || adding === 'file') return
    if (event.dataTransfer.types.includes(DRIVE_DRAG_MIME)) return
    const dropped = Array.from(event.dataTransfer.files || [])
    if (!dropped.length) return
    event.preventDefault()
    setDroppedFiles(dropped)
    setAdding('file')
  }

  const previewIndex = gridOpenedFile ? previewableShown.findIndex((item) => item.id === gridOpenedFile.id) : -1

  return (
    <div
      className="relative space-y-4"
      onDragOver={onCanvasDragOver}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropActive(false)
      }}
      onDrop={onCanvasDrop}
    >
      {dropActive && (
        <div className="pointer-events-none fixed inset-4 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-action-primary bg-primary-soft/85 backdrop-blur-xs">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface-raised px-6 py-5 shadow-raised">
            <Upload className="h-7 w-7 text-primary-ink" aria-hidden="true" />
            <p className="text-base font-bold text-ink">
              Drop files to upload{defaultFolder ? ` into ${defaultFolder}` : ''}
            </p>
          </div>
        </div>
      )}

      {adding === 'file' ? (
        <CohortFileUploader key={`${cohortId}-class`} cohortId={cohortId} heading="Upload class files" allowVisibility defaultFolder={defaultFolder}
          initialFiles={droppedFiles}
          onInitialFilesConsumed={() => setDroppedFiles(undefined)}
          description="Add several files at once. Choose Staff only to review them before students can see them."
          folderPresets={presets} disabled={!storage} disabledReason="File storage isn't set up yet."
          onCancel={() => { setAdding(null); setDroppedFiles(undefined) }}
          onUploaded={(file) => onChange((current) => [...current, file])}
          onFinished={() => { setAdding(null); setDroppedFiles(undefined) }} />
      ) : adding === 'link' ? (
        <CohortLinkForm key={`${cohortId}-class`} cohortId={cohortId} heading="Add a class link" allowVisibility folderPresets={presets} defaultFolder={defaultFolder}
          onCancel={() => setAdding(null)}
          onSaved={(file) => { onChange((current) => [...current, file]); setAdding(null) }} />
      ) : adding === 'doc' ? (
        <CohortDocForm key={`${cohortId}-class`} cohortId={cohortId} heading="New class doc" allowVisibility folderPresets={presets} defaultFolder={defaultFolder}
          description="Write a guide, checklist or template right here. Use Copy to all students to give everyone their own copy to fill in."
          onCancel={() => setAdding(null)}
          onCreated={(file) => { onChange((current) => [...current, file]); setAdding(null); setOpenFileId(file.id) }} />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchBox value={query} onChange={setQuery} label="Search class files" />
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button onClick={() => { setDroppedFiles(undefined); setAdding('file') }} disabled={!storage}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Upload files
            </Button>
            <Button variant="secondary" onClick={() => setAdding('link')}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Add link
            </Button>
            <Button variant="secondary" className="col-span-2 sm:col-span-1" onClick={() => setAdding('doc')}>
              <NotebookPen className="h-4 w-4" aria-hidden="true" />
              New doc
            </Button>
          </div>
        </div>
      )}
      {!adding && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="More ways to add and download class files">
          <CohortFileImportControls cohortId={cohortId} onImported={onCopied} />
          <FolderZipButton cohortId={cohortId} scope="class" folder={defaultFolder} size="sm" variant="quiet" empty={!files.some((file) => activeFolder === 'All' || file.folder === activeFolder)}
            label={defaultFolder ? `Download ${defaultFolder} as ZIP` : 'Download ZIP'} ariaLabel={defaultFolder ? `Download the ${defaultFolder} folder as a ZIP` : 'Download all class files as a ZIP'} />
        </div>
      )}
      {folders.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by folder">
            {['All', ...folders].map((name) => (
              <button key={name} type="button" aria-pressed={activeFolder === name} onClick={() => { setFolder(name); setRenaming(false) }}
                className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors duration-150 lg:min-h-9 ${activeFolder === name ? 'border-primary-soft-line bg-primary-soft text-primary-ink' : 'border-line bg-surface-raised text-ink-secondary hover:border-line-strong hover:text-ink'}`}>
                {name}
              </button>
            ))}
          </div>
          {activeFolder !== 'All' && !renaming && (
            <Button size="sm" variant="quiet" onClick={() => setRenaming(true)} aria-label={`Rename folder ${activeFolder}`}>
              <FolderPen className="h-4 w-4" aria-hidden="true" />
              Rename folder
            </Button>
          )}
        </div>
      )}
      {activeFolder === 'All' && folderSummaries.length > 1 && !query.trim() && (
        <DriveFolderGrid
          folders={folderSummaries}
          activeFolder={activeFolder}
          onSelectFolder={(next) => { setFolder(next); setRenaming(false) }}
          onDropFileToFolder={(fileId, targetFolder) => void moveFileToFolder(fileId, targetFolder)}
          label="Class folders"
        />
      )}
      <DriveBreadcrumbs
        rootLabel="Class files"
        activeFolder={activeFolder}
        onReset={() => { setFolder('All'); setRenaming(false) }}
      />
      {renaming && activeFolder !== 'All' && (
        <RenameFolder cohortId={cohortId} folder={activeFolder} onCancel={() => setRenaming(false)}
          onRenamed={(name) => {
            onChange((current) => current.map((file) => (file.folder === activeFolder ? { ...file, folder: name } : file)))
            setFolder(name)
            setRenaming(false)
          }} />
      )}
      {files.length > 0 && (
        <DriveControlsBar
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          sort={sort}
          onSortChange={setSort}
          viewMode={viewMode}
          onViewModeChange={handleViewMode}
          totalCount={shown.length}
        />
      )}
      <DriveBulkBar
        selectedCount={activeSelectedIds.length}
        folderOptions={presets}
        busy={bulkBusy}
        canToggleVisibility
        onMove={(targetFolder) => void handleBulkMove(targetFolder)}
        onSetVisibility={(visibility) => void handleBulkVisibility(visibility)}
        onDelete={() => void handleBulkDelete()}
        onClear={() => setSelectedIds(new Set())}
      />
      <div className={inspectedFile ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start' : ''}>
        <div className="min-w-0">
          {files.length === 0 ? (
            <div className="app-surface">
              <EmptyState icon={FolderOpen} title="No class files yet" description="Upload slides, guides, templates and starter kits. Students see them on Resources." />
            </div>
          ) : shown.length === 0 ? (
            <p className="app-surface px-4 py-6 text-center text-sm text-ink-secondary">No class files match this view.</p>
          ) : viewMode === 'grid' ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Class files">
              {shown.map((file) => (
                <DriveFileGridCard
                  key={file.id}
                  file={file}
                  selected={selectedIds.has(file.id)}
                  inspected={inspectedId === file.id}
                  canSelect
                  canDrag
                  downloadDisabled={!storage}
                  onToggleSelect={toggleSelect}
                  onInspect={(item) => setInspectedId((current) => (current === item.id ? null : item.id))}
                  onOpen={(item, pane = 'main') => setGridOpened({ fileId: item.id, pane })}
                  onDownload={(item) => void downloadCohortFile(cohortId, item).catch((cause) => toast.error(cause instanceof Error ? cause.message : 'Download failed.'))}
                />
              ))}
            </div>
          ) : (
            <ul className="app-surface divide-y divide-line overflow-hidden" aria-label="Class files">
              {shown.map((file) => (
                <ClassFileItem key={file.id} cohortId={cohortId} file={file} studentCount={studentCount} storage={storage}
                  selected={selectedIds.has(file.id)}
                  onToggleSelect={toggleSelect}
                  inspected={inspectedId === file.id}
                  onInspect={(item) => setInspectedId((current) => (current === item.id ? null : item.id))}
                  onSaved={(saved) => onChange((current) => current.map((item) => (item.id === saved.id ? saved : item)))}
                  onDeleted={() => {
                    onChange((current) => current.filter((item) => item.id !== file.id))
                    setInspectedId((current) => (current === file.id ? null : current))
                  }}
                  onCopied={onCopied} />
              ))}
            </ul>
          )}
        </div>
        {inspectedFile && (
          <DriveInspectorDrawer
            cohortId={cohortId}
            file={inspectedFile}
            folderOptions={presets}
            downloadDisabled={!storage}
            onClose={() => setInspectedId(null)}
            onOpenPreview={(item, pane = 'main') => setGridOpened({ fileId: item.id, pane })}
            onFileChange={(saved) => onChange((current) => current.map((item) => (item.id === saved.id ? saved : item)))}
          />
        )}
      </div>
      {gridOpenedFile && gridOpenedFile.kind === 'doc' && (
        <CohortDocEditorModal
          key={`${cohortId}-${gridOpenedFile.id}`}
          cohortId={cohortId}
          file={gridOpenedFile}
          open
          onClose={() => setGridOpened(null)}
          onFileChange={(saved) => onChange((current) => current.map((item) => (item.id === saved.id ? saved : item)))}
        />
      )}
      {gridOpenedFile && gridOpenedFile.kind === 'file' && (
        <CohortFilePreviewModal
          key={`${cohortId}-${gridOpenedFile.id}`}
          cohortId={cohortId}
          file={gridOpenedFile}
          open
          onClose={() => setGridOpened(null)}
          downloadDisabled={!storage}
          onFileChange={(saved) => onChange((current) => current.map((item) => (item.id === saved.id ? saved : item)))}
          onPrev={previewIndex > 0 ? () => setGridOpened({ fileId: previewableShown[previewIndex - 1].id, pane: 'main' }) : undefined}
          onNext={previewIndex >= 0 && previewIndex < previewableShown.length - 1 ? () => setGridOpened({ fileId: previewableShown[previewIndex + 1].id, pane: 'main' }) : undefined}
          positionLabel={previewIndex >= 0 && previewableShown.length > 1 ? `${previewIndex + 1} of ${previewableShown.length}` : undefined}
        />
      )}
    </div>
  )
}

/** Rename the selected class-file folder in one step. Student folders keep their names. */
function RenameFolder({ cohortId, folder, onRenamed, onCancel }: {
  cohortId: number
  folder: string
  onRenamed: (name: string) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(folder)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const trimmed = name.trim()
  const save = async () => {
    if (!trimmed || saving) return
    if (trimmed === folder) return onCancel()
    setSaving(true)
    const result = await api.renameCohortFolder(cohortId, { from_folder: folder, to_folder: trimmed })
    setSaving(false)
    if (!result.data) return setError(result.error || 'Could not rename this folder.')
    toast.success(`Renamed ${folder} to ${result.data.folder}`)
    onRenamed(result.data.folder)
  }
  return (
    <form className="app-surface flex flex-col gap-3 p-4 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label className="block min-w-0 flex-1 text-sm font-medium text-ink">
        {`Rename ${folder}`}
        <input className="app-control mt-1 w-full" value={name} maxLength={80} disabled={saving} autoFocus onChange={(event) => setName(event.target.value)} />
      </label>
      {error && <p role="alert" className="text-sm text-danger-ink sm:order-last sm:basis-full">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !trimmed}>
          <Check className="h-4 w-4" aria-hidden="true" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="quiet" disabled={saving} onClick={onCancel}>
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ClassFileItem({ cohortId, file, studentCount, storage, selected, onToggleSelect, inspected, onInspect, onSaved, onDeleted, onCopied }: {
  cohortId: number
  file: CohortFile
  studentCount: number
  storage: boolean
  selected?: boolean
  onToggleSelect?: (fileId: number) => void
  inspected?: boolean
  onInspect?: (file: CohortFile) => void
  onSaved: (file: CohortFile) => void
  onDeleted: () => void
  onCopied: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const staged = file.visibility === 'staff_only'
  const link = file.kind === 'link'
  const doc = file.kind === 'doc'
  const kindLabel = link ? 'link' : doc ? 'doc' : 'file'

  const autoCopy = file.auto_copy_to_students
  const toggle = async () => {
    setBusy(true)
    // Staff-only items can't auto-copy, so moving one to staff only turns auto-copy off with it.
    const result = await api.updateCohortFile(cohortId, file.id, staged ? { visibility: 'students' } : { visibility: 'staff_only', ...(autoCopy ? { auto_copy_to_students: false } : {}) })
    setBusy(false)
    if (!result.data) return toast.error(result.error || `Could not change who can see this ${kindLabel}.`)
    onSaved(result.data.file)
    toast.success(staged ? `Shared ${file.title} with students` : `${file.title} is staff only${autoCopy ? ' and no longer auto-copies' : ''}`)
  }
  const toggleAutoCopy = async () => {
    if (!autoCopy && !(await confirm({
      title: `Auto-copy ${file.title} to every student?`,
      description: `Each active student (${studentCount}) gets their own copy now, and students who join later get one automatically. Students who already have a copy are skipped.${file.kind === 'file' && !storage ? ' Uploaded files are copied once file storage is set up.' : ''}`,
      confirmLabel: 'Turn on auto-copy',
    }))) return
    setBusy(true)
    const result = await api.updateCohortFile(cohortId, file.id, { auto_copy_to_students: !autoCopy })
    setBusy(false)
    if (!result.data) return toast.error(result.error || 'Could not change auto-copy.')
    onSaved(result.data.file)
    const copied = result.data.auto_copied_count ?? 0
    toast.success(autoCopy ? `${file.title} no longer auto-copies to new students` : `Auto-copy is on${copied ? ` and ${copied} student${copied === 1 ? '' : 's'} got a copy` : ''}`)
    if (copied) onCopied()
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
    if (!result.data) return toast.error(result.error || `Could not copy this ${kindLabel}.`)
    const { copied_count: copied, skipped_count: skipped } = result.data
    toast.success(`Copied to ${copied} student${copied === 1 ? '' : 's'}${skipped ? ` (${skipped} already had it)` : ''}`)
    onCopied()
  }
  const remove = async () => {
    const ok = await confirm({ title: `Delete ${file.title}?`, description: `Students lose access to it right away.${link ? '' : doc ? ' Its history is deleted too.' : ' Every version is deleted.'} Copies already in student folders stay.`, confirmLabel: `Delete ${kindLabel}`, tone: 'danger' })
    if (!ok) return
    setBusy(true)
    const result = await api.deleteCohortFile(cohortId, file.id)
    setBusy(false)
    if (result.error) return toast.error(result.error)
    onDeleted()
    toast.success(`Deleted ${file.title}`)
  }

  if (editing) {
    return <EditFile cohortId={cohortId} file={file} presets={CLASS_FOLDER_PRESETS} onCancel={() => setEditing(false)} onReload={onCopied}
      onSaved={(saved) => { onSaved(saved); setEditing(false) }} />
  }
  return (
    <CohortFileRow cohortId={cohortId} file={file} downloadDisabled={!storage} canUploadVersion={file.kind === 'file'} onVersionUploaded={(saved) => { onSaved(saved); toast.success(`Uploaded version ${saved.version_number} of ${saved.title}`) }}
      onFileChange={onSaved}
      canSelect={Boolean(onToggleSelect)} selected={selected} onToggleSelect={onToggleSelect}
      canDrag inspected={inspected} onInspect={onInspect}
      badges={<><FolderBadge folder={file.folder} />{staged && <StaffOnlyBadge />}{autoCopy && <AutoCopyBadge />}</>}
      actions={<>
        <Button size="sm" variant={staged ? 'primary' : 'quiet'} disabled={busy} onClick={() => void toggle()}>
          {staged ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
          {staged ? 'Share with students' : 'Move to staff only'}
        </Button>
        <OverflowMenu size="sm" label={`More actions for ${file.title}`} items={[
          // Staff-only items are shared with students before they can be copied to their folders.
          ...((storage || link || doc) && studentCount > 0 && !staged ? [{ key: 'copy', label: 'Copy to all students', icon: <CopyPlus className="h-4 w-4" aria-hidden="true" />, onSelect: () => void copy() }] : []),
          ...(!staged ? [{ key: 'auto-copy', label: autoCopy ? 'Turn off auto-copy' : 'Auto-copy to new students', icon: <Repeat className="h-4 w-4" aria-hidden="true" />, onSelect: () => void toggleAutoCopy() }] : []),
          { key: 'edit', label: 'Edit', icon: <Pencil className="h-4 w-4" aria-hidden="true" />, onSelect: () => setEditing(true) },
          { key: 'delete', label: 'Delete', tone: 'danger' as const, icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, onSelect: () => void remove() },
        ]} />
      </>} />
  )
}

function EditFile({ cohortId, file, presets, onCancel, onSaved, onReload }: {
  cohortId: number
  file: CohortFile
  presets: string[]
  onCancel: () => void
  onSaved: (file: CohortFile) => void
  /** Reloads the list from the server when cancelling after a 409 conflict. */
  onReload?: () => void
}) {
  const [title, setTitle] = useState(file.title)
  const [folder, setFolder] = useState(file.folder)
  const [baseFolder, setBaseFolder] = useState(file.folder)
  const [url, setUrl] = useState(file.external_url || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // The doc version a rename is made from; a conflict moves it to the latest.
  const [baseVersion, setBaseVersion] = useState(file.doc_version)
  const [hadConflict, setHadConflict] = useState(false)
  const listId = `folders-${file.id}`
  const link = file.kind === 'link'
  const urlProblem = link ? linkUrlProblem(url) : null
  const cancel = () => {
    if (hadConflict) onReload?.()
    onCancel()
  }
  const save = async () => {
    if (urlProblem) return setError(urlProblem)
    setSaving(true)
    const folderChanged = folder.trim() !== baseFolder.trim()
    // Renaming a doc is a doc save, made from the version on screen.
    // Omit folder when unchanged so retrying a rename doesn't undo a concurrent move.
    const result = await api.updateCohortFile(cohortId, file.id, {
      title,
      ...(folderChanged ? { folder } : {}),
      ...(link ? { external_url: url.trim() } : {}),
      ...(file.kind === 'doc' && baseVersion ? { base_doc_version: baseVersion } : {}),
    })
    if (result.status === 409) {
      setHadConflict(true)
      const latest = await api.getCohortDoc(cohortId, file.id)
      setSaving(false)
      if (!latest.data) return setError(latest.error || 'This doc changed since you opened it. Cancel and try again.')
      setBaseVersion(latest.data.doc_version)
      if (!folderChanged) setFolder(latest.data.file.folder)
      setBaseFolder(latest.data.file.folder)
      return setError(`This doc changed since you opened it (now "${latest.data.file.title}"). Save again to rename it.`)
    }
    setSaving(false)
    if (!result.data) return setError(result.error || 'Could not save.')
    onSaved(result.data.file)
  }
  return (
    <li className="space-y-3 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
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
          <label className="block text-sm font-medium text-ink sm:col-span-2">
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
        <Button size="sm" variant="quiet" disabled={saving} onClick={cancel}>
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </li>
  )
}

function StudentFolders({ cohortId, folders, storage, openStudentId, onOpen, linkedFileId, onChange }: {
  cohortId: number
  folders: CohortStudentFolder[]
  storage: boolean
  openStudentId: number | null
  onOpen: (studentId: number | null) => void
  linkedFileId: number | null
  onChange: (update: (files: CohortFile[]) => CohortFile[], studentId: number) => void
}) {
  const [query, setQuery] = useState('')
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false)
  const q = query.trim().toLowerCase()
  const waiting = folders.filter((folder) => folder.needs_review_count > 0).length
  const shown = folders.filter((folder) => (!needsReviewOnly || folder.needs_review_count > 0) &&
    (!q || folder.student_name.toLowerCase().includes(q) || folder.student_email.toLowerCase().includes(q)))
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
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter student folders">
          {([[false, 'All students'], [true, `Needs review (${waiting})`]] as const).map(([value, label]) => (
            <button key={String(value)} type="button" aria-pressed={needsReviewOnly === value} onClick={() => setNeedsReviewOnly(value)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors duration-150 lg:min-h-9 ${needsReviewOnly === value ? 'border-primary-soft-line bg-primary-soft text-primary-ink' : 'border-line bg-surface-raised text-ink-secondary hover:border-line-strong hover:text-ink'}`}>
              {value && <CircleDot className="h-4 w-4" aria-hidden="true" />}
              <span className="tabular-nums">{label}</span>
            </button>
          ))}
        </div>
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
                  <span className="flex flex-col items-end gap-1 sm:flex-row sm:items-center">
                    {folder.needs_review_count > 0 && <Badge tone="warning">{`Needs review${folder.needs_review_count > 1 ? ` (${folder.needs_review_count})` : ''}`}</Badge>}
                    {folder.enrollment_status !== 'active' && <Badge tone={status.tone}>{status.label}</Badge>}
                    <Badge>{`${folder.file_count} file${folder.file_count === 1 ? '' : 's'}`}</Badge>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                </button>
              </li>
            )
          })}
          {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-secondary">{needsReviewOnly && !q ? 'Nothing is waiting for review.' : 'No students match.'}</li>}
        </ul>
      </div>
      {open ? (
        <div className="min-w-0 space-y-3">
          <Button variant="quiet" className="lg:hidden" onClick={() => onOpen(null)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All student folders
          </Button>
          {/* Keyed per student, so a half-filled upload or link never carries into another student's folder. */}
          <StudentFolderView key={`${cohortId}-${open.student_id}`} cohortId={cohortId} folder={open} storage={storage} linkedFileId={linkedFileId} onChange={(update) => onChange(update, open.student_id)} />
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
export function StudentFolderView({ cohortId, folder, storage, linkedFileId = null, onChange }: {
  cohortId: number
  folder: CohortStudentFolder
  storage: boolean
  /** Opened once, from a notification link. */
  linkedFileId?: number | null
  onChange: (update: (files: CohortFile[]) => CohortFile[]) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [adding, setAdding] = useState<'file' | 'link' | 'doc' | null>(null)
  const [droppedFiles, setDroppedFiles] = useState<File[] | undefined>(undefined)
  const [dropActive, setDropActive] = useState(false)
  const [activeSubfolder, setActiveSubfolder] = useState('All')
  const [typeFilter, setTypeFilter] = useState<DriveTypeFilter>('all')
  const [sort, setSort] = useState<DriveSort>('updated_desc')
  const [viewMode, setViewMode] = useState<DriveViewMode>(() => readStoredDriveView())
  const [inspectedId, setInspectedId] = useState<number | null>(null)
  const [gridOpened, setGridOpened] = useState<{ fileId: number; pane: 'main' | 'review' } | null>(null)
  const [openFileId, setOpenFileId] = useState<number | null>(linkedFileId)
  // A newer notification link for this folder opens its item too.
  const [seenLink, setSeenLink] = useState(linkedFileId)
  if (linkedFileId !== seenLink) {
    setSeenLink(linkedFileId)
    if (linkedFileId) setOpenFileId(linkedFileId)
  }
  const firstName = folder.student_name.split(' ')[0] || folder.student_name
  const presets = folderOptions(STUDENT_FOLDER_PRESETS, folder.files)
  const subfolderSummaries = useMemo(() => summarizeFolders(folder.files), [folder.files])
  const validSubfolder = activeSubfolder !== 'All' && subfolderSummaries.some((item) => item.name === activeSubfolder) ? activeSubfolder : 'All'
  const shown = useMemo(
    () => sortDriveFiles(
      folder.files.filter((file) => (validSubfolder === 'All' || file.folder === validSubfolder) && matchesDriveTypeFilter(file, typeFilter)),
      sort,
    ),
    [folder.files, sort, typeFilter, validSubfolder],
  )
  const needsReviewCount = useMemo(
    () => folder.files.filter((file) => isStudentFolderItem(file) && file.review_status === 'needs_review').length,
    [folder.files],
  )
  const inspectedFile = useMemo(() => folder.files.find((item) => item.id === inspectedId) || null, [folder.files, inspectedId])
  const gridOpenedFile = useMemo(() => (gridOpened ? folder.files.find((item) => item.id === gridOpened.fileId) || null : null), [folder.files, gridOpened])
  const previewableShown = useMemo(() => shown.filter((item) => item.kind === 'file' && item.previewable && storage), [shown, storage])
  const previewIndex = gridOpenedFile ? previewableShown.findIndex((item) => item.id === gridOpenedFile.id) : -1

  useEffect(() => {
    if (!openFileId) return
    const target = folder.files.find((item) => item.id === openFileId)
    if (!target) return
    setOpenFileId(null)
    if (target.kind === 'doc') {
      setGridOpened({ fileId: target.id, pane: 'main' })
    } else if (target.kind === 'file' && target.previewable && storage) {
      setGridOpened({ fileId: target.id, pane: 'main' })
    } else if (isStudentFolderItem(target)) {
      setGridOpened({ fileId: target.id, pane: 'review' })
    } else if (target.kind === 'file') {
      setGridOpened({ fileId: target.id, pane: 'main' })
    }
  }, [folder.files, openFileId, storage])

  const handleViewMode = (mode: DriveViewMode) => {
    setViewMode(mode)
    saveStoredDriveView(mode)
  }

  const moveFile = async (fileId: number, targetFolder: string) => {
    const item = folder.files.find((entry) => entry.id === fileId)
    if (!item || item.folder === targetFolder) return
    const result = await api.updateCohortFile(cohortId, fileId, { folder: targetFolder })
    if (!result.data) return toast.error(result.error || `Could not move ${item.title}.`)
    onChange((files) => files.map((entry) => (entry.id === fileId ? result.data!.file : entry)))
    toast.success(`Moved ${item.title} to ${targetFolder}`)
  }

  const remove = async (file: CohortFile) => {
    const ok = await confirm({ title: `Delete ${file.title}?`, description: `${folder.student_name} loses access to it right away.`, confirmLabel: file.kind === 'link' ? 'Delete link' : file.kind === 'doc' ? 'Delete doc' : 'Delete file', tone: 'danger' })
    if (!ok) return
    const result = await api.deleteCohortFile(cohortId, file.id)
    if (result.error) return toast.error(result.error)
    onChange((files) => files.filter((item) => item.id !== file.id))
    setInspectedId((current) => (current === file.id ? null : current))
    toast.success(`Deleted ${file.title}`)
  }

  const onCanvasDragOver = (event: DragEvent<HTMLElement>) => {
    if (!storage || adding === 'file') return
    if (event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes(DRIVE_DRAG_MIME)) {
      event.preventDefault()
      if (!dropActive) setDropActive(true)
    }
  }

  const onCanvasDrop = (event: DragEvent<HTMLElement>) => {
    setDropActive(false)
    if (!storage || adding === 'file') return
    if (event.dataTransfer.types.includes(DRIVE_DRAG_MIME)) return
    const dropped = Array.from(event.dataTransfer.files || [])
    if (!dropped.length) return
    event.preventDefault()
    setDroppedFiles(dropped)
    setAdding('file')
  }

  return (
    <section
      className="relative space-y-3"
      aria-label={`${folder.student_name}'s folder`}
      onDragOver={onCanvasDragOver}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDropActive(false) }}
      onDrop={onCanvasDrop}
    >
      {dropActive && (
        <div className="pointer-events-none fixed inset-4 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-action-primary bg-primary-soft/85 backdrop-blur-xs">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface-raised px-6 py-5 shadow-raised">
            <Upload className="h-7 w-7 text-primary-ink" aria-hidden="true" />
            <p className="text-base font-bold text-ink">Drop files to upload into {firstName}&apos;s folder</p>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
            <RecordLink record={{ type: 'student', id: folder.student_id, cohortId }} variant="plain" touchTarget>{folder.student_name}</RecordLink>'s folder
          </h3>
          <p className="mt-1 text-sm text-ink-secondary">Private: only {firstName} and cohort staff can see these files.</p>
        </div>
        {!adding && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-wrap sm:justify-end">
            <Button onClick={() => { setDroppedFiles(undefined); setAdding('file') }} disabled={!storage} aria-label={`Upload to ${firstName}'s folder`}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Upload files
            </Button>
            <Button variant="secondary" onClick={() => setAdding('link')} aria-label={`Add a link to ${firstName}'s folder`}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Add link
            </Button>
            <Button variant="secondary" onClick={() => setAdding('doc')} aria-label={`New doc in ${firstName}'s folder`}>
              <NotebookPen className="h-4 w-4" aria-hidden="true" />
              New doc
            </Button>
            <FolderZipButton cohortId={cohortId} scope="student" studentId={folder.student_id} empty={folder.files.length === 0} variant="quiet"
              ariaLabel={`Download ${folder.student_name}'s folder as a ZIP`} />
          </div>
        )}
      </div>
      {adding === 'file' && (
        <CohortFileUploader key={`${cohortId}-${folder.student_id}`} cohortId={cohortId} studentId={folder.student_id} heading={`Upload to ${firstName}'s folder`}
          defaultFolder={validSubfolder === 'All' ? undefined : validSubfolder}
          initialFiles={droppedFiles}
          onInitialFilesConsumed={() => setDroppedFiles(undefined)}
          folderPresets={presets} disabled={!storage} disabledReason="File storage isn't set up yet."
          onCancel={() => { setAdding(null); setDroppedFiles(undefined) }}
          onUploaded={(file) => { onChange((files) => [...files, file]); toast.success(`Uploaded ${file.title}`) }}
          onFinished={() => { setAdding(null); setDroppedFiles(undefined) }} />
      )}
      {adding === 'link' && (
        <CohortLinkForm key={`${cohortId}-${folder.student_id}`} cohortId={cohortId} studentId={folder.student_id} heading={`Add a link to ${firstName}'s folder`}
          defaultFolder={validSubfolder === 'All' ? undefined : validSubfolder} folderPresets={presets}
          onCancel={() => setAdding(null)}
          onSaved={(file) => { onChange((files) => [...files, file]); setAdding(null); toast.success(`Added ${file.title}`) }} />
      )}
      {adding === 'doc' && (
        <CohortDocForm key={`${cohortId}-${folder.student_id}`} cohortId={cohortId} studentId={folder.student_id} heading={`New doc in ${firstName}'s folder`}
          defaultFolder={validSubfolder === 'All' ? undefined : validSubfolder} folderPresets={presets}
          description={`Feedback, a plan or notes ${firstName} can read and edit.`}
          onCancel={() => setAdding(null)}
          onCreated={(file) => { onChange((files) => [...files, file]); setAdding(null); setOpenFileId(file.id) }} />
      )}
      {validSubfolder === 'All' && subfolderSummaries.length > 1 && (
        <DriveFolderGrid
          folders={subfolderSummaries}
          activeFolder={validSubfolder}
          onSelectFolder={setActiveSubfolder}
          onDropFileToFolder={(fileId, targetFolder) => void moveFile(fileId, targetFolder)}
          label="Folders"
        />
      )}
      <DriveBreadcrumbs
        rootLabel={`${firstName}'s folder`}
        activeFolder={validSubfolder}
        onReset={() => setActiveSubfolder('All')}
      />
      {folder.files.length > 0 && (
        <DriveControlsBar
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          sort={sort}
          onSortChange={setSort}
          viewMode={viewMode}
          onViewModeChange={handleViewMode}
          showNeedsReview
          needsReviewCount={needsReviewCount}
          totalCount={shown.length}
        />
      )}
      <div className={inspectedFile ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start' : ''}>
        <div className="min-w-0">
          {folder.files.length === 0 ? (
            <div className="app-surface">
              <EmptyState icon={FolderOpen} title="This folder is empty" description={`Files, links and docs you or ${firstName} add appear here. Use Copy to all students on a class file or doc to add a template.`} />
            </div>
          ) : shown.length === 0 ? (
            <p className="app-surface px-4 py-6 text-center text-sm text-ink-secondary">No files match this filter.</p>
          ) : viewMode === 'grid' ? (
            <div className="grid gap-3 sm:grid-cols-2" aria-label={`Files in ${folder.student_name}'s folder`}>
              {shown.map((file) => (
                <DriveFileGridCard
                  key={file.id}
                  file={file}
                  inspected={inspectedId === file.id}
                  canDrag
                  downloadDisabled={!storage}
                  review={STAFF_REVIEW}
                  note={file.uploaded_by_role === 'student' ? 'Added by student' : 'Shared by staff'}
                  onInspect={(item) => setInspectedId((current) => (current === item.id ? null : item.id))}
                  onOpen={(item, pane = 'main') => setGridOpened({ fileId: item.id, pane })}
                  onDownload={(item) => void downloadCohortFile(cohortId, item).catch((cause) => toast.error(cause instanceof Error ? cause.message : 'Download failed.'))}
                  actions={
                    <Button size="sm" variant="quiet" onClick={() => void remove(file)} aria-label={`Delete ${file.title}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  }
                />
              ))}
            </div>
          ) : (
            <ul className="app-surface divide-y divide-line overflow-hidden" aria-label={`Files in ${folder.student_name}'s folder`}>
              {shown.map((file) => (
                <CohortFileRow key={file.id} cohortId={cohortId} file={file} downloadDisabled={!storage} canUploadVersion={file.kind === 'file'}
                  review={STAFF_REVIEW}
                  canDrag inspected={inspectedId === file.id} onInspect={(item) => setInspectedId((current) => (current === item.id ? null : item.id))}
                  onFileChange={(saved) => onChange((files) => files.map((item) => (item.id === saved.id ? saved : item)))}
                  onVersionUploaded={(saved) => { onChange((files) => files.map((item) => (item.id === saved.id ? saved : item))); toast.success(`Uploaded version ${saved.version_number} of ${saved.title}`) }}
                  note={file.uploaded_by_role === 'student' ? 'Added by student' : 'Shared by staff'}
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
        </div>
        {inspectedFile && (
          <DriveInspectorDrawer
            cohortId={cohortId}
            file={inspectedFile}
            folderOptions={presets}
            downloadDisabled={!storage}
            review={STAFF_REVIEW}
            desktopBreakpoint="xl"
            onClose={() => setInspectedId(null)}
            onOpenPreview={(item, pane = 'main') => setGridOpened({ fileId: item.id, pane })}
            onFileChange={(saved) => onChange((files) => files.map((item) => (item.id === saved.id ? saved : item)))}
          />
        )}
      </div>
      {gridOpenedFile && gridOpenedFile.kind === 'doc' && (
        <CohortDocEditorModal
          key={`${cohortId}-${gridOpenedFile.id}`}
          cohortId={cohortId}
          file={gridOpenedFile}
          open
          onClose={() => setGridOpened(null)}
          reviewAccess={STAFF_REVIEW}
          initialPane={gridOpened?.pane === 'review' ? 'review' : 'doc'}
          onFileChange={(saved) => onChange((files) => files.map((item) => (item.id === saved.id ? saved : item)))}
        />
      )}
      {gridOpenedFile && gridOpenedFile.kind === 'file' && (gridOpened?.pane !== 'review' || (gridOpenedFile.previewable && storage)) && (
        <CohortFilePreviewModal
          key={`${cohortId}-${gridOpenedFile.id}`}
          cohortId={cohortId}
          file={gridOpenedFile}
          open
          onClose={() => setGridOpened(null)}
          downloadDisabled={!storage}
          review={STAFF_REVIEW}
          initialPane={gridOpened?.pane === 'review' ? 'review' : 'preview'}
          onFileChange={(saved) => onChange((files) => files.map((item) => (item.id === saved.id ? saved : item)))}
          onPrev={previewIndex > 0 ? () => setGridOpened({ fileId: previewableShown[previewIndex - 1].id, pane: 'main' }) : undefined}
          onNext={previewIndex >= 0 && previewIndex < previewableShown.length - 1 ? () => setGridOpened({ fileId: previewableShown[previewIndex + 1].id, pane: 'main' }) : undefined}
          positionLabel={previewIndex >= 0 && previewableShown.length > 1 ? `${previewIndex + 1} of ${previewableShown.length}` : undefined}
        />
      )}
      {gridOpenedFile && gridOpened?.pane === 'review' && gridOpenedFile.kind !== 'doc' && !(gridOpenedFile.kind === 'file' && gridOpenedFile.previewable && storage) && isStudentFolderItem(gridOpenedFile) && (
        <CohortFileReviewModal
          key={`${cohortId}-${gridOpenedFile.id}-review`}
          cohortId={cohortId}
          file={gridOpenedFile}
          access={STAFF_REVIEW}
          open
          onClose={() => setGridOpened(null)}
          onFileChange={(saved) => onChange((files) => files.map((item) => (item.id === saved.id ? saved : item)))}
        />
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
    <StudentFolderView key={`${cohortId}-${studentId}`} cohortId={cohortId} folder={folder} storage={data.storage_configured}
      onChange={(update) => setData((current) => current && {
        ...current,
        student_folders: (current.student_folders || []).map((item) => (item.student_id === studentId ? withFolderFiles(item, update(item.files)) : item)),
      })} />
  )
}
