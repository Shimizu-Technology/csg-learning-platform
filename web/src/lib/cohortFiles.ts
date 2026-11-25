import { FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation, type LucideIcon } from 'lucide-react'
import type { components } from '../types/api.generated'
import { api } from './api'
import { sanitizeUrl } from './sanitizeUrl'
import { uploadToS3, type UploadProgress } from './uploadToS3'

export type CohortFile = components['schemas']['CohortFile']
export type CohortStudentFolder = components['schemas']['CohortStudentFolder']
export type CohortFilesResponse = components['schemas']['CohortFilesResponse']

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

export function matchesFileQuery(file: CohortFile, query: string) {
  const q = query.trim().toLowerCase()
  return !q || [file.title, file.filename, file.folder, file.description || ''].some((value) => value.toLowerCase().includes(q))
}

export interface CohortFileUploadOptions {
  title?: string
  folder: string
  description?: string
  visibility?: 'students' | 'staff_only'
  studentId?: number | null
}

/** Presign, upload straight to storage, then publish. Abandons the pending row if the upload fails. */
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
    void api.deleteCohortFile(cohortId, pending.id)
    throw cause
  }
}

export async function downloadCohortFile(cohortId: number, file: Pick<CohortFile, 'id' | 'filename'>) {
  const result = await api.downloadCohortFile(cohortId, file.id)
  if (!result.data) throw new Error(result.error || 'Could not download this file.')
  const url = sanitizeUrl(result.data.url)
  if (!url.startsWith('https://')) throw new Error('File storage returned an invalid download link.')
  const link = document.createElement('a')
  link.href = url
  link.download = result.data.filename || file.filename
  link.rel = 'noreferrer'
  link.click()
}
