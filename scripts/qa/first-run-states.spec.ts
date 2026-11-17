import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { checkedLifecycle } from './ownership.mjs'
const session = process.env.DEV_LIFECYCLE_SESSION!
if (!session) throw new Error('Lifecycle session is required')
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/first-run.json', import.meta.url), 'utf8'))
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const shots = new URL('../../docs/qa/first-run-states-2026-11-18/', import.meta.url)
mkdirSync(shots, { recursive: true })
const ownership = new Map<object, string>()
const results: unknown[] = []
function resetWelcome() {
  execFileSync('bundle', ['exec', 'rails', 'runner', `Enrollment.where(user_id: [7, ${ids.program_user}]).update_all(start_here_dismissed_at: nil)`], { cwd: new URL('../../api/', import.meta.url).pathname, env: { ...process.env, RAILS_ENV: 'test', DATABASE_URL: `postgresql://localhost/${state.database}` }, stdio: 'pipe' })
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
    results.push({ persona: persona.key, theme, width: info.project.use.viewport!.width, overflow, passed: true, screenshot: path })
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
    }
    if (persona.key === 'self-paced-new') {
      await page.goto(`/profile?cohort_id=${persona.cohort}`)
      const toggle = page.getByRole('switch', { name: 'Direct-message email notifications' })
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
  })
  test(`public legal recovery ${theme}`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto('/privacy')
    await expect(page.getByRole('link', { name: 'Back to Today' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Legal navigation' }).getByRole('link', { name: 'Delete account' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: new URL(`legal-${info.project.use.viewport!.width}-${theme}.png`, shots).pathname, fullPage: true })
    await page.getByRole('navigation', { name: 'Legal navigation' }).getByRole('link', { name: 'Delete account' }).click()
    await expect(page.getByRole('heading', { name: 'Request account and data deletion' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to Today', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator('main h1')).toBeVisible()
  })
}
