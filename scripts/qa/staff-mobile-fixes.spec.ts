import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { checkedLifecycle } from './ownership.mjs'
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')
const owners = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const id = `staff-fix-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
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
for (const theme of ['light', 'dark'] as const) {
  test(`phone ${theme}: keyboard viewport hides pinned chrome and textarea sizing`, async ({ page }) => {
    test.skip(page.viewportSize()!.width !== 390, 'Phone viewport contract')
    // iOS keeps the layout viewport tall while only the visual viewport shrinks.
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), { height: innerHeight, offsetTop: 0 })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    })
    await page.addInitScript((theme) => localStorage.setItem('csg-learn:theme', theme), theme)
    for (const cohort of [1, 2]) {
      await page.goto(`/admin/cohorts/${cohort}?tab=settings&qa_user=1`)
      const input = page.getByRole('textbox', { name: 'GitHub organization', exact: true })
      await expect(input).toBeVisible({ timeout: 15_000 })
      const save = page.getByRole('button', { name: 'Save settings', exact: true })
      const nav = page.getByRole('navigation', { name: 'Primary navigation' })
      await expect(save).toBeVisible()
      const fields = page.locator('form input:not([type=checkbox]), form textarea, form select')
      await expect.poll(async () => fields.count()).toBeGreaterThan(10)
      const sizes = await fields.evaluateAll((elements) =>
        elements
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => ({
            tag: el.tagName,
            font: parseFloat(getComputedStyle(el).fontSize),
            height: el.getBoundingClientRect().height,
          })),
      )
      expect(
        sizes.every((size) => size.font >= 16 && size.height >= 44),
        JSON.stringify(sizes),
      ).toBe(true)
      if (cohort === 2) expect(sizes.filter((size) => size.tag === 'TEXTAREA')).toHaveLength(4)
      await input.focus()
      await page.evaluate(() => {
        Object.assign(window.visualViewport!, { height: innerHeight - 300, offsetTop: 0 })
        window.visualViewport!.dispatchEvent(new Event('resize'))
      })
      await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'open')
      await expect(input).toBeFocused()
      await expect(save).toBeHidden()
      await expect(nav).toBeHidden()
      await page.evaluate(() => {
        Object.assign(window.visualViewport!, { height: innerHeight, offsetTop: 0 })
        window.visualViewport!.dispatchEvent(new Event('resize'))
      })
      await expect(page.locator('html')).not.toHaveAttribute('data-keyboard', 'open')
      await expect(save).toBeVisible()
      await expect(nav).toBeVisible()
    }
  })
}

test('phone: offering textareas do not trigger iOS input zoom', async ({ page }) => {
  test.skip(page.viewportSize()!.width !== 390, 'Phone input sizing')
  await page.goto('/admin/cohorts/2?tab=settings&qa_user=1')
  const fields = page.locator('form textarea')
  await expect(fields).toHaveCount(4, { timeout: 15_000 })
  expect(
    await fields.evaluateAll((elements) => elements.map((el) => parseFloat(getComputedStyle(el).fontSize))),
  ).toEqual([16, 16, 16, 16])
})

test('desktop: section-link focus outline fits inside the scrolling navigation', async ({ page }) => {
  test.skip(page.viewportSize()!.width !== 1280, 'Desktop link focus')
  await page.goto('/admin/cohorts/1/students/3/overview?qa_user=1')
  const link = page
    .getByRole('navigation', { name: 'Student page sections' })
    .getByRole('link', { name: 'Access', exact: true })
  await link.focus()
  await expect(link).toBeFocused()
  const ring = await link.evaluate((el) => ({
    width: parseFloat(getComputedStyle(el).outlineWidth),
    offset: parseFloat(getComputedStyle(el).outlineOffset),
  }))
  expect(ring.width).toBeGreaterThan(0)
  expect(ring.offset).toBeLessThanOrEqual(-ring.width)
})

test('fractional width: staff and lesson navigation meet exactly at lg', async ({ page }) => {
  test.setTimeout(90_000)
  test.skip(page.viewportSize()!.width !== 1280, 'Fractional iframe viewport')
  await page.goto('/admin/cohorts/1?qa_user=1')
  await page.evaluate(() => {
    const frame = document.createElement('iframe')
    frame.id = 'fractional'
    frame.style.cssText = 'width:1023.5px;height:844px;border:0;position:absolute;inset:0;z-index:1000'
    frame.src = '/admin/cohorts/1?qa_user=1'
    document.body.append(frame)
  })
  const frame = page.frameLocator('#fractional')
  const sections = frame.getByRole('navigation', { name: 'Cohort sections' })
  await expect(sections).toBeVisible({ timeout: 30_000 })
  // Chromium can round iframe viewport widths; compare to the CSS boundary in that same viewport.
  for (const width of [1023.25, 1023.5, 1023.98, 1024]) {
    await page.locator('#fractional').evaluate((el, width) => {
      ;(el as HTMLElement).style.width = `${width}px`
    }, width)
    const desktop = await page
      .locator('#fractional')
      .evaluate((el) => (el as HTMLIFrameElement).contentWindow!.matchMedia('(min-width: 1024px)').matches)
    if (desktop) {
      await expect(sections.getByRole('button', { name: /^Section:/ })).toHaveCount(0)
      await expect(sections.getByRole('link', { name: 'Overview', exact: true })).toBeVisible()
    } else {
      await expect(sections.getByRole('button', { name: /^Section: Overview/ })).toBeVisible()
      await expect(sections.getByRole('link', { name: 'Overview', exact: true })).toBeHidden()
    }
  }
  await page.locator('#fractional').evaluate((el) => {
    ;(el as HTMLElement).style.width = '1023.25px'
    ;(el as HTMLIFrameElement).src = '/lessons/1?cohort_id=1&qa_user=1'
  })
  await expect(frame.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 })
  await expect(frame.locator('details > summary').filter({ hasText: 'What success looks like' })).toBeVisible()
  await page.locator('#fractional').evaluate((el) => {
    ;(el as HTMLElement).style.width = '1024px'
  })
  await expect(frame.locator('details > summary').filter({ hasText: 'What success looks like' })).toHaveCount(0)
})

for (const theme of ['light', 'dark'] as const) {
  test(`phone ${theme}: module footer and editor labels on a short screen`, async ({ page }) => {
    test.skip(page.viewportSize()!.width !== 390, 'Short phone dialog')
    await page.setViewportSize({ width: 390, height: 568 })
    await page.addInitScript((theme) => localStorage.setItem('csg-learn:theme', theme), theme)
    await page.goto('/admin/cohorts/1?tab=settings&qa_user=1')
    await page.getByRole('button', { name: 'Configure', exact: true }).first().click()
    const dialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: 'Done editing module', exact: true }) })
    await expect(dialog.getByLabel('Module start date', { exact: true })).toBeVisible()
    await dialog.getByLabel('Require GitHub submissions for this module').check()
    await expect(dialog.getByLabel('Repository name', { exact: true })).toBeVisible()
    for (const height of [568, 320]) {
      await page.setViewportSize({ width: 390, height })
      const box = (await dialog.boundingBox())!
      for (const label of ['Remove from cohort', 'Done editing module']) {
        const button = dialog.getByRole('button', { name: label, exact: true })
        const rect = (await button.boundingBox())!
        expect(rect.y).toBeGreaterThanOrEqual(box.y)
        expect(rect.y + rect.height).toBeLessThanOrEqual(box.y + box.height)
        expect(rect.y + rect.height).toBeLessThanOrEqual(height)
      }
      const body = dialog.locator(':scope > div').nth(1)
      await body.evaluate((el) => (el.scrollTop = el.scrollHeight))
      expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      await expect(dialog.getByRole('button', { name: 'Done editing module', exact: true })).toBeInViewport()
    }
    await dialog.getByRole('button', { name: 'Done editing module', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 568 })
    await page.getByRole('button', { name: /^Class resources/ }).click()
    const resources = page.getByRole('dialog', { name: 'Class resources', exact: true })
    await resources.getByRole('button', { name: 'Edit', exact: true }).click()
    await resources.getByRole('button', { name: 'Add resource', exact: true }).click()
    await resources.getByRole('button', { name: 'Add resource', exact: true }).click()
    const categories = resources.getByRole('combobox', { name: 'Category', exact: true })
    expect(await categories.count()).toBeGreaterThanOrEqual(2)
    const ids = await categories.evaluateAll((elements) => elements.map((el) => el.id))
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test(`phone ${theme}: roster targets and named support counts`, async ({ page }) => {
    test.skip(page.viewportSize()!.width !== 390, 'Phone target and disclosure labels')
    await page.addInitScript((theme) => localStorage.setItem('csg-learn:theme', theme), theme)
    await page.goto('/admin/cohorts/1?tab=students&qa_user=1')
    const names = page.getByRole('main').locator('a[data-record-link="student"]')
    await expect(names.first()).toBeVisible({ timeout: 15_000 })
    expect(await names.evaluateAll((links) => links.every((link) => link.getBoundingClientRect().height >= 44))).toBe(
      true,
    )
    await page.route('**/api/v1/progress/student/3?cohort_id=1', async (route) => {
      const response = await route.fetch()
      const data = await response.json()
      Object.assign(data.status, { help_request_count: 2, active_intervention_count: 1 })
      await route.fulfill({ response, json: data })
    })
    await page.goto('/admin/cohorts/1/students/3/support?qa_user=1')
    const menu = page
      .getByRole('navigation', { name: 'Student page sections' })
      .getByRole('button', { name: 'Section: Support (2 open, 1 plan)', exact: true })
    await expect(menu).toBeVisible()
    await menu.click()
    await expect(
      page
        .getByRole('list', { name: 'Student page sections' })
        .getByRole('link', { name: 'Support (2 open, 1 plan)', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
  })

  test(`staff ${theme}: Learning cards retain the filtered-list return target`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem('csg-learn:theme', theme), theme)
    for (const label of ['Learning progress', 'Recordings completed', 'Lesson videos completed', 'All modules']) {
      await page.goto('/admin/students?cohort_id=1&q=QA&qa_user=1')
      await page.getByRole('main').locator('a[href*="/cohorts/1/students/3/overview"]').first().click()
      const back = page
        .getByRole('main')
        .getByRole('link', { name: /^Back to Students/ })
        .first()
      const target = await back.getAttribute('href')
      expect(target).toContain('/admin/students')
      const card =
        label === 'All modules'
          ? page.getByRole('link', { name: label, exact: true })
          : page
              .getByRole('main')
              .locator('a')
              .filter({ has: page.getByText(label, { exact: true }) })
              .first()
      await card.click()
      await expect(page).toHaveURL(/\/learning(?:#recordings|#lesson-videos)?$/)
      await expect(back).toHaveAttribute('href', target!)
      await back.click()
      await expect(page).toHaveURL(new RegExp(target!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))
    }
  })
}

test('cohort updates distinguish loading, error, retry and a successful empty result', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let stage = 'loading'
  await page.route('**/api/v1/cohorts/1/home', async (route) => {
    if (stage !== 'empty') {
      await pending
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'QA updates unavailable' }),
      })
    } else {
      const response = await route.fetch()
      const data = await response.json()
      data.home.recent_announcements = []
      await route.fulfill({ response, json: data })
    }
  })
  try {
    await page.goto('/admin/cohorts/1?tab=communication&qa_user=1')
    await expect(page.getByText('Loading cohort updates…', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('No updates for this cohort yet.', { exact: true })).toHaveCount(0)
    release()
    await expect(page.getByText('QA updates unavailable', { exact: true })).toBeVisible()
    await expect(page.getByText('No updates for this cohort yet.', { exact: true })).toHaveCount(0)
    stage = 'empty'
    await page.getByRole('button', { name: 'Retry updates', exact: true }).click()
    await expect(page.getByText('No updates for this cohort yet.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry updates', exact: true })).toHaveCount(0)
  } finally {
    release()
  }
})

test('a pending direct-message request cannot replace a newly selected student', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/direct_conversations', async (route) => {
    await pending
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ direct_conversation: { id: 999 } }),
    })
  })
  try {
    await page.goto('/admin/cohorts/1/students/3/overview?qa_user=1')
    await page.getByRole('button', { name: 'Message', exact: true }).click()
    await page.getByRole('combobox', { name: 'Switch student in QA Program' }).selectOption('4')
    await expect(page).toHaveURL(/\/students\/4\/overview$/)
    const response = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/direct_conversations') && response.ok(),
    )
    release()
    await response
    await expect(page.getByRole('heading', { level: 1, name: 'QA Behind', exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/students\/4\/overview$/)
  } finally {
    release()
  }
})

for (const theme of ['light', 'dark'] as const) {
  test(`phone ${theme}: keyboard disclosure commits one destination and respects a draft`, async ({ page }) => {
    test.skip(page.viewportSize()!.width !== 390, 'Phone keyboard disclosure')
    await page.addInitScript((theme) => localStorage.setItem('csg-learn:theme', theme), theme)
    await page.goto('/admin/cohorts/1?qa_user=1')
    const nav = page.getByRole('navigation', { name: 'Cohort sections' })
    const button = nav.getByRole('button', { name: /^Section:/ })
    await expect(button).toBeVisible({ timeout: 15_000 })
    await page.waitForLoadState('networkidle')
    const origin = page.url()
    const history = await page.evaluate(() => window.history.length)
    const loaded: string[] = []
    page.on('request', (request) => {
      if (/\/api\/v1\/cohorts\/1(?:\?|$)/.test(request.url())) loaded.push(request.url())
    })
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    const panel = (await nav.getByRole('list').boundingBox())!
    const chrome = (await page.getByRole('navigation', { name: 'Primary navigation' }).boundingBox())!
    expect(panel.y).toBeGreaterThanOrEqual(56)
    expect(panel.y + panel.height).toBeLessThanOrEqual(chrome.y)
    await page.keyboard.type('se')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page).toHaveURL(origin)
    expect(loaded).toEqual([])
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
    await expect(nav.getByRole('list').getByRole('link', { name: 'Settings', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(button).toBeFocused()
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=settings$/)
    expect(await page.evaluate(() => window.history.length)).toBe(history + 1)
    await page.goBack()
    await expect(page).toHaveURL(origin)
    await page.goForward()
    await expect(page).toHaveURL(/tab=settings$/)
    const field = page.getByRole('textbox', { name: 'GitHub organization', exact: true })
    await field.focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('keyboard-draft')
    await button.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.type('se')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toHaveCount(0)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(nav.getByRole('list').getByRole('link', { name: 'Students', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    const guard = page.getByRole('dialog', { name: 'Leave without saving?' })
    await expect(guard).toBeVisible()
    await expect(guard.getByRole('button', { name: 'Close Leave without saving?', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(guard.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(button).toHaveText('Section: Settings')
    await expect(field).toHaveValue('keyboard-draft')
    await expect(page).toHaveURL(/tab=settings$/)
  })
}

test('phone: modified-click opens the chosen section in a separate tab', async ({ page }) => {
  test.skip(page.viewportSize()!.width !== 390, 'Phone disclosure link semantics')
  // The synthetic Clerk stub uses tab-local storage; real Clerk auth is shared across tabs.
  await page.context().addInitScript(() => sessionStorage.setItem('qa_user', '1'))
  await page.goto('/admin/cohorts/1?qa_user=1')
  const nav = page.getByRole('navigation', { name: 'Cohort sections' })
  await nav.getByRole('button', { name: /^Section:/ }).click()
  const link = nav.getByRole('list').getByRole('link', { name: 'Learning', exact: true })
  await expect(link).toHaveAttribute('href', '/admin/cohorts/1?tab=learning')
  const original = page.url()
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    link.click({ modifiers: ['ControlOrMeta'] }),
  ])
  const id = 'staff-section-new-tab'
  checkedLifecycle(session!, 'claim', id)
  try {
    await expect(popup).toHaveURL(/tab=learning$/)
    await expect(page).toHaveURL(original)
  } finally {
    await popup.close()
    checkedLifecycle(session!, 'release', id)
  }
})
