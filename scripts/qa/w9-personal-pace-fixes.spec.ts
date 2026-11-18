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
 * Run with QA_SPEC=w9-personal-pace-fixes.spec.ts (QA_THEME=light|dark).
 */
const theme = process.env.QA_THEME === 'dark' ? 'dark' : 'light'
const harness = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8')) as { database: string }
const pilot = JSON.parse(readFileSync(new URL('../../.qa-local/w9-pace.json', import.meta.url), 'utf8')) as { cohort: number }
let ids: { on_demand_cohort: number; self_paced: { user: number; enrollment: number }; held: { user: number; enrollment: number }; finished: { user: number; enrollment: number }; project_lesson: number }
test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

function iso(daysFromToday: number) {
  const date = new Date()
  date.setDate(date.getDate() + daysFromToday)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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
