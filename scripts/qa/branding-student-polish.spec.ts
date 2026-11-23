import { test, expect, type Locator } from '../../web/node_modules/@playwright/test/index.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const qaDir = new URL('../../.qa-local/', import.meta.url)
const state = JSON.parse(readFileSync(new URL('state.json', qaDir), 'utf8'))
const apiDir = new URL('../../api', import.meta.url).pathname
const qaDb = `postgresql://localhost/${state.database}`

function runFixture() {
  execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/branding-student-polish-fixtures.rb'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: qaDb, RAILS_ENV: 'test' },
  })
  return JSON.parse(readFileSync(new URL('branding-student-polish.json', qaDir), 'utf8')) as {
    school_zone: string
    opposite_zone: string
    program_id: number
    self_paced_id: number
    legacy_cohort_id: number
    opp_cohort_id: number
    opp_cohort_name: string
    slot_id: number
    slot_starts_at: string
    staff_entry_local: string
    staff_entry_expected_utc: string
  }
}

function formatExpectedInZone(iso: string, zone: string) {
  const date = new Date(iso)
  const label = zone === 'Pacific/Guam'
    ? 'ChST'
    : new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || zone
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
  return `${formatted} ${label}`
}

async function expectTouchTarget(locator: Locator, minWidth = 44, minHeight = 44) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(minWidth - 0.5)
  expect(box!.height).toBeGreaterThanOrEqual(minHeight - 0.5)
  const focusable = await locator.evaluate((el) => {
    (el as HTMLElement).focus()
    return document.activeElement === el
  })
  expect(focusable).toBe(true)
  return box!
}

test('branding metadata, unread badge, cohort meeting timezones, self-paced welcome, and 44px touch targets', async ({ browser }, info) => {
  test.setTimeout(120_000)
  const viewport = info.project.use.viewport!
  const phone = viewport.width === 390
  const ids = runFixture()
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, timezoneId: 'America/Los_Angeles' })
  const page = await context.newPage()

  try {
    await context.route('**/*', (route) => (
      ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()
    ))

    // 1. CSG default public metadata & desktop sidebar operator link
    await page.goto(`/dashboard?cohort_id=${ids.program_id}&qa_user=3`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
    const metaCheck = await page.evaluate(() => {
      const keywords = document.querySelector('meta[name="keywords"]')?.getAttribute('content') || ''
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent || '{}'))
      const org = ld.find((item) => item['@type'] === 'EducationalOrganization')
      return { keywords, areaServed: org?.areaServed?.name, scrollOverflow: document.documentElement.scrollWidth > innerWidth + 1 }
    })
    expect(metaCheck.keywords).toContain('guam')
    expect(metaCheck.areaServed).toBe('Guam')
    expect(metaCheck.scrollOverflow).toBe(false)

    if (!phone) {
      const operatorLink = page.locator('aside a[href="https://shimizu-technology.com"]')
      await expect(operatorLink).toBeVisible()
      await expect(operatorLink).toContainText('Built by Shimizu Technology')
    }

    // 2. Touch target measurements & keyboard reachability on Today, Dashboard, and MyWork at 390px
    if (phone) {
      const headerLogo = page.locator('header a[aria-label="Go to Today"]')
      const logoBox = await expectTouchTarget(headerLogo, 44, 44)

      const headerBell = page.locator('header a[href="/announcements?tab=inbox"]')
      const bellBox = await expectTouchTarget(headerBell, 44, 44)
      await expect(headerBell).toHaveAttribute('aria-label', 'Notifications, 2 unread')
      // Ensure logo and bell do not overlap
      expect(logoBox.x + logoBox.width).toBeLessThanOrEqual(bellBox.x + 1)

      // Today cohort RecordLink & Redo standalone lesson RecordLink
      const todayCohortLink = page.locator('[data-page-context] a[data-record-link="cohort"]')
      await expectTouchTarget(todayCohortLink, 44, 44)
      const redoLessonLink = page.locator('[data-needs-you="redo"] a[data-record-link="lesson"]').first()
      await expectTouchTarget(redoLessonLink, 44, 44)

      // My work standalone cohort RecordLink & standalone lesson link
      await page.goto(`/my-work?cohort_id=${ids.program_id}&qa_user=3`)
      await expect(page.getByRole('heading', { name: 'My work' })).toBeVisible({ timeout: 20_000 })
      const myWorkCohortLink = page.locator('[data-page="my-work"] header a[data-record-link="cohort"]')
      await expectTouchTarget(myWorkCohortLink, 44, 44)
      const myWorkLessonLink = page.locator('[data-page="my-work"] article h2 a').first()
      await expectTouchTarget(myWorkLessonLink, 44, 44)

      // Legacy Dashboard standalone submission-window lesson link
      await page.goto(`/dashboard?cohort_id=${ids.legacy_cohort_id}&qa_user=3`)
      await expect(page.getByText('Submission windows')).toBeVisible({ timeout: 20_000 })
      const dashboardLessonLink = page.locator('a[data-record-link="lesson"]').first()
      await expectTouchTarget(dashboardLessonLink, 44, 44)

      // 3. Learner unread notifications flow: 2 unread -> mark 1 read (singular!) -> mark all read (0) -> reload
      await page.goto(`/dashboard?cohort_id=${ids.program_id}&qa_user=3`)
      await expect(headerBell).toHaveAttribute('aria-label', 'Notifications, 2 unread')
      await headerBell.tap()
      await expect(page).toHaveURL(/\/announcements\?tab=inbox/)
      await expect(page.getByText('2 unread notifications')).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: 'Mark read' }).first().tap()
      await expect(page.getByText('1 unread notification', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(headerBell).toHaveAttribute('aria-label', 'Notifications, 1 unread')
      await page.getByRole('button', { name: 'Mark all read' }).tap()
      await expect(page.getByText('0 unread notifications')).toBeVisible({ timeout: 15_000 })
      await expect(headerBell).toHaveAttribute('aria-label', 'Notifications')
      await page.reload()
      await expect(headerBell).toHaveAttribute('aria-label', 'Notifications')
    }

    // 4. Self-paced welcome with submission windows vs without submission windows
    await page.goto(`/dashboard?cohort_id=${ids.self_paced_id}&qa_user=7`)
    const welcome = page.locator('article[aria-labelledby="welcome-title"]')
    await expect(welcome).toBeVisible({ timeout: 20_000 })
    await expect(welcome).not.toContainText('There are no class times or deadlines')
    await expect(welcome).toContainText('check Learn and each lesson for submission deadlines')

    // Remove windows and verify neutral window-discoverable wording
    execFileSync('bundle', ['exec', 'ruby', '-e', 'require_relative "../scripts/qa/boot"; Cohort.find(ENV.fetch("COHORT_ID")).cohort_module_submission_windows.destroy_all'], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: qaDb, RAILS_ENV: 'test', COHORT_ID: String(ids.self_paced_id) },
    })
    await page.reload()
    await expect(welcome).toBeVisible({ timeout: 20_000 })
    await expect(welcome).not.toContainText('There are no class times or deadlines')
    await expect(welcome).toContainText('if a lesson has a submission deadline, you’ll see it in Learn and on the lesson')

    // 5. Private meetings opposite-timezone verification (staff + learner book + reload/reopen + record detail)
    const expectedSlotText = formatExpectedInZone(ids.slot_starts_at, ids.opposite_zone)
    const expectedZonePhrase = ids.opposite_zone === 'America/Chicago' ? 'Central Time (CT)' : 'Guam time (ChST)'

    // 5a. Staff meetings: clean label (no 'CT time (CT)'), displays cohort zone, and publishes slot in cohort zone
    await page.goto(`/admin/meetings?cohort_id=${ids.opp_cohort_id}&qa_user=1`)
    await expect(page.getByText(`Start in ${expectedZonePhrase}`)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('body')).not.toContainText('CT time (CT)')
    await expect(page.getByText(expectedSlotText).first()).toBeVisible()

    const staffInput = page.locator('input[type="datetime-local"]')
    await staffInput.fill(ids.staff_entry_local)
    const createSlotResp = page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/api/v1/staff/private_meeting_slots'))
    await page.getByRole('button', { name: 'Publish time' }).click()
    const created = await createSlotResp
    expect(created.ok()).toBe(true)
    const createdPayload = await created.json()
    const savedStart = createdPayload.slots?.[0]?.starts_at || createdPayload.slot?.starts_at
    expect(new Date(savedStart).toISOString()).toBe(new Date(ids.staff_entry_expected_utc).toISOString())

    // 5b. Learner meetings: slot list, confirmation dialog, saved booking, reload/reopen same instant
    await page.goto(`/meetings?cohort_id=${ids.opp_cohort_id}&qa_user=3`)
    await expect(page.getByText(expectedZonePhrase)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('body')).not.toContainText('CT time (CT)')
    const slotBtn = page.getByRole('button', { name: new RegExp(expectedSlotText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()
    await expect(slotBtn).toBeVisible()
    await slotBtn.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(expectedSlotText)
    await dialog.getByRole('button', { name: 'Book meeting' }).click()
    await expect(page.getByText('Your meeting is booked.')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('article[data-booked="true"]')).toContainText(expectedSlotText)

    // Reopen / reload and confirm exact same instant in cohort zone
    await page.reload()
    await expect(page.locator('article[data-booked="true"]')).toContainText(expectedSlotText, { timeout: 20_000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)

    // Preserve staff phone bell & controls
    if (phone) {
      await page.goto('/admin?qa_user=1')
      await expect(page.locator('header a[href="/announcements?tab=inbox"]')).toBeVisible({ timeout: 20_000 })
    }
  } finally {
    await context.close()
  }
})
