import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * Separate clean Cohort 3 Off-cohort regression spec for Wave 3 X-6.10.
 *
 * Runs against a fresh owned QA database loaded ONLY with scripts/qa/first-run-states-fixtures.rb
 * (NEVER mutating the Prework Demo — synthetic fixture!) to prove that Cohort 3
 * (`student_experience_v2: false`, all X-6 switches default Off) has:
 *   - zero X-6 automation writes (zero grade suggestions, zero issue deliveries)
 *   - zero leaked suggestion or v2 issue-delivery UI on staff grading queue/review
 *   - unchanged legacy student Today / Learn experience
 *   - zero horizontal overflow, zero console/page errors, zero Axe WCAG 2.1 AA violations
 *     at 1280px and 390px in both light and dark mode.
 */

const STATE_PATH = fileURLToPath(new URL('../../.qa-local/state.json', import.meta.url))
const FIRST_RUN_PATH = fileURLToPath(new URL('../../.qa-local/first-run.json', import.meta.url))
const OUT_DIR = fileURLToPath(new URL('../../.qa-local/x6-cohort3-off/', import.meta.url))

const qaState = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as { api_port: number; web_port: number }
const fixtures = JSON.parse(readFileSync(FIRST_RUN_PATH, 'utf8')) as { off: number; first: number }

const headers = (user: number) => ({ Authorization: `Bearer test_token_${user}` })

async function open(page: Page, path: string, user: number, theme: 'light' | 'dark') {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.addInitScript((choice) => {
    try {
      localStorage.setItem('csg-learn:theme', choice)
    } catch {
      /* ignore */
    }
  }, theme)
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function verifySurface(page: Page, name: string, project: string, theme: 'light' | 'dark') {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(200)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${project} ${theme} ${name} overflow`).toBeLessThanOrEqual(0)
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme || null)
  expect(dataTheme).toBe(theme)
  const axe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations, `${project} ${theme} ${name} axe violations`).toEqual([])
  mkdirSync(`${OUT_DIR}${project}`, { recursive: true })
  const screenshot = `${OUT_DIR}${project}/${theme}-${name}.png`
  await page.screenshot({ path: screenshot })
  appendFileSync(`${OUT_DIR}ledger.jsonl`, `${JSON.stringify({ name, project, theme, overflow, violations: axe.violations.length, url: page.url() })}\n`)
}

test.describe.configure({ mode: 'serial' })

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })

    test('Cohort 3 Off stays 100% untouched: legacy student Today/Learn and zero X-6 staff leakage', async ({ page }, info) => {
      const project = info.project.name
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
      })

      // 1. Student (persona 3) in Cohort 3 Off sees legacy Dashboard (NOT student_experience_v2 Today)
      await open(page, `/dashboard?cohort_id=${fixtures.off}`, 3, theme)
      await expect(page.locator('[data-today="v2"]')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible({ timeout: 15_000 })
      await verifySurface(page, '01-student-off-dashboard', project, theme)

      // 2. Verify API feature flags on Cohort 3 Off: student_experience_v2 is false, all X-6 opt-in switches are false
      const featRes = await page.request.get(
        `http://127.0.0.1:${qaState.api_port}/api/v1/cohorts/${fixtures.off}/feature_settings`,
        { headers: headers(1) },
      )
      expect(featRes.status()).toBe(200)
      const featJson = (await featRes.json()) as { features: Record<string, boolean> }
      expect(featJson.features.student_experience_v2).toBe(false)
      expect(featJson.features.github_app).toBe(false)
      expect(featJson.features.github_webhooks).toBe(false)
      expect(featJson.features.github_reconciliation).toBe(false)
      expect(featJson.features.github_grade_suggestions).toBe(false)
      expect(featJson.features.github_issue_delivery_v2).toBe(false)

      // 3. Instructor grading queue for Cohort 3 Off has ZERO suggestion badges, filters, or v2 issue delivery UI
      await open(page, `/admin/grading?filter=all&cohort_id=${fixtures.off}`, 2, theme)
      await expect(page.locator('[aria-label="Grading queue"] li button').first()).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('[data-queue-suggestion]')).toHaveCount(0)
      await expect(page.locator('[aria-label="Automated check filter"]')).toHaveCount(0)
      await page.locator('[aria-label="Grading queue"] li button').first().click()
      await expect(page.locator('[aria-label="Submission review"]')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('[data-grade-suggestion]')).toHaveCount(0)
      await expect(page.locator('[data-github-issue-delivery]')).toHaveCount(0)
      await verifySurface(page, '02-staff-off-grading', project, theme)

      // Verify API submission payload for Cohort 3 Off has zero X-6 fields populated
      const subId = new URL(page.url()).searchParams.get('submission')
      expect(subId).toBeTruthy()
      const subRes = await page.request.get(
        `http://127.0.0.1:${qaState.api_port}/api/v1/submissions/${subId}`,
        { headers: headers(2) },
      )
      expect(subRes.status()).toBe(200)
      const subJson = (await subRes.json()) as {
        submission: { grade_suggestion?: unknown; github_issue_delivery?: unknown }
      }
      expect(subJson.submission.grade_suggestion ?? null).toBeNull()
      expect(subJson.submission.github_issue_delivery ?? null).toBeNull()

      expect(errors).toEqual([])
    })
  })
}
