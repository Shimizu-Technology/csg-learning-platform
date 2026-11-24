import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { checkedLifecycle } from './ownership.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')

interface RunFixtures {
  accept_id: number
  override_id: number
  redo_id: number
  stale_id: number
}

const fixturesPath = fileURLToPath(new URL('../../.qa-local/x6-grade-suggestions-fixtures.json', import.meta.url))
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8')) as {
  opted_in_cohort_id: number
  module_id: number
  off_cohort_id: number
  off_submission_id: number
  graded_r_submission_id: number
  runs: Record<string, RunFixtures>
}

const owners = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const id = `x6-grade-suggestions-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', id)
  owners.set(page, id)
})
test.afterEach(async ({ page }) => {
  await page.close()
  const id = owners.get(page)
  if (id) checkedLifecycle(session, 'release', id)
  owners.delete(page)
})

const output = fileURLToPath(new URL('../../.qa-local/x6-grade-suggestions/', import.meta.url))
const headers = (user = 2) => ({ Authorization: `Bearer test_token_${user}` })

async function open(page: Page, path: string, user = 2) {
  await page.route('**/*', (route) =>
    ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort(),
  )
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function evidence(page: Page, name: string, project: string, theme: string, axeSelector?: string) {
  await page.waitForLoadState('networkidle')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${name} horizontal overflow`).toBeLessThanOrEqual(0)
  if (axeSelector && (await page.locator(axeSelector).count())) {
    const results = await new AxeBuilder({ page })
      .include(axeSelector)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations, `${name} axe violations`).toEqual([])
  }
  mkdirSync(output, { recursive: true })
  await page.screenshot({ path: `${output}${project}-${theme}-${name}.png` })
  appendFileSync(`${output}ledger.jsonl`, JSON.stringify({ name, project, theme, overflow, url: page.url() }) + '\n')
}

async function expectTouchTarget(page: Page, locator: ReturnType<Page['locator']>, label: string) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  expect(box && box.height, `${label} height >= 44px`).toBeGreaterThanOrEqual(44)
}

test.describe.configure({ mode: 'serial', timeout: 90_000 })

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((choice) => localStorage.setItem('csg-learn:theme', choice), theme)
    })

    test('GS01 Select B does not auto-save, Save & next preserves filters, and Override note persists', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
      })
      // This harness never reaches GitHub, so Check GitHub again's refresh is refused (422) and
      // the suggestion is scored again from saved checks. Chrome logs each refusal; allow only those.
      let refusedRefreshes = 0
      page.on('response', (res) => {
        if (res.status() === 422 && res.request().method() === 'POST' && /\/submissions\/\d+\/github_checks$/.test(new URL(res.url()).pathname)) refusedRefreshes += 1
      })
      const unexpectedErrors = () => {
        let allowed = refusedRefreshes
        return errors.filter((text) => !(allowed > 0 && text.includes('status of 422') && allowed-- > 0))
      }

      const run = fixtures.runs[`${info.project.name}:${theme}`]
      expect(run).toBeTruthy()
      const phone = info.project.name.endsWith('390')

      // 1. Open queue scoped to opted-in cohort + module, verify scannable suggestion badges
      await open(page, `/admin/grading?cohort_id=${fixtures.opted_in_cohort_id}&module_id=${fixtures.module_id}`, 2)
      const acceptRow = page.locator(`#submission-row-${run.accept_id}`)
      await expect(acceptRow).toBeVisible({ timeout: 15000 })
      await expect(acceptRow).toContainText('B suggested')
      await expect(page.locator(`#submission-row-${run.redo_id}`)).toContainText('Review for Redo')
      await expect(page.locator(`#submission-row-${run.stale_id}`)).toContainText('Out of date')
      await evidence(page, 'queue-badges', info.project.name, theme, '[aria-label="Grading queue"]')

      // 2. Open suggest_b item: verify card, 44px touch targets, Select B does NOT auto-save
      await acceptRow.click()
      const card = page.locator('[data-grade-suggestion="suggest_b"]')
      await expect(card).toBeVisible()
      await expect(card).toContainText('Checks passed · B suggested')
      await expect(card).toContainText('instructors confirm every final grade')

      const selectB = card.getByRole('button', { name: 'Select B' })
      const checkGithub = card.getByRole('button', { name: 'Check GitHub again' })
      await expectTouchTarget(page, selectB, 'Select B')
      await expectTouchTarget(page, checkGithub, 'Check GitHub again')

      let gradeCalls = 0
      page.on('request', (req) => {
        if (req.method() === 'PATCH' && req.url().includes('/grade')) gradeCalls += 1
      })

      await selectB.click()
      await page.waitForTimeout(300)
      expect(gradeCalls, 'Select B must NOT auto-save').toBe(0)
      await expect(page.locator('[data-grade-bar] button', { hasText: /^B$/ })).toHaveAttribute('aria-pressed', 'true')
      await evidence(page, 'suggest-b-selected', info.project.name, theme, '[aria-label="Submission review"]')

      // 3. Explicit Save and next saves B and preserves cohort_id + module_id filters
      const saveBtn = page.locator('[data-grade-bar]').getByRole('button', { name: 'Save and next' })
      await expectTouchTarget(page, saveBtn, 'Save and next')
      const saveAcceptRes = page.waitForResponse((res) => res.url().includes(`/submissions/${run.accept_id}/grade`) && res.request().method() === 'PATCH')
      await saveBtn.click()
      expect((await saveAcceptRes).status()).toBe(200)

      await expect.poll(() => new URL(page.url()).searchParams.get('submission')).toBe(String(run.override_id))
      expect(new URL(page.url()).searchParams.get('cohort_id')).toBe(String(fixtures.opted_in_cohort_id))
      expect(new URL(page.url()).searchParams.get('module_id')).toBe(String(fixtures.module_id))

      // Verify accepted decision persisted on API
      const acceptApi = await page.request.get(`/api/v1/submissions/${run.accept_id}`, { headers: headers(2) })
      const acceptJson = await acceptApi.json()
      expect(acceptJson.submission.grade).toBe('B')
      expect(acceptJson.submission.grade_suggestion.decision).toBe('accepted')

      // 4. Override next suggest_b item with Grade A + override note
      await expect(page.locator('[data-grade-suggestion="suggest_b"]')).toBeVisible()
      await page.locator('[data-grade-bar] button', { hasText: /^A$/ }).click()
      const overrideInput = page.locator('[data-grade-bar]').getByLabel('Override note (optional)')
      await expectTouchTarget(page, overrideInput, 'Override note input')
      await overrideInput.fill('Clean recursive helper')
      await evidence(page, 'override-note', info.project.name, theme, '[data-grade-bar]')

      const saveOverrideRes = page.waitForResponse((res) => res.url().includes(`/submissions/${run.override_id}/grade`) && res.request().method() === 'PATCH')
      await page.locator('[data-grade-bar]').getByRole('button', { name: 'Save and next' }).click()
      expect((await saveOverrideRes).status()).toBe(200)

      const overrideApi = await page.request.get(`/api/v1/submissions/${run.override_id}`, { headers: headers(2) })
      const overrideJson = await overrideApi.json()
      expect(overrideJson.submission.grade).toBe('A')
      expect(overrideJson.submission.grade_suggestion.decision).toBe('overridden')
      expect(overrideJson.submission.grade_suggestion.override_reason).toBe('Clean recursive helper')

      // 5. Next item is review_for_redo: verify Redo still requires written feedback
      await expect.poll(() => new URL(page.url()).searchParams.get('submission')).toBe(String(run.redo_id))
      await expect(page.locator('[data-grade-suggestion="review_for_redo"]')).toBeVisible()
      await expect(page.locator('[data-grade-suggestion="review_for_redo"]').getByRole('button', { name: 'Select B' })).toHaveCount(0)
      await page.locator('[data-grade-bar] button', { hasText: /^Redo$/ }).click()
      await page.locator('[data-grade-bar]').getByRole('button', { name: 'Save and next' }).click()
      await expect(page.locator('[data-grade-bar] [role="alert"]')).toContainText('Write feedback before choosing Redo')

      // 6. Navigate to stale item, write unsaved feedback draft, click Check GitHub again -> draft preserved!
      if (phone) {
        await open(page, `/admin/grading?cohort_id=${fixtures.opted_in_cohort_id}&module_id=${fixtures.module_id}&submission=${run.stale_id}`, 2)
      } else {
        await page.locator(`#submission-row-${run.stale_id}`).click()
        // Redo is still chosen but unsaved from step 5: moving on asks first (UX-1).
        const discard = page.getByRole('dialog', { name: 'Discard your unsaved review?' })
        await expect(discard).toBeVisible()
        await discard.getByRole('button', { name: 'Discard and move on' }).click()
      }
      const staleCard = page.locator('[data-grade-suggestion][data-grade-suggestion-stale="true"]')
      await expect(staleCard).toBeVisible()
      await expect(staleCard).toContainText('Out of date')
      await expect(staleCard.getByRole('button', { name: 'Select B' })).toHaveCount(0)

      // The feedback box is always in view, phones included (UX-1).
      const feedbackBox = page.locator('[data-grade-bar] [contenteditable="true"], [data-grade-bar] textarea').first()
      // fill() is one edit: a burst of key events right as the review opens can race its first focus.
      await feedbackBox.fill('Draft kept across re-evaluate')

      // One click: fetch the commit's checks, and score the suggestion again (also when GitHub can't be reached).
      // The card's top sits above the pinned grade bar, which now always holds the feedback box.
      await staleCard.evaluate((element) => element.scrollIntoView({ block: 'start' }))
      await staleCard.getByRole('button', { name: 'Check GitHub again' }).click()

      const refreshedCard = page.locator('[data-grade-suggestion="suggest_b"][data-grade-suggestion-stale="false"]')
      await expect(refreshedCard).toBeVisible()
      await expect(refreshedCard.getByRole('button', { name: 'Select B' })).toBeVisible()
      await expect(feedbackBox).toContainText('Draft kept across re-evaluate')
      await evidence(page, 'reevaluated-draft-kept', info.project.name, theme, '[aria-label="Submission review"]')

      expect(refusedRefreshes).toBeLessThanOrEqual(1)
      expect(unexpectedErrors()).toEqual([])
    })

    test('GS02 Checks passed · Grade R displays side-by-side and Off cohort (Cohort 3) stays untouched', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
      })

      // 1. Saved Grade R alongside Checks passed
      await open(page, `/admin/submissions/${fixtures.graded_r_submission_id}`, 2)
      const comparison = page.locator('[data-suggestion-saved-comparison]')
      await expect(comparison).toBeVisible({ timeout: 15000 })
      await expect(comparison).toContainText('Checks passed · Grade R')
      await expect(comparison).toContainText('Overridden')
      await expect(comparison).toContainText('Hardcoded output passed minimal tests')
      await evidence(page, 'checks-passed-grade-r', info.project.name, theme, '[data-grade-suggestion]')

      // 2. Off cohort (Cohort 3 shape) queue and review have ZERO suggestion UI
      await open(page, `/admin/grading?cohort_id=${fixtures.off_cohort_id}`, 2)
      await expect(page.locator(`#submission-row-${fixtures.off_submission_id}`)).toBeVisible()
      await expect(page.locator('[data-queue-suggestion]')).toHaveCount(0)
      await expect(page.locator('[aria-label="Automated check filter"]')).toHaveCount(0)
      await page.locator(`#submission-row-${fixtures.off_submission_id}`).click()
      await expect(page.locator('[aria-label="Submission review"]')).toBeVisible()
      await expect(page.locator('[data-grade-suggestion]')).toHaveCount(0)
      await evidence(page, 'off-cohort-unchanged', info.project.name, theme, 'main')

      expect(errors).toEqual([])
    })
  })
}
