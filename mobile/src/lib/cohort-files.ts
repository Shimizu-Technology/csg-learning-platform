import type { CsgApi } from './api';
import type { components } from './api.generated';
import { formatFileSize } from './attachments';

export type CohortFile = components['schemas']['CohortFile'];
export type CohortStudentFolder = components['schemas']['CohortStudentFolder'];

export const MAX_COHORT_FILE_SIZE = 100 * 1024 * 1024;
/** Mirrors CohortFile::ALLOWED_TYPES on the API, which also refuses pages, SVGs and scripts. */
export const COHORT_FILE_EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'csv', 'txt', 'md', 'zip', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'm4a', 'mp4']);
export const STUDENT_FOLDER_PRESETS = ['Job Search & Career', 'Resumes & Portfolio', 'Class Notes', 'General'];

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

export function cohortFileMeta(file: Pick<CohortFile, 'filename' | 'file_size' | 'folder'>) {
  return `${file.filename} · ${formatFileSize(file.file_size)} · ${file.folder}`;
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
    await postPresignedFile(started.upload_url, started.fields, { uri: asset.uri, name: filename, type: started.fields['Content-Type'] || started.file.content_type }, onProgress);
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
