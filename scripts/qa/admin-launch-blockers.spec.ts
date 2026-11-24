import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { checkedLifecycle } from './ownership.mjs'

const harness = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8')) as { database: string }
const session = process.env.DEV_LIFECYCLE_SESSION

function fixtures() {
  const output = execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/admin-launch-blockers-fixtures.rb'], {
    cwd: new URL('../../api/', import.meta.url).pathname,
    env: { ...process.env, PARALLEL_WORKERS: '1', DATABASE_URL: `postgresql://localhost/${harness.database}` },
    encoding: 'utf8',
  })
  return JSON.parse(output) as { lessonId: number; blockId: number; cohortId: number }
}

async function noOverflow(page: Page, panel: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
}

async function touchTargets(controls: Locator[]) {
  for (const control of controls) {
    const bounds = await control.boundingBox()
    expect(bounds?.height).toBeGreaterThanOrEqual(44)
    expect(bounds?.width).toBeGreaterThanOrEqual(44)
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: exercise check rules and Stripe offer verification`, async ({ browser, baseURL, viewport }, info) => {
    test.setTimeout(90_000)
    const ids = fixtures()
    const mobile = (viewport?.width ?? 1280) < 1024
    const context = await browser.newContext({ baseURL, viewport, hasTouch: mobile })
    const page = await context.newPage()
    const tabId = `playwright:admin-launch-blockers:${process.pid}:${info.project.name}:${theme}`
    if (session) checkedLifecycle(session, 'claim', tabId)
    try {
      const errors: string[] = []
      let expectedStripeFailures = 0
      const verifyPath = `/api/v1/cohorts/${ids.cohortId}/verify_offering_price`
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        if (message.location().url.endsWith(verifyPath) && message.text().includes('422')) {
          expectedStripeFailures += 1
        } else {
          errors.push(message.text())
        }
      })
      await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)

      await test.step('open the exercise directly, create and update its rules, then turn them off', async () => {
        await page.goto(`/admin/lessons/${ids.lessonId}/edit?block_id=${ids.blockId}&qa_user=1`)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        if (mobile) await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 20_000 })
        const panel = page.getByRole('heading', { name: 'Checks used for grade suggestions' }).locator('..')
        await expect(panel.getByText(/No check rules yet/)).toBeVisible({ timeout: 20_000 })
        const checkName = panel.getByLabel('Required check names')
        const add = panel.getByRole('button', { name: 'Add', exact: true })
        const save = panel.getByRole('button', { name: 'Save check rules' })
        const advanced = panel.locator('summary', { hasText: 'Advanced' })
        const branch = panel.getByLabel('Default branch')
        await expect(branch).toBeHidden()
        await expect(save).toBeDisabled()
        await noOverflow(page, panel)
        if (mobile) await touchTargets([checkName, add, save, advanced])

        await checkName.fill('exercise-111')
        await add.click()
        await save.click()
        await expect(panel.getByRole('status')).toHaveText('Active · 1 required check · Version 1')
        if (mobile) await touchTargets([panel.getByRole('button', { name: 'Remove exercise-111' })])

        await advanced.click()
        const trustedApp = panel.getByLabel('Trusted check app')
        const workflow = panel.getByLabel('Required workflow file path')
        if (mobile) await touchTargets([branch, trustedApp, workflow])
        await branch.fill('main')
        await expect(trustedApp).toHaveValue('github-actions')
        await workflow.fill('.github/workflows/ruby.yml')
        await checkName.fill('exercise-111-review')
        await checkName.press('Enter')
        await save.click()
        await expect(panel.getByRole('status')).toHaveText('Active · 2 required checks · Version 2')
        await noOverflow(page, panel)
        await advanced.click()
        await panel.getByRole('status').scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath('saved-check-rules.png') })

        await page.reload()
        await expect(panel.getByRole('status')).toHaveText('Active · 2 required checks · Version 2')
        const turnOff = panel.getByRole('button', { name: 'Turn off check suggestions for this exercise' })
        if (mobile) await touchTargets([turnOff])
        await turnOff.click()
        const cancel = panel.getByRole('button', { name: 'Cancel' })
        const confirm = panel.getByRole('button', { name: 'Turn off suggestions', exact: true })
        if (mobile) await touchTargets([cancel, confirm])
        await cancel.click()
        await expect(panel.getByRole('status')).toContainText('Active')
        await turnOff.click()
        await confirm.click()
        await expect(panel.getByRole('status')).toContainText('No check rules yet')
        await page.reload()
        await expect(panel.getByRole('status')).toContainText('No check rules yet')
      })

      await test.step('recover from a Stripe mismatch, enable checkout after verification, and invalidate on edit', async () => {
        await page.goto(`/admin/cohorts/${ids.cohortId}?qa_user=1`)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await page.getByRole('button', { name: 'Readiness', exact: true }).click()
        await expect(page.getByText('Needed: Price verified in Stripe')).toBeVisible()
        const verifyLink = page.getByRole('link', { name: 'Verify the saved price in Course offering settings' })
        if (mobile) await touchTargets([verifyLink])
        await verifyLink.click()
        const panel = page.getByRole('region', { name: 'Course offering' })
        const checkout = panel.getByRole('checkbox', { name: 'Show checkout in the course catalog' })
        const stripeId = panel.getByLabel('Stripe price ID')
        const displayPrice = panel.getByLabel('Display price (USD)')
        const verify = panel.getByRole('button', { name: 'Verify price in Stripe' })
        const save = page.getByRole('button', { name: 'Save settings', exact: true })
        async function saveOffering() {
          const response = page.waitForResponse(result =>
            new URL(result.url()).pathname === `/api/v1/cohorts/${ids.cohortId}` && result.request().method() === 'PATCH')
          await save.click()
          const result = await response
          expect(result.ok()).toBe(true)
          return (await result.json()).cohort
        }
        await expect(verify).toBeEnabled({ timeout: 20_000 })
        await expect(checkout).toBeDisabled()
        await noOverflow(page, panel)
        if (mobile) await touchTargets([stripeId, displayPrice, verify, checkout.locator('..'), save])

        const mismatch = page.waitForResponse(response => response.url().endsWith(verifyPath))
        await verify.click()
        expect((await mismatch).status()).toBe(422)
        await expect(panel.getByRole('alert')).toHaveText('Stripe price is $499.00 USD, but display price is $399.00 USD.')
        await expect(checkout).toBeDisabled()

        await stripeId.fill('price_qa_ux2_399')
        await expect(verify).toBeDisabled()
        await expect(panel.getByText('Save settings to verify this price.')).toBeVisible()
        expect(await saveOffering()).toMatchObject({ stripe_price_id: 'price_qa_ux2_399' })
        await expect(verify).toBeEnabled({ timeout: 20_000 })
        await verify.click()
        await expect(panel.getByRole('status')).toHaveText('Verified in Stripe · $399.00 USD')
        await expect(checkout).toBeEnabled()
        await stripeId.scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath('verified-stripe-price.png') })
        await checkout.check()
        expect(await saveOffering()).toMatchObject({ public_checkout_enabled: true })
        await page.reload()
        await expect(checkout).toBeChecked()
        await expect(panel.getByRole('status')).toHaveText('Verified in Stripe · $399.00 USD')
        await displayPrice.fill('499.00')
        await expect(verify).toBeDisabled()
        expect(await saveOffering()).toMatchObject({ public_price_cents: 49_900, offering_price_verified: null })
        await expect(verify).toBeEnabled({ timeout: 20_000 })
        await expect(panel.getByText(/New checkout attempts are paused/)).toBeVisible()
        await noOverflow(page, panel)
      })

      expect(errors).toEqual([])
      expect(expectedStripeFailures).toBeLessThanOrEqual(1)
    } finally {
      await context.close()
      if (session) checkedLifecycle(session, 'release', tabId)
    }
  })
}
