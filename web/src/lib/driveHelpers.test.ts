import { describe, expect, it } from 'vitest'
import type { CohortFile } from './cohortFiles'
import {
  fileVisualMeta,
  matchesDriveTypeFilter,
  recentDriveFiles,
  sortDriveFiles,
  summarizeFolders,
} from './driveHelpers'

const makeFile = (overrides: Partial<CohortFile>): CohortFile => ({
  id: 1,
  cohort_id: 1,
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
})

describe('driveHelpers', () => {
  it('sorts files by updated time, name, size, and type cleanly', () => {
    const older = makeFile({ id: 1, title: 'Bravo', file_size: 5_000, ready_at: '2026-11-20T00:00:00Z' })
    const newer = makeFile({ id: 2, title: 'Alpha', file_size: 1_000, ready_at: '2026-11-26T00:00:00Z' })
    const doc = makeFile({ id: 3, kind: 'doc', title: 'Charlie Doc', file_size: null, filename: null, doc_updated_at: '2026-11-27T00:00:00Z' })

    expect(sortDriveFiles([older, newer, doc], 'updated_desc').map((f) => f.id)).toEqual([3, 2, 1])
    expect(sortDriveFiles([older, newer, doc], 'name_asc').map((f) => f.id)).toEqual([2, 1, 3])
    expect(sortDriveFiles([older, newer, doc], 'name_desc').map((f) => f.id)).toEqual([3, 1, 2])
    expect(sortDriveFiles([older, newer, doc], 'size_desc').map((f) => f.id)).toEqual([1, 2, 3])
    expect(recentDriveFiles([older, newer, doc], 2).map((f) => f.id)).toEqual([3, 2])
  })

  it('filters by item kind and student-folder needs_review status', () => {
    const doc = makeFile({ id: 1, kind: 'doc' })
    const link = makeFile({ id: 2, kind: 'link', external_url: 'https://figma.com/file/1', link_provider: 'figma' })
    const reviewItem = makeFile({ id: 3, student_id: 9, visibility: 'students', review_status: 'needs_review' })
    const staffOnly = makeFile({ id: 4, student_id: 9, visibility: 'staff_only', review_status: 'needs_review' })

    expect(matchesDriveTypeFilter(doc, 'doc')).toBe(true)
    expect(matchesDriveTypeFilter(link, 'link')).toBe(true)
    expect(matchesDriveTypeFilter(reviewItem, 'needs_review')).toBe(true)
    expect(matchesDriveTypeFilter(staffOnly, 'needs_review')).toBe(false)
  })

  it('summarizes folders with item counts, review counts, and staff-only counts', () => {
    const files = [
      makeFile({ id: 1, folder: 'Slides', visibility: 'staff_only' }),
      makeFile({ id: 2, folder: 'Slides', visibility: 'students' }),
      makeFile({ id: 3, folder: 'Career', student_id: 7, review_status: 'needs_review' }),
    ]

    expect(summarizeFolders(files)).toEqual([
      { name: 'Career', count: 1, needsReviewCount: 1, staffOnlyCount: 0, latestAt: '2026-11-24T10:00:00Z' },
      { name: 'Slides', count: 2, needsReviewCount: 0, staffOnlyCount: 1, latestAt: '2026-11-24T10:00:00Z' },
    ])
  })

  it('assigns semantic visual badges by file extension and kind', () => {
    expect(fileVisualMeta(makeFile({ kind: 'doc' })).badgeLabel).toBe('DOC')
    expect(fileVisualMeta(makeFile({ filename: 'sheet.csv' })).tone).toBe('success')
    expect(fileVisualMeta(makeFile({ filename: 'deck.pptx' })).tone).toBe('warning')
    expect(fileVisualMeta(makeFile({ filename: 'photo.png' })).tone).toBe('info')
    expect(fileVisualMeta(makeFile({ kind: 'link', link_provider: 'google_doc' })).badgeLabel).toBe('Google Doc')
  })
})
