import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/w9-deadlines.json', import.meta.url), 'utf8'))
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const theme = process.env.QA_THEME || 'light'
test.beforeEach(async ({ page }) => {
  execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/w9-deadlines-fixtures.rb'], { cwd: new URL('../../api', import.meta.url).pathname, env: { ...process.env, DATABASE_URL: `postgresql://localhost/${state.database}` } })
  await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
  await page.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})
test.afterEach(async ({ page }) => { await page.close() })
test('grant, learner date, submission enforcement, Off parity and history', async ({ page }) => {
  await page.goto(`/admin/cohorts/${ids.cohort}/students/${ids.rehearsal.user}/learning?qa_user=1`)
  const panel = page.getByRole('region', { name: 'Deadlines and extensions' })
  await expect(panel).toBeVisible()
  await panel.getByLabel('Applies to').selectOption(`lesson:${ids.lesson}`)
  await panel.getByLabel('New deadline (Guam)').fill('2030-01-15')
  await panel.getByLabel('Reason', { exact: true }).fill('Travel approved by instructor')
  await panel.getByRole('button', { name: 'Grant extension', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('Extension saved')
  await panel.getByText('Extension history (1)').click()
  await expect(panel.getByRole('listitem').filter({ hasText: 'Travel approved by instructor' }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.goto(`/lessons/${ids.lesson}?cohort_id=${ids.cohort}&qa_user=${ids.rehearsal.user}`)
  await expect(page.getByText(/Submission deadline:/).first()).toContainText('2030')
  const answer = page.getByRole('textbox', { name: 'Your answer, rich text' })
  await expect(answer).toBeEnabled()
  await answer.fill('print("extension submission")')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByText(/Waiting for review/).first()).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Waiting for review/).first()).toBeVisible()
  await page.goto(`/lessons/${ids.lesson}?cohort_id=${ids.cohort}&qa_user=${ids.late.user}`)
  await expect(page.getByText(/Submissions are closed/).first()).toBeVisible()
  const refused = await page.evaluate(async ({ block, cohort }) => {
    const result = await fetch('/api/v1/submissions', { method: 'POST', headers: { Authorization: 'Bearer test_token_902', 'Content-Type': 'application/json' }, body: JSON.stringify({ content_block_id: block, cohort_id: cohort, text: 'too late' }) })
    return result.status
  }, { block: ids.block, cohort: ids.cohort })
  expect(refused).toBe(403)
  await page.goto(`/dashboard?cohort_id=${ids.program_cohort}&qa_user=3`)
  await expect(page.locator('[data-region="next-action"]').first()).toBeVisible()
  await expect(page.locator('[data-region="personal-pace"]')).toHaveCount(0)
})
