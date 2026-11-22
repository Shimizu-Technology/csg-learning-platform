import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test, expect, type Locator, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { checkedLifecycle } from './ownership.mjs'

// Start scripts/qa/run, then set QA_SPEC=w9-small-class.spec.ts and
// DEV_LIFECYCLE_SESSION when running scripts/qa/playwright.config.ts.
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('Set DEV_LIFECYCLE_SESSION to the active lifecycle session')
const harness = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8')) as { database: string }
const smallClass = 'Small class (online lessons + optional check-ins)'
const reviewTarget = 'Review target (business days)'
const pastTarget = 'Past review target'

function fixtures() {
  const output = execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/w9-small-class-fixtures.rb'], {
    cwd: new URL('../../api/', import.meta.url).pathname,
    env: { ...process.env, PARALLEL_WORKERS: '1', DATABASE_URL: `postgresql://localhost/${harness.database}` },
    encoding: 'utf8',
  })
  return JSON.parse(output) as {
    pilot: number; curriculum: number; learner: number; program: number;
    program_submission: number; late_submission: number; start_date: string; expected_on: string;
  }
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
}

async function touchTarget(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
  expect(box?.width).toBeGreaterThanOrEqual(44)
}

async function dangerBadge(locator: Locator) {
  const badge = locator.getByText(pastTarget, { exact: true })
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('data-tone', 'danger')
  await expect(badge.locator('svg.lucide-clock')).toBeVisible()
  const contrast = await badge.evaluate(element => {
    const styles = getComputedStyle(element)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    function luminance(color: string) {
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const channels = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => value / 255)
      const [r, g, b] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const a = luminance(styles.color)
    const b = luminance(styles.backgroundColor)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
  expect(contrast).toBeGreaterThanOrEqual(4.5)
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: small-class creation, terms, feedback targets and Cohort 3 Off`, async ({ page }, info) => {
    test.setTimeout(90_000)
    const tab = `w9-small-class-${info.project.name}-${theme}`
    checkedLifecycle(session, 'claim', tab)
    try {
      const ids = fixtures()
      await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
      await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
      const shot = (name: string) => page.screenshot({ path: info.outputPath(`${name}.png`) })
      const targetDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${ids.expected_on}T00:00:00Z`))

      await test.step('create a guided cohort with fixed lesson access', async () => {
        await page.goto('/admin/cohorts?qa_user=1')
        await page.getByRole('button', { name: 'New cohort' }).click()
        await page.getByLabel('Cohort name').fill(`QA Created Small Class ${info.project.name} ${theme}`)
        await page.getByLabel('Curriculum').selectOption(String(ids.curriculum))
        await page.getByLabel('Start date').fill(ids.start_date)
        const delivery = page.getByRole('group', { name: 'Delivery', exact: true })
        const smallClassOption = page.getByRole('radio', { name: smallClass, exact: true })
        await touchTarget(delivery.locator('label').filter({ has: smallClassOption }))
        await smallClassOption.check()
        await expect(page.getByRole('group', { name: 'Relative per learner' })).toBeVisible()
        await page.getByLabel('Lessons available through').fill('2027-12-31')
        const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/cohorts' && response.request().method() === 'POST')
        await page.getByRole('button', { name: 'Create cohort', exact: true }).click()
        const response = await pending
        expect(response.status()).toBe(201)
        expect((await response.json()).cohort).toMatchObject({ course_delivery: 'guided', guided_access_ends_on: '2027-12-31' })
        await expect(page).toHaveURL(/\/admin\/cohorts\/\d+/)
      })

      await test.step('save relative terms and the review target, then reload', async () => {
        await page.goto(`/admin/cohorts/${ids.pilot}/settings?qa_user=1`)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.getByText('Cohort · Small class', { exact: true })).toBeVisible()
        const access = page.getByLabel('Access length (months)')
        const support = page.getByLabel('Support length (weeks)')
        const review = page.getByRole('region', { name: 'Review response time' })
        const target = review.getByLabel(reviewTarget)
        const save = page.getByRole('button', { name: 'Save settings', exact: true })
        await expect(page.getByText(/A fixed date takes precedence/)).toBeVisible()
        await expect(access).toHaveValue('')
        await access.fill('12')
        await support.fill('8')
        await review.getByLabel('Typical response time').fill('usually reviewed within 2 business days')
        await target.fill('31')
        await save.click()
        expect(await target.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true)
        await target.fill('2')
        for (const control of [access, support, target, save]) await touchTarget(control)
        const pending = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/cohorts/${ids.pilot}` && response.request().method() === 'PATCH')
        await save.click()
        const response = await pending
        expect(response.ok()).toBe(true)
        expect((await response.json()).cohort).toMatchObject({ guided_access_months: 12, guided_support_weeks: 8, review_sla_business_days: 2 })
        await expect(page.getByText('Cohort settings saved', { exact: true }).first()).toBeVisible()
        await page.reload()
        await expect(access).toHaveValue('12')
        await expect(support).toHaveValue('8')
        await expect(target).toHaveValue('2')
        await expect(review.getByLabel('Typical response time')).toHaveValue('usually reviewed within 2 business days')
        await noOverflow(page)
        await access.scrollIntoViewIfNeeded()
        await shot('cohort-settings')
        await target.scrollIntoViewIfNeeded()
        await shot('review-settings')
      })

      await test.step('learner sees dated feedback and an optional office-hours session', async () => {
        const dashboard = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/dashboard' && response.ok())
        await page.goto(`/dashboard?cohort_id=${ids.pilot}&qa_user=${ids.learner}`)
        const waiting = page.getByRole('region', { name: 'Waiting on your instructor' })
        await expect(waiting.getByText(`Feedback expected by ${targetDay}`)).toBeVisible()
        const sessionCard = page.getByRole('region', { name: 'Optional check-in' })
        await expect(sessionCard.getByText('QA Python office hours')).toBeVisible()
        const join = sessionCard.getByRole('link', { name: 'Join' })
        await expect(join).toHaveAttribute('href', 'https://example.invalid/python')
        await touchTarget(join)
        expect((await (await dashboard).json()).dashboard.course_access).toMatchObject({ access_expires_at: null, support_expires_at: null })
        await noOverflow(page)
        await waiting.scrollIntoViewIfNeeded()
        await shot('student-today')
        await waiting.getByRole('link', { name: 'My work' }).click()
        await expect(page.getByText(`Feedback expected by ${targetDay}`)).toBeVisible()
        await noOverflow(page)
      })

      await test.step('instructor gets the overdue badge on Today and Grading', async () => {
        await page.goto(`/admin?cohort_id=${ids.pilot}&qa_user=2`)
        const reviews = page.locator('[data-today-item="review"]')
        await expect(reviews).toHaveCount(2)
        await expect(reviews.first()).toContainText('Functions practice')
        await dangerBadge(reviews.first())
        await expect(reviews.last()).toContainText('Variables practice')
        await expect(reviews.last().getByText(pastTarget, { exact: true })).toHaveCount(0)
        await touchTarget(reviews.first().getByRole('link', { name: 'Open grading' }))
        await noOverflow(page)
        await reviews.first().scrollIntoViewIfNeeded()
        await shot('instructor-today')

        await page.goto(`/admin/grading?cohort_id=${ids.pilot}&qa_user=2`)
        const row = page.locator(`#submission-row-${ids.late_submission}`)
        await dangerBadge(row)
        await touchTarget(row)
        await expect(page.getByText(/1 past review target/)).toBeVisible()
        await noOverflow(page)
        await row.scrollIntoViewIfNeeded()
        await shot('grading')
        await row.click()
        await dangerBadge(page.getByRole('region', { name: 'Review', exact: true }))
      })

      await test.step('Cohort 3-style program Off keeps its student and staff views', async () => {
        await page.goto(`/dashboard?cohort_id=${ids.program}&qa_user=3`)
        await expect(page.locator('[data-region="next-action"]').first()).toBeVisible()
        await expect(page.getByText(/Feedback expected by|Optional check-in/)).toHaveCount(0)
        await page.goto(`/admin/grading?cohort_id=${ids.program}&qa_user=2`)
        await expect(page.locator(`#submission-row-${ids.program_submission}`)).toBeVisible()
        await expect(page.getByText(/past review target/i)).toHaveCount(0)
        await noOverflow(page)
      })
    } finally {
      await page.close()
      checkedLifecycle(session, 'release', tab)
    }
  })
}
