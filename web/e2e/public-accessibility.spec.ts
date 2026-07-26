import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const publicRoutes = [
  { path: '/', heading: /One clear path through class/i },
  { path: '/sign-in', heading: /Sign in to CSG Learning Platform/i },
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
    await expect(page.getByRole('heading', { name: route.heading })).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page)
  })
}

test('public navigation remains keyboard operable @accessibility', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /One clear path through class/i })).toBeVisible()
  await page.keyboard.press('Tab')

  await expect(page.getByRole('link', { name: 'CSG Learning home' })).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeFocused()
})
