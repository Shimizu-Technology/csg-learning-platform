import {
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  NotebookPen,
  Presentation,
  type LucideIcon,
} from 'lucide-react'
import { fileExtension, isStudentFolderItem, LINK_PROVIDERS, type CohortFile } from './cohortFiles'

export type DriveViewMode = 'list' | 'grid'
export type DriveSort = 'updated_desc' | 'name_asc' | 'name_desc' | 'size_desc' | 'type'
export type DriveTypeFilter = 'all' | 'doc' | 'file' | 'link' | 'needs_review'

export interface DriveFolderSummary {
  name: string
  count: number
  needsReviewCount: number
  staffOnlyCount: number
  latestAt: string | null
}

export type DriveVisualTone = 'brand' | 'info' | 'success' | 'warning' | 'neutral'

const VIEW_STORAGE_KEY = 'csg-drive-view'

export function readStoredDriveView(): DriveViewMode {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

export function saveStoredDriveView(mode: DriveViewMode) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, mode)
  } catch {
    // Ignore storage unavailability (private browsing, sandboxed tests).
  }
}

export function fileTimestamp(file: Pick<CohortFile, 'doc_updated_at' | 'ready_at' | 'created_at'>): number {
  const raw = file.doc_updated_at || file.ready_at || file.created_at
  const parsed = raw ? Date.parse(raw) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

export function fileTimestampIso(file: Pick<CohortFile, 'doc_updated_at' | 'ready_at' | 'created_at'>): string | null {
  return file.doc_updated_at || file.ready_at || file.created_at || null
}

export function fileVisualMeta(file: Pick<CohortFile, 'kind' | 'filename' | 'link_provider'>): {
  icon: LucideIcon
  tone: DriveVisualTone
  badgeLabel: string
} {
  if (file.kind === 'doc') {
    return { icon: NotebookPen, tone: 'brand', badgeLabel: 'DOC' }
  }
  if (file.kind === 'link') {
    const provider = LINK_PROVIDERS[file.link_provider || 'web']
    return { icon: provider.icon, tone: 'info', badgeLabel: provider.label }
  }
  const ext = fileExtension(file.filename || '')
  if (ext === 'pdf') return { icon: FileText, tone: 'brand', badgeLabel: 'PDF' }
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return { icon: FileSpreadsheet, tone: 'success', badgeLabel: ext.toUpperCase() }
  if (ext === 'pptx' || ext === 'ppt') return { icon: Presentation, tone: 'warning', badgeLabel: ext.toUpperCase() }
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') return { icon: FileImage, tone: 'info', badgeLabel: ext.toUpperCase() }
  if (ext === 'mp4') return { icon: FileVideo, tone: 'info', badgeLabel: 'MP4' }
  if (ext === 'mp3' || ext === 'm4a') return { icon: FileAudio, tone: 'info', badgeLabel: ext.toUpperCase() }
  if (ext === 'zip') return { icon: FileArchive, tone: 'neutral', badgeLabel: 'ZIP' }
  return { icon: FileText, tone: 'neutral', badgeLabel: ext ? ext.toUpperCase() : 'FILE' }
}

export function driveToneSurface(tone: DriveVisualTone): string {
  switch (tone) {
    case 'brand':
      return 'bg-primary-soft text-primary-ink border-primary-soft-line'
    case 'info':
      return 'bg-info-soft text-info-ink border-info-line'
    case 'success':
      return 'bg-success-soft text-success-ink border-success-line'
    case 'warning':
      return 'bg-warning-soft text-warning-ink border-warning-line'
    default:
      return 'bg-surface-sunken text-ink-secondary border-line'
  }
}

export function matchesDriveTypeFilter(file: CohortFile, filter: DriveTypeFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'needs_review') return isStudentFolderItem(file) && file.review_status === 'needs_review'
  return file.kind === filter
}

export function sortDriveFiles(files: CohortFile[], sort: DriveSort): CohortFile[] {
  const copy = [...files]
  copy.sort((a, b) => {
    switch (sort) {
      case 'name_asc':
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      case 'name_desc':
        return b.title.localeCompare(a.title, undefined, { sensitivity: 'base' })
      case 'size_desc':
        return (b.file_size || 0) - (a.file_size || 0) || a.title.localeCompare(b.title)
      case 'type': {
        const typeA = `${a.kind}:${fileExtension(a.filename || '')}:${a.link_provider || ''}`
        const typeB = `${b.kind}:${fileExtension(b.filename || '')}:${b.link_provider || ''}`
        return typeA.localeCompare(typeB) || a.title.localeCompare(b.title)
      }
      case 'updated_desc':
      default:
        return fileTimestamp(b) - fileTimestamp(a) || a.title.localeCompare(b.title)
    }
  })
  return copy
}

export function summarizeFolders(files: CohortFile[]): DriveFolderSummary[] {
  const map = new Map<string, DriveFolderSummary>()
  for (const file of files) {
    const existing = map.get(file.folder)
    const needsReview = isStudentFolderItem(file) && file.review_status === 'needs_review' ? 1 : 0
    const staffOnly = file.visibility === 'staff_only' ? 1 : 0
    const iso = fileTimestampIso(file)
    if (!existing) {
      map.set(file.folder, {
        name: file.folder,
        count: 1,
        needsReviewCount: needsReview,
        staffOnlyCount: staffOnly,
        latestAt: iso,
      })
    } else {
      existing.count += 1
      existing.needsReviewCount += needsReview
      existing.staffOnlyCount += staffOnly
      if (iso && (!existing.latestAt || Date.parse(iso) > Date.parse(existing.latestAt))) {
        existing.latestAt = iso
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export function recentDriveFiles(files: CohortFile[], limit = 4): CohortFile[] {
  return sortDriveFiles(files, 'updated_desc').slice(0, limit)
}

export const DRIVE_DRAG_MIME = 'application/x-csg-drive-file-id'
