import { test, expect, type APIRequestContext, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

/*
 * Curriculum template files, "Import from curriculum", "Copy from another
 * cohort", auto-copy on enrollment and folder ZIP downloads, affected-flow QA
 * at 1280 and 390 in light and dark on the "Prework Demo — synthetic" cohort.
 * Start the harness with QA_X6_DEMO=1 and run x6-actualize-demo-fixtures.rb
 * setup (or reset) first (README). Everything runs on the real local API; the
 * harness has no file storage, so ZIPs hold docs and links and note the
 * uploads left out. Each test puts the demo back as it found it: Portfolio
 * Launch Checklist un-imported, no copied cohort items, persona 5 paused.
 */
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('Set DEV_LIFECYCLE_SESSION to the active dev-lifecycle session before running browser QA.')
type Meta = {
  curriculum_id: number; cohort_id: number
  cohort_files: { templates: Record<string, number>; student_one: { job_search_plan: number } }
  personas: { program: { id: number; enrollment_id: number }; paused: { id: number; enrollment_id: number } }
}
const meta = JSON.parse(readFileSync(new URL('../../.qa-local/x6-actualize-demo.json', import.meta.url), 'utf8')) as Meta
const evidence = new URL('../../.qa-local/cohort-templates-and-export/', import.meta.url)
mkdirSync(evidence, { recursive: true })
test.setTimeout(180_000)
const ownership = new Map<object, string>()
const staff = { Authorization: 'Bearer test_token_1' }
const filesPath = `/api/v1/cohorts/${meta.cohort_id}/files`
const portfolioTemplateId = meta.cohort_files.templates['Portfolio Launch Checklist']
const COPY_SOURCE_TITLE = 'QA templates copy source link'

type FileJson = { id: number; title: string; student_id: number | null; source_file_id: number | null; source_curriculum_file_id: number | null; source_cohort_file_id: number | null; auto_copy_to_students: boolean }
type StaffFiles = { class_files: FileJson[]; student_folders: Array<{ student_id: number; files: FileJson[] }> }

test.beforeEach(async ({ page }, info) => {
  const tab = `cohort-templates-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', tab)
  ownership.set(page, tab)
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})
test.afterEach(async ({ page }) => {
  await page.close()
  const tab = ownership.get(page)
  if (tab) checkedLifecycle(session, 'release', tab)
  ownership.delete(page)
})

async function audit(page: Page, label: string, info: { project: { name: string } }) {
  await page.waitForTimeout(300)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => JSON.stringify(n.target)).join(' ')}`), `${label}: axe`).toEqual([])
  await page.screenshot({ path: new URL(`${info.project.name}-${label}.png`, evidence).pathname, fullPage: true })
}

/** Visible controls in `scope` shorter than 44px, for phone layouts. */
async function smallTargets(page: Page, scope: string) {
  return page.evaluate((selector) => [...document.querySelectorAll<HTMLElement>(`${selector} button, ${selector} a[href], ${selector} select, ${selector} input:not([type="file"]):not([type="radio"]):not([type="checkbox"])`)]
    .filter(node => node.offsetParent !== null)
    .map(node => ({ text: (node.getAttribute('aria-label') || node.textContent || node.tagName).trim().slice(0, 40), height: node.getBoundingClientRect().height }))
    .filter(node => node.height < 44), scope)
}

async function staffFiles(request: APIRequestContext, cohortId = meta.cohort_id) {
  const response = await request.get(`/api/v1/cohorts/${cohortId}/files`, { headers: staff })
  expect(response.ok()).toBe(true)
  return await response.json() as StaffFiles
}

async function setPaused(request: APIRequestContext, paused: boolean) {
  const response = await request.patch(`/api/v1/enrollments/${meta.personas.paused.enrollment_id}`, { headers: staff, data: { status: paused ? 'paused' : 'active' } })
  expect(response.ok(), await response.text()).toBe(true)
}

async function qaProgramCohortId(request: APIRequestContext) {
  const body = await (await request.get('/api/v1/cohorts/accessible', { headers: staff })).json() as { cohorts: Array<{ id: number; name: string }> }
  return body.cohorts.find(cohort => cohort.name === 'QA Program')!.id
}

/** Puts the demo back: no live import or cohort copies (and none of their student copies), persona 5 paused with no auto-copies. */
async function restoreDemo(request: APIRequestContext) {
  await setPaused(request, true)
  const body = await staffFiles(request)
  const live = body.class_files.filter(file => file.source_cohort_file_id !== null || file.source_curriculum_file_id === portfolioTemplateId)
  const liveIds = new Set(live.map(file => file.id))
  const students = body.student_folders.flatMap(folder => folder.files)
  const copies = students.filter(file => (file.source_file_id !== null && liveIds.has(file.source_file_id)) || file.title === 'Portfolio Launch Checklist')
  const pausedCopies = body.student_folders.find(folder => folder.student_id === meta.personas.paused.id)?.files.filter(file => file.source_file_id !== null) || []
  for (const file of [...copies, ...pausedCopies, ...live]) await request.delete(`${filesPath}/${file.id}`, { headers: staff })
  const sourceCohortId = await qaProgramCohortId(request)
  for (const file of (await staffFiles(request, sourceCohortId)).class_files.filter(item => item.title === COPY_SOURCE_TITLE)) {
    await request.delete(`/api/v1/cohorts/${sourceCohortId}/files/${file.id}`, { headers: staff })
  }
}

/**
 * Uploads in a ZIP: with QA_STAFF_RELIABILITY=1 storage is synthetic and each
 * upload holds synthetic PDF bytes; without it they are left out and noted.
 */
function expectUploads(archive: ReturnType<typeof zipContents>, upload: string) {
  if (archive.names.includes(upload)) expect(archive.read(upload)).toMatch(/^%PDF-/)
  else expect(archive.read('README.txt')).toMatch(/uploaded files? (was|were) left out because file storage isn't set up yet/)
}

/** The names in a downloaded ZIP and the text of a few of them. */
function zipContents(path: string) {
  const names = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  const read = (name: string) => execFileSync('unzip', ['-p', path, name], { encoding: 'utf8' })
  return { names, read }
}

for (const theme of ['light', 'dark'] as const) {
  test(`staff ${theme}: templates, import, copy from a cohort, auto-copy on enrollment and ZIPs`, async ({ page, request }, info) => {
    const mobile = (info.project.use.viewport?.width || 1280) < 640
    await restoreDemo(request)
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    try {
      // Content Management, Files pane: the five templates, badges and a doc.
      await page.goto(`/admin/content?qa_user=1&curriculum=${meta.curriculum_id}&pane=files`)
      const templates = page.getByRole('list', { name: 'Template files' })
      await expect(templates).toBeVisible({ timeout: 20_000 })
      expect(await page.locator('html').getAttribute('data-theme')).toBe(theme)
      await expect(templates.getByRole('listitem')).toHaveCount(5)
      await expect(templates.getByRole('listitem').filter({ hasText: 'Portfolio Launch Checklist' }).getByText('Auto-copy')).toBeVisible()
      await expect(templates.getByRole('listitem').filter({ hasText: 'Instructor Week 1 Facilitation Guide' }).getByText('Staff only')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add link' })).toBeEnabled()
      // The panel sits in a narrow column on desktop: titles keep a readable width instead of wrapping per letter.
      const titleBox = await templates.getByText('Portfolio Launch Checklist', { exact: true }).boundingBox()
      expect(titleBox!.width).toBeGreaterThan(120)
      await audit(page, `${theme}-curriculum-templates`, info)
      if (mobile) expect(await smallTargets(page, 'section[aria-labelledby^="templates-"]')).toEqual([])
      await templates.getByRole('button', { name: 'Open Week 1 Ruby Cheat Sheet' }).click()
      const reader = page.getByRole('dialog', { name: 'Week 1 Ruby Cheat Sheet' })
      await expect(reader.getByText('[1, 2, 3].map { |n| n * 2 }')).toBeVisible()
      await audit(page, `${theme}-template-doc`, info)
      await page.keyboard.press('Escape')
      await expect(reader).toBeHidden()

      // Cohort Files: import the template added after the cohort was made.
      await page.goto(`/admin/cohorts/${meta.cohort_id}?tab=files&qa_user=1`)
      const classList = page.getByRole('list', { name: 'Class files' })
      await expect(classList).toBeVisible({ timeout: 20_000 })
      await expect(classList.getByRole('listitem').filter({ hasText: 'Job Search Plan' }).first().getByText('Auto-copy')).toBeVisible()
      await expect(classList.getByRole('listitem').filter({ hasText: 'Portfolio Launch Checklist' })).toHaveCount(0)
      await audit(page, `${theme}-cohort-class-files`, info)
      if (mobile) expect(await smallTargets(page, '[aria-label="More ways to add and download class files"]')).toEqual([])
      await page.getByRole('button', { name: 'Import from curriculum' }).click()
      await expect(page.getByText(/Imported 1 item/)).toBeVisible()
      await expect(classList.getByRole('listitem').filter({ hasText: 'Portfolio Launch Checklist' })).toHaveCount(1)
      const afterImport = await staffFiles(request)
      const studentOne = afterImport.student_folders.find(folder => folder.student_id === meta.personas.program.id)!
      expect(studentOne.files.filter(file => file.title === 'Portfolio Launch Checklist'), 'auto-copied to the active learner once').toHaveLength(1)
      await page.getByRole('button', { name: 'Import from curriculum' }).click()
      await expect(page.getByText('Everything from the curriculum is already here.')).toBeVisible()

      // Copy from another cohort: a class link added to QA Program comes across; student folders never do.
      const sourceCohortId = await qaProgramCohortId(request)
      const created = await request.post(`/api/v1/cohorts/${sourceCohortId}/files`, { headers: staff, data: { kind: 'link', title: COPY_SOURCE_TITLE, external_url: 'https://github.com/qa/templates-copy-source', folder: 'Guides & Handouts' } })
      expect(created.ok(), await created.text()).toBe(true)
      await page.getByRole('button', { name: 'Copy from another cohort' }).click()
      const picker = page.getByRole('dialog', { name: 'Copy from another cohort' })
      await expect(picker.getByRole('radio', { name: /QA Program/ }).first()).toBeVisible()
      await audit(page, `${theme}-copy-from-cohort`, info)
      await picker.getByRole('radio', { name: /^QA Program/ }).first().check()
      await picker.getByRole('button', { name: 'Copy class files' }).click()
      await expect(picker).toBeHidden()
      await expect(classList.getByRole('listitem').filter({ hasText: COPY_SOURCE_TITLE })).toHaveCount(1)
      const copied = (await staffFiles(request)).class_files.filter(file => file.source_cohort_file_id !== null)
      expect(copied.length).toBeGreaterThan(0)

      // Class files as a ZIP: docs as Markdown, links in Links.md, uploads noted without storage.
      const [classZip] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download all class files as a ZIP' }).click()])
      expect(classZip.suggestedFilename()).toMatch(/^prework-demo-synthetic-class-files\.zip$/)
      const classPath = new URL(`${info.project.name}-${theme}-class.zip`, evidence).pathname
      await classZip.saveAs(classPath)
      const classArchive = zipContents(classPath)
      expect(classArchive.names).toEqual(expect.arrayContaining(['Career & Job Search/Job Search Plan.md', 'Week 1/Week 1 Ruby Cheat Sheet.md', 'General/Links.md', 'Instructor Notes/Instructor Week 1 Facilitation Guide.md']))
      expect(classArchive.read('General/Links.md')).toContain('- [Cohort Schedule & Office Hours](https://docs.google.com/spreadsheets/d/demo-cohort-schedule/edit)')
      expect(classArchive.read('Career & Job Search/Job Search Plan.md')).toMatch(/^# Job Search Plan\n\nFill this in before Friday/)
      expectUploads(classArchive, 'Slides/week-1-ruby-slides.pdf')

      // Student One's (persona 3's) folder as a ZIP.
      const studentName = (await (await request.get(filesPath, { headers: staff })).json() as { student_folders: Array<{ student_id: number; student_name: string }> })
        .student_folders.find(folder => folder.student_id === meta.personas.program.id)!.student_name
      await page.getByRole('tab', { name: /Student folders/ }).click()
      await page.getByRole('list', { name: 'Student folders' }).getByRole('button', { name: new RegExp(`^${studentName}`) }).click()
      const [studentZip] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: `Download ${studentName}'s folder as a ZIP` }).click()])
      const studentPath = new URL(`${info.project.name}-${theme}-student-one.zip`, evidence).pathname
      await studentZip.saveAs(studentPath)
      const studentArchive = zipContents(studentPath)
      expect(studentArchive.names).toEqual(expect.arrayContaining(['Career & Job Search/Job Search Plan.md', 'Resumes & Portfolio/Resume Draft.md', 'Resumes & Portfolio/Links.md']))
      expect(studentArchive.read('Resumes & Portfolio/Links.md')).toContain('(https://www.figma.com/design/demo-portfolio-wireframe)')
      expect(studentArchive.read('Career & Job Search/Job Search Plan.md')).toContain('- [x] Apply to three junior developer roles')
      await audit(page, `${theme}-student-folder`, info)

      // A learner made active again gets every auto-copy item, once.
      await setPaused(request, false)
      const reactivated = (await staffFiles(request)).student_folders.find(folder => folder.student_id === meta.personas.paused.id)!
      expect(reactivated.files.filter(file => file.source_file_id !== null).map(file => file.title).sort()).toEqual(['Job Search Plan', 'Portfolio Launch Checklist'])
      await setPaused(request, false)
      expect((await staffFiles(request)).student_folders.find(folder => folder.student_id === meta.personas.paused.id)!.files.filter(file => file.source_file_id !== null)).toHaveLength(2)
    } finally {
      await restoreDemo(request)
    }
  })

  test(`learner ${theme}: My files downloads as a ZIP with revision history intact`, async ({ page, request }, info) => {
    const revisions = await request.get(`${filesPath}/${meta.cohort_files.student_one.job_search_plan}/revisions`, { headers: { Authorization: `Bearer test_token_${meta.personas.program.id}` } })
    expect(revisions.ok()).toBe(true)
    expect(((await revisions.json()) as { revisions: unknown[] }).revisions).toHaveLength(2)
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/resources?cohort_id=${meta.cohort_id}&qa_user=${meta.personas.program.id}`)
    const zipButton = page.getByRole('button', { name: 'Download all my files as a ZIP' })
    await expect(zipButton).toBeVisible({ timeout: 20_000 })
    expect(await page.locator('html').getAttribute('data-theme')).toBe(theme)
    await audit(page, `${theme}-learner-resources`, info)
    const [download] = await Promise.all([page.waitForEvent('download'), zipButton.click()])
    expect(download.suggestedFilename()).toBe('prework-demo-synthetic-my-files.zip')
    const path = new URL(`${info.project.name}-${theme}-my-files.zip`, evidence).pathname
    await download.saveAs(path)
    const archive = zipContents(path)
    expect(archive.names).toEqual(expect.arrayContaining(['Career & Job Search/Job Search Plan.md', 'Resumes & Portfolio/Resume Draft.md', 'Resumes & Portfolio/Links.md']))
    expectUploads(archive, 'Resumes & Portfolio/resume-draft-v1.pdf')
    expect(archive.read('Resumes & Portfolio/Resume Draft.md')).toContain('Rails capstone')
    const forbidden = await request.get(`${filesPath}/export_zip?scope=class`, { headers: { Authorization: `Bearer test_token_${meta.personas.program.id}` } })
    expect(forbidden.status()).toBe(403)
  })
}
