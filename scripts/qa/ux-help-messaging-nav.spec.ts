import { test, expect, type APIRequestContext, type Locator, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * UX-6 affected-flow QA: a learner follows up on an instructor's help reply;
 * the phone drawer opens from one More button with no nested More; the
 * Notifications tab badge and Updates' smart link to it; staff see one
 * notification indicator on desktop; the calm Aa chat composer; New DM search
 * and multi-select; message search states; Profile's grouped alerts.
 * Light and dark, at the project's width (1280, 390). Uses the base seed only.
 * Run: QA_SPEC=ux-help-messaging-nav.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts
 */

const OUT = fileURLToPath(new URL('../../.qa-local/ux-help-messaging-nav/', import.meta.url))
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const API = `http://127.0.0.1:${state.api_port}`
const as = (user: number) => ({ Authorization: `Bearer test_token_${user}` })
const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // The harness aborts every non-loopback request (synthetic example.invalid media, external assets); those are expected.
    const source = message.location().url
    if (message.text().startsWith('Failed to load resource') && source && !['127.0.0.1', 'localhost'].includes(new URL(source).hostname)) return
    errors.push(`console: ${message.text()} (${source})`)
  })
  return errors
}

async function open(page: Page, path: string, user: number, theme: 'light' | 'dark') {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.addInitScript((choice) => {
    try {
      if (choice) localStorage.setItem('csg-learn:theme', choice); else localStorage.removeItem('csg-learn:theme')
    } catch { /* ignore */ }
  }, theme === 'light' ? 'light' : '')
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function record(page: Page, name: string, theme: string, project: string) {
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
  appendFileSync(`${OUT}${project}.jsonl`, `${JSON.stringify({ name, theme, overflow, serious, contrast, dataTheme, url: url.pathname + url.search, screenshot })}\n`)
  expect(dataTheme).toBe(theme)
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(serious, `${name} serious axe violations`).toEqual([])
}

async function target(locator: Locator, label: string) {
  const box = await locator.boundingBox()
  expect(box, `${label} is visible`).not.toBeNull()
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44)
  expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(44)
}

/** The behind student's seeded open request, with a fresh instructor reply as the latest message. */
async function instructorReplied(request: APIRequestContext, body: string) {
  const list = await (await request.get(`${API}/api/v1/help_requests`, { headers: as(4) })).json()
  const help = list.help_requests.find((item: { status: string }) => item.status === 'open' || item.status === 'acknowledged') as { id: number; context_path: string }
  expect(help, 'the seeded open help request').toBeTruthy()
  const reply = await request.post(`${API}/api/v1/help_requests/${help.id}/replies`, { headers: as(2), data: { reply: { body, resolve: false } } })
  expect(reply.ok()).toBeTruthy()
  return help
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })

    test('learner follows up on an instructor reply; the instructor sees it', async ({ page, request }, info) => {
      const errors = watchErrors(page)
      const run = `${theme} ${info.project.name} ${Date.now()}`
      const help = await instructorReplied(request, `What error did you see? (${run})`)
      await open(page, help.context_path, 4, theme)
      await page.getByRole('button', { name: /Your instructor replied|View response/ }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByText(`What error did you see? (${run})`)).toBeVisible()
      await expect(dialog.getByText('Staff can see it in Support')).toHaveCount(0)
      const box = dialog.locator(`#help-follow-up-${help.id}`)
      await expect(dialog.getByText('Reply to your instructor')).toBeVisible()
      await box.fill(`It says undefined method each (${run}).`)
      await record(page, 'help-follow-up-draft', theme, info.project.name)
      if (phone(page)) await target(dialog.getByRole('button', { name: 'Send reply' }), 'Send reply')
      await dialog.getByRole('button', { name: 'Send reply' }).click()
      await expect(page.getByText('Reply sent to your instructor.')).toBeVisible()
      await expect(dialog.getByText('You replied').first()).toBeVisible()
      await expect(dialog.getByText('Your instructor will see your reply here.')).toBeVisible()
      await record(page, 'help-follow-up-sent', theme, info.project.name)

      const saved = await (await request.get(`${API}/api/v1/help_requests/${help.id}`, { headers: as(2) })).json()
      expect(saved.help_request.replies.at(-1)).toMatchObject({ from_student: true, body: `It says undefined method each (${run}).` })
      expect(['open', 'acknowledged']).toContain(saved.help_request.status)

      const staff = await page.context().newPage()
      const staffErrors = watchErrors(staff)
      await open(staff, `/admin/help-requests/${help.id}`, 2, theme)
      await expect(staff.getByText(`It says undefined method each (${run}).`)).toBeVisible()
      await record(staff, 'staff-sees-follow-up', theme, info.project.name)
      await staff.close()
      expect([...errors, ...staffErrors]).toEqual([])
    })

    test('Updates opens Notifications when only notices are unread, and the tab carries the count', async ({ page, request }, info) => {
      const errors = watchErrors(page)
      await instructorReplied(request, `A hint for the badge check (${theme} ${info.project.name}).`)
      await request.patch(`${API}/api/v1/notifications/mark_all_read?notification_type=announcement`, { headers: as(4) })
      const inbox = await (await request.get(`${API}/api/v1/notifications?per_page=1`, { headers: as(4) })).json()
      expect(inbox.unread_count).toBeGreaterThan(0)
      await open(page, '/dashboard', 4, theme)
      if (phone(page)) {
        await page.getByRole('button', { name: 'More navigation' }).click()
        await expect(page.getByRole('dialog', { name: 'Site navigation' })).toBeVisible()
      }
      const scope = phone(page) ? page.getByRole('dialog', { name: 'Site navigation' }) : page.locator('aside')
      const updates = scope.getByRole('link', { name: /^Updates/ })
      await expect(updates).toHaveAttribute('href', /tab=inbox/)
      await updates.click()
      await expect(page).toHaveURL(/tab=inbox/)
      const tab = page.getByRole('navigation', { name: 'Updates sections' }).getByRole('link', { name: /^Notifications, \d+ unread$/ })
      await expect(tab).toBeVisible()
      await record(page, 'notifications-tab-badge', theme, info.project.name)
      await page.getByRole('navigation', { name: 'Updates sections' }).getByRole('link', { name: 'Updates', exact: true }).click()
      await expect(page.getByRole('navigation', { name: 'Updates sections' }).getByRole('link', { name: /^Notifications, \d+ unread$/ })).toBeVisible()
      expect(errors).toEqual([])
    })

    test('one drawer entry on phones with open sections; one notification indicator for desktop staff', async ({ page }, info) => {
      const errors = watchErrors(page)
      await open(page, '/admin', 1, theme)
      await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0)
      if (phone(page)) {
        const more = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'More navigation' })
        await target(more, 'More')
        await target(page.locator('header').getByRole('link', { name: /^Notifications/ }), 'Header bell')
        await more.click()
        const drawer = page.getByRole('dialog', { name: 'Site navigation' })
        await expect(drawer).toBeVisible()
        await expect(drawer.locator('nav [aria-expanded]')).toHaveCount(0)
        await expect(drawer.getByRole('heading', { name: 'More' })).toBeVisible()
        await expect(drawer.getByRole('link', { name: /^Updates/ })).toBeVisible()
        for (const link of await drawer.getByRole('link').all()) {
          if (await link.isVisible()) expect((await link.boundingBox())!.height, await link.innerText()).toBeGreaterThanOrEqual(44)
        }
        await record(page, 'phone-drawer-open', theme, info.project.name)
        await drawer.getByRole('button', { name: 'Close navigation' }).click()
        await expect(more).toBeFocused()
      } else {
        const indicators = page.locator('a[aria-label^="Notifications"]:visible')
        await expect(indicators).toHaveCount(0)
        await expect(page.locator('aside').getByRole('link', { name: /^Updates/ })).toBeVisible()
        await record(page, 'desktop-staff-sidebar', theme, info.project.name)
      }
      expect(errors).toEqual([])
    })

    test('calm composer, New DM search and multi-select, and message search states', async ({ page }, info) => {
      const errors = watchErrors(page)
      await open(page, '/messages/dm/1', 3, theme)
      // Start from the default (collapsed), once; the reload below checks the choice is remembered.
      await page.evaluate(() => localStorage.removeItem('csg-composer-formatting'))
      await page.reload()
      await page.waitForLoadState('networkidle')
      const aa = page.getByRole('button', { name: 'Formatting', exact: true })
      await expect(aa).toHaveAttribute('aria-pressed', 'false')
      await expect(page.getByRole('toolbar', { name: /^Formatting for/ })).toHaveCount(0)
      await expect(page.getByRole('group', { name: 'Editor mode' })).toHaveCount(0)
      if (phone(page)) await target(aa, 'Aa')
      await record(page, 'composer-calm', theme, info.project.name)
      await aa.click()
      await expect(page.getByRole('toolbar', { name: /^Formatting for/ })).toBeVisible()
      await expect(page.getByRole('group', { name: 'Editor mode' })).toBeVisible()
      await record(page, 'composer-formatting-open', theme, info.project.name)
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('button', { name: 'Formatting', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('button', { name: 'Formatting', exact: true }).click()
      await expect(page.getByRole('toolbar', { name: /^Formatting for/ })).toHaveCount(0)

      await page.goto(`/messages?qa_user=3`)
      await page.waitForLoadState('networkidle')
      await page.getByRole('button', { name: 'Search messages' }).click()
      const search = page.getByRole('textbox', { name: 'Search messages' })
      await search.fill('q')
      await expect(page.getByText('Type at least 2 letters to search.')).toBeVisible()
      await search.fill('zzqqxx-no-such-message')
      await expect(page.getByText('No messages match “zzqqxx-no-such-message”.')).toBeVisible()
      await record(page, 'message-search-empty', theme, info.project.name)
      await page.getByRole('button', { name: 'Close message search' }).click()

      await page.getByRole('button', { name: 'New direct message' }).click()
      const dialog = page.getByRole('dialog', { name: 'New direct message' })
      await expect(dialog).toBeVisible()
      const people = dialog.getByRole('group', { name: 'People' }).getByRole('checkbox')
      const total = await people.count()
      expect(total, 'people to message').toBeGreaterThan(1)
      await dialog.getByRole('searchbox', { name: 'Search people' }).fill('instructor')
      await expect.poll(() => people.count()).toBeLessThan(total)
      await dialog.getByRole('group', { name: 'People' }).locator('li label').first().click()
      await expect(people.first()).toBeChecked()
      await dialog.getByRole('searchbox', { name: 'Search people' }).fill('')
      await expect.poll(() => people.count()).toBe(total)
      const unchecked = dialog.getByRole('group', { name: 'People' }).locator('li').filter({ has: page.locator('input:not(:checked)') }).first()
      await unchecked.locator('label').click()
      await expect(dialog.getByRole('button', { name: 'Start group message (2)' })).toBeEnabled()
      await expect(dialog.getByRole('list', { name: 'Selected people' }).getByRole('button')).toHaveCount(2)
      if (phone(page)) await target(dialog.getByRole('list', { name: 'Selected people' }).getByRole('button').first(), 'Selected chip')
      await record(page, 'new-dm-multi-select', theme, info.project.name)
      await dialog.getByRole('button', { name: 'Start group message (2)' }).click()
      await expect(page).toHaveURL(/\/messages\/dm\/\d+/)
      expect(errors).toEqual([])
    })

    test('Profile groups message emails with browser alerts; only admins see setup detail', async ({ page }, info) => {
      const errors = watchErrors(page)
      for (const [user, admin] of [[3, false], [1, true]] as const) {
        await open(page, '/profile', user, theme)
        const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Notifications' }) })
        await expect(section.getByRole('switch', { name: 'Message emails', exact: true })).toBeVisible()
        const alerts = section.getByRole('switch', { name: 'Browser alerts', exact: true })
        await expect(alerts).toBeVisible()
        if (phone(page)) await target(alerts, 'Browser alerts switch')
        await alerts.click()
        const status = section.getByRole('status').filter({ hasText: /Browser alerts|This browser/ })
        await expect(status).toBeVisible()
        const text = await status.innerText()
        if (admin) expect(text).toMatch(/Browser alerts aren’t available right now|Browser alerts are on/)
        else {
          expect(text).not.toMatch(/Netlify|VAPID|VITE_|env vars/)
        }
        await record(page, admin ? 'profile-alerts-admin' : 'profile-alerts-student', theme, info.project.name)
        if (text.includes('Browser alerts are on')) await alerts.click()
      }
      expect(errors).toEqual([])
    })
  })
}
