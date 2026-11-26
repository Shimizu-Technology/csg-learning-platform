import { test, expect, type Locator, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkedLifecycle } from './ownership.mjs'

/*
 * Unified grading scales and Ask for help polish (PR A), at 1280 and 390 in light and dark:
 * - an admin creates a curriculum, which starts on Pass / Redo;
 * - the instructor grades a Pass / Redo submission: Pass and Redo only, Pass picked from the
 *   rubric with "Suggested from rubric", saved as P; the module grid shows it as Passed and
 *   links to the Grading workbench;
 * - the lesson editor's four submission choices, with Project link's live URL checkbox;
 * - a learner opens Ask for help straight onto the lesson form, picks a category pill, sends,
 *   then adds details before any instructor reply.
 * Needs unified-grading-and-help-fixtures.rb first (see that file). Run:
 *   DEV_LIFECYCLE_SESSION=<id> QA_SPEC=unified-grading-and-help.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts
 */

const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')
const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('../../.qa-local/unified-grading-and-help.json', import.meta.url)), 'utf8')) as {
  curriculum_id: number
  cohort_id: number
  module_id: number
  lesson_id: number
  editor_lesson_id: number
  editor_block_id: number
  submission_ids: number[]
}
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const API = `http://127.0.0.1:${state.api_port}`
const OUT = fileURLToPath(new URL('../../.qa-local/unified-grading-and-help/', import.meta.url))
const as = (user: number) => ({ Authorization: `Bearer test_token_${user}` })
const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024

const owners = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const id = `unified-grading-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`.slice(0, 120)
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
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const source = message.location().url
    if (message.text().startsWith('Failed to load resource') && source && !['127.0.0.1', 'localhost'].includes(new URL(source).hostname)) return
    errors.push(`console: ${message.text()} (${source})`)
  })
  return errors
}

async function open(page: Page, path: string, user: number, theme: 'light' | 'dark') {
  await page.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.addInitScript((choice) => { try { localStorage.setItem('csg-learn:theme', choice) } catch { /* ignore */ } }, theme)
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

/** No sideways scroll, no Axe violations in `scope`, and a screenshot plus ledger line. */
async function evidence(page: Page, name: string, theme: string, project: string, scope: string) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(250)
  // The page and any open sheet: neither may scroll sideways.
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ...[...document.querySelectorAll('.app-modal-overlay')].map((sheet) => sheet.scrollWidth - sheet.clientWidth),
  ))
  const axe = await new AxeBuilder({ page }).include(scope).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const violations = axe.violations.flatMap((v) => v.nodes.slice(0, 3).map((node) => `${v.id} ${JSON.stringify(node.target)}`))
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme || null)
  mkdirSync(`${OUT}${project}`, { recursive: true })
  const screenshot = `${OUT}${project}/${theme}-${name}.png`
  await page.screenshot({ path: screenshot })
  appendFileSync(`${OUT}${project}.jsonl`, `${JSON.stringify({ name, theme, overflow, violations, dataTheme, url: page.url(), screenshot })}\n`)
  expect(dataTheme).toBe(theme)
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(violations, `${name} axe violations`).toEqual([])
}

async function touchTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox()
  expect(box, `${label} is visible`).not.toBeNull()
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44)
}

test.describe.configure({ mode: 'serial', timeout: 120_000 })

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })

    test('a new curriculum starts on Pass / Redo', async ({ page, request }, info) => {
      const errors = watchErrors(page)
      const name = `Scale QA ${theme} ${info.project.name} ${Date.now()}`
      await open(page, '/admin/content', 1, theme)
      await page.getByRole('button', { name: 'New curriculum' }).first().click()
      const dialog = page.getByRole('dialog')
      const scale = dialog.getByRole('group', { name: 'Grading scale' })
      await expect(scale.getByRole('radio', { name: /Pass \/ Redo/ })).toBeChecked({ timeout: 15000 })
      await expect(scale.getByRole('radio', { name: /A \/ B \/ C \/ Redo/ })).not.toBeChecked()
      await expect(scale.getByText('Work either passes or goes back to the student with feedback.', { exact: false })).toBeVisible()
      if (phone(page)) await touchTarget(scale.locator('label').first(), 'Pass / Redo option')
      await dialog.getByLabel('Name').fill(name)
      await evidence(page, 'new-curriculum', theme, info.project.name, '[role="dialog"]')
      await dialog.getByRole('button', { name: 'Create curriculum' }).click()
      await expect(page.getByText(`Created curriculum "${name}"`)).toBeVisible()

      const list = await (await request.get(`${API}/api/v1/curricula`, { headers: as(1) })).json()
      const created = list.curricula.find((item: { name: string }) => item.name === name)
      expect(created.grading_scale).toBe('pass_redo')
      await expect(page.getByText('Grading: Pass / Redo').first()).toBeVisible()
      expect((await request.delete(`${API}/api/v1/curricula/${created.id}`, { headers: as(1) })).ok()).toBeTruthy()
      expect(errors).toEqual([])
    })

    test('Pass / Redo grading picks Pass from the rubric and the module grid shows it', async ({ page, request }, info) => {
      const errors = watchErrors(page)
      const submissionId = fixtures.submission_ids[(theme === 'dark' ? 2 : 0) + (phone(page) ? 1 : 0)]
      await open(page, `/admin/grading?cohort_id=${fixtures.cohort_id}&submission=${submissionId}`, 2, theme)
      const bar = page.locator('[data-grade-bar]')
      const grades = bar.getByRole('group', { name: 'Grade' })
      await expect(grades).toBeVisible({ timeout: 20000 })
      await expect(grades.getByRole('button')).toHaveText(['Pass', 'Redo'])

      const review = page.getByRole('region', { name: 'Submission review' })
      await review.getByRole('group', { name: 'Rating for Works as asked' }).getByRole('button', { name: 'Meets' }).click()
      await expect(grades.getByRole('button', { name: 'Pass' })).toHaveAttribute('aria-pressed', 'false')
      await review.getByRole('group', { name: 'Rating for Reads clearly' }).getByRole('button', { name: 'Exceeds' }).click()
      await expect(grades.getByRole('button', { name: 'Pass' })).toHaveAttribute('aria-pressed', 'true')
      await expect(bar.getByText('Suggested from rubric')).toBeVisible()
      // The instructor can still choose freely before saving.
      await grades.getByRole('button', { name: 'Redo' }).click()
      await expect(bar.getByText('Suggested from rubric')).toHaveCount(0)
      await grades.getByRole('button', { name: 'Pass' }).click()
      if (phone(page)) await touchTarget(grades.getByRole('button', { name: 'Pass' }), 'Pass')
      await evidence(page, 'grading-pass', theme, info.project.name, '[aria-label="Submission review"]')
      await bar.getByRole('button', { name: /^Save (grade|and next)$/ }).click()
      await expect(page.getByText(/Saved Pass/).first()).toBeVisible()
      const saved = await (await request.get(`${API}/api/v1/submissions/${submissionId}`, { headers: as(2) })).json()
      expect([saved.submission.grade, saved.submission.grading_scale]).toEqual(['P', 'pass_redo'])

      await open(page, `/admin/cohorts/${fixtures.cohort_id}/modules/${fixtures.module_id}/grading`, 2, theme)
      const workbench = page.getByRole('link', { name: 'Open Grading workbench' })
      await expect(workbench).toHaveAttribute('href', `/admin/grading?cohort_id=${fixtures.cohort_id}&module_id=${fixtures.module_id}`, { timeout: 20000 })
      await expect(page.locator('button[title="Passed — click to review"]').first()).toBeVisible()
      await expect(page.getByText('Passed', { exact: true }).first()).toBeVisible()
      await evidence(page, 'module-grid', theme, info.project.name, 'main')
      expect(errors).toEqual([])
    })

    test('the lesson editor offers four submission choices and Project link adds a live URL', async ({ page, request }, info) => {
      const errors = watchErrors(page)
      await open(page, `/admin/lessons/${fixtures.editor_lesson_id}/edit?block_id=${fixtures.editor_block_id}`, 1, theme)
      // Desktop shows the block's settings beside the lesson; phones open them in a sheet.
      const settings = phone(page) ? page.getByRole('dialog') : page.locator('main')
      const picker = settings.getByRole('combobox', { name: 'Submission type' })
      await expect(picker).toBeVisible({ timeout: 20000 })
      await expect(picker.locator('option')).toHaveText(['No submission', 'In-app answer or code', 'GitHub file sync', 'Project link'])
      await expect(picker).toHaveValue('repo_url_submission')
      const live = settings.getByRole('checkbox', { name: 'Also require a live deployed URL' }).first()
      await expect(live).not.toBeChecked()
      await live.check()
      await expect(page.getByText('Students submit a repository link and a deployed live link.').first()).toBeVisible()
      await expect(picker).toHaveValue('repo_url_submission')
      await evidence(page, 'editor-project-link', theme, info.project.name, phone(page) ? '[role="dialog"]' : 'main')
      const saveAndCheck = async (expected: string) => {
        if (phone(page) && await page.getByRole('dialog').count()) {
          await page.keyboard.press('Escape')
          await expect(page.getByRole('dialog')).toHaveCount(0)
        }
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await expect.poll(async () => {
          const editor = await (await request.get(`${API}/api/v1/lessons/${fixtures.editor_lesson_id}/block_editor`, { headers: as(1) })).json()
          return editor.lesson.content_blocks.find((block: { id: number }) => block.id === fixtures.editor_block_id)?.submission_type_explicit
        }, { timeout: 15000 }).toBe(expected)
      }
      await saveAndCheck('repo_and_live_url_submission')
      // Unchecking (on the block card, the same setting) goes back to a repository link only.
      const cardLive = page.locator('main').getByRole('checkbox', { name: 'Also require a live deployed URL' }).first()
      await expect(cardLive).toBeChecked()
      await cardLive.uncheck()
      await saveAndCheck('repo_url_submission')
      expect(errors).toEqual([])
    })

    test('Ask for help opens on the lesson form and takes details before an instructor replies', async ({ page, request }, info) => {
      const errors = watchErrors(page)
      const run = `${theme} ${info.project.name} ${Date.now()}`
      await open(page, `/lessons/${fixtures.lesson_id}?cohort_id=${fixtures.cohort_id}`, 3, theme)
      const help = page.locator('#help')
      await expect(help.getByRole('button', { name: 'Ask for help' })).toBeVisible({ timeout: 20000 })
      // One lesson-scoped help action: no competing Message button beside it.
      await expect(help.getByRole('button', { name: /^Message/ })).toHaveCount(0)
      await expect(help.getByRole('link', { name: /^Message/ })).toHaveCount(0)
      await help.getByRole('button', { name: 'Ask for help' }).click()

      const dialog = page.getByRole('dialog')
      const about = dialog.getByRole('group', { name: 'What is your question about?' })
      await expect(about.getByRole('radio', { name: 'Lesson: Pass QA practice' })).toBeChecked()
      const message = dialog.getByRole('textbox', { name: 'What have you tried, and where did you get stuck?' })
      await expect(message).toBeInViewport()
      const kinds = dialog.getByRole('group', { name: 'What kind of help do you need?' })
      await expect(kinds.locator('label')).toHaveText(['Concept', 'Technical issue', 'Instructions', 'Feedback', 'Something else'])
      if (phone(page)) await touchTarget(kinds.locator('label').first(), 'Concept pill')
      await kinds.getByText('Technical issue').click()
      await expect(kinds.getByRole('radio', { name: 'Technical issue' })).toBeChecked()
      await expect(dialog.getByText('A tool, setup, or error is blocking me.')).toBeVisible()
      // One click moves the question to an exercise, and back.
      await about.getByText('Exercise 1: Practice 1').click()
      await expect(about.getByRole('radio', { name: 'Exercise 1: Practice 1' })).toBeChecked()
      await about.getByText('Lesson: Pass QA practice').click()
      await message.fill(`My greeting prints nothing (${run}).`)
      await evidence(page, 'help-form', theme, info.project.name, '[role="dialog"]')
      await dialog.getByRole('button', { name: 'Send to my instructor' }).click()
      await expect(page.getByText('Your instructor can now see this request.')).toBeVisible()

      await expect(dialog.getByText('Add to your question')).toBeVisible()
      await expect(dialog.getByText('Add more details or paste an error message while you wait')).toBeVisible()
      const details = dialog.getByRole('textbox', { name: 'Add to your question' })
      await details.fill(`The console says undefined (${run}).`)
      await evidence(page, 'help-add-details', theme, info.project.name, '[role="dialog"]')
      if (phone(page)) await touchTarget(dialog.getByRole('button', { name: 'Add details' }), 'Add details')
      await dialog.getByRole('button', { name: 'Add details' }).click()
      await expect(page.getByText('Added to your help request.')).toBeVisible()
      await expect(dialog.getByText(`The console says undefined (${run}).`)).toBeVisible()

      const list = await (await request.get(`${API}/api/v1/help_requests?cohort_id=${fixtures.cohort_id}`, { headers: as(3) })).json()
      const sent = list.help_requests.find((item: { message: string }) => item.message === `My greeting prints nothing (${run}).`)
      expect(sent.status).toBe('open')
      expect(sent.replies.at(-1)).toMatchObject({ from_student: true, body: `The console says undefined (${run}).` })
      // Cancel so the next run asks a fresh question on the same lesson.
      await dialog.getByRole('button', { name: 'Cancel request' }).click()
      await expect(page.getByText('Help request canceled.')).toBeVisible()
      expect(errors).toEqual([])
    })
  })
}
