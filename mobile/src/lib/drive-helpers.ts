import { fileExtension, isStudentFolderItem, LINK_PROVIDER_LABELS, type CohortFile } from './cohort-files';

export type DriveViewMode = 'list' | 'grid';
export type DriveSort = 'updated_desc' | 'name_asc' | 'size_desc';
export type DriveTypeFilter = 'all' | 'doc' | 'file' | 'link' | 'needs_review';
export type DriveVisualTone = 'brand' | 'info' | 'success' | 'warning' | 'neutral';

export interface DriveFolderSummary {
  name: string;
  count: number;
  needsReviewCount: number;
  staffOnlyCount: number;
}

export function fileTimestamp(file: Pick<CohortFile, 'doc_updated_at' | 'ready_at' | 'created_at'>): number {
  const raw = file.doc_updated_at || file.ready_at || file.created_at;
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function fileVisualMeta(file: Pick<CohortFile, 'kind' | 'filename' | 'link_provider'>): {
  kindKey: 'doc' | 'link' | 'pdf' | 'sheet' | 'slides' | 'image' | 'video' | 'audio' | 'zip' | 'file';
  tone: DriveVisualTone;
  badgeLabel: string;
} {
  if (file.kind === 'doc') return { kindKey: 'doc', tone: 'brand', badgeLabel: 'DOC' };
  if (file.kind === 'link') {
    return { kindKey: 'link', tone: 'info', badgeLabel: LINK_PROVIDER_LABELS[file.link_provider || 'web'] };
  }
  const ext = fileExtension(file.filename || '');
  if (ext === 'pdf') return { kindKey: 'pdf', tone: 'brand', badgeLabel: 'PDF' };
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return { kindKey: 'sheet', tone: 'success', badgeLabel: ext.toUpperCase() };
  if (ext === 'pptx' || ext === 'ppt') return { kindKey: 'slides', tone: 'warning', badgeLabel: ext.toUpperCase() };
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') return { kindKey: 'image', tone: 'info', badgeLabel: ext.toUpperCase() };
  if (ext === 'mp4') return { kindKey: 'video', tone: 'info', badgeLabel: 'MP4' };
  if (ext === 'mp3' || ext === 'm4a') return { kindKey: 'audio', tone: 'info', badgeLabel: ext.toUpperCase() };
  if (ext === 'zip') return { kindKey: 'zip', tone: 'neutral', badgeLabel: 'ZIP' };
  return { kindKey: 'file', tone: 'neutral', badgeLabel: ext ? ext.toUpperCase() : 'FILE' };
}

export function matchesDriveTypeFilter(file: CohortFile, filter: DriveTypeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'needs_review') return isStudentFolderItem(file) && file.review_status === 'needs_review';
  return file.kind === filter;
}

export function sortDriveFiles(files: CohortFile[], sort: DriveSort): CohortFile[] {
  const copy = [...files];
  copy.sort((a, b) => {
    if (sort === 'name_asc') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    if (sort === 'size_desc') return (b.file_size || 0) - (a.file_size || 0) || a.title.localeCompare(b.title);
    return fileTimestamp(b) - fileTimestamp(a) || a.title.localeCompare(b.title);
  });
  return copy;
}

export function summarizeFolders(files: CohortFile[]): DriveFolderSummary[] {
  const map = new Map<string, DriveFolderSummary>();
  for (const file of files) {
    const existing = map.get(file.folder);
    const needsReview = isStudentFolderItem(file) && file.review_status === 'needs_review' ? 1 : 0;
    const staffOnly = file.visibility === 'staff_only' ? 1 : 0;
    if (!existing) {
      map.set(file.folder, { name: file.folder, count: 1, needsReviewCount: needsReview, staffOnlyCount: staffOnly });
    } else {
      existing.count += 1;
      existing.needsReviewCount += needsReview;
      existing.staffOnlyCount += staffOnly;
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function nextDriveSort(current: DriveSort): DriveSort {
  if (current === 'updated_desc') return 'name_asc';
  if (current === 'name_asc') return 'size_desc';
  return 'updated_desc';
}

export const DRIVE_SORT_LABELS: Record<DriveSort, string> = {
  updated_desc: 'Recent',
  name_asc: 'Name A–Z',
  size_desc: 'Size',
};
