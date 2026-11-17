import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { mkdirSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')
const baseline = process.env.QA_LAYOUT_BASELINE === '1'
const owners = new Map<object, string>()
test.setTimeout(180_000)
test.beforeEach(async ({ page }, info) => {
  const id = `staff-layout-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', id)
  owners.set(page, id)
  await page.route('**/*', (route) =>
    ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort(),
  )
})
test.afterEach(async ({ page }) => {
  await page.close()
  const id = owners.get(page)
  if (id) checkedLifecycle(session, 'release', id)
  owners.delete(page)
})
for (const theme of ['light', 'dark'] as const)
  for (const user of [1, 2]) {
    test(`staff ${user} ${theme}: every cohort and student section`, async ({ page }, info) => {
      const width = page.viewportSize()!.width
      test.skip(baseline && width !== 1280, 'Desktop baseline only')
      await page.clock.setFixedTime(new Date('2026-11-17T04:28:00Z'))
      await page.addInitScript((theme) => localStorage.setItem('csg-learn:theme', theme), theme)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      for (const workspace of ['cohort', 'student']) {
        const root = workspace === 'cohort' ? '/admin/cohorts/1' : '/admin/cohorts/1/students/3/overview'
        const label = workspace === 'cohort' ? 'Cohort sections' : 'Student page sections'
        await page.goto(`${root}?qa_user=${user}`)
        const nav = page.getByRole('navigation', { name: label, exact: true })
        await expect(nav).toBeVisible()
        const sections = await nav.locator('a').evaluateAll((links) =>
          links.map((link) => ({
            href: link.getAttribute('href')!,
            label: link.textContent!.trim(),
          })),
        )
        expect(sections.length).toBe(workspace === 'student' || user === 2 ? 7 : 9)
        for (const section of sections) {
          if (!baseline && width === 390) {
            const select = nav.getByRole('combobox', { name: label })
            await select.selectOption(section.href)
            await expect(select).toHaveValue(section.href)
            expect((await nav.boundingBox())!.height).toBeLessThanOrEqual(72)
            await expect(nav.locator('a').first()).toBeHidden()
          } else await nav.locator(`a[href="${section.href}"]`).click()
          await expect(page).toHaveURL(new RegExp(section.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))
          await expect(page.getByRole('main').getByText(/Loading (cohort|student|settings)/)).toHaveCount(0)
          await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible()
          await page.evaluate(() => document.fonts.ready)
          // Wait for secondary panels, then freeze animations for comparable evidence.
          await page.waitForLoadState('networkidle')
          await expect(
            page.getByRole('main').getByText(/^(Loading|Building explainable|Checking).*[.…]$/i),
          ).toHaveCount(0)
          await expect(page.getByRole('main').locator('[role="alert"]')).toHaveCount(0)
          await expect(page.getByRole('main').locator('.animate-spin')).toHaveCount(0)
          if (workspace === 'cohort' && section.label === 'Teaching team') {
            await expect(page.getByRole('main').getByRole('link', { name: 'QA Instructor', exact: true })).toBeVisible()
          }
          await page.evaluate(() => window.scrollTo(0, 0))
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
          expect(overflow, `${workspace} ${section.label} page overflow`).toBeLessThanOrEqual(1)
          const dir = `.qa-local/staff-layout/${baseline ? 'before' : 'after'}`
          mkdirSync(dir, { recursive: true })
          const name = `${width}-${user}-${theme}-${workspace}-${section.label.replace(/[^a-z0-9]+/gi, '-')}.png`
          await page.screenshot({ path: `${dir}/${name}`, fullPage: true, animations: 'disabled' })
        }
        if (workspace === 'cohort') {
          if (width === 390 && !baseline) await nav.getByRole('combobox').selectOption('/admin/cohorts/1?tab=learning')
          else await nav.getByRole('link', { name: 'Learning', exact: true }).click()
          await page.getByRole('link', { name: 'Learning insights', exact: true }).click()
          await expect(page).toHaveURL(/tab=insights$/)
          await expect(page.getByRole('heading', { name: 'How these statuses are set' }).first()).toBeVisible()
          if (width === 390 && !baseline)
            await expect(nav.getByRole('combobox')).toHaveValue('/admin/cohorts/1?tab=learning')
        }
      }
      expect(errors).toEqual([])
    })
  }

for (const theme of ['light', 'dark'] as const) {
  test(`admin ${theme}: settings targets, sticky save, draft guard, retry and persistence`, async ({
    page,
    request,
  }) => {
    test.skip(baseline, 'Post-change form acceptance')
    const width = page.viewportSize()!.width
    const headers = { Authorization: 'Bearer test_token_1' }
    const original =
      (await (await request.get('/api/v1/cohorts/1', { headers })).json()).cohort.github_organization_name || ''
    await page.addInitScript((theme) => localStorage.setItem('csg-learn:theme', theme), theme)
    await page.goto('/admin/cohorts/1?tab=settings&qa_user=1')
    const field = page.getByRole('textbox', { name: 'GitHub organization', exact: true })
    await expect(field).toBeVisible()
    const save = page.getByRole('button', { name: 'Save settings', exact: true })
    if (width === 390) {
      const control = page.getByRole('navigation', { name: 'Cohort sections' }).getByRole('combobox')
      await expect(control).toHaveValue('/admin/cohorts/1?tab=settings')
      expect(await save.evaluate((el) => getComputedStyle(el).position)).toBe('fixed')
      // All text/date/select editors retain phone input sizing and touch targets.
      const controls = await page.locator('form input:not([type=checkbox]), form select').evaluateAll((elements) =>
        elements
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => ({
            height: el.getBoundingClientRect().height,
            font: parseFloat(getComputedStyle(el).fontSize),
          })),
      )
      expect(controls.length).toBeGreaterThan(10)
      expect(controls.every((control) => control.height >= 44 && control.font >= 16)).toBe(true)
      for (const y of [0, 1000, 10000]) {
        await page.evaluate((y) => scrollTo(0, y), y)
        const rect = (await save.boundingBox())!
        expect(rect.y).toBeGreaterThan(56)
        const navTop = (await page.getByRole('navigation', { name: 'Primary navigation' }).boundingBox())!.y
        expect(rect.y + rect.height).toBeLessThan(navTop)
      }
    }
    await field.fill(`qa-layout-${width}-${theme}`)
    if (width === 390)
      await page.getByRole('combobox', { name: 'Cohort sections' }).selectOption('/admin/cohorts/1?tab=learning')
    else
      await page
        .getByRole('navigation', { name: 'Cohort sections' })
        .getByRole('link', { name: 'Learning', exact: true })
        .click()
    const guard = page.getByRole('dialog', { name: 'Leave without saving?' })
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page).toHaveURL(/tab=settings/)
    await expect(field).toHaveValue(`qa-layout-${width}-${theme}`)
    if (width === 390)
      await expect(page.getByRole('combobox', { name: 'Cohort sections' })).toHaveValue('/admin/cohorts/1?tab=settings')
    let fail = true
    await page.route('**/api/v1/cohorts/1', async (route) => {
      if (route.request().method() === 'PATCH' && fail) {
        fail = false
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'QA save unavailable' }),
        })
      } else await route.continue()
    })
    await save.click()
    await expect(page.getByText('QA save unavailable', { exact: true }).first()).toBeVisible()
    await expect(field).toHaveValue(`qa-layout-${width}-${theme}`)
    await save.click()
    await expect(page.getByText('Cohort settings saved', { exact: true }).first()).toBeVisible()
    expect((await (await request.get('/api/v1/cohorts/1', { headers })).json()).cohort.github_organization_name).toBe(
      `qa-layout-${width}-${theme}`,
    )
    await page.reload()
    await expect(field).toHaveValue(`qa-layout-${width}-${theme}`)
    await field.fill(original)
    await save.click()
    await expect(page.getByText('Cohort settings saved', { exact: true }).first()).toBeVisible()
    expect(
      (await (await request.get('/api/v1/cohorts/1', { headers })).json()).cohort.github_organization_name || '',
    ).toBe(original)
    // Dense module configuration stays within the viewport and uses existing dialog footer actions.
    await page.getByRole('button', { name: 'Configure', exact: true }).first().click()
    const module = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: 'Done editing module', exact: true }) })
    await expect(module).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await module.getByRole('button', { name: 'Done editing module', exact: true }).click()
  })
}

for (const user of [1, 2])
  test(`staff ${user}: keyboard, Back and return context`, async ({ page }) => {
    test.skip(baseline, 'Post-change navigation acceptance')
    const width = page.viewportSize()!.width
    const origin = '/admin/cohorts/1?tab=activity'
    await page.goto(`/admin/cohorts/1/students/3/overview?qa_user=${user}&return_to=${encodeURIComponent(origin)}`)
    const back = page.getByRole('link', { name: 'Back to Activity', exact: true })
    await expect(back).toHaveAttribute('href', origin)
    const nav = page.getByRole('navigation', { name: 'Student page sections' })
    if (width === 390) {
      const select = nav.getByRole('combobox')
      await select.focus()
      await expect(select).toBeFocused()
      // Native select type-ahead stays available without custom tab key handlers.
      await page.keyboard.press('s')
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/students\/3\/support$/)
      await expect(select).toHaveValue('/admin/cohorts/1/students/3/support')
      await select.selectOption('/admin/cohorts/1/students/3/access')
    } else await nav.getByRole('link', { name: 'Access', exact: true }).click()
    await expect(back).toHaveAttribute('href', origin)
    await page.goBack()
    await expect(page).toHaveURL(width === 390 ? /\/students\/3\/support$/ : /\/students\/3\/overview\?/)
    await expect(back).toHaveAttribute('href', origin)
    await back.click()
    await expect(page).toHaveURL(/\/admin\/cohorts\/1\?tab=activity$/)
    if (user === 2) {
      await page.goto('/admin/cohorts/1?tab=settings&qa_user=2')
      const sections = page.getByRole('navigation', { name: 'Cohort sections' })
      await expect(sections.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0)
      await expect(sections.getByRole('link', { name: 'Teaching team', exact: true })).toHaveCount(0)
      if (width === 390) await expect(sections.getByRole('combobox')).toHaveValue('/admin/cohorts/1')
      await expect(page.getByRole('heading', { name: 'Cohort settings', exact: true })).toHaveCount(0)
    }
  })
