import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'
const session = process.env.DEV_LIFECYCLE_SESSION!
const ownedTabs = new Map<object, string>()
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const fixtures = JSON.parse(readFileSync(new URL('../../.qa-local/staff-reliability.json', import.meta.url), 'utf8'))
const API = `http://127.0.0.1:${state.api_port}/api/v1`
const headers = (id: number) => ({ Authorization: `Bearer test_token_${id}` })

test.beforeEach(async ({ page }, info) => {
  const tab = `staff-reliability-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', tab)
  ownedTabs.set(page, tab)
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.addInitScript(() => {
    for (const id of [1, 2, 3, 5]) localStorage.setItem(`csg-editor-preferences:${id}`, JSON.stringify({ mode: 'markdown', enterSends: true }))
  })
})

test.afterEach(async ({ page }) => {
  await page.close()
  const tab = ownedTabs.get(page)
  if (tab) checkedLifecycle(session, 'release', tab)
})

test('lesson instructions survive every exit question and a reload backup', async ({ page }, info) => {
  await page.goto('/admin/lessons/1?qa_user=1')
  await page.getByRole('link', { name: 'Edit lesson', exact: true }).click()
  const text = page.getByRole('textbox', { name: 'Text block 1, Markdown', exact: true })
  await text.fill(`Unsaved reliability ${info.project.name}`)
  const question = page.getByRole('dialog', { name: 'Leave without saving?' })
  await page.locator('header a[data-back-link]').click()
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Keep editing' }).click()
  await expect(text).toHaveValue(`Unsaved reliability ${info.project.name}`)
  await expect(question).toHaveCount(0)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  // Browser Back within the data router.
  await page.goBack()
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Keep editing' }).click()
  // A content record link has the same protection, including on phones.
  await page.locator('header nav a').first().evaluate((el: HTMLElement) => el.click())
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Keep editing' }).click()
  expect(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })).toBe(true)
  let closeAsked = false
  page.once('dialog', async dialog => { closeAsked = dialog.type() === 'beforeunload'; await dialog.dismiss() })
  await page.close({ runBeforeUnload: true })
  await expect.poll(() => closeAsked).toBe(true)
  expect(page.isClosed()).toBe(false)
  // Reload is a real browser unload; accept it, then explicitly restore the backup.
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await expect(page.getByRole('button', { name: /Restore/ }).first()).toBeVisible()
  await page.getByRole('button', { name: /Restore/ }).first().click()
  await expect(text).toHaveValue(`Unsaved reliability ${info.project.name}`)
  await page.screenshot({ path: `.qa-local/staff-reliability/lesson-${info.project.name}.png`, fullPage: true })
  // Address-bar lesson switching also unloads the editor and preserves a backup.
  page.once('dialog', dialog => dialog.accept())
  await page.goto('/admin/lessons/2/edit')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('QA Lab')
  await page.goto('/admin/lessons/1/edit')
  await page.getByRole('button', { name: /Restore/ }).first().click()
  await expect(text).toHaveValue(`Unsaved reliability ${info.project.name}`)
  await page.locator('header a[data-back-link]').click()
  await question.getByRole('button', { name: 'Discard', exact: true }).click()
})

test('manual-complete filename is honest on On and unchanged on Off', async ({ page }, info) => {
  for (const mode of ['on', 'off']) {
    const f = fixtures[mode]
    await page.goto(`/lessons/${f.lesson}?cohort_id=${f.cohort}&qa_user=3`)
    await expect(page.getByText('practice.rb', { exact: true })).toBeVisible()
    if (mode === 'on') {
      await expect(page.getByText('Exercise file:', { exact: false })).toBeVisible()
      await expect(page.getByText('Work in your own editor. Nothing to upload here.')).toBeVisible()
    } else {
      await expect(page.getByText('Exercise file:', { exact: false })).toHaveCount(0)
    }
    await expect(page.getByRole('button', { name: /Submit/ })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.qa-local/staff-reliability/manual-${mode}-${info.project.name}.png`, fullPage: true })
  }
})

test('paused learner retains the earlier lesson after module and cohort date edits', async ({ page, request }, info) => {
  const f = fixtures.on
  await page.goto(`/lessons/${f.lesson}?cohort_id=${f.cohort}&qa_user=5`)
  await expect(page.getByText('Practice locally', { exact: false }).first()).toBeVisible()
  const changed = await request.patch(`${API}/module_assignments/${f.paused_assignment}`, { headers: headers(1), data: { unlock_date_override: '2035-01-01' } })
  expect(changed.ok()).toBe(true)
  const moved = await request.patch(`${API}/cohorts/${f.cohort}`, { headers: headers(1), data: { start_date: '2035-01-01' } })
  expect(moved.ok()).toBe(true)
  await page.reload()
  await expect(page.getByText('Practice locally', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toHaveCount(0)
  await page.screenshot({ path: `.qa-local/staff-reliability/paused-${info.project.name}.png`, fullPage: true })
  await page.goto(`/lessons/${f.later}?cohort_id=${f.cohort}&qa_user=5`)
  await expect(page.getByText('Later reliability lesson', { exact: true })).toHaveCount(0)
  expect((await request.patch(`${API}/module_assignments/${f.paused_assignment}`, { headers: headers(1), data: { unlock_date_override: null } })).ok()).toBe(true)
  expect((await request.patch(`${API}/cohorts/${f.cohort}`, { headers: headers(1), data: { start_date: f.start_date } })).ok()).toBe(true)
})

test('resolving help retains inactivity in attention, staff home, student and cohort workspaces', async ({ page, request }, info) => {
  const created = await request.post(`${API}/help_requests`, { headers: headers(4), data: { cohort_id: 1, context_type: 'lesson', context_id: 1, context_label: 'QA Lab', context_path: '/lessons/1', category: 'concept', message: `Reliability help ${info.project.name}` } })
  expect(created.ok()).toBe(true)
  const id = (await created.json()).help_request.id
  await page.goto(`/admin/help-requests/${id}?qa_user=2`)
  await page.locator('textarea').first().fill('Try the smaller example first.')
  await page.getByRole('button', { name: 'Reply & resolve', exact: true }).click()
  const confirm = page.getByRole('dialog')
  if (await confirm.filter({ hasText: /resolve/i }).count()) await confirm.getByRole('button', { name: 'Reply & resolve', exact: true }).click()
  await expect(page.getByText(/Resolved/, { exact: false }).first()).toBeVisible()
  for (const path of ['/admin/support?cohort_id=1', '/admin/cohorts/1/students/4/overview', '/admin/cohorts/1']) {
    await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=2`)
    await expect(page.getByText(/Inactive|No learning activity|Not active/i).filter({ visible: true }).first()).toBeVisible()
  }
  const home = await request.get(`${API}/dashboard`, { headers: headers(2) })
  const row = (await home.json()).dashboard.attention.students.find((s: { user_id: number }) => s.user_id === 4)
  expect(row.reasons.map((r: { code: string }) => r.code)).toContain('inactivity')
  await page.screenshot({ path: `.qa-local/staff-reliability/help-${info.project.name}.png`, fullPage: true })
})

test('update Cancel warns on its query-string exit and preserves the saved draft', async ({ page, request }, info) => {
  const title = `Reliability saved update ${info.project.name}`
  const created = await request.post(`${API}/announcements`, { headers: headers(1), data: { title, body: 'Saved words.', audience: 'cohort', cohort_id: 1, status: 'draft' } })
  expect(created.ok()).toBe(true)
  const id = (await created.json()).announcement.id
  await page.goto(`/announcements/${id}?cohort_id=1&edit=1&qa_user=1`)
  const editor = page.getByRole('form', { name: 'Edit draft', exact: true })
  await editor.getByLabel('Title', { exact: true }).fill('Unsaved update title')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  const question = page.getByRole('dialog', { name: 'Leave without saving?' })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Keep editing' }).click()
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Unsaved update title')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await question.getByRole('button', { name: 'Discard changes and leave' }).click()
  await expect(editor).toHaveCount(0)
  const saved = await request.get(`${API}/announcements/${id}`, { headers: headers(1) })
  expect((await saved.json()).announcement.title).toBe(title)
})

test('plan Cancel keeps edits until an explicit discard', async ({ page }) => {
  await page.goto('/admin/cohorts/1/students/4/learning?qa_user=1')
  await page.getByRole('button', { name: 'Customize plan', exact: true }).click()
  await page.getByLabel('Plan title', { exact: true }).fill('Reliability personal plan')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const question = page.getByRole('dialog', { name: 'Leave without saving?' })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.getByLabel('Plan title', { exact: true })).toHaveValue('Reliability personal plan')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await question.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Customize plan', exact: true })).toBeVisible()
})

test('new rubric survives inspector close and tab changes and guards departure', async ({ page }, info) => {
  await page.goto('/admin/lessons/1/edit?qa_user=1')
  await page.getByRole('article', { name: 'Exercise block, 3 of 5', exact: true }).click()
  const phone = info.project.name.endsWith('390')
  if (phone) await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = phone ? page.getByRole('dialog', { name: 'Settings', exact: true }) : page.getByRole('complementary', { name: 'Settings', exact: true })
  await settings.getByText('New rubric', { exact: true }).click()
  await settings.getByPlaceholder('Ticket prices rubric').fill('Unfinished reliability rubric')
  await settings.getByRole('tab', { name: 'Lesson', exact: true }).click()
  await settings.getByRole('tab', { name: 'Exercise block', exact: true }).click()
  await settings.getByText('New rubric', { exact: true }).click()
  await expect(settings.getByPlaceholder('Ticket prices rubric')).toHaveValue('Unfinished reliability rubric')
  if (phone) {
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const details = settings.locator('details').filter({ hasText: 'New rubric' })
    if (await details.getAttribute('open') === null) await settings.getByText('New rubric', { exact: true }).click()
    await expect(settings.getByPlaceholder('Ticket prices rubric')).toHaveValue('Unfinished reliability rubric')
    await page.keyboard.press('Escape')
  }
  await page.locator('header a[data-back-link]').click()
  const question = page.getByRole('dialog', { name: 'Leave without saving?' })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Discard changes and leave' }).click()
})


test('a refused schedule tells its author in Notifications and Drafts', async ({ page, request }) => {
  const f = fixtures.refused
  await page.goto('/announcements?tab=inbox&qa_user=2')
  await expect(page.getByText(f.reason, { exact: true }).first()).toBeVisible()
  await page.goto('/announcements?scope=manage&status=draft&qa_user=2')
  const row = page.getByRole('article').filter({ hasText: 'QA refused scheduled update' }).first()
  await expect(row.getByText(f.reason, { exact: true })).toBeVisible()
  const student = await request.get(`${API}/announcements/${f.id}`, { headers: headers(3) })
  expect(student.status()).toBe(404)
})
