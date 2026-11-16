import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * W7 PR 7.3 affected-flow QA: the Grading workbench and the module grading grid,
 * as instructor and admin, in light and dark, at the project's width (1280 and 390).
 * Grade A then Next lands at the top; Redo without feedback is blocked in the pinned
 * bar; Markdown renders; filters survive a reload; the grid opens on the first week
 * with ungraded work; links and Back work.
 * Needs scripts/qa/grading-fixtures.rb after scripts/qa/run start (each run grades one item).
 * Run: npx playwright test --config ../scripts/qa/playwright.config.ts grading-workbench.spec.ts
 */

const OUT = fileURLToPath(new URL('../../.qa-local/grading-workbench/', import.meta.url))

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

async function record(page: Page, name: string, theme: string, project: string, extra: Record<string, unknown> = {}) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const describe = (v: { id: string; nodes: Array<{ target: unknown }> }) => v.nodes.slice(0, 4).map((node) => `${v.id} ${JSON.stringify(node.target)}`)
  const contrast = axe.violations.filter((v) => v.id === 'color-contrast').flatMap(describe)
  const serious = axe.violations.filter((v) => v.id !== 'color-contrast' && (v.impact === 'serious' || v.impact === 'critical')).flatMap(describe)
  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme || null)
  mkdirSync(`${OUT}${project}`, { recursive: true })
  const screenshot = `${OUT}${project}/${theme}-${name}.png`
  await page.screenshot({ path: screenshot })
  const url = new URL(page.url())
  appendFileSync(`${OUT}${project}.jsonl`, `${JSON.stringify({ name, theme, overflow, serious, contrast, dataTheme, url: url.pathname + url.search + url.hash, screenshot, ...extra })}\n`)
  expect(dataTheme).toBe(theme)
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(serious, `${name} serious axe violations`).toEqual([])
}

/** The element's box is inside the viewport (the pinned grade bar, a validation message). */
async function inView(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox()
  const height = page.viewportSize()!.height
  return Boolean(box && box.y >= 0 && box.y + box.height <= height + 1)
}

const submissionParam = (page: Page) => new URL(page.url()).searchParams.get('submission')

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme}`, () => {
    test.use({ colorScheme: theme })

    test('instructor: workbench queue, Markdown, Redo needs feedback, grade A then Next at the top, filters in the URL', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const phone = info.project.name.endsWith('390')
      await open(page, '/admin/grading', 2, theme)
      await expect(page.getByRole('heading', { name: 'Grading', level: 1 })).toBeVisible()
      const rows = page.locator('[aria-label="Grading queue"] li button')
      expect(await rows.count()).toBeGreaterThan(2)
      const firstRow = await rows.first().innerText()
      await record(page, 'queue', theme, info.project.name, { firstRow })

      // Open the oldest Markdown answer (the fixture's "Make Decisions with JavaScript").
      await page.locator('[aria-label="Grading queue"] li button', { hasText: 'Make Decisions with JavaScript' }).first().click()
      await expect(page.locator('[data-record-header]')).toBeVisible()
      const answer = page.locator('[aria-label="Submission review"]')
      await expect(answer.locator('strong', { hasText: 'one' })).toBeVisible()
      await expect(answer.locator('li', { hasText: 'Tested exactly 12' })).toBeVisible()
      const pinned = await inView(page, '[data-grade-bar]')
      if (phone) await expect(page.locator('[aria-label="Grading queue"]')).toBeHidden()
      await record(page, 'review-markdown', theme, info.project.name, { gradeBarInView: pinned })
      expect(pinned, 'grade bar pinned in view').toBe(true)

      // Redo with no feedback: blocked, message in the pinned bar.
      const before = submissionParam(page)
      let graded = 0
      page.on('request', (request) => { if (request.method() === 'PATCH' && request.url().includes('/grade')) graded += 1 })
      await page.locator('[data-grade-bar] button', { hasText: /^Redo$/ }).click()
      const alert = page.locator('[data-grade-bar] [role="alert"]')
      await expect(alert).toContainText('Write feedback before choosing Redo, so the student knows what to change.')
      expect(graded).toBe(0)
      expect(submissionParam(page)).toBe(before)
      const alertInView = await inView(page, '[data-grade-bar] [role="alert"]')
      await record(page, 'redo-blocked', theme, info.project.name, { alertInView })
      expect(alertInView).toBe(true)

      // Typing in the feedback never grades; then A saves and the next review opens at its top.
      const feedback = page.locator('[data-grade-bar] [contenteditable="true"], [data-grade-bar] textarea').first()
      await feedback.click()
      await page.keyboard.type('a b c r')
      expect(graded).toBe(0)
      await expect(alert).toHaveCount(0)
      // Scroll to the bottom of the long review first, as a grader would.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.locator('[data-grade-bar] button', { hasText: /^A$/ }).click()
      await expect.poll(() => submissionParam(page)).not.toBe(before)
      await expect.poll(() => graded).toBe(1)
      await page.waitForLoadState('networkidle')
      const header = await page.locator('[data-record-header]').boundingBox()
      const headerAtTop = Boolean(header && header.y >= -1 && header.y < 140)
      await record(page, 'next-at-top', theme, info.project.name, { headerY: header?.y, headerAtTop })
      expect(headerAtTop, 'next review starts at its top').toBe(true)

      // Keyboard: J moves to the next item (desktop, focus outside the feedback box).
      if (!phone) {
        const current = submissionParam(page)
        await page.locator('[data-record-header] [data-record-type]').click()
        await page.keyboard.press('j')
        await expect.poll(() => submissionParam(page)).not.toBe(current)
      }

      // Filters and order in the URL survive a reload.
      if (phone) await page.locator('[data-back-link]').click()
      const moduleSelect = page.locator('[aria-label="Grading queue"] select').first()
      const moduleValue = await moduleSelect.locator('option', { hasText: 'QA Grading Module' }).getAttribute('value')
      await moduleSelect.selectOption(moduleValue!)
      await page.getByRole('button', { name: /Oldest first/ }).click()
      await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('newest')
      expect(new URL(page.url()).searchParams.get('module_id')).toBe(moduleValue)
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('[aria-label="Grading queue"] select').first()).toHaveValue(moduleValue!)
      await expect(page.getByRole('button', { name: /Newest first/ })).toBeVisible()
      await record(page, 'filters-after-reload', theme, info.project.name)
      expect(errors).toEqual([])
    })

    test('instructor: module grid opens on the first week with ungraded work; links and Back', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await open(page, '/admin/grading?cohort_id=1', 2, theme)
      await page.locator('summary', { hasText: 'Module grids' }).click()
      const gridLink = page.locator('ul[aria-label="Grade by module"] a', { hasText: 'QA Grading Module' })
      await expect(gridLink).toBeVisible()
      const waitingCount = await gridLink.innerText()
      await gridLink.click()
      await expect(page).toHaveURL(/\/admin\/cohorts\/1\/modules\/\d+\/grading/)
      const chips = page.locator('[role="group"][aria-label="Week"] button')
      await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true')
      await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'false')
      await expect(page.locator('table')).toHaveCount(1)
      const header = page.locator('thead th[scope="col"] a').first()
      await header.focus()
      await expect(page.locator('thead [role="tooltip"]').first()).toBeVisible()
      const headerHref = await header.getAttribute('href')
      expect(await page.locator('table').innerText()).not.toMatch(/[✓•]/)
      await record(page, 'module-grid', theme, info.project.name, { waitingCount, headerHref })
      // Week 1 is fully graded.
      await chips.nth(0).click()
      await expect(page.locator('table')).not.toContainText('Waiting')
      const back = page.locator('[data-back-link]')
      await expect(back).toHaveText('Back to Grading')
      await back.click()
      await expect(page).toHaveURL(/\/admin\/grading\?cohort_id=1(&qa_user=\d+)?$/)
      expect(errors).toEqual([])
    })

    test('admin: lesson headers open the editor, Related offers Edit and every submission for the lesson', async ({ page }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await open(page, '/admin/grading?cohort_id=1', 1, theme)
      await page.locator('[aria-label="Grading queue"] li button').first().click()
      const lessonRow = page.locator('[data-related-row="lesson"] a')
      await expect(lessonRow).toContainText('Edit')
      expect(await lessonRow.getAttribute('href')).toMatch(/^\/admin\/lessons\/\d+\/edit$/)
      const all = page.locator('[data-related-row="lesson_submissions"] a')
      await expect(all).toBeVisible()
      const allHref = await all.getAttribute('href')
      expect(allHref).toMatch(/^\/admin\/grading\?filter=all&cohort_id=1&lesson_id=\d+$/)
      const crumbs = await page.locator('[data-record-header] nav[aria-label="Breadcrumb"] a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
      await record(page, 'admin-review-related', theme, info.project.name, { allHref, crumbs })
      await all.click()
      await expect(page.getByRole('button', { name: /^Lesson: / })).toBeVisible()
      await record(page, 'admin-lesson-filter', theme, info.project.name)
      await open(page, '/admin/cohorts/1/modules/10/grading?week=2', 1, theme)
      expect(await page.locator('thead th[scope="col"] a').first().getAttribute('href')).toMatch(/^\/admin\/lessons\/\d+\/edit$/)
      expect(errors).toEqual([])
    })
  })
}
