import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { mkdirSync, readFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

/*
 * Files cabinet affected-flow QA: links, folder rename, multi-file queue,
 * Upload new version and the in-app preview with its version switcher, for
 * staff (Cohort workspace → Files) and a learner (Resources), at 1280 and 390
 * in light and dark. Load cohort-files-cabinet-fixtures.rb first (README).
 * The harness has no file storage, so the browser stubs only the
 * storage-backed parts: storage_configured on the file list and the preview
 * text. Links, rename and versions use the real local API.
 */
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('Set DEV_LIFECYCLE_SESSION to the active dev-lifecycle session before running browser QA.')
const fixture = JSON.parse(readFileSync(new URL('../../.qa-local/cohort-files-cabinet.json', import.meta.url), 'utf8')) as { cohort_id: number; notes_id: number; versions: number[] }
const evidence = new URL('../../.qa-local/cohort-files-cabinet/', import.meta.url)
mkdirSync(evidence, { recursive: true })
test.setTimeout(90_000)
const ownership = new Map<object, string>()

test.beforeEach(async ({ page }, info) => {
  const tab = `cohort-files-cabinet-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', tab)
  ownership.set(page, tab)
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  // Pretend storage is set up so Preview, Download and uploads render.
  await page.route(/\/api\/v1\/cohorts\/\d+\/files$/, async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), storage_configured: true } })
  })
  await page.route(/\/api\/v1\/cohorts\/\d+\/files\/\d+\/preview/, async route => {
    const version = new URL(route.request().url()).searchParams.get('version_id')
    const csv = !route.request().url().includes(`/files/${fixture.notes_id}/`)
    await route.fulfill({ json: csv
      ? { preview_mode: 'csv', filename: 'roster.csv', content_type: 'text/csv', file_size: 60, version_number: 1, version_id: null, url: null, expires_in: null, text: 'name,track,score\nAda Synthetic,Ruby,98\n"Lee, Q.",JavaScript,91\n', truncated: false }
      : { preview_mode: 'markdown', filename: version ? 'week-1-notes.md' : 'week-1-notes-v2.md', content_type: 'text/markdown', file_size: 4800,
        version_number: version ? 1 : 2, version_id: version ? Number(version) : null, url: null, expires_in: null, truncated: false,
        text: version ? '# Week 1 notes (first draft)\n\nArrays and hashes.' : '# Week 1 notes\n\n- Arrays\n- Hashes\n- `each` loops\n\n<script>window.qaInjected = true</script>\n\n| Day | Topic |\n|---|---|\n| 1 | Arrays |' } })
  })
})
test.afterEach(async ({ page }) => {
  await page.close()
  const tab = ownership.get(page)
  if (tab) checkedLifecycle(session, 'release', tab)
  ownership.delete(page)
})

async function audit(page: Page, label: string, info: { project: { name: string } }) {
  await page.waitForTimeout(250)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => JSON.stringify(n.target)).join(' ')}`), `${label}: axe`).toEqual([])
  await page.screenshot({ path: new URL(`${info.project.name}-${label}.png`, evidence).pathname, fullPage: true })
}

async function smallTargets(page: Page, scope: string) {
  return page.evaluate((selector) => [...document.querySelectorAll<HTMLElement>(`${selector} button, ${selector} a[href], ${selector} select, ${selector} input:not([type="file"]):not([type="radio"]):not([type="checkbox"])`)]
    .filter(node => node.offsetParent !== null)
    .map(node => ({ text: (node.getAttribute('aria-label') || node.textContent || node.tagName).trim().slice(0, 40), height: node.getBoundingClientRect().height }))
    .filter(node => node.height < 44), scope)
}

for (const theme of ['light', 'dark'] as const) {
  test(`staff ${theme}: links, rename, uploads, versions and preview`, async ({ page, request }, info) => {
    const mobile = (info.project.use.viewport?.width || 1280) < 640
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/admin/cohorts/${fixture.cohort_id}?tab=files&qa_user=1`)
    const list = page.getByRole('list', { name: 'Class files' })
    await expect(list).toBeVisible({ timeout: 15_000 })
    expect(await page.locator('html').getAttribute('data-theme')).toBe(theme)

    const link = list.getByRole('listitem').filter({ hasText: 'QA cabinet capstone brief' })
    await expect(link.getByText('Google Doc', { exact: true })).toBeVisible()
    await expect(link.getByRole('link', { name: /Open link QA cabinet capstone brief/ })).toHaveAttribute('href', 'https://docs.google.com/document/d/qa-cabinet/edit')
    await expect(link.getByRole('link', { name: /Open link/ })).toHaveAttribute('rel', /noopener/)
    const notes = list.getByRole('listitem').filter({ hasText: 'QA cabinet week 1 notes' })
    await expect(notes.getByText('v2', { exact: true })).toBeVisible()
    await audit(page, `${theme}-staff-files`, info)
    if (mobile) expect(await smallTargets(page, 'main ul[aria-label="Class files"]')).toEqual([])

    // Preview with the version switcher; raw HTML in Markdown never runs.
    await notes.getByRole('button', { name: 'Preview QA cabinet week 1 notes' }).click()
    const dialog = page.getByRole('dialog', { name: 'QA cabinet week 1 notes' })
    await expect(dialog.getByRole('heading', { name: 'Week 1 notes', exact: true })).toBeVisible()
    await expect(dialog.getByRole('table')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { qaInjected?: boolean }).qaInjected)).toBeUndefined()
    const version = dialog.getByLabel('Version')
    await expect(version.locator('option')).toHaveText(['v2 (current) · Added loop examples', 'v1'])
    await audit(page, `${theme}-staff-preview-markdown`, info)
    await version.selectOption({ label: 'v1' })
    await expect(dialog.getByRole('heading', { name: 'Week 1 notes (first draft)' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    const roster = list.getByRole('listitem').filter({ hasText: 'QA cabinet roster' })
    await roster.getByRole('button', { name: 'QA cabinet roster', exact: true }).click()
    const csv = page.getByRole('dialog', { name: 'QA cabinet roster' })
    await expect(csv.getByRole('columnheader', { name: 'track' })).toBeVisible()
    await expect(csv.getByRole('cell', { name: 'Lee, Q.' })).toBeVisible()
    await audit(page, `${theme}-staff-preview-csv`, info)
    await csv.getByRole('button', { name: 'Close QA cabinet roster' }).click()

    // Download-only files offer no Preview.
    const plan = list.getByRole('listitem').filter({ hasText: 'QA cabinet job search plan' })
    await expect(plan.getByRole('button', { name: /^Preview/ })).toHaveCount(0)
    await expect(plan.getByRole('button', { name: 'Download QA cabinet job search plan' })).toBeVisible()

    // Upload new version opens an inline form under the row.
    await notes.getByRole('button', { name: 'Upload new version of QA cabinet week 1 notes' }).click()
    await expect(notes.getByRole('group', { name: 'Upload a new version of QA cabinet week 1 notes' })).toBeVisible()
    await audit(page, `${theme}-staff-new-version`, info)
    await notes.getByRole('button', { name: 'Cancel' }).click()

    // Multi-file queue: two files, editable titles, one shared folder.
    await page.getByRole('button', { name: 'Upload files' }).click()
    await page.locator('input[type="file"][aria-label="Upload class files"]').setInputFiles([
      { name: 'week-2_slides.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic') },
      { name: 'week-2-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Week 2') },
    ])
    const queue = page.getByRole('list', { name: 'Files to upload' })
    await expect(queue.getByRole('listitem')).toHaveCount(2)
    await expect(page.getByLabel('Title for week-2_slides.pdf')).toHaveValue('week 2 slides')
    await expect(page.getByRole('button', { name: 'Upload 2 files' })).toBeEnabled()
    await audit(page, `${theme}-staff-upload-queue`, info)
    await page.getByRole('button', { name: 'Clear' }).click()
    await page.getByRole('button', { name: 'Close' }).click()

    // Add a link (real API, no storage needed), then remove it.
    const title = `QA cabinet link ${theme} ${info.project.name}`
    await page.getByRole('button', { name: 'Add link' }).click()
    const form = page.getByRole('region', { name: 'Add a class link' })
    await form.getByLabel('Link').fill('http://example.com')
    await form.getByLabel('Link').blur()
    await expect(form.getByText('Links must start with https://')).toBeVisible()
    await form.getByLabel('Link').fill('https://www.figma.com/design/qa-cabinet')
    await expect(form.getByText('Figma', { exact: true })).toBeVisible()
    await form.getByLabel(/^Title/).fill(title)
    await audit(page, `${theme}-staff-add-link`, info)
    await form.getByRole('button', { name: 'Save link' }).click()
    const saved = list.getByRole('listitem').filter({ hasText: title })
    await expect(saved.getByText('Figma', { exact: true })).toBeVisible()
    const headers = { Authorization: 'Bearer test_token_1' }
    const files = (await (await request.get(`/api/v1/cohorts/${fixture.cohort_id}/files`, { headers })).json()).class_files as Array<{ id: number; title: string }>
    for (const file of files.filter(item => item.title === title)) await request.delete(`/api/v1/cohorts/${fixture.cohort_id}/files/${file.id}`, { headers })

    // Rename a folder, then put it back.
    await page.getByRole('group', { name: 'Filter by folder' }).getByRole('button', { name: 'Career & Job Search', exact: true }).click()
    await page.getByRole('button', { name: 'Rename folder Career & Job Search' }).click()
    await page.getByLabel('Rename Career & Job Search').fill('Career Center')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Filter by folder' }).getByRole('button', { name: 'Career Center', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(list.getByText('QA cabinet job search plan')).toBeVisible()
    const renamed = await request.patch(`/api/v1/cohorts/${fixture.cohort_id}/files/rename_folder`, { headers, data: { from_folder: 'Career Center', to_folder: 'Career & Job Search' } })
    expect(renamed.ok()).toBe(true)
  })

  test(`learner ${theme}: my files, links and preview on Resources`, async ({ page, request }, info) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    // Persona 3 is also in the X6 demo cohort when that fixture is loaded; name this cohort.
    await page.goto(`/resources?cohort_id=${fixture.cohort_id}&qa_user=3`)
    const mine = page.getByRole('region', { name: 'My files' })
    await expect(mine.getByText('QA cabinet portfolio repo')).toBeVisible({ timeout: 15_000 })
    await expect(mine.getByText('GitHub', { exact: true })).toBeVisible()
    const resume = mine.getByRole('listitem').filter({ hasText: 'QA cabinet resume draft' })
    await expect(resume.getByRole('button', { name: 'Upload new version of QA cabinet resume draft' })).toBeVisible()
    await audit(page, `${theme}-learner-resources`, info)

    const classFiles = page.getByRole('region', { name: 'Class files' })
    await classFiles.getByRole('button', { name: 'Preview QA cabinet week 1 notes' }).click()
    await expect(page.getByRole('dialog', { name: 'QA cabinet week 1 notes' }).getByRole('heading', { name: 'Week 1 notes', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    const title = `QA cabinet learner link ${theme} ${info.project.name}`
    await mine.getByRole('button', { name: 'Add a link' }).click()
    const form = page.getByRole('region', { name: 'Add a link to my files' })
    await form.getByLabel('Link').fill('https://www.canva.com/design/qa-cabinet')
    await expect(form.getByText('Canva', { exact: true })).toBeVisible()
    await form.getByLabel(/^Title/).fill(title)
    await form.getByLabel('Folder').selectOption('Resumes & Portfolio')
    await audit(page, `${theme}-learner-add-link`, info)
    await form.getByRole('button', { name: 'Save link' }).click()
    await expect(mine.getByRole('listitem').filter({ hasText: title }).getByRole('link', { name: /Open link/ })).toHaveAttribute('href', 'https://www.canva.com/design/qa-cabinet')
    const headers = { Authorization: 'Bearer test_token_3' }
    const files = (await (await request.get(`/api/v1/cohorts/${fixture.cohort_id}/files`, { headers })).json()).my_files as Array<{ id: number; title: string }>
    for (const file of files.filter(item => item.title === title)) await request.delete(`/api/v1/cohorts/${fixture.cohort_id}/files/${file.id}`, { headers })
  })
}
