import { readFileSync } from 'node:fs'
import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
const fixtures = JSON.parse(readFileSync(new URL('../../.qa-local/submission-audit-round2.json', import.meta.url), 'utf8'))
for (const [themeIndex, theme] of ['light', 'dark'].entries()) {
  test(`save companion with explicit completion decision: ${theme}`, async ({ page }, info) => {
    const fixture = fixtures[(info.project.name.endsWith('390') ? 2 : 0) + themeIndex]
    await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto('/admin/content/submission-audit?qa_user=1')
    const row = page.locator('article').filter({ has: page.getByRole('link', { name: `Deploy companion ${(info.project.name.endsWith('390') ? 2 : 0) + themeIndex}`, exact: true }) })
    await expect(row).toContainText('1 learner finished this lesson. Adding an exercise reopens it for them until they submit.')
    await row.getByRole('link', { name: 'Add a companion exercise', exact: true }).click()
    if (info.project.name.endsWith('390')) await page.getByRole('button', { name: 'Close Settings', exact: true }).click()
    let puts = 0
    page.on('request', (request) => { if (request.method() === 'PUT' && request.url().endsWith('/block_editor')) puts++ })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const warning = page.getByRole('dialog', { name: 'Reopen finished lessons?' })
    await expect(warning).toContainText('1 learner finished this lesson')
    await expect(warning).toContainText('QA Program')
    await warning.getByRole('button', { name: 'Keep editing' }).click()
    expect(puts).toBe(0)
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/block_editor'))
    await page.getByRole('button', { name: 'Add work and reopen' }).click()
    const response = await saved
    expect(response.status()).toBe(200)
    expect(response.request().postDataJSON().lesson.confirm_reopen_completed_count).toBe(1)
    const result = await response.json()
    expect(result.lesson.content_blocks).toHaveLength(2)
    expect(result.lesson.content_blocks[0].block_type).toBe('text')
    expect(result.lesson.content_blocks[1].block_type).toBe('exercise')
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await page.goto(`/lessons/${fixture.lesson_id}?cohort_id=${fixture.cohort_id}&qa_user=3`)
    await expect(page.getByText('Write your solution', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
