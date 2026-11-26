import type { CohortFile } from '../cohort-files';
import {
  fileVisualMeta,
  matchesDriveTypeFilter,
  nextDriveSort,
  sortDriveFiles,
  summarizeFolders,
} from '../drive-helpers';

const makeFile = (overrides: Partial<CohortFile>): CohortFile => ({
  id: 1,
  cohort_id: 4,
  student_id: null,
  source_file_id: null,
  folder: 'Slides',
  visibility: 'students',
  title: 'Week 1 Slides',
  description: null,
  filename: 'week-1.pdf',
  content_type: 'application/pdf',
  file_size: 2048,
  ready: true,
  ready_at: '2026-11-24T10:00:00Z',
  created_at: '2026-11-24T10:00:00Z',
  uploaded_by_name: 'Leon Shimizu',
  uploaded_by_role: 'staff',
  can_manage: true,
  kind: 'file',
  external_url: null,
  link_provider: null,
  version_number: 1,
  previewable: true,
  preview_mode: 'pdf',
  doc_version: 1,
  doc_updated_at: null,
  doc_updated_by_name: null,
  can_edit_doc: false,
  review_status: 'none',
  reviewed_by_name: null,
  reviewed_at: null,
  comment_count: 0,
  source_curriculum_file_id: null,
  source_cohort_file_id: null,
  auto_copy_to_students: false,
  ...overrides,
});

describe('drive-helpers', () => {
  it('sorts files by recency, title, and size and cycles sort modes', () => {
    const a = makeFile({ id: 1, title: 'Bravo', file_size: 5_000, ready_at: '2026-11-20T00:00:00Z' });
    const b = makeFile({ id: 2, title: 'Alpha', file_size: 1_000, ready_at: '2026-11-26T00:00:00Z' });

    expect(sortDriveFiles([a, b], 'updated_desc').map((f) => f.id)).toEqual([2, 1]);
    expect(sortDriveFiles([a, b], 'name_asc').map((f) => f.id)).toEqual([2, 1]);
    expect(sortDriveFiles([a, b], 'size_desc').map((f) => f.id)).toEqual([1, 2]);
    expect(nextDriveSort('updated_desc')).toBe('name_asc');
    expect(nextDriveSort('name_asc')).toBe('size_desc');
    expect(nextDriveSort('size_desc')).toBe('updated_desc');
  });

  it('summarizes folders and filters by type and needs_review', () => {
    const doc = makeFile({ id: 1, folder: 'Career', kind: 'doc', student_id: 9, review_status: 'needs_review' });
    const pdf = makeFile({ id: 2, folder: 'Slides', visibility: 'staff_only' });

    expect(summarizeFolders([doc, pdf])).toEqual([
      { name: 'Career', count: 1, needsReviewCount: 1, staffOnlyCount: 0 },
      { name: 'Slides', count: 1, needsReviewCount: 0, staffOnlyCount: 1 },
    ]);
    expect(matchesDriveTypeFilter(doc, 'needs_review')).toBe(true);
    expect(matchesDriveTypeFilter(pdf, 'needs_review')).toBe(false);
    expect(fileVisualMeta(doc).kindKey).toBe('doc');
    expect(fileVisualMeta(pdf).badgeLabel).toBe('PDF');
  });
});
