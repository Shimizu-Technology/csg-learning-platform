import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * PR #281 fix round 1 QA, as the instructor at 1280 and 390 (Chromium):
 * a held grade key grades one student; the server refuses a Redo without feedback;
 * the queue is paged; the module grid works for a cohort that has made its own copy.
 * Needs scripts/qa/grading-fix1-fixtures.rb after scripts/qa/run start, with its JSON
 * output saved to .qa-local/grading-fix1.json. Each project grades one item.
 * Run: QA_SPEC=grading-fix1.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts
 */

const OUT = fileURLToPath(new URL('../../.qa-local/grading-fix1/', import.meta.url))
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const fixture = JSON.parse(readFileSync(new URL('../../.qa-local/grading-fix1.json', import.meta.url), 'utf8')) as {
  cohort_id: number; copy_module_id: number; old_module_id: number; copy_lesson_ids: number[]; old_lesson_ids: number[]; waiting: number
}
const API = `http://127.0.0.1:${state.api_port}/api/v1`
const headers = { Authorization: 'Bearer test_token_2' }

async function open(page: Page, path: string) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=2`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function note(page: Page, project: string, name: string, extra: Record<string, unknown> = {}) {
  await page.waitForLoadState('networkidle')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  mkdirSync(`${OUT}${project}`, { recursive: true })
  const screenshot = `${OUT}${project}/${name}.png`
  await page.screenshot({ path: screenshot })
  appendFileSync(`${OUT}${project}.jsonl`, `${JSON.stringify({ name, overflow, url: new URL(page.url()).pathname + new URL(page.url()).search, screenshot, ...extra })}\n`)
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
}

const rows = (page: Page) => page.locator('[aria-label="Grading queue"] li button')

test('the queue is paged, and a copied cohort lists its work under the copy ids', async ({ page, request }, info) => {
  const queue = await (await request.get(`${API}/grading_queue?cohort_id=${fixture.cohort_id}&filter=all&per_page=100`, { headers })).json()
  expect(new Set(queue.submissions.map((item: { lesson_id: number }) => item.lesson_id))).toEqual(new Set(fixture.copy_lesson_ids))
  expect(queue.submissions[0]).not.toHaveProperty('text')

  await open(page, `/admin/grading?cohort_id=${fixture.cohort_id}`)
  const waiting = (await (await request.get(`${API}/grading_queue?cohort_id=${fixture.cohort_id}`, { headers })).json()).meta.total_count as number
  expect(waiting).toBeGreaterThan(50)
  if (info.project.name.endsWith('1280')) await expect(rows(page)).toHaveCount(50)
  const pages = page.locator('nav[aria-label="Queue pages"]')
  await expect(pages).toContainText(`1–50 of ${waiting}`)
  await note(page, info.project.name, 'queue-page-1', { waiting })
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(pages).toContainText(`51–${waiting} of ${waiting}`)
  await expect(rows(page)).toHaveCount(waiting - 50)
  expect(new URL(page.url()).searchParams.get('page')).toBe('2')
  await note(page, info.project.name, 'queue-page-2')

  // Module grids lists the copy's module; its grid opens, and so does the shared module's old id.
  await page.locator('summary', { hasText: 'Module grids' }).click()
  const grid = page.locator('ul[aria-label="Grade by module"] a').first()
  await expect(grid).toHaveAttribute('href', `/admin/cohorts/${fixture.cohort_id}/modules/${fixture.copy_module_id}/grading`)
  await grid.click()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'QA Paging Module — Grading', level: 1 })).toBeVisible()
  await expect(page.getByRole('table').first()).toBeVisible()
  await expect(page.getByText('Could not load', { exact: false })).toHaveCount(0)
  await note(page, info.project.name, 'copy-grid')
  await open(page, `/admin/cohorts/${fixture.cohort_id}/modules/${fixture.old_module_id}/grading`)
  await expect(page.getByRole('heading', { name: 'QA Paging Module — Grading', level: 1 })).toBeVisible()
  await expect(page.getByRole('table').first()).toBeVisible()
  await note(page, info.project.name, 'copy-grid-old-id')
})

test('a held grade key grades one student', async ({ page, request }, info) => {
  const first = (await (await request.get(`${API}/grading_queue?cohort_id=${fixture.cohort_id}&per_page=1`, { headers })).json()).submissions[0]
  const writes: string[] = []
  page.on('request', (req) => { if (req.method() === 'PATCH' && req.url().endsWith('/grade')) writes.push(req.url()) })
  await open(page, `/admin/grading?cohort_id=${fixture.cohort_id}&submission=${first.id}`)
  const panel = page.locator('[aria-label="Submission review"]')
  await expect(panel).toBeVisible()
  await panel.focus()
  await page.keyboard.down('a')
  await expect.poll(() => new URL(page.url()).searchParams.get('submission')).not.toBe(String(first.id))
  await expect(page.locator('[aria-label="Submission review"]')).toBeVisible()
  // Still held: Playwright sends these as auto-repeats (repeat: true) to the next review.
  for (let i = 0; i < 4; i++) await page.keyboard.down('a')
  await page.waitForTimeout(1200)
  await page.keyboard.up('a')
  await page.waitForTimeout(400)
  await note(page, info.project.name, 'held-key-next-review', { writes: writes.length })
  expect(writes).toHaveLength(1)
  expect(writes[0]).toContain(`/submissions/${first.id}/grade`)
})

test('a Redo without written feedback is refused, on the page and by the server', async ({ page, request }, info) => {
  const item = (await (await request.get(`${API}/grading_queue?cohort_id=${fixture.cohort_id}&per_page=1`, { headers })).json()).submissions[0]
  const refused = await request.patch(`${API}/submissions/${item.id}/grade`, { headers, data: { grade: 'R', feedback: '   ', base_submission_updated_at: item.updated_at } })
  expect(refused.status()).toBe(422)
  expect((await refused.json()).errors).toEqual(['Write feedback before choosing Redo, so the student knows what to change.'])
  const after = (await (await request.get(`${API}/submissions/${item.id}`, { headers })).json()).submission
  expect(after.grade).toBeNull()

  const writes: string[] = []
  page.on('request', (req) => { if (req.method() === 'PATCH' && req.url().endsWith('/grade')) writes.push(req.url()) })
  await open(page, `/admin/grading?cohort_id=${fixture.cohort_id}&submission=${item.id}`)
  await page.locator('[data-grade-bar]').getByRole('button', { name: /^Redo/ }).click()
  await expect(page.locator('[data-grade-bar] [role="alert"]')).toContainText('Write feedback before choosing Redo, so the student knows what to change.')
  expect(writes).toHaveLength(0)
  await note(page, info.project.name, 'redo-needs-feedback')
})
