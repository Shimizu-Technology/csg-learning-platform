import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * W6.4 + L-5.1 affected-flow QA. As the QA instructor: the staff home's summary and Access & invitations
 * destinations; schedule an update, reschedule it, cancel it and schedule it again; the program student
 * never sees it before it posts (feed, page, Today, Notifications); a forced tick posts it once (and a
 * second tick and a rerun post nothing); the student then sees it. The update page's cohort link, read
 * count and rendered Markdown, and its Back. The submission page's identity header, lesson, module and
 * rubric links, and Back to the queue and to the student. The admin's School activity has one heading.
 * Light and dark at 1280 and 390. Needs staff-home-scheduled-updates-fixtures.rb setup after run start.
 * Run (repo root): QA_SPEC=staff-home-scheduled-updates.spec.ts node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const OUT = `${ROOT}.qa-local/staff-home-scheduled/`
const state = JSON.parse(readFileSync(`${ROOT}.qa-local/state.json`, 'utf8')) as { database: string }
const ids = JSON.parse(readFileSync(`${ROOT}.qa-local/staff-home-scheduled.json`, 'utf8')) as {
  program_cohort_id: number; read_update_id: number; submission_id: number; rubric_id: number; lesson_id: number; module_id: number
}
const ADMIN = 1
const INSTRUCTOR = 2
const STUDENT = 3
const RUN = Date.now().toString(36)

function fixture(...args: string[]) {
  const output = execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/staff-home-scheduled-updates-fixtures.rb', ...args], {
    cwd: `${ROOT}api`, encoding: 'utf8', env: { ...process.env, RAILS_ENV: 'test', DATABASE_URL: `postgresql://localhost/${state.database}` },
  })
  return JSON.parse(output.trim().split('\n').pop()!)
}

/** Tomorrow's date in Guam (UTC+10, no DST), for the Day field. */
function guamTomorrow() {
  return new Date(Date.now() + 10 * 3_600_000 + 24 * 3_600_000).toISOString().slice(0, 10)
}

async function open(page: Page, path: string, user: number, theme: 'light' | 'dark') {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.fallback() : route.abort()
  })
  await page.addInitScript((choice) => {
    try { if (choice) localStorage.setItem('csg-learn:theme', choice); else localStorage.removeItem('csg-learn:theme') } catch { /* ignore */ }
  }, theme === 'light' ? 'light' : '')
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function record(page: Page, name: string, theme: string, project: string, extra: Record<string, unknown> = {}) {
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
  appendFileSync(`${OUT}${project}.jsonl`, `${JSON.stringify({ name, theme, overflow, serious, contrast, dataTheme, url: url.pathname + url.search, screenshot, ...extra })}\n`)
  expect(dataTheme).toBe(theme)
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(serious, `${name} serious axe violations`).toEqual([])
  expect(contrast, `${name} contrast`).toEqual([])
}

const back = (page: Page) => page.locator('[data-back-link]').first()
const related = (page: Page, key: string) => page.locator(`[data-related-row="${key}"]`)
const detail = (page: Page) => page.getByRole('region', { name: 'Update' })

/** Confirms the audience check when it appears (posting or scheduling outside the page's cohort). */
async function confirmAudience(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Schedule to QA Program?' })
  await dialog.waitFor({ state: 'visible', timeout: 3000 }).then(() => dialog.getByRole('button', { name: 'Schedule to QA Program', exact: true }).click(), () => undefined)
}

for (const theme of ['light', 'dark'] as const) {
  test.describe.serial(theme, () => {
    test.use({ colorScheme: theme })

    test('instructor staff home: distinct summary links, Access & invitations opens never-signed-in students', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await open(page, `/admin?cohort_id=${ids.program_cohort_id}`, INSTRUCTOR, theme)
      const summary = page.getByRole('navigation', { name: 'Staff summary' })
      const labels = await summary.getByRole('link').allInnerTexts()
      // Each chip names a different thing and opens the inbox filtered to it (T-6, U-3.4).
      expect(new Set(labels.map((label) => label.replace(/^\d+/, '').trim())).size).toBe(labels.length)
      for (const link of await summary.getByRole('link').all()) expect(await link.getAttribute('href')).toMatch(/^\/admin\?.*kind=/)
      await expect(page.locator('main')).not.toContainText(/enrollments checked|Enrollments needing attention/i)
      const access = page.getByRole('link', { name: 'Access & invitations' })
      expect(await access.getAttribute('href')).toBe(`/admin/students?filter=never-signed-in&cohort_id=${ids.program_cohort_id}`)
      expect(await page.getByRole('link', { name: 'Open cohort' }).getAttribute('href')).toBe(`/admin/cohorts/${ids.program_cohort_id}`)
      await record(page, 'staff-home', theme, info.project.name, { labels })
      await access.click()
      await expect(page).toHaveURL(/\/admin\/students\?filter=never-signed-in/)
      await expect(page.getByRole('button', { name: 'Never signed in' }).or(page.getByRole('tab', { name: 'Never signed in' })).first()).toBeVisible()
      await page.goBack()
      await expect(page).toHaveURL(/\/admin\?cohort_id=/)
      expect(errors).toEqual([])
    })

    test('admin School activity shows one heading', async ({ page }, info) => {
      await open(page, '/admin/activity', ADMIN, theme)
      await expect(page.getByRole('heading', { name: 'School activity' })).toHaveCount(1)
      await record(page, 'school-activity', theme, info.project.name)
    })

    test('schedule, reschedule, cancel and schedule again; hidden from the student; a forced tick posts it once', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const title = `QA scheduled ${info.project.name} ${theme} ${RUN}`
      await open(page, '/announcements?scope=manage', INSTRUCTOR, theme)
      const composer = page.getByRole('form', { name: 'Post an update' })
      await composer.getByLabel('Title', { exact: true }).fill(title)
      await composer.getByLabel('Cohort for this update').selectOption({ label: 'QA Program' })
      await composer.getByRole('textbox', { name: 'Update, rich text' }).click()
      await page.keyboard.type('Lab moves to room 3 on Friday.')
      await composer.getByRole('button', { name: 'Schedule', exact: true }).click()
      await expect(composer.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
      await composer.getByLabel('Day').fill(guamTomorrow())
      await composer.getByLabel(/^Time/).selectOption('9')
      await expect(composer.getByTestId('schedule-sends-about')).toContainText('9:00 AM ChST')
      await expect(composer.getByTestId('schedule-sends-about')).toContainText('hourly run, not to the minute')
      await record(page, 'composer-schedule', theme, info.project.name)
      await composer.getByRole('button', { name: 'Schedule update' }).click()
      await confirmAudience(page)
      await expect(page).toHaveURL(/status=scheduled/)
      const row = page.getByRole('article').filter({ hasText: title })
      await expect(row.getByText('Scheduled', { exact: true })).toBeVisible()
      await expect(row).toContainText('Sends about')
      await record(page, 'manage-scheduled', theme, info.project.name)
      const href = await row.getByRole('link', { name: title }).getAttribute('href')
      const id = Number(href!.match(/\/announcements\/(\d+)/)![1])

      // Reschedule to 10:00.
      await row.getByRole('link', { name: title }).click()
      await expect(detail(page).getByTestId('scheduled-notice')).toContainText('9:00 AM ChST')
      await record(page, 'scheduled-page', theme, info.project.name)
      await detail(page).getByRole('button', { name: 'Edit or reschedule' }).click()
      const editor = page.getByRole('form', { name: 'Edit scheduled update' })
      await expect(editor.getByLabel('Day')).toHaveValue(guamTomorrow())
      await editor.getByLabel(/^Time/).selectOption('10')
      await editor.getByRole('button', { name: 'Save schedule' }).click()
      await confirmAudience(page)
      await expect(detail(page)).toContainText('Schedule saved')
      await expect(detail(page).getByTestId('scheduled-notice')).toContainText('10:00 AM ChST')

      // Cancel: an ordinary draft again.
      await detail(page).getByRole('button', { name: 'Cancel schedule' }).click()
      await expect(detail(page)).toContainText('Schedule cancelled')
      await expect(detail(page).getByTestId('scheduled-notice')).toHaveCount(0)
      await expect(detail(page).getByText('Draft', { exact: true })).toBeVisible()

      // Schedule again from Edit draft.
      await detail(page).getByRole('button', { name: 'Edit draft' }).click()
      const again = page.getByRole('form', { name: 'Edit draft' })
      await again.getByRole('button', { name: 'Schedule', exact: true }).click()
      await expect(again.getByLabel('Day')).toHaveValue(guamTomorrow())
      await again.getByRole('button', { name: 'Schedule update' }).click()
      await confirmAudience(page)
      await expect(detail(page).getByTestId('scheduled-notice')).toContainText('9:00 AM ChST')

      // The student sees nothing of it: feed, its page, Today, Notifications.
      await open(page, '/announcements', STUDENT, theme)
      await expect(page.locator('main')).not.toContainText(title)
      await open(page, `/announcements/${id}`, STUDENT, theme)
      await expect(page.getByRole('alert')).toContainText('Update not found')
      await expect(page.locator('main')).not.toContainText(title)
      await open(page, '/', STUDENT, theme)
      await expect(page.locator('main')).not.toContainText(title)
      await open(page, '/announcements?tab=inbox', STUDENT, theme)
      await expect(page.locator('main')).not.toContainText(title)

      // Its hour comes; the tick posts it once.
      fixture('due', String(id))
      const ticked = fixture('tick', String(id))
      appendFileSync(`${OUT}${info.project.name}.jsonl`, `${JSON.stringify({ name: 'forced-tick', theme, ticked })}\n`)
      expect(ticked.runs).toEqual([true, true, true])
      const [first, second, rerun] = ticked.summaries.map((summary: { tasks: Array<Record<string, unknown>> }) => summary.tasks[0])
      expect(first).toMatchObject({ name: 'scheduled_updates', status: 'run', claimed: 1, sent: 1, failed: 0 })
      expect(second).toMatchObject({ status: 'skipped' })
      expect(rerun).toMatchObject({ status: 'run', claimed: 0, sent: 0 })
      expect(ticked.update).toMatchObject({ id, status: 'published', notifications: 2 })
      expect(ticked.push_jobs).toBe(1)

      // Now the student has it, unread, in the feed.
      await open(page, '/announcements', STUDENT, theme)
      const posted = page.getByRole('article').filter({ hasText: title })
      await expect(posted).toBeVisible()
      await record(page, 'student-feed-after-tick', theme, info.project.name)
      await posted.getByRole('link', { name: title }).click()
      await expect(detail(page).getByRole('heading', { name: title })).toBeVisible()
      await expect(detail(page).getByTestId('read-summary')).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('update page: cohort link, read count for staff, rendered Markdown, and Back', async ({ page }, info) => {
      await open(page, `/announcements?scope=manage&audience=cohort&cohort_id=${ids.program_cohort_id}`, INSTRUCTOR, theme)
      await page.getByRole('article').filter({ hasText: 'QA read count update' }).getByRole('link', { name: 'QA read count update' }).click()
      const update = detail(page)
      await expect(update.getByTestId('read-summary')).toContainText(/\d+ of 2 people it went to have read it/)
      await expect(update.locator('strong', { hasText: 'before Friday' })).toBeVisible()
      await expect(update.locator('li', { hasText: /^Bring a (laptop|charger)$/ })).toHaveCount(2)
      await expect(update.locator('pre code')).toContainText("puts 'ready'")
      await expect(update).not.toContainText('**before Friday**')
      const cohort = update.getByRole('link', { name: 'QA Program' }).first()
      expect(await cohort.getAttribute('href')).toBe(`/admin/cohorts/${ids.program_cohort_id}?tab=communication`)
      await record(page, 'update-page-staff', theme, info.project.name)
      await expect(back(page)).toHaveText('Back to Updates')
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/announcements\\?scope=manage&audience=cohort&cohort_id=${ids.program_cohort_id}`))
      await expect(page.getByRole('article').filter({ hasText: 'QA read count update' })).toBeVisible()

      await open(page, `/announcements/${ids.read_update_id}`, STUDENT, theme)
      await expect(detail(page).locator('strong', { hasText: 'before Friday' })).toBeVisible()
      await expect(detail(page).getByTestId('read-summary')).toHaveCount(0)
      await record(page, 'update-page-student', theme, info.project.name)
    })

    test('submission page: who, where and what, its lesson, module and rubric, and Back to the queue or student', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await open(page, `/admin/submissions/${ids.submission_id}?cohort_id=${ids.program_cohort_id}&student_id=${STUDENT}&return_to=${encodeURIComponent(`/admin/grading?cohort_id=${ids.program_cohort_id}&filter=all`)}`, INSTRUCTOR, theme)
      const header = page.locator('[data-record-header]')
      await expect(header.locator('h1')).toBeVisible()
      // The seeded program student is named "QA Program" too, so pick the links by kind.
      const cohortLink = header.locator('a[data-record-link="cohort"]')
      await expect(cohortLink).toHaveText('QA Program')
      await expect(cohortLink).toHaveAttribute('href', `/admin/cohorts/${ids.program_cohort_id}`)
      await expect(cohortLink).toBeInViewport()
      await expect(header.locator('a[data-record-link="student"]')).toHaveAttribute('href', new RegExp(`/admin/cohorts/${ids.program_cohort_id}/students/${STUDENT}`))
      await expect(back(page)).toHaveText('Back to Grading · All submissions')
      await expect(related(page, 'lesson').locator('a')).toHaveAttribute('href', new RegExp(`/admin/lessons/${ids.lesson_id}`))
      await expect(related(page, 'module_grid:module').locator('a')).toHaveAttribute('href', new RegExp(`/admin/modules/${ids.module_id}\\?cohort_id=${ids.program_cohort_id}`))
      await expect(related(page, 'rubric').locator('a')).toHaveAttribute('href', new RegExp(`/admin/rubrics/${ids.rubric_id}`))
      await record(page, 'submission-page', theme, info.project.name)

      await related(page, 'rubric').locator('a').click()
      await expect(page).toHaveURL(new RegExp(`/admin/rubrics/${ids.rubric_id}`))
      await expect(page.locator('h1')).toContainText('Synthetic clarity rubric')
      await expect(back(page)).toHaveText(`Back to Submission #${ids.submission_id}`)
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/submissions/${ids.submission_id}`))
      await related(page, 'module_grid:module').locator('a').click()
      await expect(page).toHaveURL(new RegExp(`/admin/modules/${ids.module_id}`))
      await expect(back(page)).toHaveText(`Back to Submission #${ids.submission_id}`)
      await back(page).click()
      await expect(back(page)).toHaveText('Back to Grading · All submissions')
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/grading\\?cohort_id=${ids.program_cohort_id}&filter=all`))

      // From the student's Work tab, Back returns there.
      await open(page, `/admin/cohorts/${ids.program_cohort_id}/students/${STUDENT}/work`, INSTRUCTOR, theme)
      await page.locator(`a[href^="/admin/submissions/${ids.submission_id}"]`).first().click()
      await expect(page).toHaveURL(new RegExp(`/admin/submissions/${ids.submission_id}`))
      await expect(back(page)).toContainText(/Back to (Student page|Work|QA Program)/)
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.program_cohort_id}/students/${STUDENT}/work`))
      expect(errors).toEqual([])
    })
  })
}
