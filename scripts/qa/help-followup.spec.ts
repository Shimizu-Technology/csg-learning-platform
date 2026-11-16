import { test, expect, type APIRequestContext, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * W7 PR 7.4 affected-flow QA: Reply and Reply & resolve from Support and the
 * request page, help request to its follow-up plan and back, linked evidence,
 * the return plan link, and Message from a follow-up plan with its source, as
 * instructor and admin, in light and dark, at the project's width (1280, 390).
 * Needs scripts/qa/help-followup-fixtures.rb after scripts/qa/run start.
 * Run: QA_SPEC=help-followup.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts
 */

const OUT = fileURLToPath(new URL('../../.qa-local/help-followup/', import.meta.url))
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const API = `http://127.0.0.1:${state.api_port}`
const as = (user: number) => ({ Authorization: `Bearer test_token_${user}` })

async function open(page: Page, path: string, user: number, theme: 'light' | 'dark') {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.addInitScript((choice) => {
    try {
      if (choice) localStorage.setItem('csg-learn:theme', choice); else localStorage.removeItem('csg-learn:theme')
      // Markdown mode: a plain textarea the test can type into.
      for (const id of ['1', '2']) localStorage.setItem(`csg-editor-preferences:${id}`, JSON.stringify({ mode: 'markdown', enterSends: true }))
    } catch { /* ignore */ }
  }, theme === 'light' ? 'light' : '')
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function record(page: Page, name: string, theme: string, project: string) {
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
  await page.screenshot({ path: screenshot, fullPage: true })
  const url = new URL(page.url())
  appendFileSync(`${OUT}${project}.jsonl`, `${JSON.stringify({ name, theme, overflow, serious, contrast, dataTheme, url: url.pathname + url.search, screenshot })}\n`)
  expect(dataTheme).toBe(theme)
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(serious, `${name} serious axe violations`).toEqual([])
}

/** A fresh open request from the program student (one active per lesson; a resolved one frees it). */
async function freshRequest(request: APIRequestContext, message: string) {
  const support = await (await request.get(`${API}/api/v1/support_queue`, { headers: as(2) })).json()
  const existing = support.support_queue.help_requests.find((item: { student?: { id: number } }) => item.student?.id === 3)
  if (existing) return existing as { id: number }
  // The fixture's request was resolved by an earlier run: ask again about the same lesson.
  const previous = (await (await request.get(`${API}/api/v1/help_requests?student_id=3`, { headers: as(2) })).json()).help_requests[0]
  const created = await request.post(`${API}/api/v1/help_requests`, { headers: as(3), data: { help_request: { cohort_id: previous.cohort.id, context_type: previous.context_type, context_source: 'primary', context_id: previous.context_id, category: 'technical', message } } })
  expect(created.ok()).toBeTruthy()
  return (await created.json()).help_request as { id: number }
}

async function plans(request: APIRequestContext) {
  const list = await (await request.get(`${API}/api/v1/interventions`, { headers: as(1) })).json()
  const byTrigger = (trigger: string) => list.interventions.find((item: { trigger_type: string; status: string }) => item.trigger_type === trigger && item.status !== 'resolved')
  return { help: byTrigger('help_request') as { id: number; help_request_id: number; enrollment: { student: { full_name: string } } }, redo: byTrigger('redo') as { id: number; evidence_snapshot: { submission_ids: number[] } } }
}

async function type(page: Page, scope: ReturnType<Page['locator']>, text: string) {
  const box = scope.locator('textarea').first()
  await box.click()
  await box.fill(text)
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme}`, () => {
    test.use({ colorScheme: theme })

    test('instructor: Reply keeps the request open in Support, Reply & resolve closes it', async ({ page, request }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const help = await freshRequest(request, `Synthetic ${theme} ${info.project.name} question`)
      await open(page, '/admin/support', 2, theme)
      const card = page.locator('article').filter({ has: page.locator(`a[href^="/admin/help-requests/${help.id}"]`) })
      await expect(card.getByRole('button', { name: 'Reply', exact: true })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Reply & resolve' })).toBeVisible()
      await expect(card.getByRole('link', { name: 'Open request' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0)
      await card.getByRole('button', { name: 'Reply', exact: true }).click()
      await type(page, card, 'Check where the counter changes inside the loop.')
      await record(page, 'support-reply-open', theme, info.project.name)
      await card.getByRole('button', { name: 'Send reply' }).click()
      await expect(page.getByText('Reply sent. The request stays open.')).toBeVisible()
      await expect(card.getByText(/\d+ repl(y|ies)/)).toBeVisible()
      const after = await (await request.get(`${API}/api/v1/help_requests/${help.id}`, { headers: as(2) })).json()
      expect(after.help_request.status).toBe('acknowledged')
      expect(after.help_request.replies.at(-1).body).toBe('Check where the counter changes inside the loop.')

      await card.getByRole('button', { name: 'Reply & resolve' }).click()
      await type(page, card, 'Add one to the counter at the end of the loop.')
      await card.getByRole('button', { name: 'Reply & resolve' }).first().click()
      await expect(page.getByText('Reply sent and request resolved.')).toBeVisible()
      await expect(card).toHaveCount(0)
      const resolved = await (await request.get(`${API}/api/v1/help_requests/${help.id}`, { headers: as(2) })).json()
      expect(resolved.help_request.status).toBe('resolved')
      await record(page, 'support-after-resolve', theme, info.project.name)
      expect(errors).toEqual([])
    })

    test('instructor: request page Reply, follow-up plan link and back', async ({ page, request }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const { help } = await plans(request)
      await open(page, '/admin/support', 2, theme)
      await page.locator(`article a[href^="/admin/help-requests/${help.help_request_id}"]`).filter({ hasText: 'Open request' }).click()
      await expect(page.locator('[data-back-link]').first()).toHaveText('Back to Support')
      await type(page, page.locator('section[aria-label="Reply"]'), 'A synthetic hint, request stays open.')
      await page.getByRole('button', { name: 'Send reply' }).click()
      await expect(page.getByText('Reply sent. The request stays open.')).toBeVisible()
      await expect(page.getByText('A synthetic hint, request stays open.').first()).toBeVisible()
      await record(page, 'request-after-reply', theme, info.project.name)

      const followUp = page.getByRole('link', { name: /Follow-up plan · / }).first()
      await expect(followUp).toBeVisible()
      await followUp.click()
      await expect(page).toHaveURL(new RegExp(`/admin/interventions/${help.id}`))
      await expect(page.locator('[data-back-link]').first()).toHaveText(/Back to Help request · /)
      await expect(page.getByRole('link', { name: help.enrollment.student.full_name }).first()).toBeAttached()
      await record(page, 'follow-up-from-request', theme, info.project.name)
      await page.locator('[data-back-link]').first().click()
      await expect(page).toHaveURL(new RegExp(`/admin/help-requests/${help.help_request_id}`))
      expect(errors).toEqual([])
    })

    test('admin: linked evidence, return plan link, and Message with its source', async ({ page, request }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const { redo } = await plans(request)
      const first = redo.evidence_snapshot.submission_ids[0]
      await open(page, `/admin/interventions/${redo.id}?return_to=${encodeURIComponent('/admin/support')}`, 1, theme)
      await expect(page.locator('[data-back-link]').first()).toHaveText('Back to Support')
      const evidence = page.getByRole('link', { name: `#${first}`, exact: true })
      await expect(evidence).toHaveAttribute('href', new RegExp(`^/admin/submissions/${first}\\?cohort_id=\\d+&student_id=\\d+&return_to=`))
      await expect(page.getByRole('link', { name: /Open in student page/ })).toHaveAttribute('href', /\/support\?plan_id=\d+$/)
      await record(page, 'follow-up-evidence', theme, info.project.name)
      await evidence.click()
      await expect(page).toHaveURL(new RegExp(`/admin/submissions/${first}`))
      await expect(page.locator('[data-back-link]').first()).toHaveText(/Back to Follow-up plan · /)
      await page.locator('[data-back-link]').first().click()
      await expect(page).toHaveURL(new RegExp(`/admin/interventions/${redo.id}`))

      await page.getByRole('button', { name: 'Message', exact: true }).click()
      await expect(page).toHaveURL(/\/messages\/dm\/\d+\?source_type=intervention/)
      const chip = page.getByRole('link', { name: /From follow-up plan: / })
      await expect(chip).toHaveAttribute('href', new RegExp(`^/admin/interventions/${redo.id}`))
      await record(page, 'message-with-source', theme, info.project.name)
      await chip.click()
      await expect(page).toHaveURL(new RegExp(`/admin/interventions/${redo.id}`))
      expect(errors).toEqual([])
    })
  })
}
