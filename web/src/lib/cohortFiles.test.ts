import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createCohortFile: vi.fn(), completeCohortFile: vi.fn(), deleteCohortFile: vi.fn(), uploadToS3: vi.fn(), createCohortFileVersion: vi.fn(), completeCohortFileVersion: vi.fn() }))
vi.mock('./api', () => ({ api: mocks }))
vi.mock('./uploadToS3', () => ({ uploadToS3: mocks.uploadToS3 }))
import { abandonCohortUpload, cohortFileProblem, fileTypeIcon, linkProviderFor, linkUrlProblem, matchesFileQuery, parseCsv, safeExternalFileUrl, titleFromFilename, uploadCohortFile, uploadCohortFileVersion, type CohortFile, type CohortUploadState } from './cohortFiles'

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
  expect(linkUrlProblem('https://intranet/page')).toMatch(/full public web address/)
  expect(linkUrlProblem('https://docs.google.com/document/d/x')).toBeNull()
  expect(linkProviderFor('https://docs.google.com/document/d/x/edit')).toBe('google_doc')
  expect(linkProviderFor('https://docs.google.com/spreadsheets/d/x')).toBe('google_sheet')
  expect(linkProviderFor('https://docs.google.com/presentation/d/x')).toBe('google_slides')
  expect(linkProviderFor('https://www.figma.com/design/x')).toBe('figma')
  expect(linkProviderFor('https://team.notion.site/x')).toBe('notion')
  expect(linkProviderFor('https://example.com/figma.com')).toBe('web')
  expect(safeExternalFileUrl('javascript:alert(1)')).toBeNull()
  expect(safeExternalFileUrl('http://example.com')).toBeNull()
  expect(safeExternalFileUrl('https://example.com/a')).toBe('https://example.com/a')
  const link = { title: 'Brief', filename: null, folder: 'General', description: null, external_url: 'https://www.canva.com/design/x' } as unknown as CohortFile
  expect(matchesFileQuery(link, 'canva')).toBe(true)
})

it('parses CSV previews with quotes, escaped quotes and CRLF', () => {
  expect(parseCsv('name,notes\r\n"Ada, L.","said ""hi"""\nGrace,\n').rows).toEqual([['name', 'notes'], ['Ada, L.', 'said "hi"'], ['Grace', '']])
  const many = Array.from({ length: 10 }, (_, index) => `${index}`).join('\n')
  expect(parseCsv(many, 3)).toEqual({ rows: [['0'], ['1'], ['2']], clipped: true })
})

it('accepts only public https hosts, like the API', () => {
  for (const url of [
    'https://10.255.0.1/', 'https://172.31.255.255/', 'https://192.168.10.1/', 'https://100.64.0.1/', 'https://100.127.255.254/', 'https://127.1.2.3/',
    'https://169.254.1.1/', 'https://0.1.2.3/', 'https://224.0.0.1/', 'https://[::]/', 'https://[::1]/', 'https://[fc00::1]/', 'https://[fe80::1]/',
    'https://[::ffff:192.168.1.1]/', 'https://[::ffff:100.64.0.1]/', 'https://user:pw@example.com/', 'https://example.com@evil.com/',
    'https://exa%6dple.com/', 'https://bücher.de/', 'https://localhost/', 'https://intranet/', 'https://printer.local/', 'https://2130706433/',
    'https://0x7f.0.0.1/', 'https://1.2.3/', 'http://example.com/', 'javascript:alert(1)',
  ]) {
    expect(linkUrlProblem(url), url).not.toBeNull()
    expect(safeExternalFileUrl(url), url).toBeNull()
  }
  for (const url of ['https://example.com/', 'https://8.8.8.8/', 'https://100.128.0.1/', 'https://172.32.0.1/', 'https://[2001:4860:4860::8888]/', 'https://xn--bcher-kva.de/', 'https://example.com:8443/a?b=1#c']) {
    expect(linkUrlProblem(url), url).toBeNull()
    expect(safeExternalFileUrl(url), url).toBe(url)
  }
})

it('retries a lost confirmation on the same pending file instead of creating another', async () => {
  mocks.uploadToS3.mockResolvedValue(undefined)
  mocks.completeCohortFile.mockRejectedValueOnce(new Error('Network lost')).mockResolvedValueOnce({ data: { file: { ...pending, ready: true } }, error: null })
  const file = new File(['resume'], 'resume.pdf', { type: 'application/pdf' })
  const state: CohortUploadState = {}
  await expect(uploadCohortFile(4, file, { folder: 'General' }, undefined, state)).rejects.toThrow('Network lost')
  expect(state).toMatchObject({ fileId: 7, uploaded: true })
  // The caller owns the pending file: nothing is abandoned while Retry is possible.
  expect(mocks.deleteCohortFile).not.toHaveBeenCalled()
  await expect(uploadCohortFile(4, file, { folder: 'General' }, undefined, state)).resolves.toMatchObject({ id: 7, ready: true })
  expect(mocks.createCohortFile).toHaveBeenCalledTimes(1)
  expect(mocks.uploadToS3).toHaveBeenCalledTimes(1)
  expect(mocks.completeCohortFile).toHaveBeenCalledTimes(2)
  expect(mocks.completeCohortFile).toHaveBeenLastCalledWith(4, 7)
  await abandonCohortUpload(4, state)
  expect(mocks.deleteCohortFile).toHaveBeenCalledWith(4, 7, { pendingOnly: true })
})

it('retries a failed storage upload to the same presigned form', async () => {
  mocks.uploadToS3.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce(undefined)
  mocks.completeCohortFile.mockResolvedValue({ data: { file: { ...pending, ready: true } }, error: null })
  const state: CohortUploadState = {}
  const file = new File(['resume'], 'resume.pdf')
  await expect(uploadCohortFile(4, file, { folder: 'General' }, undefined, state)).rejects.toThrow('Network down')
  await uploadCohortFile(4, file, { folder: 'General' }, undefined, state)
  expect(mocks.createCohortFile).toHaveBeenCalledTimes(1)
  expect(mocks.uploadToS3).toHaveBeenCalledTimes(2)
})

it('retries a version on the same pending version', async () => {
  mocks.uploadToS3.mockResolvedValue(undefined)
  mocks.createCohortFileVersion.mockResolvedValue({ data: { version: { id: 31 }, upload_url: 'https://storage.test/upload', fields: { key: 'v' } }, error: null })
  mocks.completeCohortFileVersion.mockResolvedValueOnce({ data: null, error: 'Gateway timeout' }).mockResolvedValueOnce({ data: { file: { id: 5, version_number: 2 } }, error: null })
  const state: CohortUploadState = {}
  const file = new File(['v2'], 'notes.md')
  await expect(uploadCohortFileVersion(4, 5, file, 'Typo', undefined, state)).rejects.toThrow('Gateway timeout')
  await expect(uploadCohortFileVersion(4, 5, file, 'Typo', undefined, state)).resolves.toMatchObject({ version_number: 2 })
  expect(mocks.createCohortFileVersion).toHaveBeenCalledTimes(1)
  expect(mocks.uploadToS3).toHaveBeenCalledTimes(1)
  expect(mocks.completeCohortFileVersion).toHaveBeenNthCalledWith(2, 4, 5, 31)
})
