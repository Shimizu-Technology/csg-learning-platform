import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'
const session = process.env.DEV_LIFECYCLE_SESSION!
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/first-run.json', import.meta.url), 'utf8'))
const output = new URL('../../.qa-local/renderer-followups/', import.meta.url)
mkdirSync(output, { recursive: true })
const owners = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const name = `renderer-followups-${info.project.name}-${info.title}`.replace(/[^a-z0-9-]/gi, '-')
  checkedLifecycle(session, 'claim', name); owners.set(page, name)
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})
test.afterEach(async ({ page }) => { await page.close(); checkedLifecycle(session, 'release', owners.get(page)!); owners.delete(page) })
for (const theme of ['light', 'dark']) test(`${theme}: Off targets and On missing-module recovery`, async ({ page }, info) => {
  await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
  await page.goto(`/materials?cohort_id=${ids.off}&qa_user=3`)
  const expand = page.getByRole('button', { name: 'Expand all', exact: true })
  const collapse = page.getByRole('button', { name: 'Collapse all', exact: true })
  await expect(expand).toBeVisible()
  const heights = { expand: (await expand.boundingBox())!.height, collapse: (await collapse.boundingBox())!.height }
  expect(heights.expand).toBeGreaterThanOrEqual(44)
  expect(heights.collapse).toBeGreaterThanOrEqual(44)
  const modules = page.locator('h2 > button')
  await collapse.click()
  await expect.poll(() => modules.evaluateAll(nodes => nodes.every(node => node.getAttribute('aria-expanded') === 'false'))).toBe(true)
  await expand.click()
  await expect.poll(() => modules.evaluateAll(nodes => nodes.every(node => node.getAttribute('aria-expanded') === 'true'))).toBe(true)
  await page.screenshot({ path: new URL(`${info.project.name}-${theme}-off.png`, output).pathname, fullPage: true })
  await page.goto(`/modules/999999?cohort_id=${ids.program}&qa_user=${ids.program_user}`)
  await expect(page.getByRole('heading', { name: 'Module not found', exact: true })).toBeVisible()
  const back = page.getByRole('link', { name: 'Back to Learn', exact: true })
  await expect(back).toHaveAttribute('href', `/materials?cohort_id=${ids.program}`)
  await page.screenshot({ path: new URL(`${info.project.name}-${theme}-missing.png`, output).pathname, fullPage: true })
  await back.click()
  await expect(page.getByTestId('course-outline')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Module not found' })).toHaveCount(0)
  // A valid module still opens its own location in the outline.
  await page.locator('main h2 a').first().click()
  await expect(page).toHaveURL(/module=/)
  await expect(page.getByTestId('course-outline')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  writeFileSync(new URL(`${info.project.name}-${theme}.json`, output), JSON.stringify({ width: page.viewportSize()!.width, theme, heights, missingModule: 'passed', back: 'passed', validModule: 'passed' }, null, 2))
})
