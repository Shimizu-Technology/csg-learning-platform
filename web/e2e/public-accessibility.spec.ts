import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const publicRoutes = [
  { path: '/', heading: /Your course, your questions, and your progress/i },
  { path: '/sign-in', heading: /Sign in and pick up where you left off/i },
  { path: '/sign-up', heading: /Create your account/i },
  { path: '/terms', heading: /Terms and Community Guidelines/i },
]

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  const seriousViolations = results.violations.filter(
    ({ impact }) => impact === 'serious' || impact === 'critical',
  )

  expect(
    seriousViolations,
    seriousViolations
      .map(({ id, help, nodes }) => `${id}: ${help} (${nodes.length} node${nodes.length === 1 ? '' : 's'})`)
      .join('\n'),
  ).toEqual([])
}

for (const route of publicRoutes) {
  test(`${route.path} has no serious WCAG violations @accessibility`, async ({ page }) => {
    await page.goto(route.path)
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page)
  })
}

test('public navigation remains keyboard operable @accessibility', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: publicRoutes[0].heading })).toBeVisible()

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'CSG Learn home' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeFocused()
})

test('the landing makes the invitation path obvious and never scrolls sideways', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'I have an invitation' }).first()).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0)
    const header = page.locator('header').first()
    expect((await header.boundingBox())!.height, `header wraps at ${width}px`).toBeLessThanOrEqual(80)
  }
})

test('Clerk invitation links open the sign-up page with the ticket', async ({ page }) => {
  await page.goto('/?__clerk_ticket=example_ticket&__clerk_status=sign_up')
  await expect(page).toHaveURL(/\/sign-up\?__clerk_ticket=example_ticket/)
  await expect(page.getByRole('heading', { level: 1, name: /Accept your invitation/i })).toBeVisible()
})

test('the signed-out landing does not download analytics or markdown', async ({ page }) => {
  const scripts: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname)
  })
  await page.goto('/', { waitUntil: 'networkidle' })
  expect(scripts.filter((path) => /vendor-(analytics|markdown)/.test(path))).toEqual([])
  await expect(page.locator('html')).toHaveAttribute('data-surface', 'public')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#faf7f0')
})
