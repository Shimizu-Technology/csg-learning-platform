import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * Connected records, finish (L-5.2, L-3.2, L-2.9) affected-flow QA: the return
 * plan, community report and offering pages; Safety filtered to one person; a
 * lesson's learner activity; a course package's curriculum and cohorts; watch
 * progress Back. As admin and as an instructor who teaches QA Program but not
 * QA Finish Other Program, whose records must be No access and whose names must
 * never appear. A forced 500 keeps Back and recovers. Light and dark at 1280
 * and 390. Needs scripts/qa/connected-records-finish-fixtures.rb after start.
 * Run: QA_SPEC=connected-records-finish.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts
 */

const OUT = fileURLToPath(new URL('../../.qa-local/connected-records-finish/', import.meta.url))
const PACKAGE = fileURLToPath(new URL('../../.qa-local/finish-package.json', import.meta.url))
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/connected-records-finish.json', import.meta.url), 'utf8')) as {
  program_cohort_id: number; other_cohort_id: number; self_paced_cohort_id: number; package_cohort_id: number; recovery_plan_id: number
  intervention_id: number; behind_id: number; program_student_id: number; channel_id: number; channel_message_id: number
  channel_report_id: number; dm_report_id: number; lesson_id: number; imported_curriculum_id: number; instructor_id: number
  other: { recovery_plan_id: number; content_report_id: number; learner_id: number }
}
const OTHER = ['QA Finish Other Program', 'QA Finish Other learner', 'QA Finish Other instructor', 'Synthetic other-cohort report']
const ADMIN = 1
const INSTRUCTOR = 2

async function open(page: Page, path: string, user: number, theme: 'light' | 'dark') {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    // fallback(), not continue(): a test's own route (a forced failure) registered earlier still runs.
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.fallback() : route.abort()
  })
  await page.addInitScript((choice) => {
    try { if (choice) localStorage.setItem('csg-learn:theme', choice); else localStorage.removeItem('csg-learn:theme') } catch { /* ignore */ }
  }, theme === 'light' ? 'light' : '')
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

// `exclude` leaves out page parts this PR didn't change (named in the QA record), so their known issues don't mask ours.
async function record(page: Page, name: string, theme: string, project: string, exclude: string[] = []) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  for (const selector of exclude) builder.exclude(selector)
  const axe = await builder.analyze()
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

    test('instructor: return plan from the Support tab and the follow-up plan, and Back', async ({ page }, info) => {
      await open(page, `/admin/cohorts/${ids.program_cohort_id}/students/${ids.behind_id}/support`, INSTRUCTOR, theme)
      await page.getByRole('link', { name: 'Plan page' }).first().click()
      await expect(page).toHaveURL(new RegExp(`/admin/recovery-plans/${ids.recovery_plan_id}\\?return_to=`))
      await expect(page.locator('h1')).toHaveText("QA Behind's return plan")
      await expect(page.locator('[data-record-header]')).toContainText('Follow-up due')
      await expect(page.locator('#overview')).toContainText('Two synthetic labs a day')
      await expect(page.locator('#check-ins li')).toHaveCount(3)
      await expect(page.locator('#check-ins li').first()).toContainText('Synthetic check-in 3')
      await expect(back(page)).toHaveText('Back to QA Behind')
      await record(page, 'return-plan-instructor', theme, info.project.name)
      // Team member pages are admin-only: the instructor reads the owner's name without a link.
      await expect(page.locator('#overview a[href^="/admin/team/"]')).toHaveCount(0)
      await related(page, 'follow_up').getByRole('link').click()
      await expect(page).toHaveURL(new RegExp(`/admin/interventions/${ids.intervention_id}`))
      await page.getByRole('link', { name: 'Plan page' }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/recovery-plans/${ids.recovery_plan_id}\\?return_to=%2Fadmin%2Finterventions`))
      await expect(back(page)).toHaveText('Back to Follow-up plan · QA Behind')
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/interventions/${ids.intervention_id}`))
      await noOther(page)
    })

    test('instructor: another cohort’s plan, every report and purchases are No access with a way back', async ({ page }, info) => {
      await open(page, `/admin/recovery-plans/${ids.other.recovery_plan_id}`, INSTRUCTOR, theme)
      await expect(page.locator('body')).toContainText('No access')
      await expect(back(page)).toHaveText('Back to Support')
      await noOther(page)
      await record(page, 'return-plan-other-cohort', theme, info.project.name)
      for (const path of [`/admin/moderation/reports/${ids.channel_report_id}`, `/admin/moderation/reports/${ids.other.content_report_id}`, `/admin/offerings/${ids.self_paced_cohort_id}`]) {
        await page.goto(`${path}?qa_user=${INSTRUCTOR}`)
        await page.waitForLoadState('networkidle')
        await expect(page.locator('body'), path).toContainText('No access')
        await noOther(page)
      }
      // The lesson's activity names only QA Program's learner.
      await page.goto(`/admin/lessons/${ids.lesson_id}?qa_user=${INSTRUCTOR}`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('#activity')).toContainText('QA Program')
      await expect(page.locator('#activity li')).toHaveCount(2)
      await noOther(page)
    })

    test('admin: a report from Safety, its conversation, the people, and Safety filtered to one person', async ({ page }, info) => {
      await open(page, '/admin/moderation', ADMIN, theme)
      await page.locator(`a[href^="/admin/moderation/reports/${ids.channel_report_id}"]`).click()
      await expect(page).toHaveURL(new RegExp(`/admin/moderation/reports/${ids.channel_report_id}(\\?|$)`))
      await expect(page.locator('h1')).toHaveText('QA Program reported a message from QA Behind')
      await expect(page.locator('blockquote')).toHaveText('Synthetic reported class-chat message.')
      await expect(page.locator('#people')).toContainText('QA Program blocked QA Behind')
      await expect(back(page)).toHaveText('Back to Safety')
      await record(page, 'report-channel', theme, info.project.name)
      await page.getByRole('link', { name: /^Open in #qa-class/ }).click()
      await expect(page).toHaveURL(new RegExp(`/messages/${ids.channel_id}\\?message_id=${ids.channel_message_id}`))
      await page.goBack()
      await expect(page.locator('h1')).toHaveText('QA Program reported a message from QA Behind')
      await page.locator('#people').getByRole('link', { name: /^QA Behind on Safety/ }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/moderation\\?person_id=${ids.behind_id}`))
      await expect(page.getByRole('status').filter({ hasText: 'Showing reports and blocks involving QA Behind' })).toBeVisible()
      await expect(page.locator('article[id^="report-"]')).toHaveCount(2)
      await record(page, 'safety-person', theme, info.project.name)
      await page.getByRole('button', { name: 'Blocks', exact: true }).click()
      await expect(page.locator('section[aria-labelledby="safety-blocks"]')).toContainText('QA Program blocked QA Behind')
      await page.getByRole('button', { name: 'Show everyone' }).click()
      await expect(page).not.toHaveURL(/person_id=/)
      // A direct message the admin isn't in stays a quote and a label.
      await page.goto(`/admin/moderation/reports/${ids.dm_report_id}?qa_user=${ADMIN}`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('#report')).toContainText('You’re not in this conversation, so it can’t be opened')
      await expect(page.locator('#report a[href^="/messages/"]')).toHaveCount(0)
    })

    test('admin: Reviewing and Actioned from the report page, and a forced failure keeps Back', async ({ page }, info) => {
      // Fails until Try again (dev StrictMode loads twice), like record-pages.spec.ts.
      let fail = true
      await page.route(`**/api/v1/records/content_report/${ids.other.content_report_id}/detail*`, (route) => fail
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Synthetic failure"}' })
        : route.fallback())
      await open(page, `/admin/moderation/reports/${ids.other.content_report_id}?return_to=%2Fadmin%2Fmoderation%3Fview%3Dresolved`, ADMIN, theme)
      await expect(page.locator('body')).toContainText("Couldn't load this report")
      await expect(back(page)).toHaveText('Back to Safety')
      await record(page, 'report-error', theme, info.project.name)
      fail = false
      await page.getByRole('button', { name: 'Try again' }).click()
      await expect(page.locator('h1')).toContainText('reported QA Finish Other learner')
      // The first pass marks the synthetic report Reviewing (saved); later passes find it already reviewing.
      const status = page.locator('[data-record-header]')
      if (await page.getByRole('button', { name: 'Reviewing' }).count()) {
        await page.getByRole('button', { name: 'Reviewing' }).click()
        await expect(status).toContainText('Reviewing')
      }
    })

    test('admin: purchases from the offering settings, Show more, a buyer’s enrollment, and Back', async ({ page }, info) => {
      await open(page, `/admin/cohorts/${ids.self_paced_cohort_id}?tab=settings`, ADMIN, theme)
      await page.getByRole('link', { name: 'Purchases', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/offerings/${ids.self_paced_cohort_id}$`))
      await expect(page.locator('h1')).toHaveText('QA Self-paced Lab')
      await expect(page.locator('#overview')).toContainText('$1323.00 from 27 purchases')
      await expect(page.locator('[data-purchase-row]')).toHaveCount(25)
      await expect(page.locator('[data-purchase-row]').first()).toContainText('No enrollment')
      await expect(back(page)).toHaveText('Back to Settings')
      await record(page, 'offering', theme, info.project.name)
      await page.locator('[data-show-more-purchases]').click()
      await expect(page.locator('[data-purchase-row]')).toHaveCount(30)
      await page.locator('[data-purchase-row]').filter({ hasText: 'Enrolled' }).first().getByRole('link').click()
      await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.self_paced_cohort_id}/students/\\d+`))
      await page.goBack()
      await expect(page.locator('h1')).toHaveText('QA Self-paced Lab')
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.self_paced_cohort_id}\\?tab=settings`))
    })

    test('admin: a student’s and a team member’s safety rows, and the lesson’s activity', async ({ page }, info) => {
      await open(page, `/admin/cohorts/${ids.program_cohort_id}/students/${ids.behind_id}/overview`, ADMIN, theme)
      await expect(related(page, 'safety')).toContainText('Open reports about them')
      await related(page, 'safety').getByRole('link').click()
      await expect(page).toHaveURL(new RegExp(`/admin/moderation\\?person_id=${ids.behind_id}`))
      await open(page, `/admin/team/${ids.instructor_id}`, ADMIN, theme)
      await expect(related(page, 'safety')).toContainText('Open reports about them')
      await expect(related(page, 'safety').getByRole('link')).toHaveCount(0)
      await page.goto(`/admin/lessons/${ids.lesson_id}?qa_user=${ADMIN}`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('#activity li')).toHaveCount(3)
      await expect(page.locator('#activity')).toContainText('QA Finish Other Program')
      await record(page, 'lesson-activity', theme, info.project.name)
      await page.locator('#activity a[data-record-link="activity_event"]').first().click()
      await expect(page).toHaveURL(/\/admin\/activity\/\d+\?return_to=/)
      await expect(back(page)).toHaveText('Back to Lesson · QA Lab 1.1.1')
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/lessons/${ids.lesson_id}`))
    })

    test('admin: a course package preview names its curriculum and the cohorts using it', async ({ page }, info) => {
      await open(page, '/admin/content', ADMIN, theme)
      await page.getByRole('button', { name: 'Import course package' }).click()
      await page.locator('#course-package-file').setInputFiles(PACKAGE)
      const where = page.locator('[data-package-where-used]')
      await expect(where).toContainText('Imported as Python recording package')
      await expect(where).toContainText('Used by one cohort')
      await expect(where.getByRole('link', { name: 'QA Package Cohort' })).toHaveAttribute('href', `/admin/cohorts/${ids.package_cohort_id}`)
      // Content's module drag handles (StructureActions) are behind the dialog and unchanged here.
      await record(page, 'package-preview', theme, info.project.name, ['.cursor-grab'])
      await where.getByRole('link', { name: 'Python recording package' }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/curricula/${ids.imported_curriculum_id}`))
      await expect(page.locator('[data-record-type]')).toContainText('Imported course package python-fundamentals')
    })

    // L-2.9 items #268 already fixed, checked again here: the Teaching team tab and /settings for an instructor,
    // the recordings author line and its Watch progress link, and the staff shell's notification bell.
    test('instructor: Teaching team and settings URLs, recording author, and the bell (L-2.9, already done)', async ({ page }, info) => {
      await open(page, `/admin/cohorts/${ids.program_cohort_id}?tab=team`, INSTRUCTOR, theme)
      await expect(page.locator('h1')).toContainText('QA Program')
      await expect(page.locator('main')).not.toBeEmpty()
      await page.goto(`/admin/cohorts/${ids.program_cohort_id}/settings?qa_user=${INSTRUCTOR}`)
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/settings_notice=1/)
      await expect(page).not.toHaveURL(/tab=recordings/)
      await page.goto(`/admin/cohorts/${ids.program_cohort_id}?tab=recordings&qa_user=${INSTRUCTOR}`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).not.toContainText('by Unknown')
      await expect(page.getByRole('link', { name: 'Watch progress' }).first()).toBeVisible()
      const bell = page.getByRole('link', { name: /^Notifications/ }).first()
      await expect(bell).toHaveAttribute('href', '/announcements?tab=inbox')
      await record(page, 'l29-recordings', theme, info.project.name)
    })

    test('instructor: watch progress from Recordings goes Back to Recordings (L-2.9)', async ({ page }, info) => {
      await open(page, `/admin/cohorts/${ids.program_cohort_id}?tab=recordings`, INSTRUCTOR, theme)
      await page.getByRole('link', { name: 'Watch progress' }).first().click()
      await expect(page).toHaveURL(/\/watch-progress\?recording_id=/)
      await expect(back(page)).toHaveText('Back to Recordings')
      await record(page, 'watch-progress', theme, info.project.name)
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.program_cohort_id}\\?tab=recordings`))
    })
  })
}
