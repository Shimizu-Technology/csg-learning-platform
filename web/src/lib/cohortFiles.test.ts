import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createCohortFile: vi.fn(), completeCohortFile: vi.fn(), deleteCohortFile: vi.fn(), uploadToS3: vi.fn(), createCohortFileVersion: vi.fn(), completeCohortFileVersion: vi.fn(), updateCohortFile: vi.fn() }))
vi.mock('./api', () => ({ api: mocks }))
vi.mock('./uploadToS3', () => ({ uploadToS3: mocks.uploadToS3 }))
import { CSV_PREVIEW_LIMITS, UPLOAD_RESUME_WINDOW_MS, abandonCohortUpload, ipv6Groups, cohortFileProblem, fileTypeIcon, linkProviderFor, linkUrlProblem, matchesFileQuery, parseCsv, safeExternalFileUrl, titleFromFilename, uploadCohortFile, uploadCohortFileVersion, type CohortFile, type CohortUploadState } from './cohortFiles'

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
  expect(parseCsv(many, { rows: 3, columns: 50, cellLength: 200 })).toEqual({ rows: [['0'], ['1'], ['2']], clippedRows: true, clippedColumns: false })
})

it('bounds CSV previews by rows, columns and cell length', () => {
  const wide = Array.from({ length: 100_000 }, (_, index) => `c${index}`).join(',')
  const { rows, clippedRows, clippedColumns } = parseCsv(`${wide}\n${'x'.repeat(5_000)},b\n`)
  expect(rows[0]).toHaveLength(CSV_PREVIEW_LIMITS.columns)
  expect(rows[1][0]).toBe(`${'x'.repeat(CSV_PREVIEW_LIMITS.cellLength)}…`)
  expect([clippedRows, clippedColumns]).toEqual([false, true])
  expect(parseCsv(Array.from({ length: 1_000 }, () => 'a').join('\n')).rows).toHaveLength(CSV_PREVIEW_LIMITS.rows)
})

it('accepts only public https hosts, like the API', () => {
  for (const url of [
    'https://10.255.0.1/', 'https://172.31.255.255/', 'https://192.168.10.1/', 'https://100.64.0.1/', 'https://100.127.255.254/', 'https://127.1.2.3/',
    'https://169.254.1.1/', 'https://0.1.2.3/', 'https://224.0.0.1/', 'https://[::]/', 'https://[::1]/', 'https://[fc00::1]/', 'https://[fe80::1]/',
    'https://[::ffff:192.168.1.1]/', 'https://[::ffff:100.64.0.1]/', 'https://user:pw@example.com/', 'https://example.com@evil.com/',
    'https://exa%6dple.com/', 'https://bücher.de/', 'https://localhost/', 'https://intranet/', 'https://printer.local/', 'https://2130706433/',
    'https://0x7f.0.0.1/', 'https://1.2.3/', 'http://example.com/', 'javascript:alert(1)',
    'https://192.88.99.2/', 'https://[2001::1]/', 'https://[2001:0:4136:e378::1]/', 'https://[2001:2::1]/', 'https://[2001:10::1]/',
    'https://[2001:100::1]/', 'https://[2001:1ff::1]/', 'https://[2001:1::4]/', 'https://[2001:4:113::1]/', 'https://[2001:db8::1]/', 'https://[2002:c000:204::1]/', 'https://[3fff::1]/', 'https://[0:0:0:0:0:ffff:10.0.0.1]/',
    'https://home.arpa/', 'https://router.home.arpa/', 'https://local/', 'https://internal/', 'https://app.internal/', 'https://LOCALHOST/',
  ]) {
    expect(linkUrlProblem(url), url).not.toBeNull()
    expect(safeExternalFileUrl(url), url).toBeNull()
  }
  for (const url of ['https://example.com/', 'https://8.8.8.8/', 'https://100.128.0.1/', 'https://172.32.0.1/', 'https://[2001:4860:4860::8888]/', 'https://xn--bcher-kva.de/', 'https://example.com:8443/a?b=1#c',
    'https://[2001:3::1]/', 'https://[2001:1::1]/', 'https://[2001:1::3]/', 'https://[2001:4:112::1]/', 'https://[2001:20::1]/', 'https://[2001:2f::1]/',
    'https://[2001:30::1]/', 'https://[2001:200::1]/', 'https://[2003::1]/', 'https://[0:0:0:0:0:ffff:8.8.8.8]/', 'https://192.88.100.1/', 'HTTPS://example.com/', 'Https://Docs.Google.com/x']) {
    expect(linkUrlProblem(url), url).toBeNull()
    expect(safeExternalFileUrl(url), url).not.toBeNull()
  }
  expect(ipv6Groups('0000:0000:0000:0000:0000:ffff:0808:0808')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x808, 0x808])
  expect(ipv6Groups('::ffff:8.8.8.8')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x808, 0x808])
  expect(ipv6Groups('1::2::3')).toBeNull()
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

it('checks complete after a failed storage response and re-uploads cleanly when bytes never landed', async () => {
  mocks.uploadToS3.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce(undefined)
  mocks.completeCohortFile
    .mockResolvedValueOnce({ data: null, error: 'Uploaded file is missing', status: 422 })
    .mockResolvedValueOnce({ data: { file: { ...pending, id: 8, ready: true } }, error: null })
  const state: CohortUploadState = {}
  const file = new File(['resume'], 'resume.pdf')
  await expect(uploadCohortFile(4, file, { folder: 'General' }, undefined, state)).rejects.toThrow('Network down')
  await expect(uploadCohortFile(4, file, { folder: 'General' }, undefined, state)).resolves.toMatchObject({ id: 8 })
  expect(mocks.createCohortFile).toHaveBeenCalledTimes(2)
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

it('starts a fresh upload when a retry finds the old one expired, using the current details', async () => {
  mocks.uploadToS3.mockResolvedValue(undefined)
  mocks.createCohortFile.mockResolvedValueOnce({ data: { file: pending, upload_url: 'https://storage.test/upload', fields: { key: 'k' } }, error: null })
    .mockResolvedValueOnce({ data: { file: { id: 8 }, upload_url: 'https://storage.test/upload2', fields: { key: 'k2' } }, error: null })
  mocks.completeCohortFile.mockRejectedValueOnce(new Error('Network lost'))
    .mockResolvedValueOnce({ data: null, error: 'Upload expired; start a new upload', status: 422 })
    .mockResolvedValueOnce({ data: { file: { id: 8, ready: true } }, error: null })
  const state: CohortUploadState = {}
  const file = new File(['resume'], 'resume.pdf')
  await expect(uploadCohortFile(4, file, { folder: 'General', title: 'Resume' }, undefined, state)).rejects.toThrow('Network lost')
  await expect(uploadCohortFile(4, file, { folder: 'General', title: 'Resume' }, undefined, state)).resolves.toMatchObject({ id: 8 })
  expect(mocks.deleteCohortFile).toHaveBeenCalledWith(4, 7, { pendingOnly: true })
  expect(mocks.createCohortFile).toHaveBeenCalledTimes(2)
  expect(mocks.uploadToS3).toHaveBeenLastCalledWith('https://storage.test/upload2', { key: 'k2' }, file, undefined)
  expect(state.fileId).toBe(8)
})

it('starts fresh when the presigned form is too old to reuse and bytes never reached storage', async () => {
  mocks.uploadToS3.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(undefined)
  mocks.completeCohortFile
    .mockResolvedValueOnce({ data: null, error: 'Uploaded file is missing', status: 422 })
    .mockResolvedValue({ data: { file: { id: 8, ready: true } }, error: null })
  const state: CohortUploadState = {}
  const file = new File(['resume'], 'resume.pdf')
  await expect(uploadCohortFile(4, file, { folder: 'General' }, undefined, state)).rejects.toThrow('Network down')
  state.startedAt = Date.now() - UPLOAD_RESUME_WINDOW_MS - 1
  await uploadCohortFile(4, file, { folder: 'General' }, undefined, state)
  expect(mocks.deleteCohortFile).toHaveBeenCalledWith(4, 7, { pendingOnly: true })
  expect(mocks.createCohortFile).toHaveBeenCalledTimes(2)
})

it('uses edited details on retry: recovers when bytes never reached storage, saves on the pending file when they did', async () => {
  const file = new File(['resume'], 'resume.pdf')
  mocks.uploadToS3.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(undefined)
  mocks.updateCohortFile.mockResolvedValue({ data: { file: pending }, error: null })
  mocks.completeCohortFile
    .mockResolvedValueOnce({ data: null, error: 'Uploaded file is missing', status: 422 })
    .mockResolvedValue({ data: { file: { id: 8, ready: true } }, error: null })
  const before: CohortUploadState = {}
  await expect(uploadCohortFile(4, file, { folder: 'General', title: 'Old' }, undefined, before)).rejects.toThrow('Network down')
  await uploadCohortFile(4, file, { folder: 'Resumes', title: 'New' }, undefined, before)
  expect(mocks.deleteCohortFile).toHaveBeenCalledTimes(1)
  expect(mocks.createCohortFile).toHaveBeenLastCalledWith(4, expect.objectContaining({ title: 'New', folder: 'Resumes' }))

  vi.clearAllMocks()
  mocks.createCohortFile.mockResolvedValue({ data: { file: pending, upload_url: 'https://storage.test/upload', fields: { key: 'k' } }, error: null })
  mocks.uploadToS3.mockResolvedValue(undefined)
  mocks.updateCohortFile.mockResolvedValue({ data: { file: pending }, error: null })
  mocks.completeCohortFile.mockRejectedValueOnce(new Error('Network lost')).mockResolvedValue({ data: { file: { id: 7, ready: true } }, error: null })
  const after: CohortUploadState = {}
  await expect(uploadCohortFile(4, file, { folder: 'General', title: 'Old' }, undefined, after)).rejects.toThrow('Network lost')
  await uploadCohortFile(4, file, { folder: 'General', title: 'New', description: 'Final' }, undefined, after)
  expect(mocks.createCohortFile).toHaveBeenCalledTimes(1)
  expect(mocks.uploadToS3).toHaveBeenCalledTimes(1)
  expect(mocks.updateCohortFile).toHaveBeenCalledWith(4, 7, { title: 'New', folder: 'General', description: 'Final' })
  expect(mocks.deleteCohortFile).not.toHaveBeenCalled()
})

it('treats 410 on pending delete as gone and confirms an upload whose S3 response was lost', async () => {
  mocks.deleteCohortFile.mockResolvedValueOnce({ data: null, error: 'Gone', status: 410 })
  const gone410: CohortUploadState = { fileId: 7, uploaded: true }
  await expect(abandonCohortUpload(4, gone410)).resolves.toBe('gone')
  expect(gone410).toEqual({})

  // S3 accepted the POST, then the HTTP response dropped: Retry confirms the existing upload without re-uploading or duplicating.
  vi.clearAllMocks()
  mocks.createCohortFile.mockResolvedValue({ data: { file: pending, upload_url: 'https://storage.test/upload', fields: { key: 'k' } }, error: null })
  mocks.uploadToS3.mockRejectedValueOnce(new Error('Connection reset after POST'))
  mocks.updateCohortFile.mockResolvedValue({ data: { file: pending }, error: null })
  mocks.completeCohortFile.mockResolvedValue({ data: { file: { id: 7, ready: true } }, error: null })
  const lostS3: CohortUploadState = {}
  const file = new File(['resume'], 'resume.pdf')
  await expect(uploadCohortFile(4, file, { folder: 'General', title: 'Old' }, undefined, lostS3)).rejects.toThrow('Connection reset')
  lostS3.startedAt = Date.now() - UPLOAD_RESUME_WINDOW_MS * 2
  await expect(uploadCohortFile(4, file, { folder: 'General', title: 'Edited' }, undefined, lostS3)).resolves.toMatchObject({ id: 7 })
  expect(mocks.createCohortFile).toHaveBeenCalledTimes(1)
  expect(mocks.uploadToS3).toHaveBeenCalledTimes(1)
  expect(mocks.deleteCohortFile).not.toHaveBeenCalled()
})

it('reports a pending file that could not be abandoned, clears gone ones and keeps published ones', async () => {
  mocks.deleteCohortFile.mockResolvedValueOnce({ data: null, error: 'Server error', status: 500 })
  await expect(abandonCohortUpload(4, { fileId: 7 })).rejects.toThrow('Server error')
  mocks.deleteCohortFile.mockResolvedValueOnce({ data: null, error: 'Not found', status: 404 })
  const gone: CohortUploadState = { fileId: 7, uploaded: true }
  await expect(abandonCohortUpload(4, gone)).resolves.toBe('gone')
  expect(gone).toEqual({})
  for (const result of [{ status: 409, error: 'Conflict' }, { status: 422, error: 'This file was already published' }]) {
    mocks.deleteCohortFile.mockResolvedValueOnce({ data: null, ...result })
    const published: CohortUploadState = { fileId: 7, uploaded: true }
    await expect(abandonCohortUpload(4, published)).resolves.toBe('published')
    expect(published.fileId).toBe(7)
  }
})

it('treats a missing staged upload or a vanished pending file as a reason to upload again', async () => {
  mocks.uploadToS3.mockResolvedValue(undefined)
  mocks.createCohortFile.mockResolvedValueOnce({ data: { file: pending, upload_url: 'https://storage.test/upload', fields: { key: 'k' } }, error: null })
    .mockResolvedValueOnce({ data: { file: { id: 8 }, upload_url: 'https://storage.test/upload2', fields: { key: 'k2' } }, error: null })
  mocks.completeCohortFile.mockRejectedValueOnce(new Error('Network lost'))
    .mockResolvedValueOnce({ data: null, error: 'Uploaded file is missing or does not match its declared size and type', status: 422 })
    .mockResolvedValueOnce({ data: { file: { id: 8, ready: true } }, error: null })
  const file = new File(['resume'], 'resume.pdf')
  const state: CohortUploadState = {}
  await expect(uploadCohortFile(4, file, { folder: 'General' }, undefined, state)).rejects.toThrow('Network lost')
  await expect(uploadCohortFile(4, file, { folder: 'General' }, undefined, state)).resolves.toMatchObject({ id: 8 })
  expect(mocks.deleteCohortFile).toHaveBeenCalledWith(4, 7, { pendingOnly: true })

  // A 404 on the metadata save means the pending file is gone: start over with the new details.
  vi.clearAllMocks()
  mocks.uploadToS3.mockResolvedValue(undefined)
  mocks.deleteCohortFile.mockResolvedValue({ data: null, error: 'Not found', status: 404 })
  mocks.updateCohortFile.mockResolvedValue({ data: null, error: 'Not found', status: 404 })
  mocks.createCohortFile.mockResolvedValue({ data: { file: { id: 9 }, upload_url: 'https://storage.test/upload3', fields: {} }, error: null })
  mocks.completeCohortFile.mockResolvedValue({ data: { file: { id: 9, ready: true } }, error: null })
  const vanished: CohortUploadState = { fileId: 7, upload: { url: 'https://storage.test/upload', fields: {} }, uploaded: true, startedAt: Date.now(), details: '{}' }
  await expect(uploadCohortFile(4, file, { folder: 'General', title: 'New title' }, undefined, vanished)).resolves.toMatchObject({ id: 9 })
  expect(mocks.createCohortFile).toHaveBeenCalledWith(4, expect.objectContaining({ title: 'New title' }))
  expect(mocks.completeCohortFile).toHaveBeenCalledTimes(1)
})

it('always confirms a sent upload first, even when old and edited, so a lost confirmation never duplicates it', async () => {
  mocks.updateCohortFile.mockResolvedValue({ data: { file: pending }, error: null })
  mocks.completeCohortFile.mockResolvedValue({ data: { file: { id: 7, ready: true } }, error: null })
  const sent: CohortUploadState = { fileId: 7, upload: { url: 'https://storage.test/upload', fields: {} }, uploaded: true, startedAt: Date.now() - UPLOAD_RESUME_WINDOW_MS * 2, details: '{}' }
  await expect(uploadCohortFile(4, new File(['x'], 'resume.pdf'), { folder: 'General', title: 'Edited' }, undefined, sent)).resolves.toMatchObject({ id: 7 })
  expect(mocks.updateCohortFile).toHaveBeenCalledWith(4, 7, expect.objectContaining({ title: 'Edited' }))
  expect(mocks.completeCohortFile).toHaveBeenCalledWith(4, 7)
  expect(mocks.createCohortFile).not.toHaveBeenCalled()
  expect(mocks.uploadToS3).not.toHaveBeenCalled()
  expect(mocks.deleteCohortFile).not.toHaveBeenCalled()
})

it('returns a pending file that turns out to be published instead of uploading it again', async () => {
  mocks.deleteCohortFile.mockResolvedValue({ data: null, error: 'Conflict', status: 409 })
  mocks.completeCohortFile.mockResolvedValue({ data: { file: { id: 7, ready: true, title: 'resume' } }, error: null })
  // Bytes never confirmed as sent, and the form is too old: normally a fresh start.
  const stale: CohortUploadState = { fileId: 7, upload: { url: 'https://storage.test/upload', fields: {} }, uploaded: false, startedAt: Date.now() - UPLOAD_RESUME_WINDOW_MS * 2, details: '{}' }
  await expect(uploadCohortFile(4, new File(['x'], 'resume.pdf'), { folder: 'General' }, undefined, stale)).resolves.toMatchObject({ id: 7, ready: true })
  expect(mocks.createCohortFile).not.toHaveBeenCalled()
  expect(mocks.uploadToS3).not.toHaveBeenCalled()
  expect(stale).toEqual({})
})

it('confirms a sent version first even with a new note, and starts fresh only when it expired or was never sent', async () => {
  mocks.uploadToS3.mockResolvedValue(undefined)
  mocks.createCohortFileVersion.mockResolvedValueOnce({ data: { version: { id: 31 }, upload_url: 'https://storage.test/a', fields: {} }, error: null })
    .mockResolvedValueOnce({ data: { version: { id: 32 }, upload_url: 'https://storage.test/b', fields: {} }, error: null })
    .mockResolvedValueOnce({ data: { version: { id: 33 }, upload_url: 'https://storage.test/c', fields: {} }, error: null })
  mocks.completeCohortFileVersion.mockResolvedValueOnce({ data: null, error: 'Gateway timeout', status: 504 })
    .mockResolvedValueOnce({ data: { file: { id: 5, version_number: 2 } }, error: null })
  const file = new File(['v2'], 'notes.md')
  const state: CohortUploadState = {}
  await expect(uploadCohortFileVersion(4, 5, file, 'Typo', undefined, state)).rejects.toThrow('Gateway timeout')
  // Sent bytes: the same version is confirmed even though the note changed.
  await expect(uploadCohortFileVersion(4, 5, file, 'Typo and links', undefined, state)).resolves.toMatchObject({ version_number: 2 })
  expect(mocks.completeCohortFileVersion).toHaveBeenLastCalledWith(4, 5, 31)
  expect(mocks.createCohortFileVersion).toHaveBeenCalledTimes(1)

  // An expired sent version starts over once.
  mocks.completeCohortFileVersion.mockResolvedValueOnce({ data: null, error: 'Upload expired; start a new upload', status: 422 })
    .mockResolvedValueOnce({ data: { file: { id: 5, version_number: 3 } }, error: null })
  const expired: CohortUploadState = { versionId: 40, upload: { url: 'https://storage.test/x', fields: {} }, uploaded: true, startedAt: Date.now(), details: 'Typo' }
  await expect(uploadCohortFileVersion(4, 5, file, 'Typo', undefined, expired)).resolves.toMatchObject({ version_number: 3 })
  expect(mocks.completeCohortFileVersion).toHaveBeenLastCalledWith(4, 5, 32)

  // Attempted S3 upload whose bytes never landed: complete reports missing (422), then starts fresh with the new note.
  mocks.uploadToS3.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce(undefined)
  const unsent: CohortUploadState = {}
  mocks.createCohortFileVersion.mockResolvedValueOnce({ data: { version: { id: 34 }, upload_url: 'https://storage.test/d', fields: {} }, error: null })
  await expect(uploadCohortFileVersion(4, 5, file, 'One', undefined, unsent)).rejects.toThrow('Network down')
  mocks.completeCohortFileVersion
    .mockResolvedValueOnce({ data: null, error: 'Uploaded file is missing', status: 422 })
    .mockResolvedValueOnce({ data: { file: { id: 5, version_number: 4 } }, error: null })
  await uploadCohortFileVersion(4, 5, file, 'Two', undefined, unsent)
  expect(mocks.createCohortFileVersion).toHaveBeenLastCalledWith(4, 5, expect.objectContaining({ note: 'Two' }))
})
