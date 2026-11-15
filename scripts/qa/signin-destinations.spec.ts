import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync } from 'node:fs'

const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))

test('email DM destination survives synthetic sign-in; wrong role keeps the app shell', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  const headers = { Authorization: 'Bearer test_token_3' }
  const list = await request.get(`http://127.0.0.1:${state.api_port}/api/v1/direct_conversations`, { headers })
  expect(list.ok()).toBe(true)
  const conversation = (await list.json()).direct_conversations[0]
  const detail = await request.get(`http://127.0.0.1:${state.api_port}/api/v1/direct_conversations/${conversation.id}`, { headers })
  const message = (await detail.json()).messages[0]
  // Matches NotificationEmailService#message_path, plus an anchor to verify hash retention.
  const destination = `/messages/dm/${conversation.id}?message_id=${message.id}#message-${message.id}`
  await page.goto(destination)
  await expect(page.getByRole('button', { name: 'Sign in as synthetic student' })).toBeVisible()
  expect(new URLSearchParams(new URL(page.url()).search).get('redirect_url')).toBe(destination)
  await page.getByRole('button', { name: 'Sign in as synthetic student' }).click()
  await expect(page).toHaveURL(new RegExp(`${destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  await expect(page.locator(`#message-${message.id}`)).toHaveClass(/message-row-highlight/)
  await expect(page.locator(`#message-${message.id}`)).toBeInViewport()
  await expect(page.getByText('Switching conversation…')).toHaveCount(0)
  await page.screenshot({ path: `.qa-local/signin-dm-${test.info().project.name}.png` })
  await page.goto('/admin/team')
  await expect(page.getByRole('heading', { name: 'No access', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/team$/)
  await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `.qa-local/no-access-${test.info().project.name}.png` })
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  await page.goto('/admin/team')
  await page.getByRole('main').getByRole('link', { name: 'Go to Today', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  expect(errors).toEqual([])
})
