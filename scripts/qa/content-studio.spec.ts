import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'

for (const user of [1, 2]) for (const theme of ['light', 'dark']) {
  test(`content library admin=${user === 1} ${theme}`, async ({ page }, info) => {
    await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
    const details = new Set<string>()
    page.on('request', r => { if (/\/api\/v1\/curricula\/\d+$/.test(r.url())) details.add(r.url()) })
    await page.goto(`/admin/content?qa_user=${user}`)
    const rail = page.getByRole('navigation', { name: 'Curricula', exact: true })
    const outline = page.getByRole('region', { name: 'Curriculum outline', exact: true })
    await expect(rail.getByRole('button', { name: /QA Program Lab/ })).toBeVisible()
    await expect.poll(() => details.size).toBe(1)
    await rail.getByRole('button', { name: /QA Program Lab/ }).click()
    await expect(outline.getByRole('heading', { name: 'QA Program Lab', exact: true })).toBeFocused()
    await expect(outline.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-pressed', 'true')
    if (info.project.name.endsWith('390')) await expect(rail).toBeHidden()
    await outline.getByRole('button', { name: /^QA Week 1/ }).click()
    const preview = outline.getByRole('link', { name: 'Preview QA Lab 1.1.1 as a student', exact: true })
    await expect(preview).toHaveAttribute('href', /preview=true/)
    const before = new URL(page.url()).searchParams.get('open')
    await preview.click()
    await expect(page.getByRole('heading', { name: 'QA Lab 1.1.1', exact: true }).first()).toBeVisible()
    await page.goBack()
    await expect(preview).toBeVisible()
    expect(new URL(page.url()).searchParams.get('open')).toBe(before)
    await outline.getByRole('button', { name: 'Sequence', exact: true }).click()
    await expect(outline.getByRole('region', { name: 'Lesson sequence' }).first()).toBeVisible()
    await outline.getByRole('searchbox', { name: 'Search modules and lessons' }).fill('QA Lab 1.1.1')
    await expect(outline.getByRole('link', { name: 'QA Lab 1.1.1', exact: true }).first()).toBeVisible()
    await expect(outline.getByRole('link', { name: 'QA Lab 1.1.2', exact: true })).toHaveCount(0)
    await outline.getByRole('searchbox', { name: 'Search modules and lessons' }).fill('')
    if (user === 1) {
      await outline.getByLabel('Schedule pattern for QA Week 1').selectOption('daily')
      await expect(page.getByRole('dialog', { name: 'Change schedule?' })).toBeVisible()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(outline.getByLabel('Schedule pattern for QA Week 1')).toHaveValue('weekdays')
      await expect(outline.getByRole('link', { name: 'Edit QA Lab 1.1.1', exact: true })).toBeVisible()
    } else {
      await expect(outline.getByLabel('Schedule pattern for QA Week 1')).toHaveCount(0)
      await expect(outline.getByRole('link', { name: /^Edit / })).toHaveCount(0)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
    await page.screenshot({ path: `.qa-local/content-${user}-${theme}-${info.project.name}.png`, fullPage: true })
    if (info.project.name.endsWith('390')) await outline.getByRole('button', { name: 'Back to curricula' }).click()
    await rail.getByLabel('Used by cohort').selectOption({ label: 'QA Self paced' })
    await expect(rail.getByRole('button', { name: /QA Program Lab/ })).toHaveCount(0)
    await rail.getByRole('button', { name: /QA Self paced Lab/ }).click()
    // Reset explicit Calendar/Sequence choice, then verify delivery-based default on a fresh URL.
    await page.goto(`/admin/content?qa_user=${user}&curriculum=2&pane=detail`)
    await expect(outline.getByRole('button', { name: 'Sequence', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await outline.getByRole('button', { name: 'Learner files', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Learner ZIP files' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
  })
}

test('creation jumps to curriculum, module and exercise editor', async ({ page }, info) => {
  await page.goto('/admin/content?qa_user=1')
  await page.getByRole('button', { name: 'New curriculum', exact: true }).click()
  const name = `QA Studio ${info.project.name} ${Date.now()}`
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Create curriculum', exact: true }).click()
  const outline = page.getByRole('region', { name: 'Curriculum outline', exact: true })
  await expect(outline.getByRole('heading', { name, exact: true })).toBeFocused()
  await outline.getByRole('button', { name: 'New module', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('QA New module')
  await page.getByRole('button', { name: 'Create module', exact: true }).click()
  await expect(outline.getByRole('button', { name: /^QA New module/ })).toHaveAttribute('aria-expanded', 'true')
  await outline.getByRole('button', { name: 'Exercise', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('QA New exercise')
  await page.getByRole('dialog').getByPlaceholder('https://youtube.com/watch?v=...').fill('https://example.invalid/synthetic-video')
  await page.getByRole('button', { name: 'Create exercise', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/lessons\/\d+\/edit/)
  await expect(page.getByRole('heading', { name: 'QA New exercise', exact: true })).toBeVisible()
})

test('import selects the saved draft and filters retain their URL state', async ({ page }, info) => {
  await page.goto('/admin/content?qa_user=1&status=active&q=Program')
  await page.getByRole('button', { name: 'Import course package', exact: true }).click()
  const name = `QA Imported ${info.project.name}`
  const data = { schema_version: 1, key: `studio-${info.project.name}`, revision: '1', title: name, total_weeks: 1,
    modules: [{ key: 'core', title: 'QA Imported module', schedule_days: 'daily', total_days: 7, lessons: [
      { key: 'first', title: 'QA Imported lesson', lesson_type: 'exercise', release_day: 0, required: true,
        blocks: [{ key: 'body', block_type: 'text', body: 'Synthetic practice only.', submission_type: 'manual_complete' }] }
    ] }] }
  await page.getByLabel('Course package file (.json)').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) })
  await page.getByRole('button', { name: 'Import draft', exact: true }).click()
  const outline = page.getByRole('region', { name: 'Curriculum outline', exact: true })
  await expect(outline.getByRole('heading', { name, exact: true })).toBeFocused()
  expect(new URL(page.url()).searchParams.has('status')).toBe(false)
  expect(new URL(page.url()).searchParams.has('q')).toBe(false)
  await page.reload()
  await expect(outline.getByRole('heading', { name, exact: true })).toBeVisible()
})
