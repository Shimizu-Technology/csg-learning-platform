// W9.3 learner reminders in the browser. Needs `scripts/qa/run start`, then from
// api/: w9-nudges-fixtures.rb and w9-nudges-harness.rb (they write
// .qa-local/w9-nudges.json and the sent reminders). Then from web/:
//   QA_SPEC=w9-nudges.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts
// QA_THEME=dark runs the same checks in dark mode.
import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const ids = JSON.parse(readFileSync(new URL('../../.qa-local/w9-nudges.json', import.meta.url), 'utf8'))
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const theme = process.env.QA_THEME || 'light'

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
  await page.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})
test.afterEach(async ({ page }) => { await page.close() })

function tick(day: number, hour: number) {
  return JSON.parse(execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/w9-nudges-harness.rb', 'tick', String(day), String(hour)], {
    cwd: new URL('../../api', import.meta.url).pathname,
    env: { ...process.env, RAILS_ENV: 'test', DATABASE_URL: `postgresql://localhost/${state.database}` },
  }).toString().trim().split('\n').pop()!)
}
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}
async function reminders(page: Page, user: number, cohort = ids.paced) {
  await page.goto(`/admin/cohorts/${cohort}/students/${user}/learning?qa_user=1`)
  await expect(page.getByRole('heading', { name: 'Deadlines and extensions' })).toBeVisible()
  return page.getByRole('region', { name: 'Reminders' })
}

test('staff see the reminders a learner got, newest first, with channels and Guam times', async ({ page }) => {
  const panel = await reminders(page, 971)
  await expect(panel).toBeVisible()
  const rows = panel.getByRole('list', { name: 'Reminders sent' }).getByRole('listitem')
  await expect(rows.first()).toBeVisible()
  // The opt-out check below adds a 14-day inactivity reminder for 971; whichever
  // width runs first, the harness's four reminders are the oldest, newest first.
  const count = await rows.count()
  expect([4, 5]).toContain(count)
  const oldest = (index: number) => rows.nth(count - 4 + index)
  await expect(oldest(0)).toContainText('No recent activity · After 7 days inactive')
  await expect(oldest(0)).toContainText('Pick up where you left off')
  await expect(oldest(1)).toContainText('Due soon · 24 hours before')
  await expect(oldest(1)).toContainText('Final project due today')
  await expect(oldest(2)).toContainText('Final project due tomorrow')
  await expect(oldest(3)).toContainText('Week 1: due today')
  await expect(oldest(3)).toContainText('2 lessons left')
  for (const index of [0, 1, 2, 3]) {
    await expect(oldest(index)).toContainText('ChST · Email sent · Push attempted via both providers · Not read yet')
  }
  await noSideScroll(page)
})

test('an opted-out learner shows only essential access reminders, and staff are told why', async ({ page }) => {
  const panel = await reminders(page, 973)
  await expect(panel).toContainText('This learner turned off optional reminders. Access-ending reminders still go out.')
  const rows = panel.getByRole('listitem')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Access ending · Essential · 3 days before')
  await expect(rows.nth(1)).toContainText('Access ending · Essential · 14 days before')
  await noSideScroll(page)
})

test('the Off program cohort shows no reminders section and never asks for one', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (/\/(?:nudges|nudge_preferences)$/.test(new URL(request.url()).pathname)) asked.push(request.url())
  })
  await reminders(page, 974, ids.off)
  await expect(page.getByRole('region', { name: 'Reminders' })).toHaveCount(0)
  await page.goto(`/profile?qa_user=974`)
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Course reminders' })).toHaveCount(0)
  expect(asked).toEqual([])
})

test('the learner reads the reminder in Notifications and it opens the lesson', async ({ page }) => {
  await page.goto(`/announcements?tab=inbox&qa_user=972`)
  const item = page.getByRole('button', { name: /Final project due tomorrow/ }).first()
  await expect(item).toBeVisible()
  await expect(page.getByText('Reminder final project is due by 11:59 PM Guam time.').first()).toBeVisible()
  await item.click()
  await expect(page).toHaveURL(new RegExp(`/lessons/${ids.project}\\b`))
  await expect(page.getByRole('heading', { name: 'Reminder final project' }).first()).toBeVisible()
  await noSideScroll(page)
})

test('a learner turns optional reminders off in Profile; the next tick skips them but not a classmate', async ({ page }) => {
  await page.goto(`/profile?qa_user=975`)
  const toggle = page.getByRole('switch', { name: 'Course reminders' })
  await expect(page.getByText('Reminders that your course access is ending always arrive.')).toBeVisible()
  if (await toggle.getAttribute('aria-checked') === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Course reminders' })).toHaveAttribute('aria-checked', 'false')
  const before = tick(33, 7).nudges
  const after = tick(33, 8).nudges
  expect(after['975']).toEqual(before['975'])
  expect(after['971']).toContain('inactive/14d')
  const panel = await reminders(page, 975)
  await expect(panel).toContainText('This learner turned off optional reminders.')
  await noSideScroll(page)
})

test('staff see Learner reminders as a cohort opt-in that inherits Off', async ({ page }) => {
  await page.goto(`/admin/cohorts/${ids.off}/settings?qa_user=1`)
  const select = page.getByLabel('Learner reminders')
  await expect(select).toBeVisible()
  await expect(select.locator('option:checked')).toHaveText('Inherit → Off')
  await page.goto(`/admin/cohorts/${ids.paced}/settings?qa_user=1`)
  await expect(page.getByLabel('Learner reminders').locator('option:checked')).toHaveText('On')
  await noSideScroll(page)
})

test('staff keep reminder history after setting a cohort to Inherit Off', async ({ page }) => {
  async function saveSetting(value: 'inherit' | 'on') {
    await page.goto(`/admin/cohorts/${ids.paced}/settings?qa_user=1`)
    const select = page.getByLabel('Learner reminders')
    await expect(select).toBeVisible()
    if (await select.inputValue() === value) return
    await select.selectOption(value)
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.locator('#main-content').getByText('Cohort settings saved', { exact: true })).toBeVisible()
  }

  try {
    await saveSetting('inherit')
    const panel = await reminders(page, 971)
    await expect(panel).toContainText('Reminders are off for this cohort.')
    await expect(panel.getByRole('list', { name: 'Reminders sent' }).getByRole('listitem').first()).toBeVisible()
    await noSideScroll(page)
  } finally {
    await saveSetting('on')
  }
})
