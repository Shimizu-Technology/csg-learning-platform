import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * W6 PR 6.4b affected-flow QA: Safety open/resolved/blocks, the reported
 * message's conversation link, a team member page opened from a cohort's
 * Teaching team, and a help-request notification tap-through, as admin and
 * instructor, in light and dark, at the project's width (1280 and 390).
 * Needs scripts/qa/safety-fixtures.rb after scripts/qa/run start.
 * Run: npx playwright test --config ../scripts/qa/playwright.config.ts safety-team.spec.ts
 */

const OUT = fileURLToPath(new URL('../../.qa-local/safety-team/', import.meta.url))

async function open(page: Page, path: string, user: number, theme: 'light' | 'dark') {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.addInitScript((choice) => {
    try { if (choice) localStorage.setItem('csg-learn:theme', choice); else localStorage.removeItem('csg-learn:theme') } catch { /* ignore */ }
  }, theme === 'light' ? 'light' : '')
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function record(page: Page, name: string, theme: string, project: string) {
  await page.waitForLoadState('networkidle')
  // Let entrance motion settle before measuring, as theme.spec.ts does.
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const describe = (v: { id: string; nodes: Array<{ target: unknown }> }) => v.nodes.slice(0, 4).map((node) => `${v.id} ${JSON.stringify(node.target)}`)
  // Contrast is recorded, not gated, as in theme.spec.ts; the other serious rules are gated.
  const contrast = axe.violations.filter((v) => v.id === 'color-contrast').flatMap(describe)
  const serious = axe.violations.filter((v) => v.id !== 'color-contrast' && (v.impact === 'serious' || v.impact === 'critical')).flatMap(describe)
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme || null)
  mkdirSync(`${OUT}${project}`, { recursive: true })
  const screenshot = `${OUT}${project}/${theme}-${name}.png`
  await page.screenshot({ path: screenshot })
  appendFileSync(`${OUT}${project}.jsonl`, `${JSON.stringify({ name, theme, overflow, serious, contrast, dataTheme, url: new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash, screenshot })}\n`)
  expect(dataTheme).toBe(theme)
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(serious, `${name} serious axe violations`).toEqual([])
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme}`, () => {
    test.use({ colorScheme: theme })

    test('admin: Safety open, conversation link, resolved, blocks', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await open(page, '/admin/moderation', 1, theme)
      await expect(page.getByRole('heading', { name: 'Safety', level: 1 })).toBeVisible()
      await expect(page.getByText('2 waiting for action')).toBeVisible()
      await expect(page.getByText(/Posted in Direct conversation in .*You’re not in this conversation/)).toBeVisible()
      await record(page, 'admin-safety-open', theme, info.project.name)

      const conversation = page.getByRole('link', { name: /^Open in #qa-class in / })
      await conversation.click()
      await expect(page).toHaveURL(/\/messages\/\d+\?message_id=\d+/)
      await expect(page.getByText('Synthetic message someone reported.')).toBeVisible()
      await record(page, 'admin-reported-message', theme, info.project.name)
      await page.goBack()
      await expect(page).toHaveURL(/\/admin\/moderation(\?qa_user=1)?$/)

      await page.getByRole('button', { name: 'Resolved' }).click()
      await expect(page).toHaveURL(/view=resolved/)
      await expect(page.getByText(/Actioned · by .* · /)).toBeVisible()
      await expect(page.getByText(/Dismissed · by .* · /)).toBeVisible()
      await expect(page.getByText('Synthetic: account and files removed.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Dismiss' })).toHaveCount(0)
      await record(page, 'admin-safety-resolved', theme, info.project.name)

      await page.getByRole('button', { name: 'Blocks' }).click()
      await expect(page).toHaveURL(/view=blocks/)
      await expect(page.getByText(/blocked/).first()).toBeVisible()
      const staffLink = page.locator('a[href="/admin/team/2"]')
      await expect(staffLink).toHaveCount(1)
      await record(page, 'admin-safety-blocks', theme, info.project.name)
      await staffLink.click()
      await expect(page).toHaveURL(/\/admin\/team\/2$/)
      await expect(page.getByRole('link', { name: /Back to Safety/ })).toBeVisible()
      expect(errors).toEqual([])
    })

    test('admin: team member page from the cohort Teaching team', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await open(page, '/admin/cohorts/1?tab=team', 1, theme)
      const person = page.locator('a[data-record-link="staff"][href="/admin/team/2"]')
      await expect(person).toBeVisible()
      await person.click()
      await expect(page).toHaveURL(/\/admin\/team\/2$/)
      await expect(page.getByText('Team member · Instructor')).toBeVisible()
      await expect(page.getByRole('link', { name: /Back to Teaching team/ })).toBeVisible()
      await expect(page.getByText('Can edit lessons')).toBeVisible()
      await expect(page.getByText(/gave this access on/)).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Activity history' })).toBeAttached()
      await record(page, 'admin-team-member', theme, info.project.name)
      await page.getByRole('link', { name: /Change lesson editing for .* in / }).first().click()
      await expect(page).toHaveURL(/\/admin\/cohorts\/1\?tab=team$/)
      await page.goBack()
      await page.getByRole('button', { name: /^Message / }).first().click()
      await expect(page).toHaveURL(/\/messages\/dm\/\d+/)
      await page.goto('/admin/team')
      await page.getByRole('link', { name: /^Activity for / }).first().click()
      await expect(page).toHaveURL(/\/admin\/team\/\d+#activity$/)
      expect(errors).toEqual([])
    })

    for (const [role, user] of [['admin', 1], ['instructor', 2]] as const) {
      test(`${role}: help-request notification opens the exact request`, async ({ page }, info) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await open(page, '/announcements?tab=inbox', user, theme)
        const item = page.getByRole('button', { name: /asked for help/ }).first()
        await expect(item).toBeVisible()
        await record(page, `${role}-notification-inbox`, theme, info.project.name)
        await item.click()
        await expect(page).toHaveURL(/\/admin\/help-requests\/1\?cohort_id=1&student_id=4$/)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expect(page.getByText('I need help with this synthetic counter.')).toBeVisible()
        await record(page, `${role}-help-request`, theme, info.project.name)
        expect(errors).toEqual([])
      })
    }

    test('instructor: Safety and team member pages are admin-only', async ({ page }) => {
      await open(page, '/admin/moderation', 2, theme)
      await expect(page.getByRole('heading', { name: 'No access', exact: true })).toBeVisible()
      await page.goto('/admin/team/1')
      await expect(page.getByRole('heading', { name: 'No access', exact: true })).toBeVisible()
      await page.goto('/admin/cohorts/1?tab=team')
      await expect(page.locator('a[data-record-link="staff"]')).toHaveCount(0)
    })
  })
}
