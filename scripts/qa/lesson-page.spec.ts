import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { checkedLifecycle } from './ownership.mjs'
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('Set DEV_LIFECYCLE_SESSION')
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/lesson-page.json', import.meta.url), 'utf8'))
const shots = new URL('../../docs/qa/lesson-page-2026-11-17/', import.meta.url)
mkdirSync(shots, { recursive: true })
const ownership = new Map<object, string>()
test.setTimeout(90_000)
test.beforeEach(async ({ page }, info) => {
  const tab = `lesson-${info.project.name}-${info.title}`.replace(/[^a-z0-9-]/gi, '-').slice(0, 120)
  checkedLifecycle(session, 'claim', tab); ownership.set(page, tab)
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname
    return ['127.0.0.1', 'localhost', 'cdn.jsdelivr.net'].includes(host) ? route.continue() : route.abort()
  })
})
test.afterEach(async ({ page }) => { await page.close(); checkedLifecycle(session, 'release', ownership.get(page)!); ownership.delete(page) })
async function open(page: Page, id: number, cohort = ids.cohort, user = 3) {
  await page.goto(`/lessons/${id}?cohort_id=${cohort}&qa_user=${user}`)
  await expect(page.locator('main h1').first()).toBeVisible()
}
async function capture(page: Page, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: new URL(`${name}-${page.viewportSize()!.width}.jpg`, shots).pathname, fullPage: true, quality: 70 })
}
async function payload(page: Page, id: number) {
  const response = await page.request.get(`/api/v1/lessons/${id}?cohort_id=${ids.cohort}`, { headers: { Authorization: 'Bearer test_token_3' } })
  expect(response.ok()).toBe(true)
  return (await response.json()).lesson
}
async function fillCode(page: Page, value: string) {
  // Chromium may switch its pointer capability after simulated keyboard input.
  // Exercise the active editor, while the first answer explicitly proves the
  // coarse-pointer textarea path and the desktop cases prove Monaco itself.
  const textarea = page.getByRole('textbox', { name: 'Your code', exact: true })
  if (await textarea.count()) { await textarea.fill(value); return }
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 40_000 })
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(value)
}
function reset() {
  execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/lesson-page-fixtures.rb', 'reset'], { cwd: new URL('../../api/', import.meta.url), env: { ...process.env, DATABASE_URL: `postgresql://localhost/${state.database}` } })
}

test.describe('touch source entry and complete lesson journey', () => {
  test.use({ isMobile: true, hasTouch: true })
  for (const theme of ['light', 'dark']) test(`On ${theme}: read, submit, redo, complete, next module, course complete and help`, async ({ page }) => {
    reset()
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await open(page, ids.reading)
    await expect(page.getByTestId('lesson-experience')).toBeVisible()
    await expect(page.getByText('Week 1 · Lesson 1 of 6')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ask for help', exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: 'Outline', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: 'Course outline' }).getByRole('link', { name: 'Read Python without wrapping' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: 'Close Course outline' }).tap()
    const code = page.locator('.code-block pre').first()
    expect(await code.evaluate(node => getComputedStyle(node).whiteSpace)).toBe('pre')
    expect(await code.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
    await capture(page, `${theme}-reading`)
    await page.getByRole('button', { name: 'Mark complete', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toHaveCount(0)
    await expect.poll(async () => (await payload(page, ids.reading)).learner_status).toBe('done')
    await open(page, ids.video)
    await expect(page.getByRole('link', { name: 'Open video' })).toBeVisible()
    await capture(page, `${theme}-video`)
    await open(page, ids.exercise)
    const editor = page.getByRole('textbox', { name: 'Your code', exact: true })
    await editor.fill('very_long_python_identifier_' .repeat(8) + ' = "garden counter"')
    await page.getByRole('link', { name: /^Next:/ }).tap()
    await expect(page.getByRole('dialog', { name: 'Leave this answer?' })).toBeVisible()
    await page.getByRole('button', { name: 'Keep editing', exact: true }).tap()
    await expect(editor).toHaveValue(/garden counter/)
    page.once('dialog', dialog => dialog.accept())
    await page.reload()
    await expect(editor).toHaveValue(/garden counter/)
    await expect(page.getByText(/Restored your unsent draft/)).toBeVisible()
    // An actual failed POST leaves the draft in the editor; a second click saves it.
    await page.route('**/api/v1/submissions', async route => { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic retry' }) }); await page.unroute('**/api/v1/submissions') })
    await page.getByRole('button', { name: 'Submit', exact: true }).tap()
    await expect(editor).toHaveValue(/garden counter/)
    await page.getByRole('button', { name: 'Submit', exact: true }).tap()
    await expect(page.getByText('Waiting for review.', { exact: false })).toHaveCount(1)
    await expect(editor).toHaveCount(0)
    await expect(page.getByText('Revise your answer')).toHaveCount(0)
    await page.getByText('View submission #1', { exact: true }).tap()
    await expect(page.locator('details[open] .code-block')).toBeVisible()
    expect((await payload(page, ids.exercise)).content_blocks[0].submissions[0].text).toContain('garden counter')
    await capture(page, `${theme}-submitted`)
    await page.getByRole('link', { name: 'Next: Review the boundary case' }).tap()
    await expect(page.getByText('Explain the boundary case, then try again.')).toBeVisible()
    await fillCode(page, 'print("boundary covered")')
    await page.getByRole('button', { name: 'Resubmit', exact: true }).tap()
    await expect(page.getByText('View submission #2', { exact: true })).toBeVisible()
    const redo = await payload(page, ids.redo)
    expect(redo.content_blocks[0].submissions).toHaveLength(2)
    expect(redo.content_blocks[0].submissions[1].feedback).toContain('boundary case')
    await capture(page, `${theme}-redo-saved`)
    await page.getByRole('link', { name: 'Next: Try it in your terminal' }).tap()
    await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: 'Mark complete', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Start next module: Reflect on your course' }).tap()
    await page.getByRole('button', { name: 'Mark complete', exact: true }).tap()
    await page.getByRole('button', { name: 'Course complete', exact: true }).tap()
    await expect(page.getByTestId('course-complete')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('course-complete')).toBeVisible()
    await expect(page.getByRole('heading', { name: /Course complete:/ })).toBeVisible()
    await capture(page, `${theme}-complete`)
    await open(page, ids.exercise)
    await page.getByRole('button', { name: 'Ask for help', exact: true }).tap()
    const modal = page.getByRole('dialog')
    await expect(modal).toContainText('Count fictional seedlings')
    const question = `Synthetic lesson help ${theme} ${page.viewportSize()!.width}`
    await modal.getByRole('textbox').fill(question)
    await modal.getByRole('button', { name: 'Send to my instructor' }).tap()
    await expect(modal.getByText(question, { exact: true })).toBeVisible()
    await capture(page, `${theme}-help`)
    expect(errors).toEqual([])
  })
})

test.describe('desktop Monaco, people and Off fallback', () => {
  for (const theme of ['light', 'dark']) test(`${theme}: Monaco, exact instructor DM, author actions, self-paced and Off`, async ({ page }) => {
    reset()
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await open(page, ids.exercise)
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 40_000 })
    await expect.poll(() => page.locator('.monaco-editor').first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe(theme === 'light' ? 'rgb(246, 247, 249)' : 'rgb(15, 20, 27)')
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.insertText('very_long_python_identifier_'.repeat(8) + ' = 5')
    await expect(page.locator('.monaco-editor .view-line')).toHaveCount(1)
    await capture(page, `${theme}-monaco`)
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByText('Waiting for review.')).toBeVisible()
    expect((await payload(page, ids.exercise)).content_blocks[0].submissions[0].text).toContain(' = 5')
    await page.getByRole('button', { name: 'Message QA Instructor', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/messages/dm/${ids.conversation}`))
    await expect(page.getByText('Welcome, Alex. Ask me about your lesson here.', { exact: true })).toBeVisible()
    // Message author buttons carry a specific accessible name.
    const author = page.getByRole('button', { name: /QA Instructor/ }).first()
    await author.click()
    await expect(page.getByRole('dialog', { name: 'Profile' })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Message QA Instructor' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Book a meeting' })).toHaveCount(0)
    await capture(page, `${theme}-author`)
    await page.getByRole('button', { name: 'Close Profile' }).click()
    await open(page, ids.reading, ids.self_paced_cohort, 7)
    await expect(page.getByText('Section 1 · Lesson 1 of 6')).toBeVisible()
    await capture(page, `${theme}-self-paced`)
    await open(page, ids.manual, ids.off_cohort, 4)
    await expect(page.getByTestId('lesson-experience')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark exercise complete' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toHaveCount(1)
    await capture(page, `${theme}-off-lance-shape`)
  })
})

for (const theme of ['light', 'dark']) test(`${theme}: staff lesson preview stays contained without learner writes`, async ({ page }) => {
  const writes: string[] = []
  page.on('request', request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && /\/(progresses|submissions|help_requests|direct_conversations)(\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url())
  })
  await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
  await page.goto(`/admin/cohorts/${ids.cohort}/student-view/lessons/${ids.exercise}?student_id=3&qa_user=1`)
  await expect(page.getByRole('heading', { name: 'Count fictional seedlings', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^(Submit|Resubmit|Mark complete)$/ })).toHaveCount(0)
  const links = await page.locator('main a[href]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')!).filter(href => /^\/(lessons|modules)\//.test(href)))
  expect(links).toEqual([])
  await page.getByRole('link', { name: 'Back to Learn', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.cohort}/student-view/materials`))
  expect(writes).toEqual([])
  await capture(page, `${theme}-staff-preview`)
})

for (const theme of ['light', 'dark']) test(`${theme}: instructor booking action uses the enabled course`, async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
  // The base harness program has meetings On and an instructor-authored class message.
  const directory = await page.request.get('/api/v1/channels', { headers: { Authorization: 'Bearer test_token_3' } })
  const channel = (await directory.json()).channels.find((entry: { cohort_id: number; name: string }) => entry.cohort_id === 1 && entry.name === 'qa-class')
  expect(channel?.id).toBeTruthy()
  await page.goto(`/messages/${channel.id}?cohort_id=1&qa_user=3`)
  await page.getByRole('button', { name: 'View QA Instructor', exact: true }).first().click()
  const booking = page.getByRole('dialog').getByRole('link', { name: 'Book a meeting', exact: true })
  await expect(booking).toHaveAttribute('href', '/meetings?cohort_id=1&instructor_id=2')
  await capture(page, `${theme}-author-meetings-on`)
  await booking.click()
  await expect(page).toHaveURL(/\/meetings\?cohort_id=1&instructor_id=2/)
  await expect(page.getByRole('heading', { name: 'My meetings', exact: true })).toBeVisible()
})
