import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

/*
 * W9.1 browser QA: personal start date and learner-chosen pace. Needs
 * `w9-personal-pace-fixtures.rb setup` after `scripts/qa/run start`. Run once
 * per theme (QA_THEME=light, then dark):
 *   QA_SPEC=w9-personal-pace.spec.ts QA_THEME=dark npx playwright test --config ../scripts/qa/playwright.config.ts
 * Each project (1280 and 390 wide) resets the two synthetic learners first,
 * then walks, in order:
 *   1. a learner in a guided cohort with pace on opens Today, picks 4 weeks and sees milestones (Today and Learn);
 *   2. the learner changes to 6 weeks;
 *   3. staff see the pace on the student workspace and override it;
 *   4. a second learner whose start is a week later (set by staff) gets their own dates;
 *   5. a program cohort learner (pace off) sees no pace anywhere;
 *   6. cohort settings show the setting on the pilot and not on the program.
 * Every page opened is closed in afterEach. Screenshots go to
 * docs/qa/w9-personal-pace-2026-11-18/.
 */
const theme = process.env.QA_THEME === 'dark' ? 'dark' : 'light'
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/w9-pace.json', import.meta.url), 'utf8')) as {
  rehearsal: { user: number; enrollment: number }; late: { user: number; enrollment: number }; cohort: number; program_cohort: number
}
const harness = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8')) as { database: string; api_port: number }
const shots = new URL('../../docs/qa/w9-personal-pace-2026-11-18/', import.meta.url)
const evidence = new URL('../../.qa-local/w9-pace/', import.meta.url)
mkdirSync(shots, { recursive: true })
mkdirSync(evidence, { recursive: true })
const results: Array<Record<string, unknown>> = []
test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

const ADMIN = 1
const PROGRAM_STUDENT = 3

function iso(daysFromToday: number) {
  const date = new Date()
  date.setDate(date.getDate() + daysFromToday)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

test.beforeAll(() => {
  execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/w9-personal-pace-fixtures.rb', 'reset'], {
    cwd: new URL('../../api/', import.meta.url).pathname, env: { ...process.env, DATABASE_URL: `postgresql://localhost/${harness.database}` }, stdio: 'ignore',
  })
})
test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
  await page.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})
test.afterEach(async ({ page }) => { await page.close() })
test.afterAll(() => writeFileSync(new URL(`results-${theme}-${process.pid}.json`, evidence), JSON.stringify(results, null, 2)))

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'no horizontal scroll').toBeLessThanOrEqual(1)
}
async function shot(page: Page, name: string, width: string) {
  await page.screenshot({ path: new URL(`${name}-${width}-${theme}.png`, shots).pathname, fullPage: false })
}
async function today(page: Page, user: number, cohortId = ids.cohort) {
  await page.goto(`/dashboard?cohort_id=${cohortId}&qa_user=${user}`)
  await expect(page.locator('[data-region="next-action"]').first()).toBeVisible({ timeout: 20_000 })
}
async function apiGet(page: Page, path: string, user: number) {
  return page.evaluate(async ({ url, user }) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer test_token_${user}` } })
    return { status: response.status, body: await response.json() }
  }, { url: path, user })
}

test('1. learner opens a paced course, picks 4 weeks and sees milestones', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  await today(page, ids.rehearsal.user)
  const card = page.locator('[data-region="personal-pace"]')
  await expect(card).toHaveAttribute('data-pace-status', 'not_chosen')
  await expect(card.getByRole('heading', { name: 'How fast do you want to go?' })).toBeVisible()
  // The picker leads the page, above the welcome.
  const cardTop = (await card.boundingBox())!.y
  const welcomeTop = (await page.locator('[data-region="next-action"]').first().boundingBox())!.y
  expect(cardTop).toBeLessThan(welcomeTop)
  await expect(card.getByRole('button', { name: 'Set my pace' })).toBeDisabled()
  const options = card.locator('label:has(input[type="radio"])')
  await expect(options).toHaveCount(3)
  for (const box of await options.all()) expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await noHorizontalScroll(page)
  await shot(page, '1a-picker', width)

  await card.getByText('4 weeks', { exact: true }).click()
  await card.getByRole('button', { name: 'Set my pace' }).click()
  await expect(card).toHaveAttribute('data-pace-status', 'on_track')
  await expect(card).toContainText('Your pace · 4 weeks · week 1 of 4')
  await expect(card).toContainText('Week 1: 0 of 3 done')
  await expect(card).toContainText('Final project due')
  await expect(card).toContainText('firm date')
  await expect(card.locator('[data-pace-lessons] a')).toHaveCount(3)
  const endDate = iso(27)
  const pace = await apiGet(page, `/api/v1/enrollments/${ids.rehearsal.enrollment}/pace`, ids.rehearsal.user)
  expect(pace.body.personal_pace.weeks).toBe(4)
  expect(pace.body.personal_pace.starts_on).toBe(iso(0))
  expect(pace.body.personal_pace.ends_on).toBe(endDate)
  expect(pace.body.personal_pace.milestones.map((item: { title: string }) => item.title)).toEqual(['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Final project'])
  // Reload: the saved pace is what the server returns.
  await page.reload()
  await expect(page.locator('[data-region="personal-pace"]')).toContainText('Week 1: 0 of 3 done')
  await noHorizontalScroll(page)
  await page.locator('[data-region="personal-pace"]').scrollIntoViewIfNeeded()
  await shot(page, '1b-today-4-weeks', width)

  await page.goto(`/materials?cohort_id=${ids.cohort}&qa_user=${ids.rehearsal.user}`)
  await expect(page.getByTestId('course-outline')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('course-outline').locator('[data-page-header]')).toContainText('Your pace: 4 weeks')
  await expect(page.getByTestId('course-outline')).toContainText('Final project due')
  await expect(page.locator('li[data-lesson-status]').first()).toContainText('Due')
  await noHorizontalScroll(page)
  await shot(page, '1c-learn-4-weeks', width)
  results.push({ case: 1, width, theme, outcome: 'passed', ends_on: endDate })
})

test('2. learner changes to 6 weeks', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  await today(page, ids.rehearsal.user)
  const card = page.locator('[data-region="personal-pace"]')
  await card.getByRole('button', { name: 'Change pace' }).click()
  await expect(card).toContainText('You can change your pace 2 more times.')
  await card.getByText('6 weeks', { exact: true }).click()
  await card.getByRole('button', { name: 'Change my pace' }).click()
  await expect(card).toContainText('Your pace · 6 weeks')
  await card.getByRole('button', { name: 'Change pace' }).click()
  await expect(card).toContainText('You can change your pace 1 more time.')
  await card.getByRole('button', { name: 'Keep my pace' }).click()
  const pace = await apiGet(page, `/api/v1/enrollments/${ids.rehearsal.enrollment}/pace`, ids.rehearsal.user)
  expect([pace.body.personal_pace.weeks, pace.body.personal_pace.changes_left, pace.body.personal_pace.ends_on]).toEqual([6, 1, iso(41)])
  await noHorizontalScroll(page)
  await card.scrollIntoViewIfNeeded()
  await shot(page, '2-today-6-weeks', width)
  results.push({ case: 2, width, theme, outcome: 'passed' })
})

test('3. staff see the pace and override it', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  await page.goto(`/admin/cohorts/${ids.cohort}/students/${ids.rehearsal.user}/learning?qa_user=${ADMIN}`)
  const panel = page.locator('[data-region="staff-pace"]')
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(panel).toContainText('6 weeks')
  await expect(panel).toContainText('Set by QA Rehearsal')
  await expect(panel).toContainText('1 learner change left')
  await expect(page.locator('[data-plan-source="learner_pace"]')).toContainText('Made from the pace the learner chose (6 weeks)')
  await noHorizontalScroll(page)
  await panel.scrollIntoViewIfNeeded()
  await shot(page, '3a-staff-pace', width)

  await panel.getByLabel('Set this learner’s pace').selectOption('3')
  await panel.getByRole('button', { name: 'Change pace' }).click()
  await expect(panel.getByRole('status')).toContainText('Pace set to 3 weeks')
  await expect(panel).toContainText('Set by QA Admin')
  await expect(panel).toContainText('1 learner change left')
  // The plan editor below reloads with the respread plan.
  await expect(page.locator('[data-plan-source="learner_pace"]')).toContainText('(3 weeks)')
  await shot(page, '3b-staff-override', width)

  await today(page, ids.rehearsal.user)
  await expect(page.locator('[data-region="personal-pace"]')).toContainText('Your pace · 3 weeks')
  results.push({ case: 3, width, theme, outcome: 'passed' })
})

test('4. a learner who starts a week later gets their own dates', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  const later = iso(7)
  await page.goto(`/admin/cohorts/${ids.cohort}/students/${ids.late.user}/learning?qa_user=${ADMIN}`)
  const panel = page.locator('[data-region="staff-pace"]')
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(panel).toContainText('No pace chosen yet')
  await panel.getByLabel('Personal start date').fill(later)
  await panel.getByRole('button', { name: 'Save start' }).click()
  await expect(panel.getByRole('status')).toContainText('Start moved to')
  await expect(panel).toContainText('Set by staff')

  await today(page, ids.late.user)
  const card = page.locator('[data-region="personal-pace"]')
  await expect(card).toContainText('Every lesson is open from')
  await card.getByText('4 weeks', { exact: true }).click()
  await card.getByRole('button', { name: 'Set my pace' }).click()
  await expect(card).toHaveAttribute('data-pace-status', 'on_track')
  const pace = await apiGet(page, `/api/v1/enrollments/${ids.late.enrollment}/pace`, ids.late.user)
  expect(pace.body.personal_pace.starts_on).toBe(later)
  expect(pace.body.personal_pace.milestones[0].due_on).toBe(iso(13))
  expect(pace.body.personal_pace.ends_on).toBe(iso(34))
  // The first learner's dates are untouched.
  const first = await apiGet(page, `/api/v1/enrollments/${ids.rehearsal.enrollment}/pace`, ids.rehearsal.user)
  expect(first.body.personal_pace.starts_on).toBe(iso(0))
  await card.scrollIntoViewIfNeeded()
  await shot(page, '4a-late-today', width)

  await page.goto(`/materials?cohort_id=${ids.cohort}&qa_user=${ids.late.user}`)
  await expect(page.getByTestId('course-outline')).toBeVisible({ timeout: 20_000 })
  // Nothing is open yet, so no part is expanded; each part says when it opens.
  const part = page.getByRole('button', { name: /Part 1/ })
  await expect(page.getByTestId('course-outline')).toContainText('Opens')
  await part.click()
  const firstLesson = page.locator('li[data-lesson-status]').first()
  await expect(firstLesson).toHaveAttribute('data-lesson-status', 'upcoming')
  await expect(firstLesson).toContainText('Opens')
  await expect(firstLesson).toContainText('Due')
  await page.waitForTimeout(400) // let the part finish expanding before the capture
  await noHorizontalScroll(page)
  await shot(page, '4b-late-learn', width)
  results.push({ case: 4, width, theme, outcome: 'passed', starts_on: later })
})

test('5. a program cohort learner sees no pace anywhere', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  await today(page, PROGRAM_STUDENT, ids.program_cohort)
  await expect(page.locator('[data-region="personal-pace"]')).toHaveCount(0)
  const dashboard = await apiGet(page, `/api/v1/dashboard?cohort_id=${ids.program_cohort}`, PROGRAM_STUDENT)
  expect(dashboard.status).toBe(200)
  expect(Object.keys(dashboard.body.dashboard.student_today ?? {})).not.toContain('personal_pace')
  const outline = await apiGet(page, `/api/v1/course_outline?cohort_id=${ids.program_cohort}`, PROGRAM_STUDENT)
  expect(outline.body.outline.mode).toBe('program')
  expect(Object.keys(outline.body.outline)).not.toContain('personal_pace')
  expect(JSON.stringify(outline.body.outline)).not.toContain('"due_on"')
  await shot(page, '5a-program-today', width)
  await page.goto(`/materials?cohort_id=${ids.program_cohort}&qa_user=${PROGRAM_STUDENT}`)
  await expect(page.getByTestId('course-outline')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('course-outline')).not.toContainText('Your pace')
  await expect(page.getByTestId('course-outline')).toContainText('Week 1')
  await shot(page, '5b-program-learn', width)
  results.push({ case: 5, width, theme, outcome: 'passed' })
})

test('6. cohort settings show the setting only where it applies', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  await page.goto(`/admin/cohorts/${ids.cohort}/settings?qa_user=${ADMIN}`)
  const section = page.locator('section[aria-labelledby="learner-pace-heading"]')
  await expect(section).toBeVisible({ timeout: 20_000 })
  await expect(section.getByLabel('Let learners choose their pace')).toBeChecked()
  await expect(section.getByLabel('Pace choices, in weeks')).toHaveValue('3, 4, 6')
  await noHorizontalScroll(page)
  await section.scrollIntoViewIfNeeded()
  await shot(page, '6-settings', width)
  await page.goto(`/admin/cohorts/${ids.program_cohort}/settings?qa_user=${ADMIN}`)
  await expect(page.getByRole('heading', { name: 'Cohort settings' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('section[aria-labelledby="learner-pace-heading"]')).toHaveCount(0)
  results.push({ case: 6, width, theme, outcome: 'passed' })
})
