import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createCohortFile: vi.fn(), completeCohortFile: vi.fn(), deleteCohortFile: vi.fn(), uploadToS3: vi.fn() }))
vi.mock('./api', () => ({ api: mocks }))
vi.mock('./uploadToS3', () => ({ uploadToS3: mocks.uploadToS3 }))
import { cohortFileProblem, fileTypeIcon, linkProviderFor, linkUrlProblem, matchesFileQuery, parseCsv, safeLinkHref, titleFromFilename, uploadCohortFile, type CohortFile } from './cohortFiles'

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

it('abandons only the pending file when publishing fails, never a published one', async () => {
  mocks.uploadToS3.mockResolvedValue(undefined)
  mocks.completeCohortFile.mockRejectedValue(new Error('Network lost'))
  await expect(uploadCohortFile(4, new File(['x'], 'notes.md'), { folder: 'Class Notes' })).rejects.toThrow('Network lost')
  expect(mocks.deleteCohortFile).toHaveBeenCalledWith(4, 7, { pendingOnly: true })
})

it('abandons the pending file when the upload fails', async () => {
  mocks.uploadToS3.mockRejectedValue(new Error('Network down'))
  await expect(uploadCohortFile(4, new File(['x'], 'notes.md'), { folder: 'Class Notes' })).rejects.toThrow('Network down')
  expect(mocks.deleteCohortFile).toHaveBeenCalledWith(4, 7, { pendingOnly: true })
  expect(mocks.completeCohortFile).not.toHaveBeenCalled()
})

it('checks links client side and shows their provider while typing', () => {
  expect(linkUrlProblem('')).toBe('Paste a link.')
  for (const url of ['http://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com']) expect(linkUrlProblem(url)).toBe('Links must start with https://')
  expect(linkUrlProblem('https://intranet/page')).toMatch(/full web address/)
  expect(linkUrlProblem('https://docs.google.com/document/d/x')).toBeNull()
  expect(linkProviderFor('https://docs.google.com/document/d/x/edit')).toBe('google_doc')
  expect(linkProviderFor('https://docs.google.com/spreadsheets/d/x')).toBe('google_sheet')
  expect(linkProviderFor('https://docs.google.com/presentation/d/x')).toBe('google_slides')
  expect(linkProviderFor('https://www.figma.com/design/x')).toBe('figma')
  expect(linkProviderFor('https://team.notion.site/x')).toBe('notion')
  expect(linkProviderFor('https://example.com/figma.com')).toBe('web')
  expect(safeLinkHref('javascript:alert(1)')).toBeNull()
  expect(safeLinkHref('http://example.com')).toBeNull()
  expect(safeLinkHref('https://example.com/a')).toBe('https://example.com/a')
  const link = { title: 'Brief', filename: null, folder: 'General', description: null, external_url: 'https://www.canva.com/design/x' } as unknown as CohortFile
  expect(matchesFileQuery(link, 'canva')).toBe(true)
})

it('parses CSV previews with quotes, escaped quotes and CRLF', () => {
  expect(parseCsv('name,notes\r\n"Ada, L.","said ""hi"""\nGrace,\n').rows).toEqual([['name', 'notes'], ['Ada, L.', 'said "hi"'], ['Grace', '']])
  const many = Array.from({ length: 10 }, (_, index) => `${index}`).join('\n')
  expect(parseCsv(many, 3)).toEqual({ rows: [['0'], ['1'], ['2']], clipped: true })
})
