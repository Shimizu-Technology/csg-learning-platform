import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const state = JSON.parse(readFileSync(`${root}.qa-local/state.json`, 'utf8'))
const out = `${root}docs/qa/catalog-course-pages-2026-11-17`
mkdirSync(out, { recursive: true })
function reset() {
  execFileSync('bundle', ['exec', 'rails', 'runner', "Enrollment.find_by!(user_id: 7, cohort_id: 2).update!(start_here_dismissed_at: nil)"], { cwd: `${root}api`, env: { ...process.env, RAILS_ENV: 'test', DATABASE_URL: `postgresql://localhost/${state.database}`, PARALLEL_WORKERS: '1' } })
}
async function check(page: Page, name: string, theme: string, width: number, screenshot = false) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact || ''))).toEqual([])
  if (screenshot) await page.screenshot({ path: `${out}/${name}-${width}-${theme}.png`, fullPage: true })
  appendFileSync(`${root}.qa-local/catalog-results.jsonl`, JSON.stringify({ name, theme, width, status: 'passed', contrast: axe.violations.filter(v => v.id === 'color-contrast').length }) + '\n')
}
for (const theme of ['light', 'dark']) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme as 'light' | 'dark' })
    test.beforeEach(async ({ page, request }) => {
      await request.patch('/api/v1/feature_settings', { headers: { Authorization: 'Bearer test_token_1' }, data: { public_catalog_mode: 'automatic' } })
      await request.patch('/api/v1/cohorts/2', { headers: { Authorization: 'Bearer test_token_1' }, data: { public_price_cents: 14900 } })
      await page.route('**/*', async route => ['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
      await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
    })
    test('R1 landing follows all three school catalog modes with and without a sale', async ({ page, request }, info) => {
      test.setTimeout(60000)
      const headers = { Authorization: 'Bearer test_token_1' }
      for (const mode of ['automatic', 'always', 'hidden']) {
        for (const sale of [false, true]) {
          expect((await request.patch('/api/v1/feature_settings', { headers, data: { public_catalog_mode: mode } })).ok()).toBe(true)
          expect((await request.patch('/api/v1/cohorts/2', { headers, data: { public_price_cents: sale ? 14900 : null } })).ok()).toBe(true)
          const loaded = page.waitForResponse(response => response.url().endsWith('/api/v1/course_offerings'))
          await page.goto('/')
          await loaded
          await expect(page.getByRole('heading', { name: 'Build a skill. Put it to work.' })).toBeVisible()
          // Wait for the public request, rather than accepting the initial Sign in state.
          await expect.poll(async () => page.locator('main article').count()).toBe(sale && mode !== 'hidden' ? 1 : 0)
          const available = mode === 'always' || (mode === 'automatic' && sale)
          await expect(page.locator('main a.bg-action-primary').first()).toHaveText(available ? /Browse courses/ : /Sign in/)
          await expect(page.getByRole('link', { name: 'See the course catalog', exact: true })).toHaveCount(available ? 1 : 0)
          await check(page, `landing-${mode}-${sale ? 'sale' : 'empty'}`, theme, info.project.use.viewport!.width, true)
        }
      }
      await page.goto('/courses/course-guided-private')
      await expect(page.getByRole('heading', { name: 'This course isn’t available' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Browse courses', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
      await expect(page).toHaveTitle('Course unavailable · CSG Learn')
      await check(page, 'unlisted-hidden', theme, info.project.use.viewport!.width, true)
    })
    test('C1–C3 public landing, catalog, detail, legacy and unlisted course', async ({ page }, info) => {
      const width = info.project.use.viewport!.width
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Build a skill. Put it to work.' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Build a garden counter', exact: true })).toBeVisible()
      await expect(page.getByText('Python Fundamentals', { exact: true })).toHaveCount(0)
      await check(page, 'landing', theme, width, true)
      await page.getByRole('link', { name: 'Browse courses', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Build a garden counter', exact: true })).toBeVisible()
      await check(page, 'catalog', theme, width)
      await page.getByRole('link', { name: 'View course', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Build a garden counter', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Syllabus', exact: true })).toBeVisible()
      await expect(page).toHaveTitle('Build a garden counter · CSG Learn')
      await expect(page.getByText('18 lessons · 4–6 hours')).toBeVisible()
      await check(page, 'course', theme, width, true)
      await page.goto('/courses?offering_id=2')
      await expect(page.getByRole('link', { name: 'Create an account to enroll' })).toHaveAttribute('href', '/sign-up?offering_id=2')
      await check(page, 'legacy-link', theme, width)
      await page.goto('/courses/course-guided-private')
      await expect(page.getByRole('heading', { name: 'This course isn’t available', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Create an account to enroll' })).toHaveCount(0)
      await check(page, 'unlisted', theme, width)
    })
    test('C4 checkout boundary, explicitly simulated hosted page', async ({ page }, info) => {
      const width = info.project.use.viewport!.width
      let sent = 0
      await page.route('**/api/v1/course_checkouts', async route => {
        if (route.request().method() !== 'POST') return route.continue()
        expect(route.request().postDataJSON()).toEqual({ cohort_id: 2 }); sent++
        await route.fulfill({ json: { url: 'https://checkout.stripe.test/catalog-simulation' } })
      })
      await page.route('https://checkout.stripe.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Simulated hosted checkout</h1><p>No payment or provider call.</p>' }))
      await page.goto('/courses/course-garden-counter?qa_user=9')
      await page.getByRole('button', { name: 'Continue to secure checkout' }).click()
      await expect(page.getByRole('heading', { name: 'Simulated hosted checkout' })).toBeVisible()
      expect(sent).toBe(1)
      appendFileSync(`${root}.qa-local/catalog-results.jsonl`, JSON.stringify({ name: 'checkout-stub', theme, width, status: 'passed', provider: 'simulated' }) + '\n')
    })
    test('C5 paid return to Today and one-time Start here', async ({ page }, info) => {
      test.setTimeout(60000); reset()
      const width = info.project.use.viewport!.width
      await page.goto('/courses?checkout=return&purchase_id=1&qa_user=7')
      const open = page.getByRole('link', { name: 'Open Build a garden counter' })
      await expect(open).toHaveAttribute('href','/dashboard?cohort_id=2')
      await open.click()
      await expect(page.getByRole('heading', { name: 'Start here', exact: true })).toBeVisible()
      await expect(page.getByText(/Your help period lasts 6 weeks/)).toBeVisible()
      await check(page, 'start-here', theme, width, true)
      await page.getByRole('button', { name: 'Got it, let’s start' }).click()
      await expect(page.getByRole('heading', { name: 'Start here', exact: true })).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Start here', exact: true })).toHaveCount(0)
      await page.goto('/')
      await expect(page).toHaveURL(/\/dashboard/)
    })
    test('C6 self-paced and guided waiting review; delivery badge in staff queue', async ({ page }, info) => {
      const width = info.project.use.viewport!.width
      for (const [user, cohort, lesson] of [[6,2,23],[3,1,5]]) {
        await page.goto(`/lessons/${lesson}?cohort_id=${cohort}&qa_user=${user}`)
        await expect(page.getByText(/Your instructor will review it — usually within 2 days/)).toBeVisible()
        await check(page, `review-${user}`, theme, width)
      }
      await page.goto('/admin/grading?qa_user=2')
      await expect(page.getByText(/ · self-paced/).first()).toBeVisible()
      await check(page, 'grading', theme, width)
    })
    test('C7 admin marketing and response settings preserve checkout', async ({ page }, info) => {
      const width = info.project.use.viewport!.width
      await page.goto('/admin/cohorts/2?tab=settings&qa_user=1')
      await expect(page.getByLabel('What learners will learn')).toBeVisible()
      const checkout = page.getByLabel('Show checkout in the course catalog')
      await expect(checkout).toBeChecked()
      await page.getByLabel('Estimated duration').fill('5–7 hours')
      await page.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect(page.getByRole('main').getByText('Cohort settings saved', { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByLabel('Estimated duration')).toHaveValue('5–7 hours')
      await expect(checkout).toBeChecked()
      await page.getByLabel('Estimated duration').fill('4–6 hours')
      await page.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect(page.getByRole('main').getByText('Cohort settings saved', { exact: true })).toBeVisible()
      await page.getByLabel('Typical response time', { exact: true }).fill('usually reviewed within 3 days')
      await page.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect(page.getByRole('main').getByText('Cohort settings saved', { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByLabel('Typical response time', { exact: true })).toHaveValue('usually reviewed within 3 days')
      await expect(checkout).toBeChecked()
      await page.goto('/lessons/23?cohort_id=2&qa_user=6')
      await expect(page.getByText(/Your instructor will review it — usually within 3 days/)).toBeVisible()
      await page.goto('/admin/cohorts/2?tab=settings&qa_user=1')
      await page.getByLabel('Typical response time', { exact: true }).fill('')
      await page.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect(page.getByRole('main').getByText('Cohort settings saved', { exact: true })).toBeVisible()
      await check(page, 'admin-settings', theme, width)
    })
  })
}
