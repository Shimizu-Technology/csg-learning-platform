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

/** Mirrors CohortFile::NON_PUBLIC_IPV4 on the API: [first address, prefix length]. */
const NON_PUBLIC_IPV4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const PUBLIC_HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

function ipv4Number(address: string) {
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]
    : null
}

function nonPublicIpv4(address: string) {
  const value = ipv4Number(address)
  if (value === null) return true
  return NON_PUBLIC_IPV4.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(ipv4Number(base)! / 2 ** (32 - bits)))
}

/** Mirrors CohortFile::NON_PUBLIC_IPV6: IANA special-use blocks inside 2000::/3. */
const NON_PUBLIC_IPV6: Array<[string, number]> = [
  ['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
]

/** The eight 16-bit groups of an IPv6 address (with "::" and a trailing dotted IPv4 expanded), or null. */
export function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase()
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const value = ipv4Number(dotted[2])
    if (value === null) return null
    text = `${dotted[1]}${Math.floor(value / 65536).toString(16)}:${(value % 65536).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part ? part.split(':') : [])
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  return groups.every((group) => /^[0-9a-f]{1,4}$/.test(group)) ? groups.map((group) => parseInt(group, 16)) : null
}

function inIpv6Prefix(groups: number[], base: string, bits: number) {
  const prefix = ipv6Groups(base)!
  for (let index = 0; index < 8 && bits > 0; index += 1, bits -= 16) {
    const mask = bits >= 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff
    if ((groups[index] & mask) !== (prefix[index] & mask)) return false
  }
  return true
}

/** IPv6 must be global unicast (2000::/3) outside special-use blocks; IPv4-mapped ones are checked as IPv4. */
function nonPublicIpv6(address: string) {
  const groups = ipv6Groups(address)
  if (!groups) return true
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return nonPublicIpv4([groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.'))
  }
  return !(groups[0] >= 0x2000 && groups[0] <= 0x3fff) || NON_PUBLIC_IPV6.some(([base, bits]) => inIpv6Prefix(groups, base, bits))
}

/**
 * The reason a link isn't a public https address, or null. Mirrors
 * CohortFile.link_problem: https only, no credentials, ASCII authority with
 * no percent-encoding, a dotted public name or a public IP.
 */
export function publicHttpsProblem(url: string) {
  const value = url.trim()
  if (!/^https:\/\//i.test(value)) return 'Links must start with https://'
  const authority = value.slice(8).match(/^[^/?#]*/)?.[0] || ''
  if (authority.includes('@')) return 'Links can\'t include a username or password.'
  // eslint-disable-next-line no-control-regex
  if (/[^\x21-\x7e]|[%\\]/.test(authority)) return 'Use a public web address.'
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return 'That doesn\'t look like a web address.'
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  // The browser rewrites shorthand and encoded addresses ("2130706433", "0x7f.1") to a dotted IP; the API refuses those as ambiguous.
  const typed = authority.toLowerCase().replace(/:\d*$/, '').replace(/\.$/, '')
  if (!typed.startsWith('[') && typed !== host) return 'Use a public web address.'
  if (host.startsWith('[')) return nonPublicIpv6(host.slice(1, -1)) ? 'Use a public web address.' : null
  if (/^[\d.]+$/.test(host)) return nonPublicIpv4(host) ? 'Use a public web address.' : null
  if (/(^|\.)(localhost|local|internal|home\.arpa)$/.test(host) || !PUBLIC_HOSTNAME.test(host)) return 'Use a full public web address, like https://docs.google.com/…'
  return null
}

/** A quick client-side check before saving a link; the API makes the same checks. */
export function linkUrlProblem(url: string) {
  const value = url.trim()
  if (!value) return 'Paste a link.'
  if (value.length > 2048) return 'That link is too long.'
  return publicHttpsProblem(value)
}

/** The host of a link without "www.", for the row's details line. */
export function linkHost(url: string | null) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

/** A saved link, ready to open in a new tab, or null unless it is a public https address. */
export function safeExternalFileUrl(url: string | null) {
  const href = url ? sanitizeUrl(url) : '#'
  return /^https:\/\//i.test(href) && !publicHttpsProblem(href) ? href : null
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
 * Where a resumable upload got to: the pending file (or version) it created,
 * its presigned POST and when it was signed, the details it was created
 * with, and whether the bytes reached storage. Retrying with the same state
 * replays only the missing steps, so a lost `complete` response is confirmed
 * on the same id instead of creating a second file or version.
 */
export interface CohortUploadState {
  fileId?: number
  versionId?: number
  upload?: { url: string; fields: Record<string, string> }
  uploaded?: boolean
  startedAt?: number
  details?: string
}

/** Presigned POSTs last an hour; resume one only well inside that. */
export const UPLOAD_RESUME_WINDOW_MS = 55 * 60 * 1000

/** The pending record is gone or its upload window closed: start over. */
function uploadExpired(result: { status?: number; error: string | null }) {
  return result.status === 404 || result.status === 410 || (result.status === 422 && /expired/i.test(result.error || ''))
}

function stale(state: CohortUploadState) {
  return !state.startedAt || Date.now() - state.startedAt > UPLOAD_RESUME_WINDOW_MS
}

class UploadExpiredError extends Error {}

/**
 * Presign, upload straight to storage, then publish. Without `state`, a
 * failure abandons the pending file with `pendingOnly` (a publish whose
 * response was lost is never deleted). With `state`, the caller keeps it for
 * Retry and abandons it with `abandonCohortUpload` when the file is removed.
 * A retry whose upload window closed, or whose details changed before the
 * bytes were sent, starts a fresh upload; details changed after the bytes
 * were sent are saved on the pending file before it publishes.
 */
export async function uploadCohortFile(cohortId: number, file: File, options: CohortFileUploadOptions, onProgress?: (progress: UploadProgress) => void, state?: CohortUploadState): Promise<CohortFile> {
  const progress: CohortUploadState = state || {}
  const details = {
    title: options.title?.trim() || titleFromFilename(file.name),
    folder: options.folder,
    description: options.description?.trim() || '',
    ...(options.visibility ? { visibility: options.visibility } : {}),
  }
  const signature = JSON.stringify(details)
  if (progress.fileId && (stale(progress) || (!progress.uploaded && progress.details !== signature))) {
    await abandonCohortUpload(cohortId, progress)
  }
  const resuming = Boolean(progress.fileId)
  if (!progress.fileId || !progress.upload) {
    const started = await api.createCohortFile(cohortId, {
      filename: file.name,
      content_type: file.type,
      file_size: file.size,
      title: details.title,
      folder: details.folder,
      ...(details.description ? { description: details.description } : {}),
      ...(options.visibility ? { visibility: options.visibility } : {}),
      ...(options.studentId ? { student_id: options.studentId } : {}),
    })
    if (!started.data) throw new Error(started.error || 'Could not start the upload.')
    Object.assign(progress, { fileId: started.data.file.id, upload: { url: started.data.upload_url, fields: started.data.fields }, uploaded: false, startedAt: Date.now(), details: signature })
  }
  try {
    if (!progress.uploaded) {
      await uploadToS3(progress.upload!.url, progress.upload!.fields, file, onProgress)
      progress.uploaded = true
    }
    if (progress.details !== signature) {
      const saved = await api.updateCohortFile(cohortId, progress.fileId!, details)
      if (!saved.data) throw new Error(saved.error || 'Could not save the new details.')
      progress.details = signature
    }
    const completed = await api.completeCohortFile(cohortId, progress.fileId!)
    if (!completed.data) {
      if (resuming && uploadExpired(completed)) throw new UploadExpiredError(completed.error || 'Upload expired')
      throw new Error(completed.error || 'The upload could not be saved.')
    }
    return completed.data.file
  } catch (cause) {
    if (cause instanceof UploadExpiredError) {
      // The saved pending file can't publish any more: start over once with the current details.
      await abandonCohortUpload(cohortId, progress)
      return uploadCohortFile(cohortId, file, options, onProgress, progress)
    }
    if (!state) void abandonCohortUpload(cohortId, progress).catch(() => undefined)
    throw cause
  }
}

/**
 * Abandons a resumable upload's pending file and clears the state. A file
 * that is already gone (404) or already published (422) needs nothing more;
 * any other failure throws, so the caller can keep the row and say so.
 */
export async function abandonCohortUpload(cohortId: number, state: CohortUploadState) {
  if (state.fileId) {
    const result = await api.deleteCohortFile(cohortId, state.fileId, { pendingOnly: true })
    if (result.error && result.status !== 404 && result.status !== 422) throw new Error(result.error)
  }
  for (const key of Object.keys(state) as Array<keyof CohortUploadState>) delete state[key]
}

/**
 * Starts a new version of a published file, uploads it, then publishes it.
 * Pass the same `state` to retry: it confirms the same pending version. A
 * retry whose upload window closed or whose note changed starts a fresh
 * version; an abandoned one stays pending until its presigned POST expires
 * and is then purged.
 */
export async function uploadCohortFileVersion(cohortId: number, fileId: number, file: File, note: string, onProgress?: (progress: UploadProgress) => void, state: CohortUploadState = {}): Promise<CohortFile> {
  const signature = note.trim()
  if (state.versionId && (stale(state) || state.details !== signature)) for (const key of Object.keys(state) as Array<keyof CohortUploadState>) delete state[key]
  const resuming = Boolean(state.versionId)
  if (!state.versionId || !state.upload) {
    const started = await api.createCohortFileVersion(cohortId, fileId, {
      filename: file.name,
      content_type: file.type,
      file_size: file.size,
      ...(signature ? { note: signature } : {}),
    })
    if (!started.data) throw new Error(started.error || 'Could not start the upload.')
    Object.assign(state, { versionId: started.data.version.id, upload: { url: started.data.upload_url, fields: started.data.fields }, uploaded: false, startedAt: Date.now(), details: signature })
  }
  if (!state.uploaded) {
    await uploadToS3(state.upload!.url, state.upload!.fields, file, onProgress)
    state.uploaded = true
  }
  const completed = await api.completeCohortFileVersion(cohortId, fileId, state.versionId!)
  if (!completed.data) {
    if (resuming && uploadExpired(completed)) {
      for (const key of Object.keys(state) as Array<keyof CohortUploadState>) delete state[key]
      return uploadCohortFileVersion(cohortId, fileId, file, note, onProgress, state)
    }
    throw new Error(completed.error || 'The new version could not be saved.')
  }
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

/** How much of a CSV a preview renders, so a very wide or long file can't freeze the screen. */
export const CSV_PREVIEW_LIMITS = { rows: 200, columns: 50, cellLength: 200 }

/**
 * Minimal RFC 4180 CSV parsing for previews (quoted fields, escaped quotes,
 * CRLF), bounded by CSV_PREVIEW_LIMITS: extra rows and columns are dropped and
 * long cells end with "…". The flags say what was cut.
 */
export function parseCsv(text: string, limits = CSV_PREVIEW_LIMITS) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let clippedColumns = false
  const add = (char: string) => { if (field.length <= limits.cellLength) field += char }
  const endField = () => {
    if (row.length < limits.columns) row.push(field.length > limits.cellLength ? `${field.slice(0, limits.cellLength)}…` : field)
    else clippedColumns = true
    field = ''
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { add('"'); index += 1 }
      else if (char === '"') quoted = false
      else add(char)
    } else if (char === '"' && field === '') quoted = true
    else if (char === ',') endField()
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      endField()
      rows.push(row)
      row = []
      if (rows.length >= limits.rows) return { rows, clippedRows: index < text.length - 1, clippedColumns }
    } else add(char)
  }
  if (field !== '' || row.length) { endField(); rows.push(row) }
  return { rows, clippedRows: false, clippedColumns }
}
