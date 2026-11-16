import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync } from 'node:fs'

const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))

// "Make a copy for this cohort" (W5 PR 5.3 part 2b). Needs `scripts/qa/copy-fixtures.rb setup`
// (QA Program 2 shares QA Program Lab; the QA instructor can edit QA Program). Run in three
// passes, since the copy happens once:
//   QA_SPEC=copy-for-cohort.spec.ts npx playwright test --config ../scripts/qa/playwright.config.ts --grep "before the copy"
//   … --grep "makes the copy" --project chromium-1280
//   … --grep "after the copy"
// then `copy-fixtures.rb verify` compares every learner's progress with the setup snapshot.

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
const shot = (page: Page, name: string, project: string, theme: string) => page.screenshot({ path: `.qa-local/copy-${name}-${theme}-${project}.png`, fullPage: true })

for (const theme of ['light', 'dark']) {
  test(`before the copy: the instructor sees read only with the copy action and its dry run (${theme})`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto('/admin/lessons/1/edit?qa_user=2')
    await expect(page.getByText('Read only: QA Program 2 shares this curriculum.')).toBeVisible()
    await expect(page.getByText('Make a copy for QA Program to change this lesson without affecting QA Program 2.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0)
    await noOverflow(page)
    await shot(page, 'read-only', info.project.name, theme)
    await page.getByRole('button', { name: 'Make a copy for QA Program', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Make a copy for QA Program?' })
    await expect(dialog.getByText('QA Program switches to its own copy of QA Program Lab (18 lessons).')).toBeVisible()
    await expect(dialog.getByText('QA Program 2 keeps the shared version.')).toBeVisible()
    await expect(dialog.getByTestId('copy-counts')).toContainText('submissions')
    await noOverflow(page)
    await page.waitForTimeout(400) // let the open animation finish before the screenshot
    await shot(page, 'dialog', info.project.name, theme)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()

    // Content shows the same action next to "Read only: shared with other cohorts".
    await page.goto('/admin/content?qa_user=2&curriculum=1&pane=detail')
    const outline = page.getByRole('region', { name: 'Curriculum outline', exact: true })
    await expect(outline.getByText('Read only: shared with other cohorts')).toBeVisible()
    await expect(outline.getByRole('button', { name: 'Make a copy for QA Program', exact: true })).toBeVisible()
    await noOverflow(page)
    await shot(page, 'content-before', info.project.name, theme)
  })
}

test('makes the copy as the granted instructor, then edits the copy', async ({ page }, info) => {
  await page.goto('/admin/lessons/1/edit?qa_user=2')
  await page.getByRole('button', { name: 'Make a copy for QA Program', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Make a copy for QA Program?' })
  await dialog.getByRole('button', { name: 'Make a copy', exact: true }).click()
  // The editor reopens the same lesson in the cohort's copy (a new id).
  await expect(page).not.toHaveURL(/\/admin\/lessons\/1\/edit/)
  await expect(page).toHaveURL(/\/admin\/lessons\/\d+\/edit/)
  await expect(page.getByText("You're editing QA Program's copy.")).toBeVisible()
  await expect(page.getByText('Other cohorts keep the shared QA Program Lab.')).toBeVisible()
  // The first Title field is the video block's.
  const title = page.getByLabel('Title', { exact: true }).first()
  await title.fill('QA Program video')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/^Saved/)).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Title', { exact: true }).first()).toHaveValue('QA Program video')
  await shot(page, 'editing-copy', info.project.name, 'light')
})

for (const theme of ['light', 'dark']) {
  test(`after the copy: learners keep their work, old links open the copy, the other cohort is unchanged (${theme})`, async ({ page, request }, info) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    // The instructor's editor on the copy, and Content naming the cohort's copy.
    await page.goto('/admin/content?qa_user=2')
    const rail = page.getByRole('navigation', { name: 'Curricula', exact: true })
    if (info.project.name.endsWith('390')) await expect(rail.getByRole('button', { name: /QA Program Lab \(QA Program\)/ })).toBeVisible()
    await rail.getByRole('button', { name: /QA Program Lab \(QA Program\)/ }).click()
    const outline = page.getByRole('region', { name: 'Curriculum outline', exact: true })
    await expect(outline.getByText("QA Program's copy")).toBeVisible()
    await expect(outline.getByText('You can edit')).toBeVisible()
    await noOverflow(page)
    await shot(page, 'content-after', info.project.name, theme)

    // The program student follows an old lesson link: same work, on the copy.
    await page.goto('/lessons/1?cohort_id=1&qa_user=3')
    await expect(page).not.toHaveURL(/\/lessons\/1\?/)
    await expect(page).toHaveURL(/\/lessons\/\d+\?cohort_id=1/)
    await expect(page.getByRole('heading', { name: 'QA Lab 1.1.1', exact: true }).first()).toBeVisible()
    await expect(page.getByText('QA Program video').first()).toBeVisible()
    await expect(page.getByText('Synthetic counter explanation 0').first()).toBeVisible()
    await noOverflow(page)
    await shot(page, 'learner-lesson', info.project.name, theme)
    await page.goto('/dashboard?qa_user=3')
    await expect(page.getByRole('main')).toBeVisible()
    await shot(page, 'learner-today', info.project.name, theme)

    // QA Program 2's learner (no browser persona; their API token) still has the shared lesson, unchanged.
    const other = await request.get(`http://127.0.0.1:${state.api_port}/api/v1/lessons/1`, { headers: { Authorization: 'Bearer test_token_9' } })
    expect(other.ok()).toBe(true)
    const lesson = (await other.json()).lesson
    expect([lesson.id, lesson.title, lesson.moved_from]).toEqual([1, 'QA Lab 1.1.1', undefined])
    expect(JSON.stringify(lesson.content_blocks)).toContain('Other cohort synthetic answer')
    expect(JSON.stringify(lesson.content_blocks)).not.toContain('QA Program video')
  })
}
