import {
  Code, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, HardDrive, Link2, NotebookText, Palette, PenTool, Presentation, Video,
  type LucideIcon,
} from 'lucide-react'
import type { components } from '../types/api.generated'
import { api } from './api'
import { sanitizeUrl } from './sanitizeUrl'
import { uploadToS3, type UploadProgress } from './uploadToS3'

export type CohortFile = components['schemas']['CohortFile']
export type CohortStudentFolder = components['schemas']['CohortStudentFolder']
export type CohortFilesResponse = components['schemas']['CohortFilesResponse']
export type CohortFileVersion = components['schemas']['CohortFileVersion']
export type CohortFilePreview = components['schemas']['CohortFilePreviewResponse']
export type LinkProvider = NonNullable<CohortFile['link_provider']>

export const MAX_COHORT_FILE_SIZE = 100 * 1024 * 1024
/** Mirrors CohortFile::ALLOWED_TYPES on the API. Pages, SVGs and scripts are refused there too. */
export const COHORT_FILE_EXTENSIONS = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'csv', 'txt', 'md', 'zip', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'm4a', 'mp4']
export const COHORT_FILE_ACCEPT = COHORT_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(',')
export const CLASS_FOLDER_PRESETS = ['Slides', 'Guides & Handouts', 'Career & Job Search', 'Starter Kits', 'General']
export const STUDENT_FOLDER_PRESETS = ['Job Search & Career', 'Resumes & Portfolio', 'Class Notes', 'General']

export function fileExtension(filename: string) {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/** A friendly title from a filename: "week-1_ruby slides.pdf" becomes "week 1 ruby slides". */
export function titleFromFilename(filename: string) {
  const dot = filename.lastIndexOf('.')
  return (dot > 0 ? filename.slice(0, dot) : filename).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
}

/** The reason this file can't be uploaded, or null. */
export function cohortFileProblem(file: File) {
  if (!COHORT_FILE_EXTENSIONS.includes(fileExtension(file.name))) {
    return `${file.name} can't be uploaded. Use a PDF, Word, Excel, PowerPoint, CSV, text, Markdown, ZIP, image, MP3, M4A or MP4 file.`
  }
  if (file.size <= 0) return `${file.name} is empty.`
  if (file.size > MAX_COHORT_FILE_SIZE) return `${file.name} is larger than the 100 MB limit.`
  return null
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** Lucide icon per file type; anything else shows FileText. */
export const FILE_TYPE_ICONS: Record<string, LucideIcon> = {
  xlsx: FileSpreadsheet, xls: FileSpreadsheet, csv: FileSpreadsheet,
  pptx: Presentation, ppt: Presentation,
  zip: FileArchive,
  png: FileImage, jpg: FileImage, jpeg: FileImage, webp: FileImage,
  mp3: FileAudio, m4a: FileAudio,
  mp4: FileVideo,
}

export function fileTypeIcon(filename: string): LucideIcon {
  return FILE_TYPE_ICONS[fileExtension(filename)] || FileText
}

export const LINK_PROVIDERS: Record<LinkProvider, { label: string; icon: LucideIcon }> = {
  google_doc: { label: 'Google Doc', icon: FileText },
  google_sheet: { label: 'Google Sheet', icon: FileSpreadsheet },
  google_slides: { label: 'Google Slides', icon: Presentation },
  google_drive: { label: 'Google Drive', icon: HardDrive },
  figma: { label: 'Figma', icon: PenTool },
  notion: { label: 'Notion', icon: NotebookText },
  canva: { label: 'Canva', icon: Palette },
  loom: { label: 'Loom', icon: Video },
  github: { label: 'GitHub', icon: Code },
  web: { label: 'Link', icon: Link2 },
}

/** Mirrors CohortFile::LINK_PROVIDERS for the live preview while typing; the API decides what is saved. */
export function linkProviderFor(url: string): LinkProvider {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return 'web'
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  if (on('docs.google.com')) {
    if (parsed.pathname.startsWith('/document/')) return 'google_doc'
    if (parsed.pathname.startsWith('/spreadsheets/')) return 'google_sheet'
    if (parsed.pathname.startsWith('/presentation/')) return 'google_slides'
    return 'google_drive'
  }
  if (on('drive.google.com')) return 'google_drive'
  if (on('figma.com')) return 'figma'
  if (on('notion.so') || on('notion.site')) return 'notion'
  if (on('canva.com')) return 'canva'
  if (on('loom.com')) return 'loom'
  if (on('github.com')) return 'github'
  return 'web'
}

/** A quick client-side check before saving a link; the API also refuses private and local addresses. */
export function linkUrlProblem(url: string) {
  const value = url.trim()
  if (!value) return 'Paste a link.'
  if (!/^https:\/\//i.test(value)) return 'Links must start with https://'
  try {
    if (!new URL(value).hostname.includes('.')) return 'Use a full web address, like https://docs.google.com/…'
  } catch {
    return 'That doesn\'t look like a web address.'
  }
  if (value.length > 2048) return 'That link is too long.'
  return null
}

/** The host of a link without "www.", for the row's details line. */
export function linkHost(url: string | null) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

/** A saved link, ready to open in a new tab, or null if it isn't https. */
export function safeLinkHref(url: string | null) {
  const href = url ? sanitizeUrl(url) : '#'
  return href.startsWith('https://') ? href : null
}

export function matchesFileQuery(file: CohortFile, query: string) {
  const q = query.trim().toLowerCase()
  return !q || [file.title, file.filename || '', file.folder, file.description || '', file.external_url || ''].some((value) => value.toLowerCase().includes(q))
}

export interface CohortFileUploadOptions {
  title?: string
  folder: string
  description?: string
  visibility?: 'students' | 'staff_only'
  studentId?: number | null
}

/**
 * Presign, upload straight to storage, then publish. If anything fails, the
 * pending file is abandoned with `pendingOnly`, so a publish whose response
 * was lost is never deleted.
 */
export async function uploadCohortFile(cohortId: number, file: File, options: CohortFileUploadOptions, onProgress?: (progress: UploadProgress) => void) {
  const started = await api.createCohortFile(cohortId, {
    filename: file.name,
    content_type: file.type,
    file_size: file.size,
    title: options.title?.trim() || titleFromFilename(file.name),
    folder: options.folder,
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    ...(options.visibility ? { visibility: options.visibility } : {}),
    ...(options.studentId ? { student_id: options.studentId } : {}),
  })
  if (!started.data) throw new Error(started.error || 'Could not start the upload.')
  const pending = started.data.file
  try {
    await uploadToS3(started.data.upload_url, started.data.fields, file, onProgress)
    const completed = await api.completeCohortFile(cohortId, pending.id)
    if (!completed.data) throw new Error(completed.error || 'The upload could not be saved.')
    return completed.data.file
  } catch (cause) {
    void api.deleteCohortFile(cohortId, pending.id, { pendingOnly: true })
    throw cause
  }
}

/**
 * Starts a new version of a published file, uploads it, then publishes it.
 * A failed upload stays pending and is purged once its presigned POST expires.
 */
export async function uploadCohortFileVersion(cohortId: number, fileId: number, file: File, note: string, onProgress?: (progress: UploadProgress) => void) {
  const started = await api.createCohortFileVersion(cohortId, fileId, {
    filename: file.name,
    content_type: file.type,
    file_size: file.size,
    ...(note.trim() ? { note: note.trim() } : {}),
  })
  if (!started.data) throw new Error(started.error || 'Could not start the upload.')
  await uploadToS3(started.data.upload_url, started.data.fields, file, onProgress)
  const completed = await api.completeCohortFileVersion(cohortId, fileId, started.data.version.id)
  if (!completed.data) throw new Error(completed.error || 'The new version could not be saved.')
  return completed.data.file
}

export async function downloadCohortFile(cohortId: number, file: Pick<CohortFile, 'id' | 'filename'>, versionId?: number | null) {
  const result = await api.downloadCohortFile(cohortId, file.id, versionId)
  if (!result.data) throw new Error(result.error || 'Could not download this file.')
  const url = sanitizeUrl(result.data.url)
  if (!url.startsWith('https://')) throw new Error('File storage returned an invalid download link.')
  const link = document.createElement('a')
  link.href = url
  link.download = result.data.filename || file.filename || 'download'
  link.rel = 'noreferrer'
  link.click()
}

/** Minimal RFC 4180 CSV parsing for previews: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string, maxRows = 500) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && field === '') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field); field = ''
      rows.push(row); row = []
      if (rows.length >= maxRows) return { rows, clipped: index < text.length - 1 }
    } else field += char
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return { rows, clipped: false }
}
