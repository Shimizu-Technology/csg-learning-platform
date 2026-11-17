import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * W5 PR 5.4 affected-flow QA: the curriculum, module and lesson record pages,
 * every new link and its Back, the lesson editor's breadcrumb and "Used in",
 * as admin and as an instructor who teaches one of two cohorts sharing a
 * curriculum (the instructor must never see QA Program 2), a refused student,
 * and the team member page's grading load and owned follow-ups. Light and
 * dark, at the project's width (1280, 390).
 * Needs scripts/qa/where-used-fixtures.rb after scripts/qa/run start.
 * Run: QA_SPEC=where-used.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts
 */

const OUT = fileURLToPath(new URL('../../.qa-local/where-used/', import.meta.url))
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/where-used.json', import.meta.url), 'utf8')) as {
  shared_curriculum_id: number; module_id: number; lesson_id: number; second_cohort_id: number; copy_curriculum_id: number; program_cohort_id: number
}
const API = `http://127.0.0.1:${state.api_port}`
const as = (user: number) => ({ Authorization: `Bearer test_token_${user}` })
const SECRET = ['QA Program 2', 'QA Program 3', 'Second cohort learner']

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
  expect(contrast, `${name} contrast`).toEqual([])
}

const back = (page: Page) => page.locator('[data-back-link]').first()
const usedIn = (page: Page) => page.locator('#used-in')

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })

    test('admin: Content to curriculum, module, lesson and the editor, and Back each step', async ({ page }, info) => {
      const phone = info.project.name.endsWith('390')
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await open(page, `/admin/content?curriculum=${ids.shared_curriculum_id}&pane=detail`, 1, theme)
      await page.getByRole('link', { name: "Where it's used" }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/curricula/${ids.shared_curriculum_id}$`))
      await expect(back(page)).toHaveText('Back to Content')
      await expect(page.locator('h1')).toHaveText('QA Program Lab')
      await expect(usedIn(page).locator('[data-used-in-cohort]')).toHaveCount(2)
      await expect(usedIn(page)).toContainText('QA Program 2')
      await expect(page.locator('#copies')).toContainText("QA Program Lab (QA Program 3's copy)")
      await expect(page.locator('#copies')).toContainText('QA Program 3')
      await expect(page.locator('#rubrics')).toContainText('Synthetic clarity rubric')
      await record(page, 'admin-curriculum', theme, info.project.name)

      await page.locator('#modules a[data-record-link="module"]').filter({ hasText: /./ }).first().click()
      await expect(page).toHaveURL(/\/admin\/modules\/\d+/)
      await expect(back(page)).toHaveText('Back to Curriculum · QA Program Lab')
      await expect(usedIn(page)).toContainText('Cohort schedules')
      await expect(usedIn(page).getByRole('link', { name: 'Module grading' }).first()).toBeVisible()
      await record(page, 'admin-module', theme, info.project.name)

      await page.goto(`/admin/modules/${ids.module_id}`)
      await page.locator(`#lessons a[href^="/admin/lessons/${ids.lesson_id}"]`).click()
      await expect(page).toHaveURL(new RegExp(`/admin/lessons/${ids.lesson_id}`))
      await expect(back(page)).toHaveText(/^Back to Module · /)
      await expect(usedIn(page).locator('[data-used-in-cohort]')).toHaveCount(2)
      await expect(page.getByRole('link', { name: 'Edit lesson' })).toBeVisible()
      if (!phone) await expect(page.locator('nav[aria-label="Breadcrumb"] a')).toHaveCount(2)
      await record(page, 'admin-lesson', theme, info.project.name)

      // Submissions count matches what Grading shows for the same lesson.
      await page.locator('[data-related-row="submissions"] a').click()
      await expect(page).toHaveURL(new RegExp(`/admin/grading\\?lesson_id=${ids.lesson_id}&filter=all`))
      await expect(page.getByRole('button', { name: /Lesson: .*Remove this filter/ })).toBeVisible()
      await page.goBack()
      await expect(page).toHaveURL(new RegExp(`/admin/lessons/${ids.lesson_id}`))

      await page.getByRole('link', { name: 'Edit lesson' }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/lessons/${ids.lesson_id}/edit`))
      const editorBack = page.locator('header a[data-back-link]')
      // Opened from the lesson page, so Back names it (and keeps that page's own way back).
      await expect(editorBack).toHaveAttribute('aria-label', /^Back to Lesson · /)
      if (!phone) {
        const crumbs = page.locator('header nav[aria-label="Breadcrumb"] a')
        await expect(crumbs.nth(0)).toHaveAttribute('href', `/admin/curricula/${ids.shared_curriculum_id}`)
        await expect(crumbs.nth(1)).toHaveAttribute('href', `/admin/modules/${ids.module_id}`)
        await expect(crumbs.nth(2)).toHaveAttribute('href', `/admin/lessons/${ids.lesson_id}`)
        await expect(page.locator('aside[aria-label="Settings"] #editor-used-in [data-used-in-cohort]')).toHaveCount(2)
      } else {
        await page.getByRole('button', { name: 'Settings' }).click()
        await expect(page.locator('[role="dialog"] #editor-used-in [data-used-in-cohort]')).toHaveCount(2)
        await record(page, 'admin-editor-settings', theme, info.project.name)
        await page.keyboard.press('Escape')
      }
      await record(page, 'admin-editor', theme, info.project.name)
      await editorBack.click()
      await expect(page).toHaveURL(new RegExp(`/admin/lessons/${ids.lesson_id}(\\?|$)`))
      await back(page).click()
      await expect(page).toHaveURL(new RegExp(`/admin/modules/${ids.module_id}`))
      expect(errors).toEqual([])
    })

    test('instructor: sees only the cohort they teach everywhere, and View as student opens the lesson', async ({ page, request }, info) => {
      const phone = info.project.name.endsWith('390')
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      for (const [type, id] of [['curriculum', ids.shared_curriculum_id], ['module', ids.module_id], ['lesson', ids.lesson_id]] as const) {
        const body = await (await request.get(`${API}/api/v1/records/${type}/${id}/usage`, { headers: as(2) })).text()
        for (const secret of SECRET) expect(body, `${type} usage payload`).not.toContain(secret)
      }
      const editor = await (await request.get(`${API}/api/v1/lessons/${ids.lesson_id}/block_editor`, { headers: as(2) })).text()
      for (const secret of SECRET) expect(editor, 'editor payload').not.toContain(secret)

      await open(page, `/admin/curricula/${ids.shared_curriculum_id}`, 2, theme)
      await expect(usedIn(page).locator('[data-used-in-cohort]')).toHaveCount(1)
      await expect(usedIn(page)).toContainText('QA Program')
      await expect(page.locator('[data-other-cohorts]')).toHaveText("1 other cohort uses this curriculum. You don't teach it, so it isn’t listed or counted here.")
      await expect(page.locator('#copies')).toContainText("1 more copy was made for cohorts you don't teach.")
      for (const secret of SECRET) await expect(page.locator('main')).not.toContainText(secret)
      await record(page, 'instructor-curriculum', theme, info.project.name)

      await open(page, `/admin/lessons/${ids.lesson_id}`, 2, theme)
      await expect(usedIn(page).locator('[data-used-in-cohort]')).toHaveCount(1)
      for (const secret of SECRET) await expect(page.locator('main')).not.toContainText(secret)
      await expect(page.getByRole('link', { name: 'Open in editor' })).toBeVisible()
      // Count matches the instructor's own Grading queue for this lesson.
      const queue = await (await request.get(`${API}/api/v1/grading_queue?lesson_id=${ids.lesson_id}&filter=all`, { headers: as(2) })).json()
      await expect(page.locator('[data-related-row="submissions"] [data-related-count]')).toHaveText(String(queue.counts.all))
      await record(page, 'instructor-lesson', theme, info.project.name)

      await page.locator('[data-record-header] a', { hasText: 'View as student' }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.program_cohort_id}/student-view/lessons/${ids.lesson_id}`))
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('heading', { name: 'No access' })).toHaveCount(0)
      await expect(page.locator('h1, h2').first()).toBeVisible()
      await record(page, 'instructor-view-as-student', theme, info.project.name)
      await page.goBack()

      // The editor's Used in panel (read only for this instructor: the lesson page is the context).
      await open(page, `/admin/lessons/${ids.lesson_id}/edit`, 2, theme)
      if (!phone) await expect(page.locator('nav[aria-label="Breadcrumb"] a').nth(2)).toHaveAttribute('href', `/admin/lessons/${ids.lesson_id}`)
      for (const secret of SECRET) await expect(page.locator('body')).not.toContainText(secret)
      await record(page, 'instructor-editor', theme, info.project.name)
      expect(errors).toEqual([])
    })

    test('student: the content record pages say No access and the API answers 404', async ({ page, request }, info) => {
      for (const [type, id] of [['curriculum', ids.shared_curriculum_id], ['module', ids.module_id], ['lesson', ids.lesson_id]] as const) {
        expect((await request.get(`${API}/api/v1/records/${type}/${id}/usage`, { headers: as(3) })).status()).toBe(404)
      }
      await open(page, `/admin/lessons/${ids.lesson_id}`, 3, theme)
      await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible()
      await expect(page.locator('#used-in')).toHaveCount(0)
      await record(page, 'student-no-access', theme, info.project.name)
    })

    test('admin: team member page shows grading load and owned follow-ups', async ({ page }, info) => {
      await open(page, '/admin/team/2', 1, theme)
      await expect(page.locator('[data-related-row="grading"]')).toBeVisible()
      await expect(page.locator('#follow-ups')).toContainText(/active plan/)
      const plan = page.locator('#follow-ups a[data-record-link="intervention"]').first()
      await plan.click()
      await expect(page).toHaveURL(/\/admin\/interventions\/\d+/)
      await expect(back(page)).toHaveText(/^Back to Team member · /)
      await back(page).click()
      await expect(page).toHaveURL(/\/admin\/team\/2/)
      await record(page, 'admin-team-member', theme, info.project.name)
    })
  })
}
