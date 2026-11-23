import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

const qaDir = new URL('../../.qa-local/', import.meta.url)
const state = JSON.parse(readFileSync(new URL('state.json', qaDir), 'utf8'))
const zone = process.env.SCHOOL_TIME_ZONE || 'Pacific/Guam'
const chicago = zone === 'America/Chicago'
const session = process.env.DEV_LIFECYCLE_SESSION

test('staff grants and reopens the school date, and the learner sees the persisted cutoff', async ({ browser }, info) => {
  test.setTimeout(90_000)
  const viewport = info.project.use.viewport!
  const phone = viewport.width === 390
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, timezoneId: 'America/Los_Angeles' })
  const page = await context.newPage()
  const tab = `school-deadlines-${Date.now()}-${process.pid}`
  let claimed = false
  try {
    if (session) {
      checkedLifecycle(session, 'claim', tab)
      claimed = true
    }
    await context.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    const qaDb = `postgresql://localhost/${state.database}`
    execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/school-deadlines-fixture.rb'], {
      cwd: new URL('../../api', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: qaDb },
    })
    const ids = JSON.parse(readFileSync(new URL('w9-deadlines-review.json', qaDir), 'utf8'))
    const { base, first, second, fold_lock_at } = JSON.parse(readFileSync(new URL('school-deadlines.json', qaDir), 'utf8'))
    async function showLearner(browserPage: Page, date: string, label: string) {
      await browserPage.goto(`/lessons/${ids.project}?cohort_id=${ids.paced}&qa_user=953`)
      const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`))
      await expect(browserPage.getByText(/Submission deadline:/)).toContainText(`${day}, 11:59 PM ${label}`)
      await expect(browserPage.getByRole('textbox', { name: 'Your answer, rich text' })).toBeEnabled()
      expect(await browserPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    await page.goto(`/dashboard?cohort_id=${ids.paced}&qa_user=953`)
    expect(await page.evaluate(() => ({ width: innerWidth, coarse: matchMedia('(pointer: coarse)').matches }))).toEqual({ width: viewport.width, coarse: phone })
    await showLearner(page, base, chicago ? 'CST' : 'ChST')

    await page.goto(`/admin/cohorts/${ids.paced}/students/953/learning?qa_user=1`)
    const panel = page.getByRole('region', { name: 'Deadlines and extensions' })
    const input = panel.getByLabel(chicago ? 'New deadline (CT time)' : 'New deadline (Guam time)')
    const reason = panel.getByLabel('Reason', { exact: true })
    await expect(panel.getByLabel('Applies to')).toHaveValue('final')
    await expect(input).toBeEnabled()
    await input.fill(first)
    await reason.fill('QA final extension')
    await panel.getByRole('button', { name: 'Grant extension', exact: true }).click()
    await expect(panel.getByRole('status')).toContainText('Extension saved')

    const edit = () => panel.getByRole('list', { name: 'Extensions' }).getByRole('listitem').filter({ hasText: 'Final project' }).getByRole('button', { name: 'Edit', exact: true })
    await page.reload()
    await edit().click()
    await expect(input).toHaveValue(first)
    await expect(panel.getByText(/Final project ·/)).toContainText(`11:59 PM ${chicago ? 'CST' : 'ChST'}`)
    await input.fill(base)
    await reason.fill('QA attempt to shorten')
    await panel.getByRole('button', { name: 'Save extension change' }).click()
    await expect(panel.getByRole('alert')).toContainText('must extend')
    await input.fill(second)
    await reason.fill('QA final extension revised')
    await panel.getByRole('button', { name: 'Save extension change' }).click()
    await expect(panel.getByRole('status')).toContainText('Extension saved')

    await page.reload()
    await edit().click()
    await expect(input).toHaveValue(second)
    await expect(panel.getByText(/Final project ·/)).toContainText(`11:59 PM ${chicago ? 'CDT' : 'ChST'}`)
    const response = await page.request.get(`/api/v1/enrollments/${ids.pace.enrollment}/extensions`, { headers: { Authorization: 'Bearer test_token_1' } })
    expect(response.ok()).toBe(true)
    const grant = (await response.json()).extensions.find((item: { scope: string }) => item.scope === 'final')
    const expectedIso = new Date(`${second}T23:59:59${chicago ? '-05:00' : '+10:00'}`).toISOString()
    expect(new Date(grant.submissions_close_at).toISOString()).toBe(expectedIso)
    expect(grant.revisions).toHaveLength(2)
    await showLearner(page, second, chicago ? 'CDT' : 'ChST')

    if (chicago) {
      await page.goto(`/admin/cohorts/${ids.program}?tab=settings&qa_user=1`)
      await page.getByRole('button', { name: 'Configure', exact: true }).click()
      const settings = page.getByRole('dialog')
      const springInput = settings.getByLabel(/^Week 1 submissions close/)
      const savedSpringValue = await springInput.inputValue()
      await springInput.fill(`${second}T02:30`)
      await expect(springInput).toHaveAttribute('aria-invalid', 'true')
      await expect(settings.getByText('Invalid time', { exact: true })).toBeVisible()
      await springInput.fill(savedSpringValue)

      const foldInput = settings.getByLabel(/^Week 2 submissions close/)
      const savedFoldValue = await foldInput.inputValue()
      await expect(foldInput).toHaveAccessibleName(/CST/)
      await page.clock.setFixedTime(new Date(fold_lock_at))
      await settings.getByRole('button', { name: 'Lock now', exact: true }).nth(1).click()
      await expect(foldInput).toHaveValue(savedFoldValue)
      await expect(foldInput).toHaveAccessibleName(/CDT/)
      await settings.getByRole('button', { name: 'Done editing windows', exact: true }).click()

      const patchSaved = page.waitForResponse((response) =>
        response.request().method() === 'PATCH' && response.url().includes('/submission_windows'),
      )
      await page.getByRole('button', { name: 'Save settings', exact: true }).click()
      const patchResponse = await patchSaved
      expect(patchResponse.ok()).toBe(true)
      const savedWeek = (await patchResponse.json()).submission_windows.find((window: { week_number: number }) => window.week_number === 2)
      expect(new Date(savedWeek.submissions_close_at).toISOString()).toBe(new Date(fold_lock_at).toISOString())
      await expect(page.getByRole('main').getByText('Cohort settings saved', { exact: true })).toBeVisible()
      await page.reload()
      await page.getByRole('button', { name: 'Configure', exact: true }).click()
      await expect(foldInput).toHaveValue(savedFoldValue)
      await expect(foldInput).toHaveAccessibleName(/CDT/)
    }
  } finally {
    try {
      await context.close()
    } finally {
      if (session && claimed) checkedLifecycle(session, 'release', tab)
    }
  }
})
