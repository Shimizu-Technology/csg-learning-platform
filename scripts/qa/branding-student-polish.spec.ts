import { test, expect, type Locator, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

const qaDir = new URL('../../.qa-local/', import.meta.url)
const state = JSON.parse(readFileSync(new URL('state.json', qaDir), 'utf8'))
const apiDir = new URL('../../api', import.meta.url).pathname
const qaDb = `postgresql://localhost/${state.database}`
const session = process.env.DEV_LIFECYCLE_SESSION

function runFixture() {
  const result = execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/branding-student-polish-fixtures.rb'], {
    cwd: apiDir, encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: qaDb, RAILS_ENV: 'test' },
  })
  return JSON.parse(result) as {
    school_zone: string
    opposite_zone: string
    program_id: number
    self_paced_id: number
    legacy_cohort_id: number
    opp_cohort_id: number
    opp_cohort_name: string
    slot_week: number
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

async function expectTouchTarget(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  await locator.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(43.5)
  expect(box!.height).toBeGreaterThanOrEqual(43.5)
  // Verify the actual clickable box, including the padding around its label.
  const hit = await locator.evaluate((element) => {
    const { left, top, right, bottom } = element.getBoundingClientRect()
    const midX = (left + right) / 2
    const midY = (top + bottom) / 2
    return [[midX, midY], [left + 2, midY], [right - 2, midY], [midX, top + 2], [midX, bottom - 2]]
      .every(([x, y]) => element.contains(document.elementFromPoint(x, y)))
  })
  expect(hit).toBe(true)
  await locator.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(locator).not.toBeFocused()
  await page.keyboard.press('Tab')
  await expect(locator).toBeFocused()
  return box!
}

function responseFor(page: Page, path: RegExp, method = 'GET') {
  return page.waitForResponse((response) => path.test(new URL(response.url()).pathname) && response.request().method() === method)
}

test('branding metadata, unread badge, cohort meeting timezones, self-paced welcome, and 44px touch targets', async ({ browser }, info) => {
  test.setTimeout(120_000)
  const viewport = info.project.use.viewport!
  const phone = viewport.width === 390
  const ids = runFixture()
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, timezoneId: 'America/Los_Angeles' })
  const page = await context.newPage()
  const tab = `branding-student-polish-${info.project.name}-${process.pid}`
  let claimed = false

  try {
    if (session) {
      checkedLifecycle(session, 'claim', tab)
      claimed = true
    }
    await context.route('**/*', (route) => (
      ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()
    ))

    // CSG public metadata and desktop operator link
    const sessionResponse = responseFor(page, /\/api\/v1\/sessions$/, 'POST')
    await page.goto(`/dashboard?cohort_id=${ids.program_id}&qa_user=3`)
    const signedIn = await sessionResponse
    expect(signedIn.ok()).toBe(true)
    expect(await signedIn.json()).toMatchObject({ user: { id: 3, role: 'student' }, school: { time_zone: ids.school_zone } })
    expect(await page.evaluate(() => ({ width: innerWidth, coarse: matchMedia('(pointer: coarse)').matches })))
      .toEqual({ width: viewport.width, coarse: phone })
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

    const headerBell = page.locator('header a[href="/announcements?tab=inbox"]')
    // Phone hit areas and keyboard reachability on Today and My work.
    if (phone) {
      const headerLogo = page.locator('header a[aria-label="Go to Today"]')
      const logoBox = await expectTouchTarget(page, headerLogo)

      const bellBox = await expectTouchTarget(page, headerBell)
      await expect(headerBell).toHaveAttribute('aria-label', 'Notifications, 2 unread')
      // Ensure logo and bell do not overlap
      expect(logoBox.x + logoBox.width).toBeLessThanOrEqual(bellBox.x + 1)

      // Today cohort RecordLink & Redo standalone lesson RecordLink
      const todayCohortLink = page.locator('[data-page-context] a[data-record-link="cohort"]')
      await expectTouchTarget(page, todayCohortLink)
      const redoLessonLink = page.locator('[data-needs-you="redo"] a[data-record-link="lesson"]').first()
      await expectTouchTarget(page, redoLessonLink)

      // My work standalone cohort RecordLink & standalone lesson link
      await page.goto(`/my-work?cohort_id=${ids.program_id}&qa_user=3`)
      await expect(page.getByRole('heading', { name: 'My work' })).toBeVisible({ timeout: 20_000 })
      const myWorkCohortLink = page.locator('[data-page="my-work"] header a[data-record-link="cohort"]')
      await expectTouchTarget(page, myWorkCohortLink)
      const myWorkLessonLink = page.locator('[data-page="my-work"] article h2 a').first()
      await expectTouchTarget(page, myWorkLessonLink)
    }

    await test.step('Mark one notification and then all as read, with the zero count persisted', async () => {
      if (phone) {
        await page.goto(`/dashboard?cohort_id=${ids.program_id}&qa_user=3`)
        await expect(headerBell).toHaveAttribute('aria-label', 'Notifications, 2 unread')
        await expect(headerBell).toHaveText('2')
        await headerBell.tap()
      } else {
        await page.goto(`/announcements?cohort_id=${ids.program_id}&qa_user=3`)
        await page.getByRole('navigation', { name: 'Updates sections' }).getByRole('link', { name: 'Notifications' }).click()
      }
      expect(new URL(page.url()).searchParams.get('tab')).toBe('inbox')
      await expect(page.getByText('2 unread notifications', { exact: true })).toBeVisible()
      const markOne = page.getByRole('button', { name: 'Mark read', exact: true }).first()
      if (phone) await markOne.tap()
      else await markOne.press('Enter')
      await expect(page.getByText('1 unread notification', { exact: true })).toBeVisible()
      if (phone) {
        await expect(headerBell).toHaveAttribute('aria-label', 'Notifications, 1 unread')
        await expect(headerBell).toHaveText('1')
      }
      const markAll = page.getByRole('button', { name: 'Mark all read' })
      if (phone) await markAll.tap()
      else await markAll.press('Enter')
      await expect(page.getByText('0 unread notifications', { exact: true })).toBeVisible()
      await expect(markAll).toBeDisabled()
      const inbox = responseFor(page, /\/api\/v1\/notifications$/)
      await page.reload()
      expect(await (await inbox).json()).toMatchObject({ unread_count: 0 })
      await expect(page.getByText('0 unread notifications', { exact: true })).toBeVisible()
      if (phone) {
        await expect(headerBell).toHaveAttribute('aria-label', 'Notifications')
        await expect(headerBell).toHaveText('')
      }
    })

    await test.step('Legacy Dashboard uses the real weekly plan, with a standalone deadline link as fallback', async () => {
      const dashboard = responseFor(page, /\/api\/v1\/dashboard$/)
      const plan = responseFor(page, /\/api\/v1\/weekly_plan$/)
      await page.goto(`/dashboard?cohort_id=${ids.legacy_cohort_id}&qa_user=3`)
      expect(await (await dashboard).json()).toMatchObject({
        dashboard: { user: { id: 3 }, cohort: { id: ids.legacy_cohort_id }, capabilities: { features: { student_experience_v2: false } } },
      })
      expect(await (await plan).json()).toMatchObject({ weekly_plan: { enrolled: true, cohort: { id: ids.legacy_cohort_id } } })
      const weeklyLesson = page.getByRole('link', { name: /QA Lab .*closes/ }).first()
      await expect(weeklyLesson).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Submission windows' })).toHaveCount(0)
      if (phone) {
        await expectTouchTarget(page, page.getByRole('link', { name: 'QA Legacy Dashboard', exact: true }))
        await expectTouchTarget(page, weeklyLesson)
      }

      // Simulate a weekly plan unavailable to this enrollment. The Dashboard
      // response, learner identity, enrollment, and deadlines still come from Rails.
      const planUnavailable = /\/api\/v1\/weekly_plan(?:\?|$)/
      await page.route(planUnavailable, (route) => route.fulfill({ json: { weekly_plan: { enrolled: false } } }))
      try {
        await page.reload()
        await expect(page.getByRole('heading', { name: 'Submission windows' })).toBeVisible()
        const fallback = page.getByText('Next close:', { exact: false }).locator('..').locator('a[data-record-link="lesson"]')
        if (phone) await expectTouchTarget(page, fallback)
        else await expect(fallback).toBeVisible()
        await fallback.press('Enter')
        await expect(page).toHaveURL(new RegExp(`/lessons/\\d+.*cohort_id=${ids.legacy_cohort_id}`))
      } finally {
        await page.unroute(planUnavailable)
      }
    })

    // Self-paced welcome with and without submission windows
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

    const expectedSlotText = formatExpectedInZone(ids.slot_starts_at, ids.opposite_zone)
    const expectedZonePhrase = ids.opposite_zone === 'America/Chicago' ? 'Central Time (CT)' : 'Guam time (ChST)'

    // Publish in the cohort's wall time and confirm its persisted UTC instant.
    await page.goto(`/admin/meetings?cohort_id=${ids.opp_cohort_id}&qa_user=1`)
    await expect(page.getByText(`Start in ${expectedZonePhrase}`)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('body')).not.toContainText('CT time (CT)')
    const staffWeek = page.getByRole('heading', { name: `Week ${ids.slot_week}`, exact: true }).locator('../..')
    await expect(staffWeek.getByText(expectedSlotText, { exact: true })).toBeVisible()

    const staffInput = page.locator('input[type="datetime-local"]')
    await staffInput.fill(ids.staff_entry_local)
    const createSlotResp = page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/api/v1/staff/private_meeting_slots'))
    await page.getByRole('button', { name: 'Publish time' }).click()
    const created = await createSlotResp
    expect(created.ok()).toBe(true)
    const createdPayload = await created.json()
    const publishedStart = new Date(createdPayload.slots[0].starts_at).toISOString()
    expect(publishedStart).toBe(new Date(ids.staff_entry_expected_utc).toISOString())
    const publishedLabel = formatExpectedInZone(publishedStart, ids.opposite_zone)
    await page.reload()
    await expect(page.getByText(publishedLabel, { exact: true })).toBeVisible()

    // Book from the course week and confirm the same instant after reload.
    await page.goto(`/meetings?cohort_id=${ids.opp_cohort_id}&qa_user=3`)
    await expect(page.getByText(expectedZonePhrase)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('body')).not.toContainText('CT time (CT)')
    const learnerWeek = page.locator(`#meeting-${ids.opp_cohort_id}-${ids.slot_week}`)
    await expect(learnerWeek.getByRole('heading', { name: `Week ${ids.slot_week}` })).toBeVisible()
    await expect(page.getByRole('button', { name: publishedLabel, exact: false })).toBeVisible()
    const slot = learnerWeek.getByRole('button', { name: expectedSlotText, exact: false })
    if (phone) await slot.tap()
    else await slot.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(expectedSlotText)
    const savedBooking = responseFor(page, /\/api\/v1\/private_meetings$/, 'POST')
    await dialog.getByRole('button', { name: 'Book meeting' }).click()
    const saved = await savedBooking
    expect(saved.ok()).toBe(true)
    const { booking } = await saved.json()
    expect(booking.week_number).toBe(ids.slot_week)
    expect(new Date(booking.starts_at).toISOString()).toBe(new Date(ids.slot_starts_at).toISOString())
    await expect(page.getByText('Your meeting is booked.')).toBeVisible()
    await expect(learnerWeek).toHaveAttribute('data-booked', 'true')
    await expect(learnerWeek).toContainText(expectedSlotText)
    await page.reload()
    await expect(learnerWeek).toHaveAttribute('data-booked', 'true')
    await expect(learnerWeek).toContainText(expectedSlotText)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)

    // Re-open the persisted booking from the staff list and its record page.
    await page.goto(`/admin/meetings?cohort_id=${ids.opp_cohort_id}&qa_user=1`)
    const recordLink = page.getByRole('link', { name: new RegExp(`Meeting details: .*week ${ids.slot_week}`) })
    await expect(recordLink).toContainText(expectedSlotText)
    const detailResponse = responseFor(page, new RegExp(`/api/v1/records/private_meeting/${booking.id}/detail$`))
    await recordLink.click()
    const record = await detailResponse
    expect(record.ok()).toBe(true)
    const { detail } = await record.json()
    expect(detail).toMatchObject({ timezone: ids.opposite_zone, week_number: ids.slot_week, student: { id: 3 } })
    expect(new Date(detail.starts_at).toISOString()).toBe(new Date(ids.slot_starts_at).toISOString())
    const shortTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ids.opposite_zone }).format(new Date(ids.slot_starts_at))
    await expect(page.getByText(new RegExp(shortTime)).first()).toBeVisible()
    const denied = await page.request.get(new URL(record.url()).pathname, { headers: { Authorization: 'Bearer test_token_2' } })
    expect(denied.status()).toBe(404)

    await info.attach('meeting-evidence', { contentType: 'application/json', body: JSON.stringify({
      ...ids, publishedStart, bookingId: booking.id, bookingStart: booking.starts_at, detailStart: detail.starts_at,
    }, null, 2) })

    // Preserve staff phone bell & controls
    if (phone) {
      await page.goto('/admin?qa_user=1')
      await expect(page.locator('header a[href="/announcements?tab=inbox"]')).toBeVisible({ timeout: 20_000 })
    }
  } finally {
    await context.close()
    if (claimed && session) checkedLifecycle(session, 'release', tab)
  }
})
