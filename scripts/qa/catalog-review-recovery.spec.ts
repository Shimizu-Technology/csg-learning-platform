import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const state = JSON.parse(readFileSync(`${root}.qa-local/state.json`, 'utf8'))

async function check(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact || ''))).toEqual([])
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })
    test.beforeEach(async ({ page, request }) => {
      await request.patch('/api/v1/cohorts/2/feature_settings', { headers: { Authorization: 'Bearer test_token_1' }, data: { review_response_time: null } })
      await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
      await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
    })

    test('selected course survives Sign in; dismissed Start here cannot return from offline cache', async ({ page }) => {
      test.setTimeout(60000)
      await page.goto('/courses/course-garden-counter?ref=school')
      const signIn = page.locator('header').getByRole('link', { name: 'Sign in', exact: true })
      await expect(signIn).toHaveAttribute('href', '/sign-in?ref=school&offering_id=2')
      await check(page)
      execFileSync('bundle', ['exec', 'rails', 'runner', 'Enrollment.find_by!(user_id: 7, cohort_id: 2).update!(start_here_dismissed_at: nil)'], { cwd: `${root}api`, env: { ...process.env, RAILS_ENV: 'test', DATABASE_URL: `postgresql://localhost/${state.database}`, PARALLEL_WORKERS: '1' } })
      await page.goto('/dashboard?cohort_id=2&qa_user=7')
      await expect(page.getByRole('heading', { name: 'Start here', exact: true })).toBeVisible()
      const cachedDashboards = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('csg-api-cache:') && key.includes('/api/v1/dashboard')))
      await expect.poll(async () => (await cachedDashboards()).length).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Got it, let’s start' }).click()
      await expect(page.getByRole('heading', { name: 'Start here', exact: true })).toHaveCount(0)
      expect(await cachedDashboards()).toEqual([])
      await page.route('**/api/v1/dashboard?**', route => route.abort('failed'))
      await page.reload()
      await expect(page.getByText('Could not load Today', { exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Start here', exact: true })).toHaveCount(0)
      await check(page)
    })

    test('accepted review draft survives refresh failure; marketing saves without instructor loading', async ({ page }, info) => {
      test.setTimeout(90000)
      const reviewWrites: Array<string | null> = []
      page.on('request', request => {
        if (request.method() === 'PATCH' && request.url().endsWith('/api/v1/cohorts/2/feature_settings')) {
          const data = request.postDataJSON()
          if ('review_response_time' in data) reviewWrites.push(data.review_response_time)
        }
      })
      let failRefresh = false
      await page.route('**/api/v1/cohorts/2', route => failRefresh && route.request().method() === 'GET' ? route.fulfill({ status: 503, json: { error: 'Simulated refresh outage' } }) : route.continue())
      await page.goto('/admin/cohorts/2?tab=settings&qa_user=1')
      const response = page.getByLabel('Typical response time', { exact: true })
      await expect(response).toBeEnabled()
      const originalResponse = await response.inputValue()
      await response.fill('usually reviewed within 3 days')
      await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('csg-api-cache:') && key.includes('/api/v1/cohorts/2')).forEach(key => localStorage.removeItem(key)))
      failRefresh = true
      await page.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect(page.locator('main').getByText(/Some settings may have saved/)).toBeVisible()
      await response.fill(originalResponse)
      await page.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect.poll(() => reviewWrites.length).toBe(2)
      expect(reviewWrites).toEqual(['usually reviewed within 3 days', originalResponse || null])
      await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toBeEnabled()
      failRefresh = false
      await page.reload()
      await expect(response).toHaveValue(originalResponse)

      await page.route('**/api/v1/cohorts/2/instructor_assignments', route => route.fulfill({ status: 503, json: { error: 'Simulated instructor outage' } }))
      await page.reload()
      await expect(page.getByText(/Course copy can still be saved/)).toBeVisible()
      const preview = page.getByRole('textbox', { name: 'Course preview', exact: true })
      const originalPreview = await preview.inputValue()
      await preview.fill('A draft retained while instructor loading fails.')
      await page.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect(page.locator('main').getByText('Cohort settings saved', { exact: true })).toBeVisible()
      await page.reload()
      await expect(preview).toHaveValue('A draft retained while instructor loading fails.')
      await expect(page.getByText(/Course copy can still be saved/)).toBeVisible()
      await expect(page.getByLabel('Show checkout in the course catalog')).toBeChecked()
      await check(page)
      await page.locator('section[aria-labelledby="course-offering-heading"]').screenshot({ path: `${root}docs/qa/catalog-course-pages-2026-11-17/admin-instructor-load-error-${info.project.use.viewport!.width}-${theme}.png` })
      await preview.fill(originalPreview)
      await page.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect(page.locator('main').getByText('Cohort settings saved', { exact: true })).toBeVisible()
    })
  })
}
