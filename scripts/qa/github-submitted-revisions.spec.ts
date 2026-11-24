import { test, expect, type Locator, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkedLifecycle } from './ownership.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const state = JSON.parse(readFileSync(`${root}.qa-local/state.json`, 'utf8'))
const fixtures = JSON.parse(readFileSync(`${root}.qa-local/github-submitted-revisions.json`, 'utf8'))
const output = `${root}.qa-local/github-submitted-revisions/`
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')
const owners = new Map<Page, string>()
const headers = { Authorization: 'Bearer test_token_2' }

function stage(value: string) {
  const result = spawnSync('bundle', ['exec', 'ruby', '../scripts/qa/github-submitted-revisions-fixtures.rb', value], {
    cwd: `${root}api`, encoding: 'utf8',
    env: { ...process.env, RAILS_ENV: 'test', DATABASE_URL: `postgresql://localhost/${state.database}` },
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
}
test.beforeEach(async ({ page }, info) => {
  const id = `submitted-revisions-${info.project.name}-${info.title.replace(/[^a-z0-9]/gi, '-')}`
  checkedLifecycle(session, 'claim', id)
  owners.set(page, id)
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  stage('reset')
})
test.afterEach(async ({ page }) => {
  await page.close()
  const id = owners.get(page)
  if (id) checkedLifecycle(session, 'release', id)
})

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=2`)
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}
async function sync(page: Page, key: 'on' | 'off') {
  const row = fixtures[key]
  await open(page, `/admin/cohorts/${row.cohort_id}/modules/${row.module_id}/grading`)
  const response = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith('/sync_github'))
  await page.getByRole('button', { name: 'Sync all from GitHub', exact: true }).click()
  const body = await (await response).json()
  expect(body.errors).toEqual([])
  return body
}
async function attempts(page: Page, key: 'on' | 'off') {
  const row = fixtures[key]
  const response = await page.request.get(`/api/v1/submissions?cohort_id=${row.cohort_id}&user_id=${row.user_id}`, { headers })
  expect(response.status()).toBe(200)
  return (await response.json()).submissions.filter((item: { content_block_id: number }) => item.content_block_id === row.block_id)
}
/**
 * Scroll a control into the band between the top header (and toasts) and the pinned grade bar:
 * on phones that bar now always holds the feedback box (UX-1), so a target scrolled only to the
 * screen's bottom edge stays covered.
 */
async function reveal(locator: Locator) {
  await locator.evaluate((element) => {
    // Instant: the app scrolls smoothly, and a target still moving is re-scrolled by the click.
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
    let node = element.parentElement
    while (node && !(node.scrollHeight > node.clientHeight && /(auto|scroll)/.test(getComputedStyle(node).overflowY))) node = node.parentElement
    ;(node ?? document.scrollingElement)?.scrollBy({ top: 200, behavior: 'instant' })
  })
  return locator
}

/**
 * At 390 the targets below sit visibly between the sticky header and the pinned grade bar (see
 * the history evidence), but Playwright's own re-scroll on click keeps pushing them under one or
 * the other. On touch widths press them as DOM clicks after revealing; desktop keeps real clicks.
 */
async function press(locator: Locator, touch: boolean) {
  await reveal(locator)
  if (touch) await locator.dispatchEvent('click')
  else await locator.click()
}

/** The commit and paths, folded away from non-technical graders (UX-1). */
const technicalDetails = (page: Page) => page.locator('details', { has: page.getByText('Technical details', { exact: true }) }).first().locator('dl')

async function grade(page: Page, id: number, value: 'B' | 'C') {
  await open(page, `/admin/submissions/${id}`)
  const bar = page.locator('[data-grade-bar]')
  await expect(bar).toBeVisible()
  // Feedback is always in view; a grade button only chooses, and Save grade saves (UX-1).
  const feedback = page.getByRole('textbox', { name: 'Overall feedback, rich text', exact: true })
  await feedback.fill(`Reviewed source ${value}`)
  await bar.getByRole('group', { name: 'Grade' }).getByRole('button', { name: value, exact: true }).click()
  const saved = page.waitForResponse(res => res.request().method() === 'PATCH' && res.url().endsWith('/grade'))
  await bar.getByRole('button', { name: 'Save grade' }).click()
  expect((await saved).status()).toBe(200)
  await expect(page.getByRole('heading', { name: /Saved feedback/ })).toBeVisible()
}
async function evidence(page: Page, name: string, project: string, theme: string, data: unknown) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  mkdirSync(output, { recursive: true })
  await page.screenshot({ path: `${output}${project}-${theme}-${name}.png` })
  appendFileSync(`${output}ledger.jsonl`, JSON.stringify({ name, project, theme, overflow, data }) + '\n')
}

// Each run syncs, grades and reloads several times; the dev server can be slow on a cold start.
test.describe.configure({ timeout: 90_000 })

for (const theme of ['light', 'dark']) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    })
    test('R01 sync grade changed content history and identical-content commit', async ({ page }, info) => {
      expect((await sync(page, 'on')).synced).toBe(1)
      const first = (await attempts(page, 'on'))[0]
      expect(first.commit_sha).toBe('a'.repeat(40))
      await grade(page, first.id, 'B')
      await expect(page.getByText(/^Synced from GitHub /)).toBeVisible()
      await expect(technicalDetails(page)).toContainText('a'.repeat(40))
      const gradedFirst = (await attempts(page, 'on'))[0]
      stage('changed')
      expect((await sync(page, 'on')).synced).toBe(1)
      const changed = await attempts(page, 'on')
      expect(changed).toHaveLength(2)
      const current = changed.find((row: { id: number }) => row.id !== first.id)
      const historical = changed.find((row: { id: number }) => row.id === first.id)
      expect(historical).toMatchObject({ grade: 'B', feedback: 'Reviewed source B', commit_sha: 'a'.repeat(40), updated_at: gradedFirst.updated_at, github_revision: gradedFirst.github_revision })
      expect(current).toMatchObject({ grade: null, feedback: null, commit_sha: 'b'.repeat(40), num_submissions: 2 })
      await grade(page, current.id, 'C')
      // On a phone the "Saved C" toast sits over the top of the narrow band above the grade bar.
      await expect(page.getByText(/^Saved [A-Z]+ for /)).toHaveCount(0, { timeout: 15_000 })
      // Touch screens have no hover; on a desktop, show the row's hover state in the evidence.
      const touch = info.project.name.endsWith('390')
      await press(page.getByText('Attempt history', { exact: true }), touch)
      await press(page.getByRole('button', { name: 'Load attempts', exact: true }), touch)
      const prior = page.getByRole('link', { name: /Attempt 1 · Previous · B · Synced / })
      await expect(prior).toBeVisible()
      await reveal(prior)
      if (!touch) await prior.hover()
      await evidence(page, 'history', info.project.name, theme, changed)
      await press(prior, touch)
      await expect(page.getByRole('heading', { name: /Saved feedback/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: /Saved feedback/ }).locator('..').getByText('Reviewed source B', { exact: true })).toBeVisible()
      await expect(page.locator('[data-grade-bar]').getByRole('group', { name: 'Grade' }).getByRole('button', { name: 'B', exact: true })).toBeDisabled()
      const beforeIdentical = (await attempts(page, 'on')).find((row: { id: number }) => row.id === current.id)
      stage('identical')
      expect((await sync(page, 'on')).synced).toBe(0)
      const identical = await attempts(page, 'on')
      expect(identical).toHaveLength(2)
      expect(identical.find((row: { id: number }) => row.id === current.id)).toEqual(beforeIdentical)
      await open(page, `/admin/submissions/${current.id}`)
      await expect(page.getByText(/^Synced from GitHub /)).toBeVisible()
      await expect(technicalDetails(page)).toContainText('b'.repeat(40))
      await evidence(page, 'identical', info.project.name, theme, identical)
    })
    test('R02 Off cohort retains legacy row and grade behavior without revision UI', async ({ page }, info) => {
      expect((await sync(page, 'off')).synced).toBe(1)
      const first = (await attempts(page, 'off'))[0]
      await grade(page, first.id, 'B')
      await expect(page.getByText(/^Synced from GitHub /)).toHaveCount(0)
      stage('changed')
      expect((await sync(page, 'off')).synced).toBe(1)
      stage('identical')
      expect((await sync(page, 'off')).synced).toBe(0)
      const rows = await attempts(page, 'off')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: first.id, grade: 'B', feedback: 'Reviewed source B', num_submissions: 2, commit_sha: 'c'.repeat(40) })
      expect(rows[0]).not.toHaveProperty('github_revision')
      await open(page, `/admin/submissions/${first.id}`)
      await expect(page.getByRole('heading', { name: /Saved feedback/ })).toBeVisible()
      await expect(page.getByText(/^Synced from GitHub /)).toHaveCount(0)
      await evidence(page, 'off', info.project.name, theme, rows)
    })
  })
}
