import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { checkedLifecycle } from './ownership.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { mkdirSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')
const owners = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const id = `github-app-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', id)
  owners.set(page, id)
})
test.afterEach(async ({ page }) => {
  await page.close()
  const id = owners.get(page)
  if (id) checkedLifecycle(session, 'release', id)
  owners.delete(page)
})
const output = fileURLToPath(new URL('../../.qa-local/github-app-bindings/', import.meta.url))
const headers = (user = 1) => ({ Authorization: `Bearer test_token_${user}` })

async function open(page: Page, path: string, user = 1) {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}
async function saved(page: Page, user = 1) {
  const response = await page.request.get('/api/v1/enrollments/1/github_repository_bindings', { headers: headers(user) })
  expect(response.status()).toBe(200)
  return (await response.json()).bindings
}
async function evidence(page: Page, name: string, project: string, theme: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const region = page.getByRole('region', { name: /GitHub (App connection|repository)$/ }).first()
  if (await region.count()) {
    const violations = await new AxeBuilder({ page }).include('section[aria-label*="GitHub"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(violations.violations.filter(item => ['serious', 'critical'].includes(item.impact || ''))).toEqual([])
    await region.scrollIntoViewIfNeeded()
  }
  mkdirSync(output, { recursive: true })
  await page.screenshot({ path: `${output}${project}-${theme}-${name}.png` })
  appendFileSync(`${output}ledger.jsonl`, JSON.stringify({ name, project, theme, overflow, url: page.url() }) + '\n')
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(choice => localStorage.setItem('csg-learn:theme', choice), theme)
    })

    test('G01 admin installation setup saves selected-repository metadata and survives reload', async ({ page }, info) => {
      await open(page, '/admin/cohorts/1?tab=settings')
      const region = page.getByRole('region', { name: 'GitHub App connection', exact: true })
      await region.getByRole('button', { name: 'Prepare installation' }).click()
      await expect(region.getByRole('link', { name: 'Choose repositories on GitHub' })).toHaveAttribute('href', /https:\/\/github.com\/apps\/synthetic-app\/installations\/new\?state=/)
      await region.getByRole('textbox', { name: 'Installation ID' }).fill('70001')
      await region.getByRole('button', { name: 'Confirm installation' }).click()
      await expect(region.getByText('Installation connected. Repository verification is now available.')).toBeVisible()
      await page.reload()
      await expect(region.getByText('app-learner · Connected')).toBeVisible()
      const response = await page.request.get('/api/v1/cohorts/1/github_app_installations', { headers: headers() })
      const body = await response.json()
      expect(body.installations[0]).toMatchObject({ app_id: 12345, installation_id: 70001, repository_selection: 'selected', account_login: 'app-learner' })
      expect(JSON.stringify(body)).not.toMatch(/private_key|webhook_secret|access_token/)
      await evidence(page, 'installation', info.project.name, theme)
      await region.getByRole('button', { name: 'Prepare installation' }).click()
      const installUrl = new URL((await region.getByRole('link', { name: 'Choose repositories on GitHub' }).getAttribute('href'))!)
      await page.goto(`/github-app/setup?installation_id=70001&state=${encodeURIComponent(installUrl.searchParams.get('state')!)}`)
      await expect(page).toHaveTitle('Confirm GitHub installation · CSG Learn')
      await page.getByRole('button', { name: 'Confirm connection', exact: true }).click()
      await expect(page.getByText('Installation connected.', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Return to cohort settings' })).toHaveAttribute('href', '/admin/cohorts/1?tab=settings')
      await page.goto('/github-app/setup?installation_id=70001&state=expired')
      await page.getByRole('button', { name: 'Confirm connection', exact: true }).click()
      await expect(page.getByText('Setup expired or is unavailable to this account. Return to cohort settings and prepare again.')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Return to cohorts', exact: true })).toBeVisible()
      await page.goto('/github-app/setup?state=pending-approval')
      await expect(page.getByRole('alert')).toHaveText('GitHub has not supplied an installation ID. Ask the account owner to approve access, then prepare setup again in cohort settings.')
      await expect(page.getByRole('button', { name: 'Confirm connection', exact: true })).toBeDisabled()
    })

    test('G02 default binding pending verified reload and API persisted identity', async ({ page }, info) => {
      await open(page, '/profile', 3)
      const own = page.getByRole('region', { name: 'QA Program · GitHub repository', exact: true })
      await own.getByRole('button', { name: /^(Connect|Reconnect) GitHub$/ }).click()
      await page.getByRole('link', { name: 'Continue as app-learner' }).click()
      await page.getByRole('button', { name: 'Confirm GitHub identity', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'GitHub connected as app-learner' })).toBeVisible()
      await open(page, '/admin/cohorts/1/students/3/access')
      const region = page.getByRole('region', { name: 'GitHub repository', exact: true })
      await region.getByRole('textbox', { name: 'Repository (owner/name)' }).fill('app-learner/prework-exercises')
      await region.getByRole('combobox', { name: 'Repository scope', exact: true }).selectOption('')
      await region.getByRole('button', { name: 'Save repository', exact: true }).click()
      const row = region.getByRole('listitem').filter({ hasText: 'Enrollment default' })
      await expect(row.getByText('Pending verification')).toBeVisible()
      await expect.poll(async () => (await saved(page)).find((binding: { curriculum_module_id: number | null }) => binding.curriculum_module_id === null)?.verification_state).toBe('pending')
      await row.getByRole('button', { name: 'Verify repository', exact: true }).click()
      await expect(row.getByText('Verified', { exact: true })).toBeVisible()
      await page.reload()
      await expect(row.getByText('Verified', { exact: true })).toBeVisible()
      const binding = (await saved(page)).find((item: { curriculum_module_id: number | null }) => item.curriculum_module_id === null)
      expect(binding).toMatchObject({ repository_id: 98765, github_username: 'app-learner', verification_state: 'verified' })
      expect(binding.verified_at).toBeTruthy()
      await evidence(page, 'verified', info.project.name, theme)
    })

    test('G03 failure reason wrong owner unselected and successful recovery preserve entries', async ({ page }, info) => {
      await open(page, '/admin/cohorts/1/students/3/access')
      const region = page.getByRole('region', { name: 'GitHub repository', exact: true })
      const row = region.getByRole('listitem').filter({ hasText: 'Enrollment default' })
      for (const [name, reason] of [['wrong-owner/prework-exercises', "Repository must belong"], ['app-learner/unselected', 'check selected repositories'], ['victim-gh/prework-exercises', 'verified GitHub identity'], ['app-learner/forked-repo', 'Forked repositories']]) {
        await region.getByRole('textbox', { name: 'Repository (owner/name)' }).fill(name)
        await region.getByRole('button', { name: 'Save repository', exact: true }).click()
        await expect(row.getByText('Pending verification')).toBeVisible()
        await row.getByRole('button', { name: 'Verify repository', exact: true }).click()
        await expect(row.getByText('Failed', { exact: true })).toBeVisible()
        await expect(row.getByText(new RegExp(reason))).toBeVisible()
        await expect(region.getByRole('textbox', { name: 'Repository (owner/name)' })).toHaveValue(name)
        expect((await saved(page)).find((binding: { curriculum_module_id: number | null }) => binding.curriculum_module_id === null).verified_at).toBeNull()
      }
      await evidence(page, 'failed', info.project.name, theme)
      await row.getByRole('button', { name: 'Edit repository', exact: true }).click()
      await region.getByRole('textbox', { name: 'Repository (owner/name)' }).fill('app-learner/prework-exercises')
      await region.getByRole('button', { name: 'Save repository', exact: true }).click()
      await expect(row.getByText('Pending verification')).toBeVisible()
      await row.getByRole('button', { name: 'Verify repository', exact: true }).click()
      await expect(row.getByText('Verified', { exact: true })).toBeVisible()
    })

    test('G04 module override is independent and persists after reload', async ({ page }) => {
      await open(page, '/admin/cohorts/1/students/3/access')
      const region = page.getByRole('region', { name: 'GitHub repository', exact: true })
      await region.getByRole('textbox', { name: 'Repository (owner/name)' }).fill('app-learner/module-exercises')
      await region.getByRole('combobox', { name: 'Repository scope', exact: true }).selectOption({ label: 'QA Week 1' })
      await region.getByRole('button', { name: 'Save repository', exact: true }).click()
      const row = region.getByRole('listitem').filter({ hasText: 'QA Week 1' })
      await expect(row.getByText('Pending verification')).toBeVisible()
      await row.getByRole('button', { name: 'Verify repository', exact: true }).click()
      await expect(row.getByText('Verified', { exact: true })).toBeVisible()
      await page.reload()
      await expect(row.getByText('app-learner/module-exercises', { exact: true })).toBeVisible()
      const bindings = await saved(page)
      expect(bindings).toHaveLength(2)
      expect(bindings.find((binding: { curriculum_module_id: number | null }) => binding.curriculum_module_id === null).full_name).toBe('app-learner/prework-exercises')
    })

    test('G05 learner own profile verifies and instructor other learner get uniform 404', async ({ page }) => {
      await open(page, '/profile', 3)
      const region = page.getByRole('region', { name: 'QA Program · GitHub repository', exact: true })
      await expect(page.getByRole('textbox', { name: 'GitHub username', exact: true })).toBeDisabled()
      const impersonate = await page.request.patch('/api/v1/profile', { headers: headers(3), data: { github_username: 'victim-gh' } })
      expect(impersonate.status()).toBe(422)
      const row = region.getByRole('listitem').filter({ hasText: 'Enrollment default' })
      await row.getByRole('button', { name: 'Verify repository', exact: true }).click()
      await expect(row.getByText('Verified', { exact: true })).toBeVisible()
      expect((await saved(page, 3)).find((binding: { curriculum_module_id: number | null }) => binding.curriculum_module_id === null).repository_id).toBe(98765)
      for (const user of [2, 4]) {
        const response = await page.request.get('/api/v1/enrollments/1/github_repository_bindings', { headers: headers(user) })
        expect(response.status()).toBe(404)
        expect(await response.json()).toEqual({ error: 'Not found' })
        const setup = await page.request.post('/api/v1/cohorts/1/github_app_installations/prepare', { headers: headers(user) })
        expect(setup.status()).toBe(404)
      }
      await open(page, '/admin/cohorts/1/students/3/access', 2)
      await expect(page.getByRole('region', { name: 'GitHub repository', exact: true })).toHaveCount(0)
    })

    test('G06 Off cohort and learner have no connection or repository controls', async ({ page }, info) => {
      await open(page, '/admin/cohorts/2?tab=settings')
      await expect(page.getByRole('heading', { name: 'Cohort settings', exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: 'GitHub App connection', exact: true })).toHaveCount(0)
      const response = await page.request.get('/api/v1/cohorts/2/github_app_installations', { headers: headers() })
      expect(response.status()).toBe(404)
      await open(page, '/profile', 6)
      await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: /GitHub repository$/ })).toHaveCount(0)
      await evidence(page, 'off', info.project.name, theme)
    })
  })
}
