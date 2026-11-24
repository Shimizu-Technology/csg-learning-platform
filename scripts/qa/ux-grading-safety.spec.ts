import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { checkedLifecycle } from './ownership.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// UX-1: Staff Today -> Grading workbench, select-first grading, feedback in view on phones,
// and the GitHub Redo warning. Needs ux-grading-safety-fixtures.rb first (see that file).
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('../../.qa-local/ux-grading-safety.json', import.meta.url)), 'utf8')) as {
  cohort_id: number
  module_id: number
  submission_ids: number[]
}
const output = fileURLToPath(new URL('../../.qa-local/ux-grading-safety/', import.meta.url))
const WARNING = "Saving Redo will post this feedback to the student's GitHub repository as an issue."

const owners = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const id = `ux-grading-safety-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', id)
  owners.set(page, id)
})
test.afterEach(async ({ page }) => {
  await page.close()
  const id = owners.get(page)
  if (id) checkedLifecycle(session, 'release', id)
  owners.delete(page)
})

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function open(page: Page, path: string, user = 2) {
  await page.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function evidence(page: Page, name: string, project: string, theme: string, axeSelector?: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  if (axeSelector && await page.locator(axeSelector).count()) {
    const result = await new AxeBuilder({ page }).include(axeSelector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(result.violations.filter((item) => ['serious', 'critical'].includes(item.impact || ''))).toEqual([])
  }
  mkdirSync(output, { recursive: true })
  await page.screenshot({ path: `${output}${project}-${theme}-${name}.png` })
  appendFileSync(`${output}ledger.jsonl`, JSON.stringify({ name, project, theme, overflow, url: page.url() }) + '\n')
}

async function expectTouchTarget(page: Page, locator: ReturnType<Page['locator']>, mobile: boolean) {
  if (!mobile) return
  const box = await locator.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
}

test.describe.configure({ mode: 'serial', timeout: 120_000 })

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((choice) => localStorage.setItem('csg-learn:theme', choice), theme)
    })

    test('UX01 Today opens the Grading workbench; grades select first; Redo warns about GitHub; Save and next saves once', async ({ page }, info) => {
      const errors = watchErrors(page)
      const mobile = info.project.name.endsWith('390')
      const grades: string[] = []
      page.on('request', (request) => { if (request.method() === 'PATCH' && /\/submissions\/\d+\/grade$/.test(new URL(request.url()).pathname)) grades.push(request.url()) })

      // Staff Today: the review chip and Open grading both go to the workbench.
      await open(page, `/admin?cohort_id=${fixtures.cohort_id}`)
      const chip = page.getByRole('navigation', { name: 'Staff summary' }).getByRole('link', { name: /Waiting for review/ })
      // The first visit may wait on a cold dev-server compile.
      await expect(chip).toHaveAttribute('href', new RegExp(`^/admin/grading\\?cohort_id=${fixtures.cohort_id}&return_to=`), { timeout: 30000 })
      const openGrading = page.locator('[data-today-item="review"]').first().getByRole('link', { name: 'Open grading' })
      await expect(openGrading).toHaveAttribute('href', new RegExp(`^/admin/grading\\?cohort_id=${fixtures.cohort_id}&submission=\\d+&return_to=`))
      await expectTouchTarget(page, openGrading, mobile)
      await evidence(page, 'today', info.project.name, theme, 'main')
      await openGrading.click()
      await expect(page).toHaveURL(/\/admin\/grading\?/)
      const opened = Number(new URL(page.url()).searchParams.get('submission'))
      expect(fixtures.submission_ids).toContain(opened)

      const review = page.getByRole('region', { name: 'Submission review' })
      const bar = page.locator('[data-grade-bar]')
      const gradeGroup = bar.getByRole('group', { name: 'Grade' })
      await expect(gradeGroup).toBeVisible({ timeout: 15000 })
      // The feedback box is on screen as the review opens, before any scrolling or tapping, at
      // every width: the pinned grade bar holds it right above the grades and Save.
      const feedbackBox = bar.getByRole('textbox').first()
      await expect(feedbackBox).toBeVisible()
      await expect(feedbackBox).toBeInViewport()
      await expect(gradeGroup).toBeInViewport()
      await expect(bar.getByRole('button', { name: /^Save/ })).toBeInViewport()
      const [feedbackTop, gradesTop] = await Promise.all([feedbackBox.boundingBox(), gradeGroup.boundingBox()])
      expect(feedbackTop!.y).toBeLessThan(gradesTop!.y)
      await expect(bar.getByRole('button', { name: 'Feedback', exact: true })).toHaveCount(0)

      // A click and a key only choose.
      await gradeGroup.getByRole('button', { name: 'A', exact: true }).click()
      await expect(gradeGroup.getByRole('button', { name: 'A', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await review.focus()
      await page.keyboard.press('c')
      await expect(gradeGroup.getByRole('button', { name: 'C', exact: true })).toHaveAttribute('aria-pressed', 'true')
      expect(grades).toEqual([])

      // Redo on a GitHub-delivery cohort: a calm warning right above Save.
      await expect(page.getByText(WARNING)).toHaveCount(0)
      await gradeGroup.getByRole('button', { name: 'Redo', exact: true }).click()
      const warning = bar.locator('[data-redo-github-warning]')
      await expect(warning).toHaveText(WARNING)
      await expect(warning).toBeVisible()
      await evidence(page, 'redo-warning', info.project.name, theme, '[data-grade-bar]')
      expect(grades).toEqual([])

      const save = bar.getByRole('button', { name: 'Save and next' })
      for (const name of ['A', 'B', 'C', 'Redo']) await expectTouchTarget(page, gradeGroup.getByRole('button', { name, exact: true }), mobile)
      await expectTouchTarget(page, save, mobile)
      await expectTouchTarget(page, page.getByRole('button', { name: 'Check GitHub again' }), mobile)

      // A chosen grade alone is an unsaved draft: moving on asks first, and Keep editing stays.
      await review.focus()
      await page.keyboard.press('j')
      const dialog = page.getByRole('dialog', { name: 'Discard your unsaved review?' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('The grade you chose')
      await dialog.getByRole('button', { name: 'Keep editing' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`submission=${opened}(&|$)`))
      await expect(gradeGroup.getByRole('button', { name: 'Redo', exact: true })).toHaveAttribute('aria-pressed', 'true')

      // With feedback written, the icon-only "save as snippet" button is a full touch target.
      await bar.getByRole('textbox').first().fill('Check the odd and even cases again.')
      const snippet = bar.getByRole('button', { name: 'Save draft as reusable snippet' })
      await expect(snippet).toBeVisible()
      await expectTouchTarget(page, snippet, mobile)

      // Choose A and save: exactly one save, then the next attempt opens.
      await gradeGroup.getByRole('button', { name: 'A', exact: true }).click()
      await expect(warning).toHaveCount(0)
      const saved = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/submissions/${opened}/grade`))
      await save.click()
      expect((await saved).status()).toBe(200)
      await expect(page).not.toHaveURL(new RegExp(`submission=${opened}(&|$)`))
      await expect(gradeGroup).toBeVisible()
      await expect(gradeGroup.getByRole('button', { name: 'A', exact: true })).toHaveAttribute('aria-pressed', 'false')
      expect(grades).toHaveLength(1)
      await evidence(page, 'after-save-next', info.project.name, theme, '[data-grade-bar]')

      // A standalone record has no next item: its button says Save grade.
      await open(page, `/admin/submissions/${fixtures.submission_ids.at(-1)}`)
      const recordBar = page.locator('[data-grade-bar]')
      await recordBar.getByRole('group', { name: 'Grade' }).getByRole('button', { name: 'B', exact: true }).click()
      await expect(recordBar.getByRole('button', { name: 'Save grade' })).toBeVisible()
      await expect(recordBar.getByRole('button', { name: 'Save and next' })).toHaveCount(0)
      await expect(recordBar.getByRole('textbox').first()).toBeVisible()
      await evidence(page, 'record-save-grade', info.project.name, theme, '[data-grade-bar]')
      expect(grades).toHaveLength(1)

      // The module matrix keeps a saved cell open, so it says Save grade too.
      await open(page, `/admin/cohorts/${fixtures.cohort_id}/modules/${fixtures.module_id}/grading?view=grid&review=${fixtures.submission_ids.at(-2)}`)
      const gridBar = page.locator('[data-grade-bar]')
      await gridBar.getByRole('group', { name: 'Grade' }).getByRole('button', { name: 'A', exact: true }).click()
      await expect(gridBar.getByRole('button', { name: 'Save grade' })).toBeVisible()
      await expect(gridBar.getByRole('button', { name: 'Save and next' })).toHaveCount(0)
      await evidence(page, 'grid-save-grade', info.project.name, theme)
      expect(grades).toHaveLength(1)

      expect(errors).toEqual([])
    })
  })
}
