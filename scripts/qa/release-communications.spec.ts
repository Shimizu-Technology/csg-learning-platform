import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { expect, test } from '../../web/node_modules/@playwright/test/index.mjs'

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} mode`, () => {
    test.use({ colorScheme: theme })

    test(`release communications panel works for admin and instructor in ${theme} mode`, async ({ page }, testInfo) => {
      const isMobile = testInfo.project.name.includes('390')
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await page.route('**/*', async (request) => {
        const url = new URL(request.request().url())
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return request.abort()
        return request.continue()
      })

      await page.addInitScript((mode) => {
        try {
          window.localStorage.setItem('csg-learn:theme', mode)
        } catch {
          // ignore
        }
      }, theme)

      // 1. Admin on QA Program (cohort 1) Communication tab
      await page.goto('/admin/cohorts/1?tab=communication&qa_user=1')
      const section = page.locator('section', { hasText: 'Release communications' }).first()
      await expect(section).toBeVisible({ timeout: 15_000 })
      await expect(section.getByText('Pacific/Guam (ChST)')).toBeVisible()
      await expect(section.getByText('Scheduled daily unlock')).toBeVisible()
      await expect(section.getByText('Grades and instructor feedback are published separately')).toBeVisible()
      await expect(section.getByText('Upcoming release preview')).toBeVisible()
      await expect(section.getByText('Recent delivery status')).toBeVisible()
      await expect(section.getByText('School-wide scheduler health')).toBeVisible()

      const visibleAttempted = section.locator(`${isMobile ? 'ul' : 'table'} >> text=Attempted (claim recorded)`).first()
      const visiblePending = section.locator(`${isMobile ? 'ul' : 'table'} >> text=Pending`).first()
      await expect(visibleAttempted).toBeVisible()
      await expect(visiblePending).toBeVisible()

      // Interactive sample email preview toggle + mobile >=44px touch targets on buttons, lesson/module RecordLinks, and sample links
      const previewButton = section.getByRole('button', { name: 'Preview sample email' })
      await expect(previewButton).toBeVisible()
      const refreshButton = section.getByRole('button', { name: 'Refresh status' })
      if (isMobile) {
        expect((await previewButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
        expect((await refreshButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
        const lessonLink = section.locator('a[data-record-link="lesson"]').first()
        const moduleLink = section.locator('a[data-record-link="module"]').first()
        expect((await lessonLink.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
        expect((await moduleLink.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
      }
      await previewButton.click()
      const samplePreview = section.getByLabel('Sample release email preview')
      await expect(samplePreview).toBeVisible()
      await expect(samplePreview.getByText('New content unlocked - Code School of Guam')).toBeVisible()
      await expect(samplePreview.getByText('Open Learn:')).toBeVisible()
      if (isMobile) {
        const sampleLessonLink = samplePreview.locator('a[data-record-link="lesson"]').first()
        expect((await sampleLessonLink.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
      }

      // Verify theme, zero horizontal overflow, and WCAG AA contrast inside Release Communications
      const metrics = await page.evaluate(() => {
        const root = document.documentElement
        const style = window.getComputedStyle(document.body)
        return {
          theme: root.dataset.theme,
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          bg: style.backgroundColor,
          color: style.color,
        }
      })
      expect(metrics.theme).toBe(theme)
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
      expect(metrics.bg).not.toBe(metrics.color)

      const axe = await new AxeBuilder({ page })
        .include('section[aria-labelledby^="release-communications-heading-"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(axe.violations).toEqual([])

      await section.getByRole('button', { name: 'Hide sample email' }).click()
      await expect(samplePreview).toBeHidden()

      // 2. Admin on QA Self paced (cohort 2) Communication tab -> skipped explanation
      await page.goto('/admin/cohorts/2?tab=communication')
      const selfPacedSection = page.locator('section', { hasText: 'Release communications' }).first()
      await expect(selfPacedSection).toBeVisible()
      await expect(selfPacedSection.getByText('Skipped for this cohort')).toBeVisible()
      await expect(selfPacedSection.getByText(/Self-paced cohorts open assigned lessons immediately/).first()).toBeVisible()
      const selfPacedOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )
      expect(selfPacedOverflow).toBe(true)

      // 3. Instructor on QA Program (cohort 1) Communication tab -> staff access works
      await page.goto('/admin/cohorts/1?tab=communication&qa_user=2')
      const instructorSection = page.locator('section', { hasText: 'Release communications' }).first()
      await expect(instructorSection).toBeVisible()
      await expect(instructorSection.getByText('Upcoming release preview')).toBeVisible()
      const instructorOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )
      expect(instructorOverflow).toBe(true)

      await page.waitForTimeout(300)
      expect(errors).toEqual([])
    })
  })
}
