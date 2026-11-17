import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * L-5.2 affected-flow QA: the staff record pages for a recording, an
 * office-hour session, a private-meeting booking, a learning plan, a channel,
 * a rubric and an activity event. Every new link and its Back, as admin and as
 * an instructor who teaches one of two cohorts on the curriculum (they must
 * never open QA Other Program's records or see its name), a refused student,
 * and copying a message link then opening it. Light and dark at 1280 and 390.
 * Needs scripts/qa/record-pages-fixtures.rb after scripts/qa/run start.
 * Run: QA_SPEC=record-pages.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts
 */

const OUT = fileURLToPath(new URL('../../.qa-local/record-pages/', import.meta.url))
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/record-pages.json', import.meta.url), 'utf8')) as {
  program_cohort_id: number; other_cohort_id: number; curriculum_id: number; recording_id: number; recording_lesson_id: number; office_hour_id: number
  booking_id: number; booking_week: number; learning_plan_id: number; program_student_id: number; channel_id: number; copy_message_id: number
  rubric_id: number; activity_event_id: number; submission_id: number
  other: { recording_id: number; office_hour_id: number; booking_id: number; learning_plan_id: number; channel_id: number; activity_event_id: number }
}
const OTHER = ['QA Other Program', 'QA Other learner', 'QA Other instructor', 'Other cohort synthetic']
const ADMIN = 1
const INSTRUCTOR = 2
const STUDENT = 3

async function open(page: Page, path: string, user: number, theme: 'light' | 'dark') {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    // fallback(), not continue(): a test's own route (a forced failure) registered earlier still runs.
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.fallback() : route.abort()
  })
  await page.addInitScript((choice) => {
    try { if (choice) localStorage.setItem('csg-learn:theme', choice); else localStorage.removeItem('csg-learn:theme') } catch { /* ignore */ }
    // Keep what "Copy link" copies, so the spec can open it.
    const write = navigator.clipboard?.writeText?.bind(navigator.clipboard)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { __copied: string }).__copied = text; try { await write?.(text) } catch { /* headless */ } } } })
  }, theme === 'light' ? 'light' : '')
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function record(page: Page, name: string, theme: string, project: string) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const describe = (v: { id: string; nodes: Array<{ target: unknown }> }) => v.nodes.slice(0, 4).map((node) => `${v.id} ${JSON.stringify(node.target)}`)
  const contrast = axe.violations.filter((v) => v.id === 'color-contrast').flatMap(describe)
  const serious = axe.violations.filter((v) => v.id !== 'color-contrast' && (v.impact === 'serious' || v.impact === 'critical')).flatMap(describe)
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme || null)
  mkdirSync(`${OUT}${project}`, { recursive: true })
  const screenshot = `${OUT}${project}/${theme}-${name}.png`
  await page.screenshot({ path: screenshot, fullPage: true })
  const url = new URL(page.url())
  appendFileSync(`${OUT}${project}.jsonl`, `${JSON.stringify({ name, theme, overflow, serious, contrast, dataTheme, url: url.pathname + url.search, screenshot })}\n`)
  expect(dataTheme).toBe(theme)
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(serious, `${name} serious axe violations`).toEqual([])
  expect(contrast, `${name} contrast`).toEqual([])
}

const back = (page: Page) => page.locator('[data-back-link]').first()
const related = (page: Page, key: string) => page.locator(`[data-related-row="${key}"]`)
async function noOther(page: Page) {
  for (const text of OTHER) await expect(page.locator('body')).not.toContainText(text)
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })

    test('admin: recording from the Recordings tab, Edit, and Back', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await open(page, `/admin/cohorts/${ids.program_cohort_id}?tab=recordings`, ADMIN, theme)
      await page.getByRole('link', { name: 'QA counter walkthrough', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/recordings/${ids.recording_id}(\\?|$)`))
      await expect(page.locator('h1')).toHaveText('QA counter walkthrough')
      await expect(page.locator('[data-record-type]')).toHaveText('Recording · Week 2')
      // The cohort page names itself as the origin; the link returns to its Recordings tab.
      await expect(back(page)).toHaveText('Back to QA Program')
      await expect(back(page)).toHaveAttribute('href', /\/admin\/cohorts\/\d+\?tab=recordings/)
      await expect(page.locator('#lessons')).toContainText('Set up the synthetic counter')
      await expect(page.locator('#lessons')).toContainText('Optional')
      await expect(page.locator('#watchers')).toContainText('QA Program')
      await expect(page.locator('#watchers')).toContainText('Finished')
      await record(page, 'admin-recording', theme, info.project.name)
      // Fix round 1: watchers come 25 at a time; Show more loads the rest, and the totals cover everyone.
      await expect(page.locator('#watchers')).toContainText(/30 of \d+ learners/)
      await expect(page.locator('#watchers li')).toHaveCount(25)
      await page.locator('[data-show-more-watchers]').click()
      await expect(page.locator('#watchers li')).toHaveCount(30)
      await expect(page.locator('#watchers')).toContainText('Showing 30 of 30')
      await expect(page.locator('[data-show-more-watchers]')).toHaveCount(0)
      // The lesson that plays it opens its staff page, which comes back here.
      await page.locator('#lessons a[href^="/admin/lessons/"]').first().click()
      await expect(page).toHaveURL(new RegExp(`/admin/lessons/${ids.recording_lesson_id}`))
      await expect(back(page)).toHaveText('Back to Recording · QA counter walkthrough')
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/recordings/${ids.recording_id}`))
      // Edit opens the cohort's Recordings tab with this recording's form open.
      await page.getByRole('link', { name: 'Edit', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`tab=recordings&edit_recording=${ids.recording_id}`))
      await expect(page.locator(`#recording-${ids.recording_id} input[type="text"]`).first()).toHaveValue('QA counter walkthrough')
      await page.goBack()
      await expect(page).toHaveURL(new RegExp(`/admin/recordings/${ids.recording_id}`))
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.program_cohort_id}\\?tab=recordings`))
      expect(errors).toEqual([])
    })

    test('admin: a failed or refused load keeps Back, and Try again recovers', async ({ page }, info) => {
      let fail = true
      await page.route('**/api/v1/records/recording/*/detail*', (route) => fail ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Synthetic failure"}' }) : route.fallback())
      await open(page, `/admin/recordings/${ids.recording_id}?return_to=${encodeURIComponent('/admin/grading?filter=redo')}`, ADMIN, theme)
      await expect(page.getByText("Couldn't load this recording")).toBeVisible()
      await expect(back(page)).toHaveText('Back to Grading · Redo')
      await expect(back(page)).toHaveAttribute('href', '/admin/grading?filter=redo')
      await record(page, 'admin-error-state', theme, info.project.name)
      fail = false
      await page.getByRole('button', { name: 'Try again' }).click()
      await expect(page.locator('h1')).toHaveText('QA counter walkthrough')

      await open(page, `/admin/rubrics/999999?return_to=${encodeURIComponent(`/admin/curricula/${ids.curriculum_id}`)}`, ADMIN, theme)
      await expect(page.locator('body')).toContainText('No access')
      await expect(back(page)).toHaveText('Back to Curriculum')
      await record(page, 'admin-no-access-back', theme, info.project.name)
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/curricula/${ids.curriculum_id}`))
    })

    test('instructor: session from Schedule, booking from Meetings, and Back', async ({ page }, info) => {
      await open(page, `/admin/cohorts/${ids.program_cohort_id}?tab=schedule`, INSTRUCTOR, theme)
      await page.getByRole('link', { name: 'QA weekly support' }).first().click()
      await expect(page).toHaveURL(new RegExp(`/admin/office-hours/${ids.office_hour_id}`))
      await expect(page.locator('[data-record-type]')).toHaveText('Office hours · Weekly')
      await expect(page.getByRole('link', { name: 'Join', exact: true })).toHaveAttribute('href', 'https://example.invalid/meeting')
      await expect(page.locator('#people')).toContainText('active learner')
      await record(page, 'instructor-office-hour', theme, info.project.name)
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.program_cohort_id}\\?tab=schedule`))

      await open(page, `/admin/meetings?cohort_id=${ids.program_cohort_id}`, INSTRUCTOR, theme)
      await page.locator(`a[href^="/admin/meetings/${ids.booking_id}"]`).first().click()
      await expect(page).toHaveURL(new RegExp(`/admin/meetings/${ids.booking_id}`))
      await expect(page.locator('h1')).toHaveText('Meeting with QA Program')
      await expect(back(page)).toHaveText('Back to Meetings')
      await expect(page.locator('#history')).toContainText('Changed the meeting link')
      await expect(page.locator('#history')).toContainText('Booked')
      await record(page, 'instructor-booking', theme, info.project.name)
      await page.getByRole('link', { name: 'Move or cancel' }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/meetings\\?cohort_id=${ids.program_cohort_id}&booking_id=${ids.booking_id}&week=${ids.booking_week}`))
      await expect(page.locator(`#booking-${ids.booking_id}`)).toBeVisible()
    })

    test('instructor: plan page from the plan editor, Edit plan, and Back', async ({ page }, info) => {
      await open(page, `/admin/cohorts/${ids.program_cohort_id}/students/${ids.program_student_id}/learning`, INSTRUCTOR, theme)
      await page.getByRole('link', { name: 'Plan page and history' }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/learning-plans/${ids.learning_plan_id}`))
      await expect(page.locator('h1')).toHaveText('QA steady practice')
      await expect(page.locator('#milestones')).toContainText('Practice the first lab')
      await expect(page.locator('#revisions')).toContainText('Started the plan')
      await expect(page.locator('#revisions')).toContainText('Changed the description, next follow-up')
      await record(page, 'instructor-learning-plan', theme, info.project.name)
      await page.getByRole('link', { name: 'Edit plan' }).click()
      await expect(page).toHaveURL(new RegExp(`/students/${ids.program_student_id}/learning#learning-plan`))
      await expect(page.locator('#learning-plan')).toBeInViewport()
      await page.goBack()
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.program_cohort_id}/students/${ids.program_student_id}/learning`))
    })

    test('instructor: channel from Communication shows a member count and hides a blocked sender', async ({ page }, info) => {
      await open(page, `/admin/cohorts/${ids.program_cohort_id}?tab=communication`, INSTRUCTOR, theme)
      await page.getByRole('link', { name: 'qa-class' }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/channels/${ids.channel_id}`))
      await expect(page.locator('h1')).toHaveText('#qa-class')
      await expect(page.locator('[data-record-type]')).toHaveText('Class chat')
      await expect(back(page)).toHaveText('Back to QA Program · Communication')
      await expect(page.locator('#members')).toContainText('are in this conversation')
      await expect(page.locator('#members a[href^="/admin/team/"]')).toHaveCount(0)
      await expect(page.locator('#activity')).toContainText('Message hidden')
      await expect(page.locator('body')).not.toContainText('blocked sender')
      await record(page, 'instructor-channel', theme, info.project.name)
      await page.getByRole('link', { name: 'Open in Messages' }).first().click()
      await expect(page).toHaveURL(new RegExp(`/messages/${ids.channel_id}`))
      // Messages links back to the channel's page for staff.
      await page.getByRole('button', { name: 'Conversation options' }).click()
      await page.getByRole('menuitem', { name: 'Conversation details' }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/channels/${ids.channel_id}`))
      await expect(back(page)).toHaveText('Back to Messages')
    })

    test('admin: channel lists members; rubric from the curriculum names both cohorts', async ({ page }, info) => {
      await open(page, `/admin/channels/${ids.channel_id}`, ADMIN, theme)
      await expect(page.locator('#members')).toContainText('QA Program')
      await expect(page.locator('#members li').first()).toBeVisible()
      await record(page, 'admin-channel', theme, info.project.name)

      await open(page, `/admin/curricula/${ids.curriculum_id}`, ADMIN, theme)
      await page.locator(`#rubrics a[href^="/admin/rubrics/${ids.rubric_id}"]`).click()
      await expect(page).toHaveURL(new RegExp(`/admin/rubrics/${ids.rubric_id}`))
      await expect(page.locator('h1')).toHaveText('Synthetic clarity rubric')
      await expect(back(page)).toHaveText(/^Back to Curriculum/)
      await expect(page.locator('#criteria')).toContainText('Explain your approach')
      await expect(page.locator('#uses')).toContainText('QA Other Program')
      await record(page, 'admin-rubric', theme, info.project.name)
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/curricula/${ids.curriculum_id}`))
    })

    test('instructor: rubric counts only their cohort and never names the other', async ({ page }, info) => {
      await open(page, `/admin/rubrics/${ids.rubric_id}`, INSTRUCTOR, theme)
      await expect(page.locator('#uses')).toContainText("1 other cohort uses this curriculum. You don't teach it")
      await noOther(page)
      await record(page, 'instructor-rubric', theme, info.project.name)
    })

    test('admin: activity event from School activity, its submission, and Back', async ({ page }, info) => {
      await open(page, '/admin/activity', ADMIN, theme)
      await page.locator(`a[href^="/admin/activity/${ids.activity_event_id}"]`).first().click()
      await expect(page).toHaveURL(new RegExp(`/admin/activity/${ids.activity_event_id}`))
      await expect(page.locator('h1')).toContainText('Submitted work')
      await expect(back(page)).toHaveText('Back to Activity')
      await record(page, 'admin-activity-event', theme, info.project.name)
      await related(page, 'record').locator('a').click()
      await expect(page).toHaveURL(new RegExp(`/admin/submissions/${ids.submission_id}`))
      await expect(back(page)).toContainText('Back to Activity')
      await page.goBack()
      await back(page).click()
      await expect(page).toHaveURL(/\/admin\/activity(\?|$)/)
    })

    test('instructor: activity event from cohort Activity goes back there', async ({ page }) => {
      await open(page, `/admin/cohorts/${ids.program_cohort_id}?tab=activity`, INSTRUCTOR, theme)
      await page.locator(`a[href^="/admin/activity/${ids.activity_event_id}"]`).first().click()
      await expect(page).toHaveURL(new RegExp(`/admin/activity/${ids.activity_event_id}`))
      // The URL changes before the lazy page replaces the old one: wait for its heading.
      await expect(page.locator('h1')).toContainText('Submitted work')
      await expect(back(page)).toHaveText('Back to Activity')
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.program_cohort_id}\\?tab=activity`))
    })

    test('instructor: QA Other Program records are No access; admin opens them', async ({ page }) => {
      const paths = [`/admin/recordings/${ids.other.recording_id}`, `/admin/office-hours/${ids.other.office_hour_id}`, `/admin/meetings/${ids.other.booking_id}`,
        `/admin/learning-plans/${ids.other.learning_plan_id}`, `/admin/channels/${ids.other.channel_id}`, `/admin/activity/${ids.other.activity_event_id}`]
      for (const path of paths) {
        await open(page, path, INSTRUCTOR, theme)
        await expect(page.locator('body')).toContainText('No access')
        await noOther(page)
      }
      for (const path of paths) {
        await open(page, path, ADMIN, theme)
        await expect(page.locator('h1')).toBeVisible()
        await expect(page.locator('body')).not.toContainText('No access')
      }
    })

    test('student: every staff record page is No access, and their own booking stays on My meetings', async ({ page }, info) => {
      const paths = [`/admin/recordings/${ids.recording_id}`, `/admin/office-hours/${ids.office_hour_id}`, `/admin/meetings/${ids.booking_id}`,
        `/admin/learning-plans/${ids.learning_plan_id}`, `/admin/channels/${ids.channel_id}`, `/admin/rubrics/${ids.rubric_id}`, `/admin/activity/${ids.activity_event_id}`]
      for (const path of paths) {
        await open(page, path, STUDENT, theme)
        await expect(page.locator('body')).toContainText('No access')
        await expect(page.locator('body')).not.toContainText('QA counter walkthrough')
      }
      await record(page, 'student-no-access', theme, info.project.name)
      await open(page, `/meetings?cohort_id=${ids.program_cohort_id}&booking_id=${ids.booking_id}&week=${ids.booking_week}`, STUDENT, theme)
      await expect(page.locator('body')).not.toContainText('No access')
    })

    test('instructor: copy a message link in Messages, then open it on the highlighted message', async ({ page }, info) => {
      const phone = info.project.name.endsWith('390')
      await open(page, `/messages/${ids.channel_id}`, INSTRUCTOR, theme)
      const row = page.locator(`#message-${ids.copy_message_id}`)
      await expect(row).toBeVisible()
      if (phone) {
        await row.getByRole('button', { name: 'Open message actions' }).click()
        await page.getByRole('button', { name: 'Copy link to message' }).click()
      } else {
        await row.hover()
        await row.getByRole('button', { name: 'Copy link to message' }).click()
      }
      await expect(page.getByText('Link to message copied')).toBeVisible()
      const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied || '')
      expect(new URL(copied).pathname + new URL(copied).search).toBe(`/messages/${ids.channel_id}?message_id=${ids.copy_message_id}`)
      const fresh = await page.context().newPage()
      await open(fresh, new URL(copied).pathname + new URL(copied).search, INSTRUCTOR, theme)
      await expect(fresh.locator(`#message-${ids.copy_message_id}`)).toHaveClass(/message-row-highlight/)
      await expect(fresh.locator(`#message-${ids.copy_message_id}`)).toBeInViewport()
      await record(fresh, 'instructor-message-permalink', theme, info.project.name)
      await fresh.close()
    })
  })
}
