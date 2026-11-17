import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { appendFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

for (const theme of ['light', 'dark']) test(`clone authoring flows ${theme}`, async ({ page }, info) => {
  const session = process.env.DEV_LIFECYCLE_SESSION!
  const id = `authoring-clone-${info.project.name}-${theme}`
  checkedLifecycle(session, 'claim', id)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' || new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort())
  try {
    await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
    const label = `${info.project.name} ${theme} ${Date.now()}`
    await page.goto('/admin/content?qa_user=1&curriculum=1&pane=detail')
    const outline = page.getByRole('region', { name: 'Curriculum outline', exact: true })
    await outline.getByRole('button', { name: 'Clone curriculum', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Clone curriculum', exact: true })
    await dialog.getByLabel('New name').fill(`QA Curriculum ${label}`)
    const createdCurriculum = page.waitForResponse(r => /\/api\/v1\/curricula\/1\/clone$/.test(r.url()) && r.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Clone curriculum', exact: true }).click()
    const curriculumId = (await (await createdCurriculum).json()).clone.id
    dialog = page.getByRole('dialog', { name: 'Curriculum cloned', exact: true })
    await expect(dialog).toContainText('Draft, with no cohort assignments.')
    const contentLoaded = page.waitForResponse(r => r.url().endsWith(`/api/v1/curricula/${curriculumId}`) && r.request().method() === 'GET')
    await dialog.getByRole('button', { name: 'Open curriculum', exact: true }).click()
    const content = (await (await contentLoaded).json()).curriculum
    const draftModuleId = content.modules[0].id
    await expect(outline.getByRole('heading', { name: `QA Curriculum ${label}`, exact: true })).toBeFocused()
    await expect(outline).toContainText('Draft')
    await outline.getByRole('button', { name: 'Clone module', exact: true }).first().click()
    dialog = page.getByRole('dialog', { name: 'Clone module', exact: true })
    await dialog.getByLabel('New name').fill(`QA Module ${label}`)
    await dialog.getByLabel('Destination curriculum').selectOption('2')
    await dialog.getByLabel('Position (0 is first)').fill('1')
    await dialog.getByRole('button', { name: 'Clone module', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Module cloned', exact: true })
    await expect(dialog).toContainText('Lessons are archived')
    await dialog.getByRole('button', { name: 'Open module', exact: true }).click()
    await expect(outline.getByRole('heading', { name: 'QA Self paced Lab', exact: true })).toBeFocused()
    await expect(outline.getByRole('button', { name: new RegExp(`^QA Module ${label}`) })).toHaveAttribute('aria-expanded', 'true')
    expect(new URL(page.url()).searchParams.get('curriculum')).toBe('2')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
    await page.goto('/admin/cohorts?qa_user=1')
    await page.getByRole('button', { name: 'Clone QA Program', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Clone cohort', exact: true })
    await dialog.getByLabel('New name').fill(`QA Cohort ${label}`)
    await dialog.getByLabel('New start date').fill('2027-03-31')
    // Exercise both curriculum choices over the four dimensions.
    await dialog.getByLabel('Curriculum', { exact: true }).selectOption(theme === 'dark' ? 'clone' : 'same')
    const created = page.waitForResponse(r => /\/cohorts\/1\/clone$/.test(r.url()) && r.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Clone cohort', exact: true }).click()
    const response = await created
    expect(response.status()).toBe(201)
    const copy = (await response.json()).clone
    dialog = page.getByRole('dialog', { name: 'Cohort cloned', exact: true })
    await expect(dialog).toContainText('Upcoming, with 0 learners and checkout off.')
    await expect(dialog.getByRole('listitem').filter({ hasText: 'Recordings' })).toContainText('Inherit → Off')
    await expect(dialog.getByRole('listitem').filter({ hasText: 'Help requests' })).toContainText('Off (explicit)')
    await expect(dialog.getByRole('listitem').filter({ hasText: 'Office hours' })).toContainText('On (explicit)')
    expect(copy.features.recordings).toBe(false)
    expect(copy.feature_overrides.recordings).toBe(null)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
    await page.screenshot({ path: `.qa-local/clone-${label.replaceAll(' ', '-')}.png`, fullPage: true })
    await dialog.getByRole('button', { name: 'Open cohort', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${copy.id}`))
    await expect(page.getByRole('heading', { name: `QA Cohort ${label}`, exact: true }).first()).toBeVisible()
    await expect(page.getByText('Upcoming', { exact: true }).first()).toBeVisible()
    // Real student navigation, then an attempted direct URL to cloned content.
    await page.goto('/materials?qa_user=3')
    await expect(page.getByRole('main')).not.toContainText(`QA Curriculum ${label}`)
    await page.goto(`/modules/${draftModuleId}?qa_user=3`)
    await expect(page).toHaveURL(/\/materials/)
    await expect(page.getByRole('main')).not.toContainText(`QA Curriculum ${label}`)
    expect(errors).toEqual([])
    appendFileSync('.qa-local/authoring-clone-results.jsonl', JSON.stringify({ label, curriculumId: content.id, draftModuleId, cohortId: copy.id, cloneCurriculum: theme === 'dark' }) + '\n')
  } finally {
    await page.close()
    checkedLifecycle(session, 'release', id)
  }
})
