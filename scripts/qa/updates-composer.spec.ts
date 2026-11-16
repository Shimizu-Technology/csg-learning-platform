import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'

/*
 * W6 PR 6.4a (U-3.6): an instructor saves a draft, reopens and edits it,
 * posts it through the audience check, then edits it after posting. The
 * student sees one simple feed with the Edited marker and never the drafts;
 * Back from an update returns where the reader came from (L-1.5). Admin can
 * edit the instructor's update; the instructor can't edit the admin's.
 * Personas: 1 admin, 2 instructor, 3 program student. Synthetic data only.
 * Run: npx playwright test --config ../scripts/qa/playwright.config.ts updates-composer.spec.ts
 */

// Titles are unique per run, so a retained QA database never matches an earlier run's rows.
const RUN = Date.now().toString(36)
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
const OUT = new URL('../../.qa-local/updates/', import.meta.url).pathname
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: true })

for (const theme of ['light', 'dark'] as const) {
  test.describe.serial(`updates ${theme}`, () => {
    let posted = ''
    let privateDraft = ''

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
    })

    test('instructor drafts, edits, posts with confirmation, then edits after posting', async ({ page }, info) => {
      const tag = `${info.project.name} ${theme} ${RUN}`
      posted = `QA lab moves ${tag}`
      privateDraft = `QA private draft ${tag}`
      await page.goto('/announcements?scope=manage&qa_user=2')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const composer = page.getByRole('form', { name: 'Post an update' })

      // A second draft that stays a draft: nobody but its author and admins should see it.
      await composer.getByLabel('Title', { exact: true }).fill(privateDraft)
      await composer.getByLabel('Cohort for this update').selectOption({ label: 'QA Program' })
      await composer.getByRole('button', { name: 'Save draft' }).click()
      await expect(page).toHaveURL(/status=draft/)
      await expect(composer.getByLabel('Title', { exact: true })).toHaveValue('')
      await expect(page.getByRole('article').filter({ hasText: privateDraft })).toBeVisible()

      await composer.getByLabel('Title', { exact: true }).fill(posted)
      await composer.getByLabel('Cohort for this update').selectOption({ label: 'QA Program' })
      await composer.getByRole('textbox', { name: 'Update, rich text' }).click()
      await page.keyboard.type('Lab is in room 2 on Friday.')
      await composer.getByRole('button', { name: 'Save draft' }).click()
      const row = page.getByRole('article').filter({ hasText: posted })
      await expect(row.getByText('Draft', { exact: true })).toBeVisible()
      await expect(page.getByTestId('updates-context')).toHaveText(/\d+ drafts?/)
      await noSideScroll(page)
      await shot(page, `drafts-${info.project.name}-${theme}`)

      // Reopen and edit the draft, then post it. No cohort on the page, so the audience check runs.
      await row.getByRole('link', { name: 'Edit' }).click()
      const editor = page.getByRole('form', { name: 'Edit draft' })
      await expect(editor.getByLabel('Title', { exact: true })).toHaveValue(posted)
      await editor.getByRole('textbox', { name: 'Update, rich text' }).click()
      await page.keyboard.press('End')
      await page.keyboard.type(' Bring a laptop.')
      await editor.getByRole('button', { name: 'Post update' }).click()
      const confirm = page.getByRole('dialog', { name: 'Post to QA Program?' })
      await expect(confirm).toBeVisible()
      await shot(page, `confirm-${info.project.name}-${theme}`)
      await confirm.getByRole('button', { name: 'Post to QA Program', exact: true }).click()
      const detail = page.getByRole('region', { name: 'Update' })
      await expect(detail.getByText('Update posted.')).toBeVisible()
      await expect(detail.getByText('Draft', { exact: true })).toHaveCount(0)
      await expect(detail.getByText('Bring a laptop.')).toBeVisible()

      // Edit after posting: the audience is locked and nobody is notified again.
      await detail.getByRole('button', { name: 'Edit', exact: true }).click()
      const edit = page.getByRole('form', { name: 'Edit update' })
      await expect(edit.getByText(/can’t change after it’s posted/)).toBeVisible()
      await expect(edit.getByLabel('Audience')).toHaveCount(0)
      await expect(edit.getByText('Send push when posted')).toHaveCount(0)
      posted = `${posted} (room 3)`
      await edit.getByLabel('Title', { exact: true }).fill(posted)
      await edit.getByRole('button', { name: 'Save changes' }).click()
      await expect(detail.getByText(/nobody was notified again/)).toBeVisible()
      await expect(detail.getByTestId('edited-marker')).toBeVisible()
      await noSideScroll(page)
      await shot(page, `edited-${info.project.name}-${theme}`)

      // Back returns to the list the update was opened from.
      await detail.getByRole('link', { name: 'Back to Updates' }).first().click()
      await expect(page).toHaveURL(/\/announcements\?scope=manage.*status=draft/)

      // The admin's seeded update: the instructor can read it but has no Edit.
      // It is the seed's only announcement, so id 1 in a fresh QA database.
      await page.goto('/announcements/1?scope=manage&edit=1&qa_user=2')
      const seeded = page.getByRole('region', { name: 'Update' })
      await expect(seeded.getByRole('heading', { name: 'QA practice week' })).toBeVisible()
      await expect(seeded.getByRole('button', { name: /^Edit/ })).toHaveCount(0)
      await expect(page.getByRole('form')).toHaveCount(0)
    })

    test('student sees one simple feed with Edited, never drafts, and Back returns where they came from', async ({ page }, info) => {
      // Today lists unread updates, so it comes first. The update opens with "Back to Today" and keeps the cohort.
      await page.goto('/dashboard?qa_user=3')
      const today = page.getByRole('link', { name: posted })
      await expect(today).toHaveAttribute('href', /\/announcements\/\d+\?cohort_id=\d+&return_to=%2Fdashboard/)
      await noSideScroll(page)
      await shot(page, `student-today-${info.project.name}-${theme}`)
      await today.click()
      const back = page.getByRole('region', { name: 'Update' }).getByRole('link', { name: 'Back to Today' }).first()
      await expect(back).toBeVisible()
      await back.click()
      await expect(page).toHaveURL(/\/dashboard/)

      await page.goto('/announcements?qa_user=3')
      await expect(page.getByRole('heading', { name: 'Updates', level: 1 })).toBeVisible()
      const item = page.getByRole('article').filter({ hasText: posted })
      await expect(item).toBeVisible()
      await expect(item.getByTestId('edited-marker')).toBeVisible()
      await expect(page.getByText(privateDraft)).toHaveCount(0)
      await expect(page.locator('main select')).toHaveCount(0)
      for (const gone of ['Dashboard behavior', 'On Today', 'Newest published', 'Clear filters']) await expect(page.getByText(gone)).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Unread only' })).toBeVisible()
      await expect(page.getByTestId('updates-context')).toHaveText(/^(\d+ unread updates?|You’re all caught up)$/)
      await noSideScroll(page)
      await shot(page, `student-feed-${info.project.name}-${theme}`)

      await item.getByRole('link', { name: posted }).click()
      const detail = page.getByRole('region', { name: 'Update' })
      await expect(detail.getByTestId('edited-marker')).toBeVisible()
      await expect(detail.getByRole('button', { name: /^Edit/ })).toHaveCount(0)
      await detail.getByRole('link', { name: 'Back to Updates' }).first().click()
      await expect(page).toHaveURL(/\/announcements(\?|$)/)
      await expect(page.getByRole('region', { name: 'Update' })).toHaveCount(0)

      // The unread toggle filters and is undone the same way.
      await page.getByRole('button', { name: 'Unread only' }).click()
      await expect(page).toHaveURL(/read=unread/)
      await page.getByRole('button', { name: 'Unread only' }).click()
      await expect(page).not.toHaveURL(/read=unread/)

    })

    test('admin can edit the instructor’s update and sees every draft', async ({ page }) => {
      await page.goto('/announcements?scope=manage&status=draft&qa_user=1')
      await expect(page.getByRole('article').filter({ hasText: privateDraft })).toBeVisible()
      await page.goto('/announcements?scope=manage&qa_user=1')
      const row = page.getByRole('article').filter({ hasText: posted })
      await expect(row.getByRole('link', { name: 'Edit' })).toBeVisible()
    })
  })
}
