import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { checkedLifecycle } from './ownership.mjs'
const session = process.env.DEV_LIFECYCLE_SESSION!
if (!session) throw new Error('Lifecycle session is required')
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/first-run.json', import.meta.url), 'utf8'))
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const shots = new URL(`../../docs/qa/${process.env.QA_EVIDENCE_DIR || 'first-run-states-2026-11-18'}/`, import.meta.url)
mkdirSync(shots, { recursive: true })
const ownership = new Map<object, string>()
const results: unknown[] = []
function resetWelcome() {
  execFileSync('bundle', ['exec', 'rails', 'runner', `Enrollment.where(user_id: [7, ${ids.program_user}]).update_all(start_here_dismissed_at: nil)`], { cwd: new URL('../../api/', import.meta.url).pathname, env: { ...process.env, RAILS_ENV: 'test', DATABASE_URL: `postgresql://localhost/${state.database}` }, stdio: 'pipe' })
}
function runRails(code: string) {
  return execFileSync('bundle', ['exec', 'rails', 'runner', code], { cwd: new URL('../../api/', import.meta.url).pathname, env: { ...process.env, RAILS_ENV: 'test', DATABASE_URL: `postgresql://localhost/${state.database}` }, encoding: 'utf8', stdio: 'pipe' }).trim()
}
test.beforeEach(async ({ page }, info) => {
  const id = `first-run-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`.slice(0,120)
  checkedLifecycle(session, 'claim', id); ownership.set(page, id)
  await page.route('**/*', route => ['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})
test.afterEach(async ({ page }) => { await page.close(); checkedLifecycle(session, 'release', ownership.get(page)!); ownership.delete(page) })
test.afterAll(() => writeFileSync(new URL(`results-${process.pid}.json`, shots), JSON.stringify(results, null, 2)))
for (const theme of ['light','dark']) {
  for (const persona of [
    { key: 'self-paced-new', user: 7, cohort: ids.solo, first: true },
    { key: 'program-first-day', user: ids.program_user, cohort: ids.program, first: true },
    { key: 'alumni', user: 8, cohort: ids.alumni, first: false },
    { key: 'two-workspaces', user: 4, cohort: ids.alumni, first: false },
    { key: 'paused', user: 5, cohort: ids.program, first: false },
    { key: 'lance-off', user: 3, cohort: ids.off, first: false },
  ]) test(`${persona.key} ${theme}: Today and recovery`, async ({ page }, info) => {
    test.setTimeout(60_000)
    if (persona.first) resetWelcome()
    await page.emulateMedia({ reducedMotion: persona.key === 'self-paced-new' && theme === 'dark' ? 'reduce' : 'no-preference' })
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/dashboard?cohort_id=${persona.cohort}&qa_user=${persona.user}`)
    await expect(page.locator('main h1')).toBeVisible()
    if (persona.first) {
      await expect(page.getByRole('heading', { name: /Welcome,/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Here’s how your course works' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Start Orientation', exact: true })).toBeVisible()
      await expect(page.getByText('Got it, let’s start')).toHaveCount(0)
      expect(await page.locator('[data-region="next-action"]').count()).toBe(1)
      if (persona.key === 'self-paced-new') await expect(page.getByLabel('Switch cohort', { exact: true })).toHaveCount(0)
    } else if (persona.key === 'lance-off') {
      await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
      await expect(page.locator('[data-today="v2"]')).toHaveCount(0)
    } else if (persona.key === 'paused') {
      await expect(page.getByRole('heading', { name: /is paused/ })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Dismiss welcome' })).toHaveCount(0)
    } else {
      await expect(page.getByRole('heading', { name: 'CSG Alumni library' })).toBeVisible()
      await expect(page.getByText('0 of 80')).toHaveCount(0)
      if (persona.key === 'alumni') await expect(page.getByRole('link', { name: 'Continue watching: Alumni workshop' })).toBeVisible()
      if (persona.key === 'two-workspaces') await expect(page.getByRole('link', { name: 'Today in QA First day program' })).toBeVisible()
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow).toBe(false)
    const path = `${persona.key}-${info.project.use.viewport!.width}-${theme}.png`
    await page.screenshot({ path: new URL(path, shots).pathname, fullPage: true })
    if (persona.key === 'alumni') {
      await page.getByRole('link', { name: 'Open the library', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/materials\\?cohort_id=${ids.alumni}`))
      await expect(page.getByRole('heading', { name: 'CSG Alumni library', exact: true })).toBeVisible()
      await page.goBack()
      await page.getByRole('link', { name: 'Continue watching: Alumni workshop', exact: true }).click()
      await expect(page).toHaveURL(url => url.pathname === '/recordings' && url.searchParams.get('cohort_id') === String(ids.alumni))
      await expect(page.getByRole('heading', { name: 'Alumni workshop', exact: true })).toBeVisible()
      await page.getByRole('link', { name: 'Open Learn', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'CSG Alumni library', exact: true })).toBeVisible()
    }
    if (persona.first) {
      const start = page.getByRole('link', { name: 'Start Orientation', exact: true })
      if (info.project.use.viewport!.width === 390) { const box = await start.boundingBox(); expect(box!.y + box!.height).toBeLessThanOrEqual(776) }
      await start.click()
      await expect(page.getByRole('heading', { name: 'Orientation', exact: true })).toBeVisible()
      await page.getByRole('link', { name: 'Back to Today', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Here’s how your course works' })).toBeVisible()
      await page.getByRole('button', { name: 'Dismiss welcome' }).click()
      await expect(page.getByRole('heading', { name: 'Here’s how your course works' })).toHaveCount(0)
      await page.reload()
      await expect(page.locator('[data-region="next-action"]')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Here’s how your course works' })).toHaveCount(0)
      await page.locator('[data-region="next-action"]').getByRole('link', { name: 'Continue', exact: true }).click()
      await expect(page).toHaveURL(/\/lessons\//)
      await expect(page.getByRole('heading', { name: 'Orientation', exact: true })).toBeVisible()
    }
    if (persona.key === 'two-workspaces') {
      await page.getByRole('link', { name: 'Today in QA First day program' }).click()
      await expect(page).toHaveURL(new RegExp(`/dashboard\\?cohort_id=${ids.program}`))
      await expect(page.getByRole('heading', { name: 'CSG Alumni library' })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Needs you', exact: true })).toBeVisible()
      const switcher = page.locator('select[aria-label="Switch cohort"]:visible').first()
      await switcher.selectOption(String(ids.alumni))
      await expect(page).toHaveURL(new RegExp(`/dashboard\\?cohort_id=${ids.alumni}`))
      await expect(page.getByRole('heading', { name: 'CSG Alumni library' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Needs you', exact: true })).toHaveCount(0)
      await switcher.selectOption(String(ids.program))
      await expect(page).toHaveURL(new RegExp(`/dashboard\\?cohort_id=${ids.program}`))
      await expect(page.getByRole('heading', { name: 'Needs you', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Message QA', exact: true }).click()
      await expect(page).toHaveURL(/\/messages\/dm\//)
      if (info.project.use.viewport!.width === 1280) {
        const url = new URL(page.url()); url.searchParams.set('return_to', '/announcements?tab=inbox')
        await page.goto(url.toString())
        await expect(page.getByRole('link', { name: 'Back to Notifications', exact: true })).toHaveCount(1)
      }
      const cohortLink = page.locator(`main header a[href="/materials?cohort_id=${ids.program}"]`).first()
      await expect(cohortLink).toBeVisible()
      await page.screenshot({ path: new URL(`dm-header-${info.project.use.viewport!.width}-${theme}.png`, shots).pathname, fullPage: true })
      if (info.project.use.viewport!.width === 390) {
        await page.getByRole('button', { name: 'Back to conversations', exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`/messages\\?workspace_id=${ids.program_workspace}$`))
        await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible()
      } else {
        await cohortLink.click()
        await expect(page).toHaveURL(new RegExp(`/materials\\?cohort_id=${ids.program}`))
        await expect(page.locator('main h1')).toBeVisible()
      }
      await page.goto(`/materials?cohort_id=${ids.program}`)
      const moduleMention = page.getByRole('link', { name: 'A', exact: true })
      await expect(moduleMention).toBeVisible()
      const target = await moduleMention.boundingBox()
      expect(target!.width).toBeGreaterThanOrEqual(44)
      expect(target!.height).toBeGreaterThanOrEqual(44)
    }
    if (persona.key === 'self-paced-new') {
      await page.goto(`/profile?cohort_id=${persona.cohort}`)
      const toggle = page.getByRole('switch', { name: 'Message emails', exact: true })
      await expect(toggle).toBeVisible()
      const box = await toggle.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44)
      if (theme === 'dark') expect(await toggle.locator('span').last().evaluate(element => getComputedStyle(element).transitionProperty)).toBe('none')
      const before = await toggle.getAttribute('aria-checked')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
      await page.reload()
      await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', before!)
      await page.screenshot({ path: new URL(`profile-${info.project.use.viewport!.width}-${theme}.png`, shots).pathname, fullPage: true })
      await expect(page.getByText('Earlier activity was not backfilled.')).toHaveCount(0)
      await page.goto(`/resources?cohort_id=${persona.cohort}`)
      await page.getByRole('link', { name: 'Back to Today', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`cohort_id=${persona.cohort}`))
    }
    results.push({ persona: persona.key, theme, width: info.project.use.viewport!.width, overflow, passed: true, screenshot: path })
  })
  test(`On legal recovery ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/dashboard?cohort_id=${ids.solo}&qa_user=7`)
    await expect(page.locator('main h1')).toContainText('Eli')
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible()
    const back = page.getByRole('link', { name: 'Back to Today', exact: true })
    await expect(back).toHaveAttribute('href', '/dashboard')
    await expect(page.getByRole('navigation', { name: 'Legal navigation' }).getByRole('link', { name: 'Delete account' })).toBeVisible()
    const brand = page.locator('header').first().locator('a[aria-label$=" home"] span.block')
    await expect(brand).toHaveCount(2)
    expect(await brand.evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: new URL(`legal-${info.project.use.viewport!.width}-${theme}.png`, shots).pathname, fullPage: true })
    await page.getByRole('navigation', { name: 'Legal navigation' }).getByRole('link', { name: 'Delete account' }).click()
    await expect(page.getByRole('heading', { name: 'Request account and data deletion', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Back to Today', exact: true }).click()
    await expect(page).toHaveURL(url => url.pathname === '/dashboard')
    await expect(page.locator('main h1')).toContainText('Eli')
    results.push({ persona: 'legal-on', theme, width: info.project.use.viewport!.width, passed: true })
  })
  test(`signed-out legal recovery ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Today', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Back to home', exact: true }).click()
    await expect(page).toHaveURL(url => url.pathname === '/')
    await expect(page.locator('main h1')).toContainText('Build a skill. Put it to work.')
    results.push({ persona: 'legal-signed-out', theme, width: info.project.use.viewport!.width, passed: true })
  })
  test(`Off legal recovery ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/dashboard?cohort_id=${ids.off}&qa_user=3`)
    await expect(page.getByRole('heading', { name: /Welcome back, Lance/ })).toBeVisible()
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Today', exact: true })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Legal navigation' }).getByRole('link', { name: 'Delete account' })).toBeVisible()
    results.push({ persona: 'legal-off', theme, width: info.project.use.viewport!.width, passed: true })
  })
  test(`admin activity empty states ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/admin/cohorts/${ids.program}/students/${ids.program_user}/activity?qa_user=1&cohort_id=${ids.program}`)
    await expect(page.getByRole('heading', { name: 'Activity history', exact: true })).toBeVisible()
    const timeline = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Activity history', exact: true }) })
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await timeline.getByRole('button', { name: 'Work', exact: true }).click()
    await expect(timeline).toContainText('No work activity recorded yet.')
    await expect(timeline).toContainText('Earlier activity was not backfilled.')
    await expect(timeline).not.toContainText('as you learn')
    await page.screenshot({ path: new URL(`admin-activity-${info.project.use.viewport!.width}-${theme}.png`, shots).pathname, fullPage: true })
    await page.goto(`/admin/team/2?activity_category=work&cohort_id=${ids.program}`)
    await expect(page.getByRole('heading', { name: 'Activity history', exact: true })).toBeVisible()
    await expect(page.getByText('No work activity recorded yet.', { exact: false })).toBeVisible()
    await expect(page.getByText('Your activity will appear here as you learn.', { exact: true })).toHaveCount(0)
    results.push({ persona: 'admin-activity', theme, width: info.project.use.viewport!.width, passed: true })
  })
  test(`recording week opens both modules ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/recordings?cohort_id=${ids.program}&recording=${ids.week_recording}&qa_user=4`)
    await expect(page.getByRole('heading', { name: 'Week-one replay', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Open Week 1 in Learn', exact: true }).click()
    await expect(page).toHaveURL(url => url.pathname === '/materials' && url.searchParams.get('week') === '1')
    const weeks = page.getByRole('button', { name: /^Week 1/ })
    await expect(weeks).toHaveCount(2)
    await expect(weeks.nth(0)).toHaveAttribute('aria-expanded', 'true')
    await expect(weeks.nth(1)).toHaveAttribute('aria-expanded', 'true')
    await page.screenshot({ path: new URL(`recording-week-${info.project.use.viewport!.width}-${theme}.png`, shots).pathname, fullPage: true })
    await weeks.nth(0).click()
    await expect(weeks.nth(0)).toHaveAttribute('aria-expanded', 'false')
    await expect(weeks.nth(1)).toHaveAttribute('aria-expanded', 'true')
    results.push({ persona: 'recording-week', theme, width: info.project.use.viewport!.width, passed: true })
  })
  test(`welcome after support ends ${theme}`, async ({ page }, info) => {
    test.setTimeout(60_000)
    const enrollment = `Enrollment.find_by!(user_id: 7, cohort_id: ${ids.solo})`
    const before = runRails(`puts ${enrollment}.attributes.slice("first_opened_at", "support_expires_at", "start_here_dismissed_at").to_json`)
    try {
      runRails(`${enrollment}.update_columns(first_opened_at: 8.weeks.ago, support_expires_at: 1.day.ago, start_here_dismissed_at: nil)`)
      await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
      await page.goto(`/dashboard?cohort_id=${ids.solo}&qa_user=7`)
      const welcome = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Here’s how your course works', exact: true }) })
      await expect(welcome).toContainText(/Support ended on [A-Z][a-z]{2} \d{1,2}, 2026\./)
      await expect(welcome).not.toContainText('Support until')
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      await page.screenshot({ path: new URL(`support-ended-${info.project.use.viewport!.width}-${theme}.png`, shots).pathname, fullPage: true })
      await welcome.getByRole('link', { name: 'Start Orientation', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Orientation', exact: true })).toBeVisible()
      results.push({ persona: 'support-ended', theme, width: info.project.use.viewport!.width, passed: true })
    } finally {
      runRails(`${enrollment}.update_columns(JSON.parse(${JSON.stringify(before)}))`)
    }
  })
  test(`query-selected catalog recovery ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/courses?offering_id=${ids.solo}&qa_user=7`)
    await expect(page.locator('article')).toHaveCount(1)
    const back = page.getByRole('link', { name: 'Back to courses', exact: true })
    await expect(back).toBeVisible()
    const screenshot = `catalog-${info.project.use.viewport!.width}-${theme}.png`
    await page.screenshot({ path: new URL(screenshot, shots).pathname, fullPage: true })
    await back.click()
    await expect(page).toHaveURL(/\/courses$/)
    await expect(page.locator('article')).toHaveCount(2)
    await expect(page.getByRole('heading', { name: 'QA Ruby basics', exact: true })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow).toBe(false)
    results.push({ persona: 'catalog-recovery', theme, width: info.project.use.viewport!.width, overflow, passed: true, screenshot })
  })

}
