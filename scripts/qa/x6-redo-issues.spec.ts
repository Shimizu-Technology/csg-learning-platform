import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { checkedLifecycle } from './ownership.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')

const fixturesPath = fileURLToPath(new URL('../../.qa-local/x6-redo-issues-fixtures.json', import.meta.url))
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8')) as {
  opted_in_cohort_id: number
  off_cohort_id: number
  failed_submission_id: number
  failed_by_run: Record<string, number>
  pending_submission_id: number
  ungraded_submission_id: number
  off_submission_id: number
}

const owners = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const id = `x6-redo-issues-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', id)
  owners.set(page, id)
})
test.afterEach(async ({ page }) => {
  await page.close()
  const id = owners.get(page)
  if (id) checkedLifecycle(session, 'release', id)
  owners.delete(page)
})

const output = fileURLToPath(new URL('../../.qa-local/x6-redo-issues/', import.meta.url))
const headers = (user = 2) => ({ Authorization: `Bearer test_token_${user}` })

async function open(page: Page, path: string, user = 2) {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function evidence(page: Page, name: string, project: string, theme: string, axeSelector?: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  if (axeSelector && await page.locator(axeSelector).count()) {
    const violations = await new AxeBuilder({ page }).include(axeSelector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(violations.violations.filter(item => ['serious', 'critical'].includes(item.impact || ''))).toEqual([])
  }
  mkdirSync(output, { recursive: true })
  await page.screenshot({ path: `${output}${project}-${theme}-${name}.png` })
  appendFileSync(`${output}ledger.jsonl`, JSON.stringify({ name, project, theme, overflow, url: page.url() }) + '\n')
}

test.describe.configure({ mode: 'serial' })

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(choice => localStorage.setItem('csg-learn:theme', choice), theme)
    })

    test('RI01 displays pending status, Off-cohort unchanged, and cohort feature switch Inherit -> Off', async ({ page }, info) => {
      const consoleErrors: string[] = []
      page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

      // 1. Pending GitHub delivery status in SubmissionReviewPanel
      await open(page, `/admin/submissions/${fixtures.pending_submission_id}`, 2)
      const pendingCard = page.locator('[data-github-issue-delivery="pending"]')
      await expect(pendingCard).toBeVisible()
      await pendingCard.scrollIntoViewIfNeeded()
      await expect(pendingCard).toContainText('Grade saved · GitHub feedback pending')
      await evidence(page, 'pending', info.project.name, theme, '[data-github-issue-delivery]')

      // 2. Off cohort (Cohort 3 shape) has ZERO delivery status card
      await open(page, `/admin/submissions/${fixtures.off_submission_id}`, 2)
      await expect(page.getByText('Cohort 3 legacy feedback.').first()).toBeVisible()
      await expect(page.locator('[data-github-issue-delivery]')).toHaveCount(0)
      await evidence(page, 'off-cohort-unchanged', info.project.name, theme, 'main')

      // 3. Admin FeatureSettings shows Reliable GitHub Redo issues with Inherit -> Off on Off cohort
      await open(page, `/admin/cohorts/${fixtures.off_cohort_id}?tab=settings`, 1)
      const cohortSection = page.getByRole('region', { name: 'Cohort features', exact: true })
      const select = cohortSection.getByLabel('Reliable GitHub Redo issues')
      await expect(select).toBeVisible()
      await expect(select).toHaveValue('inherit')
      await expect(select.locator('option[value="inherit"]')).toHaveText('Inherit → Off')
      await evidence(page, 'feature-settings-off', info.project.name, theme, 'section[aria-label="Cohort features"]')

      expect(consoleErrors).toEqual([])
    })

    test('RI02 failed delivery shows error detail, 44px Retry button recovers to delivered with link', async ({ page }, info) => {
      const consoleErrors: string[] = []
      page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

      const targetId = fixtures.failed_by_run[`${info.project.name}:${theme}`] ?? fixtures.failed_submission_id
      await open(page, `/admin/submissions/${targetId}`, 2)

      const failedCard = page.locator('[data-github-issue-delivery="failed"]')
      await expect(failedCard).toBeVisible()
      await failedCard.scrollIntoViewIfNeeded()
      await expect(failedCard).toContainText('Grade saved · GitHub feedback failed')
      await expect(failedCard).toContainText('GitHub installation cannot access this repository')
      const retryBtn = failedCard.getByRole('button', { name: 'Retry GitHub feedback' })
      await expect(retryBtn).toBeVisible()
      const box = await retryBtn.boundingBox()
      expect(box && box.height).toBeGreaterThanOrEqual(44)
      await evidence(page, 'failed', info.project.name, theme, '[data-github-issue-delivery]')

      const retryResponse = page.waitForResponse(res => res.url().includes('/retry_github_issue') && res.request().method() === 'POST')
      await retryBtn.click()
      const res = await retryResponse
      expect(res.status()).toBe(200)

      const deliveredCard = page.locator('[data-github-issue-delivery="delivered"]')
      await expect(deliveredCard).toBeVisible()
      await expect(deliveredCard).toContainText('GitHub feedback delivered')
      const link = deliveredCard.getByRole('link', { name: 'View GitHub issue' })
      await expect(link).toBeVisible()
      const linkBox = await link.boundingBox()
      expect(linkBox && linkBox.height).toBeGreaterThanOrEqual(44)
      await evidence(page, 'delivered', info.project.name, theme, '[data-github-issue-delivery]')

      // Verify API persistence after reload
      const apiRes = await page.request.get(`/api/v1/submissions/${targetId}`, { headers: headers(2) })
      expect(apiRes.status()).toBe(200)
      const body = await apiRes.json()
      expect(body.submission.github_issue_delivery.status).toBe('delivered')
      expect(body.submission.github_issue_url).toContain('/issues/')

      expect(consoleErrors).toEqual([])
    })
  })
}
