import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createCohortFile: vi.fn(), completeCohortFile: vi.fn(), deleteCohortFile: vi.fn(), uploadToS3: vi.fn() }))
vi.mock('./api', () => ({ api: mocks }))
vi.mock('./uploadToS3', () => ({ uploadToS3: mocks.uploadToS3 }))
import { cohortFileProblem, fileTypeIcon, titleFromFilename, uploadCohortFile } from './cohortFiles'

const pending = { id: 7, title: 'resume' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCohortFile.mockResolvedValue({ data: { file: pending, upload_url: 'https://storage.test/upload', fields: { key: 'k' } }, error: null })
  mocks.deleteCohortFile.mockResolvedValue({ data: null, error: null })
})

it('refuses pages, scripts and oversized files before asking the API', () => {
  expect(cohortFileProblem(new File(['<p>'], 'page.html'))).toContain("can't be uploaded")
  expect(cohortFileProblem(new File(['<svg/>'], 'logo.svg'))).toContain("can't be uploaded")
  expect(cohortFileProblem(new File([''], 'empty.pdf'))).toContain('is empty')
  expect(cohortFileProblem(new File(['x'], 'guide.PDF'))).toBeNull()
  expect(titleFromFilename('week-1_ruby  slides.pdf')).toBe('week 1 ruby slides')
  expect(fileTypeIcon('plan.xlsx')).not.toBe(fileTypeIcon('plan.pdf'))
})

it('uploads to the presigned form, publishes, and sends the folder and student', async () => {
  mocks.uploadToS3.mockResolvedValue(undefined)
  mocks.completeCohortFile.mockResolvedValue({ data: { file: { ...pending, ready: true } }, error: null })
  const file = new File(['resume'], 'resume.pdf', { type: 'application/pdf' })
  const saved = await uploadCohortFile(4, file, { folder: 'Resumes & Portfolio', studentId: 3, title: ' ' })
  expect(mocks.createCohortFile).toHaveBeenCalledWith(4, { filename: 'resume.pdf', content_type: 'application/pdf', file_size: 6, title: 'resume', folder: 'Resumes & Portfolio', student_id: 3 })
  expect(mocks.uploadToS3).toHaveBeenCalledWith('https://storage.test/upload', { key: 'k' }, file, undefined)
  expect(saved).toEqual({ ...pending, ready: true })
  expect(mocks.deleteCohortFile).not.toHaveBeenCalled()
})

it('abandons the pending file when the upload fails', async () => {
  mocks.uploadToS3.mockRejectedValue(new Error('Network down'))
  await expect(uploadCohortFile(4, new File(['x'], 'notes.md'), { folder: 'Class Notes' })).rejects.toThrow('Network down')
  expect(mocks.deleteCohortFile).toHaveBeenCalledWith(4, 7)
  expect(mocks.completeCohortFile).not.toHaveBeenCalled()
})
