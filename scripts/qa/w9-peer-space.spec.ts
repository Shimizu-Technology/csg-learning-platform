import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { checkedLifecycle } from './ownership.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { mkdirSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')

const owners = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const id = `w9-peer-space-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', id)
  owners.set(page, id)
})
test.afterEach(async ({ page }) => {
  await page.close()
  const id = owners.get(page)
  if (id) checkedLifecycle(session, 'release', id)
  owners.delete(page)
})

const output = fileURLToPath(new URL('../../.qa-local/w9-peer-space/', import.meta.url))
const headers = (user = 1) => ({ Authorization: `Bearer test_token_${user}` })

async function open(page: Page, path: string, user = 1) {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function evidence(page: Page, name: string, project: string, theme: string, axeSelector?: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  if (axeSelector && await page.locator(axeSelector).count()) {
    const violations = await new AxeBuilder({ page }).include(axeSelector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(violations.violations.filter(item => ['serious', 'critical'].includes(item.impact || ''))).toEqual([])
  }
  mkdirSync(output, { recursive: true })
  await page.screenshot({ path: `${output}${project}-${theme}-${name}.png` })
  appendFileSync(`${output}ledger.jsonl`, JSON.stringify({ name, project, theme, overflow, url: page.url() }) + '\n')
}

async function resetPeerSpace(page: Page, cohortId: number) {
  await page.request.patch('/api/v1/feature_settings', {
    headers: headers(1),
    data: { features: { self_paced_peer_space: false } },
  })
  await page.request.patch(`/api/v1/cohorts/${cohortId}/feature_settings`, {
    headers: headers(1),
    data: { features: { self_paced_peer_space: null } },
  })
}

test.describe.configure({ mode: 'serial' })

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(choice => localStorage.setItem('csg-learn:theme', choice), theme)
    })

    test('PS01 off self-paced hides channel, admin enables school+cohort opt-in, learner sees and posts while classmate DMs stay blocked', async ({ page }, info) => {
      const consoleErrors: string[] = []
      page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

      // Discover seeded self-paced cohort id via admin API
      const cohortsRes = await page.request.get('/api/v1/cohorts/accessible', { headers: headers(6) })
      expect(cohortsRes.status()).toBe(200)
      const selfPacedCohort = (await cohortsRes.json()).cohorts[0]
      const cohortId: number = selfPacedCohort.id
      const workspaceId: number = selfPacedCohort.workspace_id

      await resetPeerSpace(page, cohortId)

      // 1. Default OFF: self-paced learner sees no channels in Messages
      const offChannels = await page.request.get('/api/v1/channels', { headers: headers(6) })
      expect(offChannels.status()).toBe(200)
      expect((await offChannels.json()).channels).toEqual([])

      await open(page, `/messages?workspace_id=${workspaceId}`, 6)
      await expect(page.getByText('No conversations yet.')).toBeVisible()
      await expect(page.getByText('Class Chat')).toHaveCount(0)
      await evidence(page, 'off-messages', info.project.name, theme, 'main')

      // 2. Admin enables school-level switch on /profile
      await open(page, '/profile', 1)
      const schoolSection = page.getByRole('region', { name: 'School features', exact: true })
      const schoolSelect = schoolSection.getByLabel(/Course community \(self-paced\)/)
      await expect(schoolSelect).toBeVisible()
      await expect(schoolSection.getByText('Lets self-paced learners talk in class chat. Recommended when 5 or more learners are enrolled.')).toBeVisible()
      await schoolSelect.selectOption('on')
      await schoolSection.getByRole('button', { name: 'Save features', exact: true }).click()
      await expect(schoolSection.getByRole('status')).toContainText('Features saved')

      // Still OFF for cohort until cohort explicitly opts in (Inherit -> Off)
      const stillOffChannels = await page.request.get('/api/v1/channels', { headers: headers(6) })
      expect((await stillOffChannels.json()).channels).toEqual([])

      // 3. Admin explicitly opts cohort IN on /admin/cohorts/:id?tab=settings
      await open(page, `/admin/cohorts/${cohortId}?tab=settings`, 1)
      const cohortSection = page.getByRole('region', { name: 'Cohort features', exact: true })
      const cohortSelect = cohortSection.getByLabel(/Course community \(self-paced\)/)
      await expect(cohortSelect).toHaveValue('inherit')
      await expect(cohortSelect.locator('option[value="inherit"]')).toHaveText('Inherit → Off')
      await cohortSelect.selectOption('on')
      await page.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect.poll(async () => {
        const res = await page.request.get('/api/v1/channels', { headers: headers(6) })
        return (await res.json()).channels.length
      }).toBe(1)
      await evidence(page, 'admin-cohort-settings', info.project.name, theme, 'section[aria-label="Cohort features"]')

      // 4. Self-paced learner now sees Class Chat in Messages, can read & post, and classmate DMs stay blocked
      const onChannelsRes = await page.request.get('/api/v1/channels', { headers: headers(6) })
      expect(onChannelsRes.status()).toBe(200)
      const onChannels = (await onChannelsRes.json()).channels
      expect(onChannels).toHaveLength(1)
      expect(onChannels[0].name).toBe('Class Chat')
      expect(onChannels[0].can_post).toBe(true)

      // Classmate DM stays blocked; only instructor is available
      const availRes = await page.request.get(`/api/v1/direct_conversations/available_users?workspace_id=${workspaceId}`, { headers: headers(6) })
      expect(availRes.status()).toBe(200)
      const availUsers = (await availRes.json()).users
      expect(availUsers.map((u: { id: number }) => u.id)).toEqual([2])

      await open(page, `/messages?workspace_id=${workspaceId}`, 6)
      await expect(page.getByRole('link', { name: /Class Chat/ }).first()).toBeVisible()
      await page.getByRole('link', { name: /Class Chat/ }).first().click()
      await expect(page.getByText('Welcome to the self-paced course community!')).toBeVisible()

      const uniqueBody = `Peer space hello (${info.project.name} ${theme})`
      const composer = page.getByRole('textbox', { name: /Message #Class Chat/ }).first()
      await expect(composer).toBeVisible()
      await composer.click()
      await page.keyboard.type(uniqueBody)
      const postPromise = page.waitForResponse(res => res.url().includes('/messages') && res.request().method() === 'POST' && res.status() === 201)
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      await postPromise
      await expect(page.getByText(uniqueBody, { exact: true })).toBeVisible()

      // Reload confirms persistence and captures settled screenshot/axe without optimistic-send fade
      await page.reload()
      await expect(page.getByText(uniqueBody, { exact: true })).toBeVisible()
      await page.waitForTimeout(250)
      await evidence(page, 'on-channel-posted', info.project.name, theme, 'main')

      expect(consoleErrors).toEqual([])
      // Cleanup switch back to default Off
      await resetPeerSpace(page, cohortId)
    })
  })
}
