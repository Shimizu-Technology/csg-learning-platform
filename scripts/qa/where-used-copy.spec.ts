import { test, expect, type APIRequestContext, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * W5 PR 5.4 fix round 2: after an admin makes QA Program 2's own copy of the
 * shared curriculum, QA Program's instructor (who doesn't teach QA Program 2)
 * never sees that cohort's name in the copy's name: Content, the copy's
 * curriculum page, a copied lesson's page and its peek card. The admin does.
 * Run after where-used.spec.ts (it changes the shared fixture for good):
 *   QA_SPEC=where-used-copy.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts
 */

const OUT = fileURLToPath(new URL('../../.qa-local/where-used/', import.meta.url))
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/where-used.json', import.meta.url), 'utf8')) as { shared_curriculum_id: number; second_cohort_id: number }
const API = `http://127.0.0.1:${state.api_port}`
const as = (user: number) => ({ Authorization: `Bearer test_token_${user}` })
const SECRET = ['QA Program 2', 'QA Program 3', 'Second cohort learner']

/** The admin's copy for QA Program 2, made once (a repeat answers already_copied). */
async function adminCopy(request: APIRequestContext) {
  const response = await request.post(`${API}/api/v1/cohorts/${ids.second_cohort_id}/curriculum_copy`, { headers: as(1), data: { source_curriculum_id: ids.shared_curriculum_id } })
  if (response.ok()) return (await response.json()).curriculum_copy.copy_curriculum.id as number
  // Already moved to its copy by an earlier project: find it from the cohort.
  const cohort = await (await request.get(`${API}/api/v1/cohorts/${ids.second_cohort_id}`, { headers: as(1) })).json()
  return cohort.cohort.curriculum_id as number
}

async function open(page: Page, path: string, user: number, theme: 'light' | 'dark') {
  await page.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()))
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
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
  mkdirSync(`${OUT}${project}`, { recursive: true })
  await page.screenshot({ path: `${OUT}${project}/${theme}-${name}.png`, fullPage: true })
  appendFileSync(`${OUT}${project}.jsonl`, `${JSON.stringify({ name, theme, overflow, serious })}\n`)
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(serious, `${name} axe`).toEqual([])
}

const noSecrets = async (page: Page) => { for (const secret of SECRET) await expect(page.locator('body')).not.toContainText(secret) }

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })

    test('after an admin copy for QA Program 2, the instructor of QA Program sees the copy without its cohort', async ({ page, request }, info) => {
      const phone = info.project.name.endsWith('390')
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const copyId = await adminCopy(request)
      const copy = await (await request.get(`${API}/api/v1/records/curriculum/${copyId}/usage`, { headers: as(1) })).json()
      expect(copy.usage.name).toBe('QA Program Lab (QA Program 2)')
      const lesson = (await (await request.get(`${API}/api/v1/records/module/${copy.usage.modules[0].id}/usage`, { headers: as(1) })).json()).usage.lessons[0]

      // Every payload the instructor reads about the copy.
      for (const path of ['/api/v1/curricula', `/api/v1/curricula/${copyId}`, `/api/v1/records/curriculum/${copyId}/usage`, `/api/v1/records/lesson/${lesson.id}/usage`,
        `/api/v1/records/lesson/${lesson.id}/summary`, `/api/v1/lessons/${lesson.id}/block_editor`, `/api/v1/search?q=${encodeURIComponent('QA Program Lab')}`]) {
        const body = await (await request.get(`${API}${path}`, { headers: as(2) })).text()
        for (const secret of SECRET) expect(body, path).not.toContain(secret)
      }

      await open(page, '/admin/content', 2, theme)
      await expect(page.getByText('QA Program Lab (copy)').first()).toBeVisible()
      await noSecrets(page)
      await record(page, 'copy-instructor-content', theme, info.project.name)

      await open(page, `/admin/curricula/${copyId}`, 2, theme)
      await expect(page.locator('h1')).toHaveText('QA Program Lab (copy)')
      await noSecrets(page)
      await record(page, 'copy-instructor-curriculum', theme, info.project.name)

      await open(page, `/admin/lessons/${lesson.id}`, 2, theme)
      await noSecrets(page)
      if (!phone) {
        await expect(page.locator('nav[aria-label="Breadcrumb"] li').first()).toHaveText('QA Program Lab (copy)')
        // The module page's lesson link opens a peek card with the curriculum in its subtitle.
        await open(page, `/admin/modules/${copy.usage.modules[0].id}`, 2, theme)
        await page.locator(`#lessons a[href^="/admin/lessons/${lesson.id}"]`).hover()
        await page.waitForTimeout(500)
        const peek = page.locator('[data-peek-card="lesson"]')
        await expect(peek).toContainText('QA Program Lab (copy)')
        await noSecrets(page)
        await record(page, 'copy-instructor-peek', theme, info.project.name)
      }

      await open(page, `/admin/curricula/${copyId}`, 1, theme)
      await expect(page.locator('h1')).toHaveText('QA Program Lab (QA Program 2)')
      await record(page, 'copy-admin-curriculum', theme, info.project.name)
      expect(errors).toEqual([])
    })
  })
}
