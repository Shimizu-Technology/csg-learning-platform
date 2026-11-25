import type { CsgApi } from './api';
import type { components } from './api.generated';
import { formatFileSize } from './attachments';

export type CohortFile = components['schemas']['CohortFile'];
export type CohortStudentFolder = components['schemas']['CohortStudentFolder'];
export type CohortFilePreview = components['schemas']['CohortFilePreviewResponse'];
export type LinkProvider = NonNullable<CohortFile['link_provider']>;

export const MAX_COHORT_FILE_SIZE = 100 * 1024 * 1024;
/** Mirrors CohortFile::ALLOWED_TYPES on the API, which also refuses pages, SVGs and scripts. */
export const COHORT_FILE_EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'csv', 'txt', 'md', 'zip', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'm4a', 'mp4']);
export const STUDENT_FOLDER_PRESETS = ['Job Search & Career', 'Resumes & Portfolio', 'Class Notes', 'General'];
export const CLASS_FOLDER_PRESETS = ['Slides', 'Guides & Handouts', 'Career & Job Search', 'Starter Kits', 'General'];
export const LINK_PROVIDER_LABELS: Record<LinkProvider, string> = {
  google_doc: 'Google Doc', google_sheet: 'Google Sheet', google_slides: 'Google Slides', google_drive: 'Google Drive',
  figma: 'Figma', notion: 'Notion', canva: 'Canva', loom: 'Loom', github: 'GitHub', web: 'Link',
};

/**
 * Loads a cohort's files, or null once access is gone (401/403), so a revoked
 * viewer never keeps seeing a folder from memory. Callers also opt out of
 * offline persistence (`meta: { persist: false }`).
 */
export async function loadCohortFiles(api: CsgApi, cohortId: number, signal?: AbortSignal) {
  try {
    return await api.cohortFiles(cohortId, signal);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) return null;
    throw error;
  }
}

export type PickedFile = { uri: string; name?: string | null; size?: number | null; mimeType?: string | null };

export function fileExtension(filename: string) {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export function cohortFileMeta(file: Pick<CohortFile, 'kind' | 'filename' | 'file_size' | 'folder' | 'external_url'>) {
  if (file.kind === 'link') return `${linkHost(file.external_url)} · ${file.folder}`;
  return `${file.filename} · ${formatFileSize(file.file_size || 0)} · ${file.folder}`;
}

export function linkHost(url: string | null) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

/** A saved link or storage URL, only if it is https. */
export function safeHttpsUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Quick check before saving a link; the API also refuses local and private addresses. */
export function linkUrlProblem(url: string) {
  const value = url.trim();
  if (!value) return 'Paste a link.';
  if (!/^https:\/\//i.test(value)) return 'Links must start with https://';
  try {
    if (!new URL(value).hostname.includes('.')) return 'Use a full web address, like https://docs.google.com/…';
  } catch {
    return "That doesn't look like a web address.";
  }
  return value.length > 2048 ? 'That link is too long.' : null;
}

export function matchesCohortFile(file: CohortFile, needle: string) {
  return `${file.title} ${file.filename || ''} ${file.folder} ${file.description || ''} ${file.external_url || ''}`.toLowerCase().includes(needle);
}

/** Minimal CSV parsing for previews: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string, maxRows = 200) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length && rows.length < maxRows; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += char;
  }
  if (rows.length < maxRows && (field !== '' || row.length)) { row.push(field); rows.push(row); }
  return rows;
}

/** Folder name => files, folders sorted by name. */
export function groupByFolder(files: CohortFile[]) {
  const groups = new Map<string, CohortFile[]>();
  files.forEach((file) => groups.set(file.folder, [...(groups.get(file.folder) || []), file]));
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function validatePickedFile(asset: PickedFile) {
  const filename = asset.name?.trim() || 'file';
  const size = asset.size || 0;
  if (!COHORT_FILE_EXTENSIONS.has(fileExtension(filename))) throw new Error(`${filename} can't be uploaded. Use a PDF, Office document, spreadsheet, slides, text, ZIP, image, audio or MP4 file.`);
  if (size <= 0) throw new Error(`We could not read the size of ${filename}.`);
  if (size > MAX_COHORT_FILE_SIZE) throw new Error(`${filename} is larger than the 100 MB limit.`);
  return { filename, size, contentType: asset.mimeType || '' };
}

/** Presign, post the file straight to storage, then publish it. Abandons the still-pending file if any step fails. */
export async function uploadToMyFolder(api: CsgApi, cohortId: number, asset: PickedFile, folder: string, onProgress: (progress: number) => void) {
  const { filename, size, contentType } = validatePickedFile(asset);
  const started = await api.createCohortFile(cohortId, { filename, content_type: contentType, file_size: size, folder });
  try {
    // The presigned policy pins the stored type; send the file as that type.
    await postPresignedFile(started.upload_url, started.fields, { uri: asset.uri, name: filename, type: started.fields['Content-Type'] || started.file.content_type || contentType }, onProgress);
    return (await api.completeCohortFile(cohortId, started.file.id)).file;
  } catch (error) {
    // pending_only: a publish whose response was lost is never deleted.
    void api.deleteCohortFile(cohortId, started.file.id, { pendingOnly: true }).catch(() => undefined);
    throw error;
  }
}

function postPresignedFile(url: string, fields: Record<string, string>, file: { uri: string; name: string; type: string }, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.timeout = 300_000;
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.max(0, Math.min(1, event.loaded / event.total))); };
    request.onerror = () => reject(new Error(`Could not upload ${file.name}. Check your connection and try again.`));
    request.ontimeout = () => reject(new Error(`${file.name} took too long to upload.`));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) { onProgress(1); resolve(); }
      else reject(new Error(`Could not upload ${file.name} (${request.status}).`));
    };
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    form.append('file', file as unknown as Blob);
    request.send(form);
  });
}
