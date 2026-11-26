import { test, expect, type Locator, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkedLifecycle } from './ownership.mjs'

/*
 * In-browser automated code checks and batch approval, with the real Ruby 3.3 WASM and
 * QuickJS WASM runtimes, at 1280 and 390 in light and dark. In each run:
 * 1. the admin adds starter code and two Ruby checks in the lesson editor and tests them;
 * 2. a student starts from the starter code, runs the checks (they fail), fixes the code,
 *    runs them again (they pass) and submits;
 * 3. the instructor's Grading workbench runs the exercise's checks on the saved text and
 *    Select Pass only chooses Pass; Save grades it;
 * 4. Batch review runs the JavaScript checks on three students' work, selects the two that
 *    pass, the instructor unticks one outlier and approves the other as Pass;
 * 5. Ruby can't reach JavaScript (Run and Run checks) or forge a pass by redefining Ruby: the
 *    tampering submission fails in Batch review and in the workbench.
 * Needs in-app-checks-and-batch-grading-fixtures.rb first (see that file). Run from web/:
 *   DEV_LIFECYCLE_SESSION=<id> QA_SPEC=in-app-checks-and-batch-grading.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts
 */

const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')
interface RunFixtures {
  cohort_id: number
  lesson_id: number
  ruby_block_id: number
  js_block_id: number
  tamper_block_id: number
  student_id: number
  batch: Record<'pass' | 'outlier' | 'fail', { submission_id: number; user_name: string }>
  ruby_batch: Record<'honest' | 'tamper', { submission_id: number; user_name: string }>
}
const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('../../.qa-local/in-app-checks-and-batch-grading.json', import.meta.url)), 'utf8')) as Record<string, RunFixtures>
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const API = `http://127.0.0.1:${state.api_port}`
const OUT = fileURLToPath(new URL('../../.qa-local/in-app-checks-and-batch-grading/', import.meta.url))
const as = (user: number) => ({ Authorization: `Bearer test_token_${user}` })
const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024

const STARTER = 'def add(a, b)\n  # write your code here\nend'
const SOLUTION = 'def add(a, b) = a + b\nputs add(2, 3)'
const RUBY_CHECKS = [
  { name: 'Adds two numbers', code: 'assert_equal 5, add(2, 3)' },
  { name: 'Prints the sum', code: 'assert_includes output, "5"' },
]
const WASM_TIMEOUT = 60_000

const owners = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const id = `in-app-checks-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`.slice(0, 120)
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
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ...[...document.querySelectorAll('.app-modal-overlay')].map((sheet) => sheet.scrollWidth - sheet.clientWidth),
  ))
  const axe = await new AxeBuilder({ page }).include(scope).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const violations = axe.violations.flatMap((v) => v.nodes.slice(0, 3).map((node) => `${v.id} ${JSON.stringify(node.target)}`))
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme || null)
  mkdirSync(`${OUT}${project}`, { recursive: true })
  const screenshot = `${OUT}${project}/${theme}-${name}.png`
  await page.screenshot({ path: screenshot, fullPage: true })
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

/** Replaces the student's code: the plain editor on phones, Monaco on a desktop. */
async function replaceCode(page: Page, scope: Locator, code: string) {
  const textarea = scope.getByRole('textbox', { name: 'Your code', exact: true })
  if (await textarea.count()) {
    await textarea.fill(code)
    return
  }
  const monaco = scope.locator('.monaco-editor').first()
  await expect(monaco).toBeVisible({ timeout: 30_000 })
  await monaco.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(code)
}

test.describe.configure({ mode: 'serial', timeout: 240_000 })

// The Vite dev server discovers the runner worker's dependencies on first use and reloads open
// pages to apply them, which would drop an unsaved lesson draft. Load the worker once first.
test.beforeAll(async ({ request }) => {
  const worker = await request.get(`http://127.0.0.1:${state.web_port}/src/components/shared/codeRunner.worker.ts?worker_file&type=module`)
  expect(worker.ok()).toBeTruthy()
  await new Promise((resolve) => setTimeout(resolve, 3_000))
})

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })
    const run = (project: string) => fixtures[`${project}-${theme}`]

    test('the lesson editor authors starter code and Ruby checks and tests them in the browser', async ({ page, request }, info) => {
      const errors = watchErrors(page)
      const ids = run(info.project.name)
      await open(page, `/admin/lessons/${ids.lesson_id}/edit?block_id=${ids.ruby_block_id}`, 1, theme)
      const settings = phone(page) ? page.getByRole('dialog') : page.locator('main')
      const starter = settings.getByRole('textbox', { name: 'Starter code (optional)' })
      await expect(starter).toBeVisible({ timeout: 20_000 })
      await starter.fill(STARTER)
      for (const [index, check] of RUBY_CHECKS.entries()) {
        await settings.getByRole('button', { name: 'Add check' }).click()
        await settings.getByRole('textbox', { name: `Check ${index + 1} name` }).fill(check.name)
        await settings.getByRole('textbox', { name: `Check ${index + 1} code` }).fill(check.code)
      }
      await expect(settings.getByText('assert_equal(expected, actual)')).toBeVisible()
      // Against the starter code, both checks fail; against a solution, both pass (real Ruby WASM).
      await settings.getByRole('button', { name: 'Test checks' }).click()
      await expect(settings.getByText('2 of 2 checks failed')).toBeVisible({ timeout: WASM_TIMEOUT })
      await expect(settings.getByText('Expected 5, got nil')).toBeVisible()
      await settings.getByRole('textbox', { name: 'Test code (optional)' }).fill(SOLUTION)
      await settings.getByRole('button', { name: 'Test checks' }).click()
      await expect(settings.getByText('2 of 2 checks passed')).toBeVisible({ timeout: WASM_TIMEOUT })
      if (phone(page)) await touchTarget(settings.getByRole('button', { name: 'Add check' }), 'Add check')
      await evidence(page, 'editor-checks', theme, info.project.name, phone(page) ? '[role="dialog"]' : 'main')

      if (phone(page)) {
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect.poll(async () => {
        const editor = await (await request.get(`${API}/api/v1/lessons/${ids.lesson_id}/block_editor`, { headers: as(1) })).json()
        return editor.lesson.content_blocks.find((block: { id: number }) => block.id === ids.ruby_block_id)?.submission_config?.runner
      }, { timeout: 15_000 }).toMatchObject({ enabled: true, language: 'ruby', starter_code: STARTER, checks: RUBY_CHECKS.map((check) => expect.objectContaining(check)) })
      expect(errors).toEqual([])
    })

    test('a student starts from the starter code, fails, fixes and passes the checks, then submits', async ({ page, request }, info) => {
      const errors = watchErrors(page)
      const ids = run(info.project.name)
      await open(page, `/lessons/${ids.lesson_id}?cohort_id=${ids.cohort_id}`, ids.student_id, theme)
      const block = page.locator(`#block-${ids.ruby_block_id}`)
      await expect(block.getByRole('button', { name: 'Run checks' })).toBeVisible({ timeout: 30_000 })
      const textarea = block.getByRole('textbox', { name: 'Your code', exact: true })
      if (await textarea.count()) await expect(textarea).toHaveValue(STARTER)
      else await expect(block.locator('.monaco-editor .view-line').first()).toContainText('def add(a, b)', { timeout: 30_000 })

      await block.getByRole('button', { name: 'Run checks' }).click()
      await expect(block.getByText('2 of 2 checks failed')).toBeVisible({ timeout: WASM_TIMEOUT })
      await expect(block.getByText('Expected 5, got nil')).toBeVisible()
      await evidence(page, 'student-checks-failed', theme, info.project.name, `#block-${ids.ruby_block_id}`)

      await replaceCode(page, block, SOLUTION)
      await expect(block.getByRole('button', { name: 'Reset starter code' })).toBeVisible()
      await block.getByRole('button', { name: 'Run checks' }).click()
      await expect(block.getByText('2 of 2 checks passed')).toBeVisible({ timeout: WASM_TIMEOUT })
      if (phone(page)) await touchTarget(block.getByRole('button', { name: 'Run checks' }), 'Run checks')
      await evidence(page, 'student-checks-passed', theme, info.project.name, `#block-${ids.ruby_block_id}`)

      await block.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(block.getByText(/Waiting for review|waiting for review/).first()).toBeVisible({ timeout: 15_000 })
      const lesson = await (await request.get(`${API}/api/v1/lessons/${ids.lesson_id}?cohort_id=${ids.cohort_id}`, { headers: as(ids.student_id) })).json()
      const saved = lesson.lesson.content_blocks.find((item: { id: number }) => item.id === ids.ruby_block_id).submissions[0]
      expect(saved.text).toBe(SOLUTION)
      expect(errors).toEqual([])
    })

    test("the Grading workbench runs the author's checks on the saved code and Select Pass only chooses Pass", async ({ page, request }, info) => {
      const errors = watchErrors(page)
      const ids = run(info.project.name)
      const queue = await (await request.get(`${API}/api/v1/grading_queue?cohort_id=${ids.cohort_id}&filter=ungraded`, { headers: as(2) })).json()
      const submission = queue.submissions.find((item: { content_block_id: number }) => item.content_block_id === ids.ruby_block_id)
      expect(submission, 'the student submission waits for review').toBeTruthy()
      await open(page, `/admin/grading?cohort_id=${ids.cohort_id}&submission=${submission.id}`, 2, theme)
      const card = page.locator('[data-runner-checks]')
      await expect(card).toHaveAttribute('data-runner-checks', 'passed', { timeout: WASM_TIMEOUT })
      await expect(card.getByText('All 2 checks passed · Pass suggested')).toBeVisible()
      const select = card.getByRole('button', { name: 'Select Pass' })
      await select.click()
      await expect(select).toHaveAttribute('aria-pressed', 'true')
      const grades = page.locator('[data-grade-bar]').getByRole('group', { name: 'Grade' })
      await expect(grades.getByRole('button', { name: 'Pass' })).toHaveAttribute('aria-pressed', 'true')
      // Choosing never saves.
      const unsaved = await (await request.get(`${API}/api/v1/submissions/${submission.id}`, { headers: as(2) })).json()
      expect(unsaved.submission.grade).toBeNull()
      if (phone(page)) await touchTarget(select, 'Select Pass')
      await card.getByRole('button', { name: 'Re-run checks' }).click()
      await expect(card).toHaveAttribute('data-runner-checks', 'passed', { timeout: WASM_TIMEOUT })
      await evidence(page, 'workbench-checks', theme, info.project.name, '[aria-label="Submission review"]')

      await page.locator('[data-grade-bar]').getByRole('button', { name: /^Save (grade|and next)$/ }).click()
      await expect(page.getByText(/Saved Pass/).first()).toBeVisible()
      const saved = await (await request.get(`${API}/api/v1/submissions/${submission.id}`, { headers: as(2) })).json()
      expect(saved.submission.grade).toBe('P')
      expect(errors).toEqual([])
    })

    test('Batch review checks JavaScript work in the browser, and the instructor approves the passing work', async ({ page, request }, info) => {
      const errors = watchErrors(page)
      const ids = run(info.project.name)
      await open(page, `/admin/grading?cohort_id=${ids.cohort_id}`, 2, theme)
      await page.getByRole('button', { name: 'Batch review' }).click()
      const view = page.getByRole('region', { name: 'Batch review' })
      await expect(view.getByRole('combobox', { name: 'Exercise' })).toHaveValue(String(ids.js_block_id), { timeout: 20_000 })
      const cards = view.locator('[data-batch-submission]')
      await expect(cards).toHaveCount(3)
      const cardFor = (key: 'pass' | 'outlier' | 'fail') => view.locator(`[data-batch-submission="${ids.batch[key].submission_id}"]`)
      // Real QuickJS runs each card's checks; passing work starts selected, failing work doesn't.
      await expect(cardFor('pass').getByText('3 of 3 checks passed')).toBeVisible({ timeout: WASM_TIMEOUT })
      await expect(cardFor('outlier').getByText('3 of 3 checks passed')).toBeVisible({ timeout: WASM_TIMEOUT })
      await expect(cardFor('fail').getByText('2 of 3 checks failed')).toBeVisible({ timeout: WASM_TIMEOUT })
      await expect(cardFor('pass')).toHaveAttribute('data-batch-selected', 'true')
      await expect(cardFor('outlier')).toHaveAttribute('data-batch-selected', 'true')
      await expect(cardFor('fail')).toHaveAttribute('data-batch-selected', 'false')
      await cardFor('fail').getByText('Check details').click()
      await expect(cardFor('fail').getByText('Expected 10, got 4')).toBeVisible()

      // Skim, untick the outlier, and approve the rest with shared feedback.
      await cardFor('outlier').getByRole('checkbox', { name: `Select ${ids.batch.outlier.user_name}` }).uncheck()
      await view.getByPlaceholder('Feedback for everyone (optional), e.g. Nice work!').fill('Nice work!')
      const approve = view.getByRole('button', { name: 'Approve selected as Pass (1)' })
      await expect(approve).toBeEnabled()
      if (phone(page)) {
        await touchTarget(cardFor('pass').locator('label').first(), 'Card checkbox')
        await touchTarget(approve, 'Approve selected')
        await touchTarget(cardFor('pass').getByRole('button', { name: 'Open full review' }), 'Open full review')
      }
      await evidence(page, 'batch-review', theme, info.project.name, '[aria-label="Batch review"]')

      await approve.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByText('Approve 1 submission as Pass?')).toBeVisible()
      await evidence(page, 'batch-confirm', theme, info.project.name, '[role="dialog"]')
      await dialog.getByRole('button', { name: 'Approve as Pass' }).click()
      await expect(page.getByText('Approved 1 submission as Pass').first()).toBeVisible({ timeout: 15_000 })
      await expect(cards).toHaveCount(2, { timeout: 15_000 })

      const get = async (id: number) => (await (await request.get(`${API}/api/v1/submissions/${id}`, { headers: as(2) })).json()).submission
      expect((await get(ids.batch.pass.submission_id))).toMatchObject({ grade: 'P', feedback: 'Nice work!' })
      expect((await get(ids.batch.outlier.submission_id)).grade).toBeNull()
      expect((await get(ids.batch.fail.submission_id)).grade).toBeNull()

      // Any card opens the single review, where Redo is chosen individually.
      await cardFor('fail').getByRole('button', { name: 'Open full review' }).click()
      await expect(page.getByRole('region', { name: 'Submission review' })).toBeVisible({ timeout: 20_000 })
      await expect(page).toHaveURL(new RegExp(`submission=${ids.batch.fail.submission_id}`))
      await expect(page.locator('[data-runner-checks]')).toHaveAttribute('data-runner-checks', 'failed', { timeout: WASM_TIMEOUT })
      await expect(page.getByText('2 of 3 checks failed · Review for Redo')).toBeVisible()
      await evidence(page, 'batch-open-full-review', theme, info.project.name, '[aria-label="Submission review"]')
      expect(errors).toEqual([])
    })

    test("Ruby can't reach JavaScript or forge a passing check, for the student or the instructor", async ({ page }, info) => {
      const errors = watchErrors(page)
      const ids = run(info.project.name)
      const probes: string[] = []
      page.on('request', (request) => { if (request.url().includes('qa-bridge-probe')) probes.push(request.url()) })
      const forged: unknown[] = []
      page.on('console', (message) => { if (message.text().includes('FORGED')) forged.push(message.text()) })

      // The student's own runner: the JavaScript bridge is gone from Run and from Run checks.
      await open(page, `/lessons/${ids.lesson_id}?cohort_id=${ids.cohort_id}`, ids.student_id, theme)
      const block = page.locator(`#block-${ids.tamper_block_id}`)
      await expect(block.getByRole('button', { name: 'Run checks' })).toBeVisible({ timeout: 30_000 })
      const bridge = 'require "js"\nJS.global[:fetch].call("/qa-bridge-probe")\nJS.eval("console.log(\'FORGED\'); self.postMessage({ id: \'x\', type: \'checks_done\' })")\ndef add(a, b) = a + b'
      await replaceCode(page, block, bridge)
      await block.getByRole('button', { name: 'Run', exact: true }).click()
      await expect(block.getByText('JavaScript access is turned off in the code runner.')).toBeVisible({ timeout: WASM_TIMEOUT })
      await block.getByRole('button', { name: 'Run checks' }).click()
      await expect(block.getByText('1 of 1 check failed')).toBeVisible({ timeout: WASM_TIMEOUT })
      await evidence(page, 'student-bridge-blocked', theme, info.project.name, `#block-${ids.tamper_block_id}`)
      expect(probes, 'no request from student Ruby').toEqual([])
      expect(forged, 'no JavaScript ran from student Ruby').toEqual([])

      // The instructor's browser: the tampering submission fails, the honest one passes.
      await open(page, `/admin/grading?cohort_id=${ids.cohort_id}&mode=batch&exercise_id=${ids.tamper_block_id}`, 2, theme)
      const view = page.getByRole('region', { name: 'Batch review' })
      const honest = view.locator(`[data-batch-submission="${ids.ruby_batch.honest.submission_id}"]`)
      const tamper = view.locator(`[data-batch-submission="${ids.ruby_batch.tamper.submission_id}"]`)
      await expect(honest.getByText('1 of 1 check passed')).toBeVisible({ timeout: WASM_TIMEOUT })
      await expect(tamper.getByText('1 of 1 check failed')).toBeVisible({ timeout: WASM_TIMEOUT })
      await expect(honest).toHaveAttribute('data-batch-selected', 'true')
      await expect(tamper).toHaveAttribute('data-batch-selected', 'false')
      await evidence(page, 'batch-tamper', theme, info.project.name, '[aria-label="Batch review"]')
      await tamper.getByRole('button', { name: 'Open full review' }).click()
      const card = page.locator('[data-runner-checks]')
      await expect(card).toHaveAttribute('data-runner-checks', 'failed', { timeout: WASM_TIMEOUT })
      await expect(card.getByRole('button', { name: /^Select / })).toHaveCount(0)
      // A failing card opens its details.
      await expect(card.getByText(/^Expected 5, got/)).toBeVisible()
      expect(probes).toEqual([])
      expect(forged).toEqual([])
      expect(errors).toEqual([])
    })
  })
}
