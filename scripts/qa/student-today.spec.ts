import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

/*
 * W8 PR 8.2 browser QA: the redesigned student Today and My work. Needs
 * course-outline-fixtures.rb setup, then student-today-fixtures.rb setup, then
 * a pass per switch state:
 *   course-outline-fixtures.rb switch off  →  QA_TODAY=off (today's Today: the "before", and Lance's shape)
 *   course-outline-fixtures.rb switch on   →  QA_TODAY=on  (the redesign, every student persona)
 * Each pass measures Today's height and where the first actionable item
 * lands, checks there is no horizontal scroll, and saves a first-screen
 * capture per persona, width and theme into docs/qa/student-today-2026-11-17/.
 * The On pass also walks the journeys: View response, the redo deep link,
 * My work's tabs and Ask about this feedback.
 */
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('Set DEV_LIFECYCLE_SESSION to the active dev-lifecycle session before running browser QA.')
const mode = process.env.QA_TODAY === 'off' ? 'off' : 'on'
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/student-today.json', import.meta.url), 'utf8')) as Record<string, number>
const harness = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8')) as { database: string }
// The journey reads persona 3's help answer; mark it unread again so every pass sees it.
const markAnswerUnread = () => execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/student-today-fixtures.rb', 'unread'], {
  cwd: new URL('../../api/', import.meta.url).pathname, env: { ...process.env, DATABASE_URL: `postgresql://localhost/${harness.database}` }, stdio: 'ignore',
})
const shots = new URL('../../docs/qa/student-today-2026-11-17/', import.meta.url)
const evidence = new URL('../../.qa-local/student-today/', import.meta.url)
mkdirSync(shots, { recursive: true })
mkdirSync(evidence, { recursive: true })
const results: unknown[] = []
test.setTimeout(60_000)

const personas = [
  { key: 'redo-feedback', label: 'Program, redo with feedback, help answer, message (Alex)', user: 3, cohort: ids.program },
  { key: 'behind', label: 'Program, behind (5 of 127), seven redos, no plan', user: 4, cohort: ids.program },
  { key: 'behind-plan', label: 'Program, behind with an agreed catch-up plan', user: ids.blair, cohort: ids.program },
  { key: 'awaiting-review', label: 'Program, personal plan, work waiting for review', user: 3, cohort: ids.qa_program },
  { key: 'self-paced', label: 'Self-paced, halfway, two waiting for review', user: 6, cohort: ids.self_paced },
  { key: 'paused', label: 'Program, paused', user: 5, cohort: ids.program },
  { key: 'alumni', label: 'Alumni library', user: 8, cohort: ids.alumni },
]

const ownership = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const tab = `student-today-${mode}-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`.slice(0, 120)
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

async function openToday(page: Page, user: number, cohortId: number, theme: string) {
  await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
  await page.goto(`/dashboard?cohort_id=${cohortId}&qa_user=${user}`)
  await expect(page.locator('[data-region="next-action"]')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(300)
}

function measure(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 }
    const first = Array.from(document.querySelectorAll('[data-region="next-action"] a, [data-region="next-action"] button')).find(visible)
    const box = first?.getBoundingClientRect()
    const small = Array.from(document.querySelectorAll('main a, main button')).filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.height < 44 && !element.closest('p') && getComputedStyle(element).display !== 'inline'
    }).map((element) => `${element.tagName.toLowerCase()}:${(element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 30)}`)
    return {
      firstAction: first ? (first.textContent || '').trim().slice(0, 60) : null,
      firstActionY: box ? Math.round(box.top + window.scrollY) : null,
      firstActionBottom: box ? Math.round(box.bottom + window.scrollY) : null,
      pageHeight: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      sections: Array.from(document.querySelectorAll('main h2')).map((heading) => (heading.textContent || '').trim()).slice(0, 20),
      smallTargets: small,
    }
  })
}

for (const theme of ['light', 'dark'] as const) {
  for (const persona of personas) {
    test(`${persona.key} ${theme}: Today ${mode}`, async ({ page }, info) => {
      const errors: string[] = []
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      await openToday(page, persona.user, persona.cohort, theme)
      expect(await page.locator('html').getAttribute('data-theme')).toBe(theme)
      const width = info.project.use.viewport?.width
      const metrics = await measure(page)
      await page.screenshot({ path: new URL(`${mode}-${persona.key}-${width}-${theme}.jpg`, shots).pathname, type: 'jpeg', quality: 70 })
      results.push({ mode, persona: persona.key, label: persona.label, theme, width, ...metrics, errors })
      expect(metrics.overflowX, 'no horizontal scroll').toBeLessThanOrEqual(0)
      expect(errors.filter((message) => !/Failed to load resource|ERR_FAILED|net::/i.test(message))).toEqual([])
      if (mode === 'off') {
        await expect(page.locator('[data-today="v2"]')).toHaveCount(0)
        await expect(page.getByRole('link', { name: 'My work' })).toHaveCount(0)
        return
      }
      await expect(page.locator('[data-today="v2"]')).toBeVisible()
      if (width === 390) {
        expect(metrics.smallTargets, 'tap targets are at least 44px on a phone').toEqual([])
        expect(metrics.firstActionBottom ?? 9999, 'the first actionable item is on the first phone screen').toBeLessThan(844 - 68)
      }
      const main = page.getByRole('main')
      switch (persona.key) {
        case 'redo-feedback':
          await expect(main.getByRole('heading', { name: 'Needs you' })).toBeVisible()
          await expect(main.locator('[data-needs-you="redo"] blockquote')).toContainText('Add the missing edge case.')
          await expect(main.getByRole('link', { name: 'View response' })).toHaveAttribute('href', new RegExp(`help_request=${ids.answered_help_request}`))
          await expect(main.locator('[data-needs-you="message"]')).toContainText('New message from QA Instructor')
          await expect(main.getByRole('heading', { name: 'Your questions' })).toBeVisible()
          await expect(main.getByRole('heading', { name: 'Waiting on your instructor' })).toBeVisible()
          await expect(main.getByRole('heading', { name: 'Recently graded' })).toBeVisible()
          await expect(main.getByRole('link', { name: /^Join/ })).toHaveAttribute('href', 'https://example.invalid/zoom/qa-live-class')
          break
        case 'behind':
          await expect(main.locator('[data-region="next-action"]')).toContainText(/You’re about \d+ weeks behind/)
          await expect(main.getByRole('button', { name: /Ask QA for a catch-up plan/ })).toBeVisible()
          await expect(main.locator('[data-region="next-action"]')).not.toContainText('Catch-up plan ·')
          await expect(main.locator('[data-region="today-needs"] li')).toHaveCount(5)
          await expect(main.getByRole('button', { name: 'Show all 7' })).toBeVisible()
          break
        case 'behind-plan':
          await expect(main.locator('[data-region="next-action"]')).toContainText('Catch-up plan · agreed with QA')
          await expect(main.locator('[data-region="next-action"] ol li')).toHaveCount(5)
          await main.getByRole('button', { name: 'Show all 14' }).click()
          await expect(main.locator('[data-region="next-action"] ol li')).toHaveCount(14)
          await expect(main.getByRole('button', { name: /Ask QA to change it/ })).toBeVisible()
          break
        case 'awaiting-review':
        case 'self-paced':
          await expect(main.getByRole('heading', { name: 'Waiting on your instructor' })).toBeVisible()
          await expect(main).toContainText('QA usually reviews within 2 days')
          break
        case 'paused':
          await expect(main.locator('[data-region="next-action"]')).toContainText('Paused since')
          await expect(main.locator('[data-region="next-action"]')).toContainText('Your work is saved')
          await expect(main.getByRole('link', { name: /^Join/ })).toHaveCount(0)
          break
        case 'alumni':
          await expect(main.locator('[data-region="next-action"]')).toContainText('CSG Alumni library')
          await expect(main.getByRole('heading', { name: 'Needs you' })).toHaveCount(0)
          break
      }
    })
  }
}

if (mode === 'on') {
  test('journeys: View response opens the answer, the redo link lands on its feedback, My work tabs and Ask about this feedback', async ({ page }, info) => {
    const width = info.project.use.viewport?.width
    await openToday(page, 3, ids.program, 'light')
    const main = page.getByRole('main')
    const journey: Record<string, unknown> = { width }

    // L-1.3: View response opens the lesson with the request's dialog showing the reply.
    await main.getByRole('link', { name: 'View response' }).click()
    await expect(page).toHaveURL(new RegExp(`/lessons/${ids.answered_lesson}\\?cohort_id=${ids.program}&help_request=${ids.answered_help_request}`))
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('it never becomes false', { timeout: 15_000 })
    await page.screenshot({ path: new URL(`journey-view-response-${width}.jpg`, shots).pathname, type: 'jpeg', quality: 70 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'View response' })).toBeVisible()
    await page.goBack()
    await expect(page.locator('[data-today="v2"]')).toBeVisible()
    // The answer has been read, so it leaves Needs you on the next load.
    await page.reload()
    await expect(page.locator('[data-region="next-action"]')).toBeVisible({ timeout: 20_000 })
    await expect(main.locator('[data-needs-you="help_answer"]')).toHaveCount(0)

    markAnswerUnread()

    // U-5.2: the redo link lands with the feedback at the top of the block.
    // (This canonical exercise syncs from GitHub, so the row reads "Read feedback", not resubmit.)
    await main.getByRole('link', { name: /^(Open feedback and resubmit|Read feedback)/ }).first().click()
    await expect(page).toHaveURL(/#block-\d+$/)
    const feedback = page.getByRole('region', { name: 'Instructor feedback: redo requested' })
    await expect(feedback).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(600)
    const feedbackTop = await feedback.evaluate((element) => Math.round(element.getBoundingClientRect().top))
    journey.redoFeedbackTop = feedbackTop
    expect(feedbackTop, 'the feedback is on the first screen after the jump').toBeLessThan(500)
    await expect(feedback).toContainText(/QA asked for a redo/)
    await page.screenshot({ path: new URL(`journey-redo-landing-${width}.jpg`, shots).pathname, type: 'jpeg', quality: 70 })
    await page.goBack()

    // L-1.2: My work, counts equal their lists, the grader named, Ask about this feedback.
    await expect(page.locator('[data-today="v2"]')).toBeVisible({ timeout: 20_000 })
    await main.getByRole('link', { name: 'My work' }).first().click()
    await expect(page).toHaveURL(/\/my-work\?cohort_id=\d+&tab=waiting/)
    for (const tab of ['Needs you', 'Waiting for review', 'Graded']) {
      const button = page.getByRole('tab', { name: new RegExp(`^${tab}`) })
      await button.click()
      const count = Number((await button.textContent())!.replace(tab, '').trim())
      await expect(page.locator('[data-work-status]')).toHaveCount(count)
      journey[`myWork:${tab}`] = count
    }
    await expect(page.getByRole('main')).toContainText('reviewed by QA Instructor')
    expect((await measure(page)).overflowX).toBeLessThanOrEqual(0)
    await page.screenshot({ path: new URL(`journey-my-work-graded-${width}.jpg`, shots).pathname, type: 'jpeg', quality: 70 })
    await page.getByRole('button', { name: 'Ask about this feedback' }).first().click()
    await expect(page).toHaveURL(/\/messages\/dm\/\d+/)
    await expect(page.getByRole('main')).toContainText('Question about:', { timeout: 15_000 })
    const metrics = await measure(page)
    expect(metrics.overflowX).toBeLessThanOrEqual(0)
    results.push({ mode, journey })
  })

  test('the behind learner can show every redo in place', async ({ page }) => {
    await openToday(page, 4, ids.program, 'dark')
    const needs = page.locator('[data-region="today-needs"]')
    await page.getByRole('button', { name: 'Show all 7' }).click()
    await expect(page.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
    await expect(needs.locator('[data-needs-you="redo"]')).toHaveCount(7)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Show fewer' }).click()
    await expect(page.getByRole('button', { name: 'Show all 7' })).toHaveAttribute('aria-expanded', 'false')
  })
}
