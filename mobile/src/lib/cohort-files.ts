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

/** Mirrors CohortFile::NON_PUBLIC_IPV4 on the API: [first address, prefix length]. */
const NON_PUBLIC_IPV4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const PUBLIC_HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

function ipv4Number(address: string) {
  const parts = address.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) return null;
  return parts.reduce((total, part) => total * 256 + Number(part), 0);
}

function nonPublicIpv4(address: string) {
  const value = ipv4Number(address);
  if (value === null) return true;
  return NON_PUBLIC_IPV4.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(ipv4Number(base)! / 2 ** (32 - bits)));
}

/** IPv6 literals must be global unicast (2000::/3); IPv4-mapped ones are checked as IPv4. */
function nonPublicIpv6(address: string) {
  const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return nonPublicIpv4(dotted[1]);
  const mapped = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return nonPublicIpv4([high >> 8, high & 255, low >> 8, low & 255].join('.'));
  }
  if (!/^[0-9a-f:]+$/.test(address)) return true;
  const first = address.startsWith('::') ? 0 : parseInt(address.split(':')[0], 16);
  return !(first >= 0x2000 && first <= 0x3fff);
}

/**
 * The reason a link isn't a public https address, or null. Mirrors
 * CohortFile.link_problem: https only, no credentials, an ASCII authority with
 * no percent-encoding, and a dotted public name or a public IP written out in full.
 */
export function publicHttpsProblem(url: string) {
  const value = url.trim();
  if (!/^https:\/\//i.test(value)) return 'Links must start with https://';
  const authority = value.slice(8).match(/^[^/?#]*/)?.[0] || '';
  if (authority.includes('@')) return "Links can't include a username or password.";
  if (/[^\x21-\x7e]|[%\\]/.test(authority)) return 'Use a public web address.';
  const host = authority.toLowerCase().replace(/:\d*$/, '').replace(/\.$/, '');
  if (host.startsWith('[')) return host.endsWith(']') && !nonPublicIpv6(host.slice(1, -1)) ? null : 'Use a public web address.';
  if (/^[\d.]+$/.test(host)) return nonPublicIpv4(host) ? 'Use a public web address.' : null;
  if (/\.(localhost|local|internal|home\.arpa)$/.test(host) || !PUBLIC_HOSTNAME.test(host)) return 'Use a full public web address, like https://docs.google.com/…';
  return null;
}

/** Quick check before saving a link; the API makes the same checks. */
export function linkUrlProblem(url: string) {
  const value = url.trim();
  if (!value) return 'Paste a link.';
  if (value.length > 2048) return 'That link is too long.';
  return publicHttpsProblem(value);
}

/** A saved link, only if it is a public https address. */
export function safeExternalFileUrl(url: string | null | undefined) {
  return url && !publicHttpsProblem(url) ? url.trim() : null;
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
