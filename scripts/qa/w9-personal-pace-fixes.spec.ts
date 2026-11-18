import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/*
 * PR #313 round 2: browser recheck of the three review fixes. After
 * `w9-personal-pace-fixtures.rb setup`, each project re-runs `... fixes` to
 * reset the cases, then:
 *   1. a self-paced learner whose staff chose 4 weeks before their late first
 *      open sees dates from today (start today, firm date today + 27), on track;
 *   2. a learner whose course is held back 30 days picks 3 weeks: the plan runs
 *      to the opening and the card and staff panel say why;
 *   3. a learner who already finished the final project changes 4 to 6 weeks:
 *      the final project is still the final project.
 * Round 3 (CodeRabbit) adds:
 *   4. a start and a refused pace sent together leave the start unchanged;
 *   5. unsaved plan-editor edits survive a pace change in the panel above;
 *   6. moving the cohort start in settings re-plans a learner without their own start.
 * Run with QA_SPEC=w9-personal-pace-fixes.spec.ts QA_THEME=light, then again with QA_THEME=dark.
 */
const theme = process.env.QA_THEME === 'dark' ? 'dark' : 'light'
const harness = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8')) as { database: string }
const pilot = JSON.parse(readFileSync(new URL('../../.qa-local/w9-pace.json', import.meta.url), 'utf8')) as { cohort: number }
let ids: { on_demand_cohort: number; self_paced: { user: number; enrollment: number }; held: { user: number; enrollment: number }; unopened: { user: number; enrollment: number }; finished: { user: number; enrollment: number }; project_lesson: number }
test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

// Expected dates in the school calendar the API uses (LearningCalendar::TIMEZONE,
// from SCHOOL_TIME_ZONE, default Pacific/Guam), never the runner's own zone.
const SCHOOL_ZONE = process.env.SCHOOL_TIME_ZONE || 'Pacific/Guam'
function iso(daysFromToday: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const [year, month, day] = today.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + daysFromToday)).toISOString().slice(0, 10)
}
test.beforeAll(() => {
  execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/w9-personal-pace-fixtures.rb', 'fixes'], {
    cwd: new URL('../../api/', import.meta.url).pathname, env: { ...process.env, DATABASE_URL: `postgresql://localhost/${harness.database}` }, stdio: 'ignore',
  })
  ids = JSON.parse(readFileSync(new URL('../../.qa-local/w9-pace-fixes.json', import.meta.url), 'utf8'))
})
test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
  await page.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})
test.afterEach(async ({ page }) => { await page.close() })

async function today(page: Page, user: number, cohortId: number) {
  await page.goto(`/dashboard?cohort_id=${cohortId}&qa_user=${user}`)
  await expect(page.locator('[data-region="personal-pace"]')).toBeVisible({ timeout: 20_000 })
}
async function pace(page: Page, enrollment: number, user: number) {
  return page.evaluate(async ({ url, user }) => (await (await fetch(url, { headers: { Authorization: `Bearer test_token_${user}` } })).json()).personal_pace, { url: `/api/v1/enrollments/${enrollment}/pace`, user })
}
const shot = (page: Page, name: string, width: string) => page.screenshot({ path: new URL(`../../docs/qa/w9-personal-pace-2026-11-18/fix-${name}-${width}-${theme}.png`, import.meta.url).pathname })

test('1. self-paced: a staff-chosen pace follows a late first open', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  await today(page, ids.self_paced.user, ids.on_demand_cohort)
  const card = page.locator('[data-region="personal-pace"]')
  await expect(card).toHaveAttribute('data-pace-status', 'on_track')
  await expect(card).toContainText('Your pace · 4 weeks · week 1 of 4')
  const value = await pace(page, ids.self_paced.enrollment, ids.self_paced.user)
  expect([value.starts_on, value.ends_on, value.adjusted_for]).toEqual([iso(0), iso(27), null])
  await card.scrollIntoViewIfNeeded()
  await shot(page, '1-self-paced', width)
})

test('2. held-back lessons: the plan runs to the opening and says why', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  await today(page, ids.held.user, pilot.cohort)
  const card = page.locator('[data-region="personal-pace"]')
  await card.getByText('3 weeks', { exact: true }).click()
  await card.getByRole('button', { name: 'Set my pace' }).click()
  await expect(card.locator('[data-pace-adjusted="lessons_open_later"]')).toContainText('This pace was adjusted because some lessons open later')
  const value = await pace(page, ids.held.enrollment, ids.held.user)
  expect(value.milestones.every((item: { due_on: string }) => item.due_on >= iso(30))).toBe(true)
  expect(value.ends_on >= iso(30)).toBe(true)
  await card.scrollIntoViewIfNeeded()
  await shot(page, '2-held-learner', width)
  await page.goto(`/admin/cohorts/${pilot.cohort}/students/${ids.held.user}/learning?qa_user=1`)
  const panel = page.locator('[data-region="staff-pace"]')
  await expect(panel.locator('[data-pace-adjusted="lessons_open_later"]')).toContainText('some lessons open later')
  await panel.scrollIntoViewIfNeeded()
  await shot(page, '2-held-staff', width)
})

test('3. a finished final project stays final after a pace change', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  await today(page, ids.finished.user, pilot.cohort)
  const card = page.locator('[data-region="personal-pace"]')
  await card.getByRole('button', { name: 'Change pace' }).click()
  await card.getByText('6 weeks', { exact: true }).click()
  await card.getByRole('button', { name: 'Change my pace' }).click()
  await expect(card).toContainText('Your pace · 6 weeks')
  await expect(card).toContainText('Final project due')
  const value = await pace(page, ids.finished.enrollment, ids.finished.user)
  expect([value.final_project.lesson_id, value.final_project.status, value.ends_on]).toEqual([ids.project_lesson, 'done', iso(41)])
  await card.scrollIntoViewIfNeeded()
  await shot(page, '3-final-kept', width)
})

async function staffPut(page: Page, enrollment: number, body: Record<string, unknown>) {
  return page.evaluate(async ({ url, body }) => {
    const response = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer test_token_1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }, { url: `/api/v1/enrollments/${enrollment}/pace`, body })
}

test('4. a start and a refused pace sent together: neither is saved', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  await page.goto(`/admin/cohorts/${pilot.cohort}/students/${ids.finished.user}/learning?qa_user=1`)
  const panel = page.locator('[data-region="staff-pace"]')
  await expect(panel).toBeVisible({ timeout: 20_000 })
  const before = await pace(page, ids.finished.enrollment, 1)
  const refused = await staffPut(page, ids.finished.enrollment, { starts_on: iso(10), weeks: 27 })
  expect(refused.status).toBe(422)
  expect(refused.body.error).toContain('from 1 to 26 weeks')
  await page.reload()
  await expect(panel).toContainText('Cohort start or first open')
  await expect(panel).toContainText(`${before.weeks} weeks`)
  const value = await pace(page, ids.finished.enrollment, 1)
  expect([value.start_set_by_staff, value.starts_on, value.weeks, value.ends_on]).toEqual([false, before.starts_on, before.weeks, before.ends_on])
  await panel.scrollIntoViewIfNeeded()
  await shot(page, '4-refused-unchanged', width)
})

test('5. unsaved plan edits survive a pace change', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  await page.goto(`/admin/cohorts/${pilot.cohort}/students/${ids.finished.user}/learning?qa_user=1`)
  const plan = page.locator('#learning-plan')
  await plan.getByRole('button', { name: 'Edit personal plan' }).click()
  await plan.getByLabel('Plan title').fill('Draft kept across a pace change')
  const panel = page.locator('[data-region="staff-pace"]')
  await panel.getByLabel('Set this learner’s pace').selectOption('3')
  await panel.getByRole('button', { name: 'Change pace' }).click()
  await expect(panel.getByRole('status')).toContainText('Pace set to 3 weeks')
  await expect(plan.getByLabel('Plan title')).toHaveValue('Draft kept across a pace change')
  await expect(plan.locator('[data-plan-changed-elsewhere]')).toContainText('Your draft is kept')
  await plan.locator('[data-plan-changed-elsewhere]').scrollIntoViewIfNeeded()
  await shot(page, '5-draft-kept', width)
  // Discarding the stale draft shows the plan as it is now.
  await plan.getByRole('button', { name: 'Cancel' }).click()
  const discard = page.getByRole('button', { name: 'Discard changes' })
  if (await discard.isVisible().catch(() => false)) await discard.click()
  await expect(plan.locator('[data-plan-source="learner_pace"]')).toContainText('(3 weeks)')
  await expect(plan.locator('[data-plan-changed-elsewhere]')).toHaveCount(0)
})

test('6. a new cohort start re-plans a learner without their own start', async ({ page }, info) => {
  const width = info.project.name.replace('chromium-', '')
  const before = await (async () => { await page.goto(`/admin/cohorts/${pilot.cohort}/settings?qa_user=1`); return pace(page, ids.unopened.enrollment, 1) })()
  expect([before.starts_on, before.ends_on]).toEqual([iso(-3), iso(24)])
  const start = page.getByLabel('Cohort start date')
  await expect(start).toBeVisible({ timeout: 20_000 })
  await start.fill(iso(4))
  const saved = page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/v1/cohorts/${pilot.cohort}`)
  await page.getByRole('button', { name: 'Save settings' }).click()
  expect((await saved).status()).toBe(200)
  const after = await pace(page, ids.unopened.enrollment, 1)
  expect([after.starts_on, after.ends_on, after.weeks, after.chosen_by?.full_name]).toEqual([iso(4), iso(31), 4, 'QA Admin'])
  await page.goto(`/admin/cohorts/${pilot.cohort}/students/${ids.unopened.user}/learning?qa_user=1`)
  const panel = page.locator('[data-region="staff-pace"]')
  await expect(panel).toContainText('Cohort start or first open', { timeout: 20_000 })
  await panel.scrollIntoViewIfNeeded()
  await shot(page, '6-cohort-start-replanned', width)
})
