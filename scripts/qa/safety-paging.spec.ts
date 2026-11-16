import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * PR #278 fix round 1: Safety's open queue pages past 100 reports, a report
 * on a later page opens pinned, and an alert for a deletion request another
 * admin already completed still opens it. Admin, light, 1280 and 390.
 * Needs safety-fixtures.rb then safety-paging-fixtures.rb after scripts/qa/run start
 * (safety-team.spec.ts expects the smaller queue, so run it before these fixtures).
 * Run: npx playwright test --config ../scripts/qa/playwright.config.ts safety-paging.spec.ts
 */

const OUT = fileURLToPath(new URL('../../.qa-local/safety-paging/', import.meta.url))
// Read per test, so other specs in this config load without these fixtures.
const loadFixtures = () => JSON.parse(readFileSync(new URL('../../.qa-local/safety-paging.json', import.meta.url), 'utf8')) as { open_reports: number; last_report: number; resolved_deletion: number }

async function open(page: Page, path: string) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.addInitScript(() => { try { localStorage.setItem('csg-learn:theme', 'light') } catch { /* ignore */ } })
  const [pathname, hash] = path.split('#')
  await page.goto(`${pathname}${pathname.includes('?') ? '&' : '?'}qa_user=1${hash ? `#${hash}` : ''}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function record(page: Page, name: string, project: string) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const describe = (v: { id: string; nodes: Array<{ target: unknown }> }) => v.nodes.slice(0, 4).map((node) => `${v.id} ${JSON.stringify(node.target)}`)
  const contrast = axe.violations.filter((v) => v.id === 'color-contrast').flatMap(describe)
  const serious = axe.violations.filter((v) => v.id !== 'color-contrast' && (v.impact === 'serious' || v.impact === 'critical')).flatMap(describe)
  mkdirSync(`${OUT}${project}`, { recursive: true })
  const screenshot = `${OUT}${project}/${name}.png`
  await page.screenshot({ path: screenshot })
  const url = new URL(page.url())
  appendFileSync(`${OUT}${project}.jsonl`, `${JSON.stringify({ name, overflow, serious, contrast, url: url.pathname + url.search + url.hash, screenshot })}\n`)
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(serious, `${name} serious axe violations`).toEqual([])
}

test.use({ colorScheme: 'light' })

test('admin: the open queue pages past 100 reports, in the URL', async ({ page }, info) => {
  const fixtures = loadFixtures()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const pages = Math.ceil(fixtures.open_reports / 25)
  await open(page, '/admin/moderation')
  await expect(page.getByText(`${fixtures.open_reports} waiting for action`)).toBeVisible()
  const pager = page.getByRole('navigation', { name: 'Open reports pages' })
  await expect(pager).toContainText(`Page 1 of ${pages}`)
  await record(page, 'open-page-1', info.project.name)

  await pager.getByRole('button', { name: 'Later' }).click()
  await expect(page).toHaveURL(/[?&]page=2(&|$)/)
  await expect(pager).toContainText(`Page 2 of ${pages}`)
  await expect(page.getByText('Synthetic paged report 24.', { exact: true })).toBeVisible()
  await record(page, 'open-page-2', info.project.name)

  await open(page, `/admin/moderation?page=${pages}`)
  await expect(pager).toContainText(`Page ${pages} of ${pages}`)
  await expect(page.getByText('Synthetic paged report 101.', { exact: true })).toBeVisible()
  await expect(pager.getByRole('button', { name: 'Later' })).toBeDisabled()
  await record(page, 'open-last-page', info.project.name)
  expect(errors).toEqual([])
})

test('admin: a report link on a later page opens pinned above page 1', async ({ page }, info) => {
  const fixtures = loadFixtures()
  await open(page, `/admin/moderation#report-${fixtures.last_report}`)
  const pinned = page.getByRole('region', { name: 'Linked report' })
  await expect(pinned).toContainText('The report you opened:')
  await expect(pinned).toContainText('Synthetic paged report 101.')
  await expect(pinned.getByRole('button', { name: 'Actioned' })).toBeVisible()
  await expect(page.locator(`#report-${fixtures.last_report}`)).toBeFocused()
  await record(page, 'linked-later-report', info.project.name)
})

test('admin: the alert for a deletion request completed since still opens it', async ({ page }, info) => {
  const fixtures = loadFixtures()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await open(page, '/announcements?tab=inbox')
  const alert = page.getByRole('button', { name: /asked to delete their account/ }).first()
  await expect(alert).toBeVisible()
  await alert.click()
  await expect(page).toHaveURL(new RegExp(`/admin/moderation#deletion-${fixtures.resolved_deletion}$`))
  const pinned = page.getByRole('region', { name: 'Linked deletion request' })
  await expect(pinned).toContainText('The deletion request you opened is already resolved:')
  await expect(pinned).toContainText(/Completed · by .* · /)
  await expect(pinned).toContainText('Synthetic: completed after the alert.')
  await expect(page.locator(`#deletion-${fixtures.resolved_deletion}`)).toHaveCount(1)
  await expect(page.locator(`#deletion-${fixtures.resolved_deletion}`)).toBeFocused()
  await record(page, 'resolved-deletion-alert', info.project.name)
  expect(errors).toEqual([])
})
