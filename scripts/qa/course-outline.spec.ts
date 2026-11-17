import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

/*
 * W8 PR 8.1 browser QA: Learn as the one course outline. Needs
 * course-outline-fixtures.rb setup, then a pass per switch state:
 *   course-outline-fixtures.rb switch off  →  QA_OUTLINE=off (today's views, the "before" and Lance's shape)
 *   course-outline-fixtures.rb switch on   →  QA_OUTLINE=on  (the redesign, every student persona)
 * Each pass measures where the first lesson lands and the page height, checks
 * there is no horizontal scroll, and saves a first-screen capture per persona,
 * width and theme into docs/qa/course-outline-2026-11-17/.
 */
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('Set DEV_LIFECYCLE_SESSION to the active dev-lifecycle session before running browser QA.')
const mode = process.env.QA_OUTLINE === 'off' ? 'off' : 'on'
const fixture = JSON.parse(readFileSync(new URL('../../.qa-local/course-outline.json', import.meta.url), 'utf8')) as { cohorts: Array<{ id: number; name: string }> }
const cohort = (name: string) => fixture.cohorts.find((item) => item.name === name)!.id
const shots = new URL('../../docs/qa/course-outline-2026-11-17/', import.meta.url)
const evidence = new URL('../../.qa-local/course-outline/', import.meta.url)
mkdirSync(shots, { recursive: true })
mkdirSync(evidence, { recursive: true })
const results: unknown[] = []
test.setTimeout(60_000)

const personas = [
  { key: 'program-plan', label: 'Program, personal plan (Alex shape)', user: 3, cohort: cohort('QA Program') },
  { key: 'program-canonical', label: 'Program, 127 production lessons, 40 in', user: 3, cohort: cohort('QA canonical program') },
  { key: 'behind', label: 'Program, behind', user: 4, cohort: cohort('QA canonical program') },
  { key: 'paused', label: 'Program, paused', user: 5, cohort: cohort('QA canonical program') },
  { key: 'self-paced-halfway', label: 'Self-paced, halfway', user: 6, cohort: cohort('QA canonical self_paced') },
  { key: 'self-paced-plan', label: 'Self-paced, personal plan', user: 6, cohort: cohort('QA Self paced') },
  { key: 'self-paced-new', label: 'Self-paced, brand new', user: 7, cohort: cohort('QA canonical self_paced') },
  { key: 'alumni', label: 'Alumni library', user: 8, cohort: cohort('QA canonical alumni') },
]

const ownership = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const tab = `course-outline-${mode}-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`.slice(0, 120)
  checkedLifecycle(session, 'claim', tab)
  ownership.set(page, tab)
  await page.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})
test.afterEach(async ({ page }) => {
  await page.close()
  const tab = ownership.get(page)
  if (tab) checkedLifecycle(session, 'release', tab)
  ownership.delete(page)
})
test.afterAll(() => writeFileSync(new URL(`results-${mode}-${process.pid}.json`, evidence), JSON.stringify(results, null, 2)))

async function openLearn(page: Page, user: number, cohortId: number, theme: string, extra = '') {
  await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
  await page.goto(`/materials?cohort_id=${cohortId}${extra}&qa_user=${user}`)
  if (mode === 'on') await expect(page.getByTestId('course-outline')).toBeVisible({ timeout: 20_000 })
  else await expect(page.getByRole('heading', { name: 'Learn', exact: true, level: 1 })).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(250)
}

function measure(page: Page) {
  return page.evaluate(() => {
    const outline = document.querySelector('[data-testid="course-outline"]')
    const first = outline
      ? document.querySelector('li[data-lesson-kind]')
      : document.querySelector('main [id^="learn-module-"] a[href*="/lessons/"], main [id^="learn-module-"] [aria-disabled="true"]')
    const box = first?.getBoundingClientRect()
    const bar = document.querySelector('[data-testid="continue-bar"]')?.getBoundingClientRect()
    const small = Array.from(document.querySelectorAll('main a, main button, main input')).filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.height < 44 && !element.closest('p') && getComputedStyle(element).display !== 'inline'
    }).map((element) => `${element.tagName.toLowerCase()}:${(element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 30)}`)
    return {
      firstLessonY: box ? Math.round(box.top + window.scrollY) : null,
      continueY: bar ? Math.round(bar.top + window.scrollY) : null,
      pageHeight: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      kinds: Array.from(new Set(Array.from(document.querySelectorAll('li[data-lesson-kind]')).map((row) => row.getAttribute('data-lesson-kind')))),
      rows: document.querySelectorAll(outline ? 'li[data-lesson-kind]' : 'main [id^="learn-module-"] a[href*="/lessons/"]').length,
      smallTargets: small,
    }
  })
}

for (const theme of ['light', 'dark'] as const) {
  for (const persona of personas) {
    test(`${persona.key} ${theme}: Learn ${mode === 'on' ? 'outline' : 'today'}`, async ({ page }, info) => {
      const errors: string[] = []
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      await openLearn(page, persona.user, persona.cohort, theme)
      expect(await page.locator('html').getAttribute('data-theme')).toBe(theme)
      const width = info.project.use.viewport?.width
      const metrics = await measure(page)
      await page.screenshot({ path: new URL(`${mode}-${persona.key}-${width}-${theme}.jpg`, shots).pathname, type: 'jpeg', quality: 70 })
      results.push({ mode, persona: persona.key, label: persona.label, theme, width, ...metrics, errors })
      expect(metrics.overflowX, 'no horizontal scroll').toBeLessThanOrEqual(0)
      if (mode === 'off') {
        await expect(page.getByTestId('course-outline')).toHaveCount(0)
        return
      }
      if (width === 390) expect(metrics.smallTargets, 'tap targets are at least 44px on a phone').toEqual([])
      if (persona.key === 'alumni') {
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Alumni library/)
        await expect(page.getByRole('group', { name: 'Show' })).toHaveCount(0)
        await expect(page.getByTestId('continue-bar')).toHaveCount(0)
      } else if (persona.key === 'paused') {
        await expect(page.getByRole('status')).toContainText('Your enrollment is paused')
        await expect(page.getByTestId('continue-bar')).toHaveCount(0)
      } else {
        await expect(page.getByTestId('continue-bar')).toBeVisible()
        if (width === 390) expect(metrics.firstLessonY ?? 9999, 'the first lesson is on the first phone screen').toBeLessThan(844)
      }
      if (persona.key.startsWith('self-paced')) {
        // No weekday schedule or dates (S-1). Lesson titles may still say "Week 3": that is authored content.
        expect(await page.getByRole('main').textContent()).not.toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Opens /)
        for (const trigger of await page.locator('button[aria-controls^="learn-group-"]').allTextContents()) expect(trigger).not.toMatch(/^Week \d/)
      }
      expect(errors.filter((message) => !/Failed to load resource|ERR_FAILED|net::/i.test(message))).toEqual([])
    })
  }
}

if (mode === 'on') {
  test('program: continue, weeks, filter, search, Back and redirects', async ({ page }) => {
    const program = cohort('QA canonical program')
    await openLearn(page, 3, program, 'light')
    const bar = page.getByTestId('continue-bar')
    const title = (await bar.locator('p.truncate').textContent())!
    await bar.getByRole('link', { name: /Open/ }).click()
    await expect(page).toHaveURL(/\/lessons\/\d+\?cohort_id=/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(title.slice(0, 20))
    await page.goBack()
    await expect(page.getByTestId('course-outline')).toBeVisible()
    const week2 = page.getByRole('button', { name: /^Week 2/ })
    await expect(week2).toHaveAttribute('aria-expanded', 'false')
    await week2.click()
    await expect(week2).toHaveAttribute('aria-expanded', 'true')
    expect(new URL(page.url()).searchParams.get('open')).toMatch(/^m\d+-2$/)
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /Needs redo/ }).click()
    const redo = page.locator('li[data-lesson-status="redo"] a')
    await expect(redo).toHaveCount(1)
    expect(await redo.getAttribute('href')).toMatch(/#block-\d+$/)
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' }).click()
    await page.getByRole('searchbox', { name: 'Search this course' }).fill('Booleans')
    await expect(page.locator('li[data-lesson-kind]')).not.toHaveCount(0)
    for (const row of await page.locator('li[data-lesson-kind]').all()) await expect(row).toContainText(/Booleans/i)
    await page.reload()
    await expect(page.getByRole('searchbox', { name: 'Search this course' })).toHaveValue('Booleans')
    const moduleId = new URL(page.url()).searchParams.get('open')?.match(/^m(\d+)-/)?.[1]
    await page.goto(`/modules/${moduleId}?cohort_id=${program}&qa_user=3`)
    await expect(page).toHaveURL(new RegExp(`/materials\\?cohort_id=${program}&module=${moduleId}`))
    await page.goto(`/cohorts/${program}?qa_user=3`)
    await expect(page).toHaveURL(new RegExp(`/materials\\?cohort_id=${program}$`))
    results.push({ mode, case: 'program interactions', passed: true })
  })
}

test(`manual exercise has ${mode === 'on' ? 'one completion control' : 'today’s two controls'}`, async ({ page }) => {
  const program = cohort('QA Program')
  await page.goto(`/materials?cohort_id=${program}&qa_user=4`)
  const lesson = await page.request.get(`/api/v1/dashboard?cohort_id=${program}`, { headers: { Authorization: 'Bearer test_token_4' } })
  const lessonId = (await lesson.json()).dashboard.modules[0].lessons.find((item: { available: boolean }) => item.available).id
  await page.goto(`/lessons/${lessonId}?cohort_id=${program}&qa_user=4`)
  const reflect = page.locator('div.app-surface').filter({ hasText: 'Reflect' }).first()
  await expect(reflect).toBeVisible({ timeout: 20_000 })
  const controls = reflect.getByRole('button', { name: /Mark (exercise )?complete/ })
  await expect(controls).toHaveCount(mode === 'on' ? 1 : 2)
  results.push({ mode, case: 'manual completion controls', count: await controls.count(), passed: true })
})

// Fix round (P1): anything short of an explicit on keeps today's Learn, in either pass.
for (const theme of ['light', 'dark'] as const) {
  test(`cached cohort list without the switch keeps today's Learn (${theme})`, async ({ page }, info) => {
    await page.route('**/api/v1/cohorts/accessible', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      for (const item of body.cohorts) {
        delete item.features?.student_experience_v2
        delete item.capabilities?.features?.student_experience_v2
      }
      await route.fulfill({ response, json: body })
    })
    await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/materials?cohort_id=${cohort('QA canonical program')}&qa_user=3`)
    await expect(page.getByRole('heading', { name: 'Learn', exact: true, level: 1 })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('course-outline')).toHaveCount(0)
    const width = info.project.use.viewport?.width
    await page.screenshot({ path: new URL(`${mode}-cached-no-flag-${width}-${theme}.jpg`, shots).pathname, type: 'jpeg', quality: 70 })
    results.push({ mode, case: 'cached no-flag payload', theme, width, passed: true })
  })
}

test('offline cold start: today’s Learn with a notice and Try again', async ({ page }) => {
  await page.route('**/api/v1/cohorts/accessible', (route) => route.abort())
  await page.goto(`/materials?cohort_id=${cohort('QA canonical program')}&qa_user=3`)
  await expect(page.getByRole('alert').filter({ hasText: 'course settings' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Learn', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByTestId('course-outline')).toHaveCount(0)
  await page.unroute('**/api/v1/cohorts/accessible')
  await page.getByRole('button', { name: 'Try again' }).click()
  if (mode === 'on') await expect(page.getByTestId('course-outline')).toBeVisible({ timeout: 20_000 })
  results.push({ mode, case: 'offline cold start with retry', passed: true })
})
