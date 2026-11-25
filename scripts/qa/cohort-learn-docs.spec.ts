import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { mkdirSync, readFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

/*
 * Learn Docs and the file review loop, affected-flow QA at 1280 and 390 in
 * light and dark: staff create a class doc without storage, edit it with
 * auto-save, open History, export, copy it to students and review a
 * student's doc; a learner creates and edits their own doc, sends it for
 * review, comments, follows a notification link and recovers from a 409.
 * Load cohort-learn-docs-fixtures.rb first (README). Everything runs on the
 * real local API; the harness has no file storage, which docs don't need.
 */
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('Set DEV_LIFECYCLE_SESSION to the active dev-lifecycle session before running browser QA.')
const fixture = JSON.parse(readFileSync(new URL('../../.qa-local/cohort-learn-docs.json', import.meta.url), 'utf8')) as { cohort_id: number; template_id: number; copy_id: number; student_id: number }
const evidence = new URL('../../.qa-local/cohort-learn-docs/', import.meta.url)
mkdirSync(evidence, { recursive: true })
test.setTimeout(120_000)
const ownership = new Map<object, string>()
const staffHeaders = { Authorization: 'Bearer test_token_1' }
const learnerHeaders = { Authorization: 'Bearer test_token_3' }

test.beforeEach(async ({ page }, info) => {
  const tab = `cohort-learn-docs-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
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

async function removeDocs(request: import('../../web/node_modules/@playwright/test/index.mjs').APIRequestContext, headers: Record<string, string>, match: (title: string) => boolean) {
  const body = await (await request.get(`/api/v1/cohorts/${fixture.cohort_id}/files`, { headers: staffHeaders })).json() as { class_files: Array<{ id: number; title: string }>; student_folders: Array<{ files: Array<{ id: number; title: string }> }> }
  const all = [...body.class_files, ...body.student_folders.flatMap(folder => folder.files)]
  for (const file of all.filter(item => match(item.title))) await request.delete(`/api/v1/cohorts/${fixture.cohort_id}/files/${file.id}`, { headers })
}

for (const theme of ['light', 'dark'] as const) {
  test(`staff ${theme}: create, edit, history, export, copy and review`, async ({ page, request }, info) => {
    const mobile = (info.project.use.viewport?.width || 1280) < 640
    const title = `QA docs staff ${theme} ${info.project.name}`
    // A failed earlier run may have left this run's doc (and its student copies) behind.
    await removeDocs(request, staffHeaders, (item) => item === title)
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/admin/cohorts/${fixture.cohort_id}?tab=files&qa_user=1`)
    const list = page.getByRole('list', { name: 'Class files' })
    await expect(list).toBeVisible({ timeout: 15_000 })
    expect(await page.locator('html').getAttribute('data-theme')).toBe(theme)
    const template = list.getByRole('listitem').filter({ hasText: 'QA docs job search template' })
    await expect(template.getByText('Learn Doc', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New doc' })).toBeEnabled()
    await audit(page, `${theme}-staff-class-files`, info)
    if (mobile) {
      expect(await smallTargets(page, 'main ul[aria-label="Class files"]')).toEqual([])
      // The three add buttons stay on one line each.
      const heights = await Promise.all(['Upload files', 'Add link', 'New doc'].map(async name => (await page.getByRole('button', { name, exact: true }).boundingBox())!.height))
      expect(Math.max(...heights)).toBeLessThan(52)
    }

    // Read view: headings, an interactive checklist, a table and code shown as code.
    await template.getByRole('button', { name: 'Open QA docs job search template' }).click()
    const reader = page.getByRole('dialog', { name: 'QA docs job search template' })
    await expect(reader.getByRole('heading', { name: 'Job search plan', exact: true })).toBeVisible()
    await expect(reader.getByRole('checkbox', { name: 'Update your resume' })).toBeChecked()
    await expect(reader.getByRole('table')).toBeVisible()
    await expect(reader.getByText('<script src="app.js"></script>')).toBeVisible()
    await audit(page, `${theme}-staff-doc-read`, info)
    await page.keyboard.press('Escape')
    await expect(reader).toHaveCount(0)

    // New doc opens straight into Edit, saves itself, and keeps History.
    await page.getByRole('button', { name: 'New doc' }).click()
    const form = page.getByRole('region', { name: 'New class doc' })
    await form.getByLabel('Title').fill(title)
    await audit(page, `${theme}-staff-new-doc-form`, info)
    await form.getByRole('button', { name: 'Create doc' }).click()
    const editor = page.getByRole('dialog', { name: title })
    await expect(editor.getByLabel('Title')).toHaveValue(title)
    const surface = editor.locator('[contenteditable="true"]').first()
    await surface.click()
    await page.keyboard.type('Week plan')
    await expect(editor.getByText('Unsaved changes').first()).toBeVisible()
    await expect(editor.getByText('Learn Doc · Saved')).toBeVisible({ timeout: 8_000 })
    await audit(page, `${theme}-staff-doc-edit`, info)
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(editor.getByText('Learn Doc · Saved')).toBeVisible()
    if (mobile) await editor.getByRole('tab', { name: 'History' }).click()
    const history = editor.getByRole('region', { name: 'Revision history' })
    await expect(history.getByRole('button').first()).toBeVisible()
    await history.getByRole('button').last().click()
    await expect(editor.getByRole('button', { name: 'Restore this version' })).toBeVisible()
    await audit(page, `${theme}-staff-doc-history`, info)
    const download = page.waitForEvent('download')
    await editor.getByRole('button', { name: 'Export this doc' }).click()
    await page.getByRole('menuitem', { name: 'Download .md' }).click()
    expect((await download).suggestedFilename()).toMatch(/^QA-docs-staff-.*\.md$/)
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    const savedDoc = list.getByRole('listitem').filter({ hasText: title })
    await expect(savedDoc.getByText(/Updated .* by QA Admin|Updated/)).toBeVisible()

    // Copy to every active student, from the doc's menu.
    await savedDoc.getByRole('button', { name: `More actions for ${title}` }).click()
    await page.getByRole('menuitem', { name: 'Copy to all students' }).click()
    await page.getByRole('button', { name: 'Copy to all students' }).last().click()
    await expect(page.getByText(/Copied to \d+ students?/)).toBeVisible()

    // Student folders: the Needs review filter, a badge, and the review pane beside the doc.
    await page.getByRole('tab', { name: /Student folders/ }).click()
    const filter = page.getByRole('group', { name: 'Filter student folders' })
    await filter.getByRole('button', { name: /Needs review \(\d+\)/ }).click()
    const folders = page.getByRole('list', { name: 'Student folders' })
    await expect(folders.getByRole('listitem')).toHaveCount(1)
    await audit(page, `${theme}-staff-needs-review-filter`, info)
    await folders.getByRole('button').first().click()
    const folder = page.getByRole('list', { name: /Files in .*'s folder/ })
    const studentDoc = folder.getByRole('listitem').filter({ hasText: 'QA docs job search plan' })
    await expect(studentDoc.getByText('Needs review', { exact: true })).toBeVisible()
    await expect(folder.getByRole('listitem').filter({ hasText: 'QA docs cover letter' }).getByText('Reviewed', { exact: true })).toBeVisible()
    await studentDoc.getByRole('button', { name: '2 comments on QA docs job search plan' }).click()
    const reviewDialog = page.getByRole('dialog', { name: 'QA docs job search plan' })
    const pane = reviewDialog.getByRole('complementary', { name: 'Review and comments' })
    await expect(pane.getByText('Nice start. Add one stretch role.')).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Mark reviewed' })).toBeEnabled()
    await audit(page, `${theme}-staff-review-pane`, info)
    if (mobile) expect(await smallTargets(page, '[role="dialog"]')).toEqual([])
    await page.keyboard.press('Escape')

    // A review notification's link opens the student's folder and the item.
    await page.goto(`/admin/cohorts/${fixture.cohort_id}?tab=files&student=${fixture.student_id}&file=${fixture.copy_id}&qa_user=1`)
    const linked = page.getByRole('dialog', { name: 'QA docs job search plan' })
    await expect(linked.getByRole('heading', { name: 'Job search plan', exact: true })).toBeVisible({ timeout: 15_000 })
    if (mobile) await linked.getByRole('tab', { name: 'Review' }).click()
    await expect(linked.getByRole('complementary', { name: 'Review and comments' }).getByRole('button', { name: 'Mark reviewed' })).toBeVisible()

    await removeDocs(request, staffHeaders, (item) => item === title)
  })

  test(`learner ${theme}: my doc, review, comments, deep link and conflict`, async ({ page, request }, info) => {
    const mobile = (info.project.use.viewport?.width || 1280) < 640
    const title = `QA docs learner ${theme} ${info.project.name}`
    await removeDocs(request, learnerHeaders, (item) => item === title)
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/resources?cohort_id=${fixture.cohort_id}&qa_user=3`)
    const mine = page.getByRole('region', { name: 'My files' })
    const copy = mine.getByRole('listitem').filter({ hasText: 'QA docs job search plan' })
    await expect(copy.getByText('Learn Doc', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(copy.getByText('Needs review', { exact: true })).toBeVisible()
    await audit(page, `${theme}-learner-my-files`, info)

    // A new doc in my folder, without file storage.
    await mine.getByRole('button', { name: 'New doc' }).click()
    const form = page.getByRole('region', { name: 'New doc in my files' })
    await form.getByLabel('Title').fill(title)
    await form.getByRole('button', { name: 'Create doc' }).click()
    const editor = page.getByRole('dialog', { name: title })
    await editor.locator('[contenteditable="true"]').first().click()
    await page.keyboard.type('My interview notes')
    await expect(editor.getByText('Learn Doc · Saved')).toBeVisible({ timeout: 8_000 })
    if (mobile) await editor.getByRole('tab', { name: 'Review' }).click()
    const pane = editor.getByRole('complementary', { name: 'Review and comments' })
    const ready = pane.getByRole('button', { name: 'Ready for review' })
    await ready.click()
    await expect(ready).toHaveAttribute('aria-pressed', 'true')
    await pane.getByLabel('Add a comment').fill('Ready for a look.')
    await pane.getByRole('button', { name: 'Post comment' }).click()
    await expect(pane.getByText('Ready for a look.')).toBeVisible()
    await audit(page, `${theme}-learner-doc-review`, info)
    await page.keyboard.press('Escape')
    const created = mine.getByRole('listitem').filter({ hasText: title })
    await expect(created.getByText('Needs review', { exact: true })).toBeVisible()
    await expect(created.getByRole('button', { name: `1 comment on ${title}` })).toBeVisible()

    // Someone else saves while the editor is open: the next save gets 409 and the banner.
    await created.getByRole('button', { name: `Open ${title}` }).click()
    const reopened = page.getByRole('dialog', { name: title })
    // A doc with content opens in Read.
    await reopened.getByRole('button', { name: 'Edit', exact: true }).click()
    const ids = (await (await request.get(`/api/v1/cohorts/${fixture.cohort_id}/files`, { headers: learnerHeaders })).json()).my_files as Array<{ id: number; title: string }>
    const id = ids.find(item => item.title === title)!.id
    expect((await request.patch(`/api/v1/cohorts/${fixture.cohort_id}/files/${id}/doc`, { headers: staffHeaders, data: { doc_content: 'Instructor feedback written elsewhere' } })).ok()).toBe(true)
    await reopened.locator('[contenteditable="true"]').first().click()
    await page.keyboard.type(' more')
    const banner = reopened.getByRole('alert').filter({ hasText: 'Someone else updated this doc' })
    await expect(banner).toBeVisible({ timeout: 8_000 })
    await audit(page, `${theme}-learner-doc-conflict`, info)
    await banner.getByRole('button', { name: 'Load latest' }).click()
    await expect(reopened.getByText('Instructor feedback written elsewhere')).toBeVisible()
    await page.keyboard.press('Escape')

    // A notification link opens the doc it names.
    await page.goto(`/resources?cohort_id=${fixture.cohort_id}&file=${fixture.copy_id}&qa_user=3`)
    const linked = page.getByRole('dialog', { name: 'QA docs job search plan' })
    await expect(linked.getByRole('heading', { name: 'Job search plan', exact: true })).toBeVisible({ timeout: 15_000 })

    await removeDocs(request, learnerHeaders, (item) => item === title)
  })
}
