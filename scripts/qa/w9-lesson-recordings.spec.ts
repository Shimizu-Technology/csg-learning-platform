import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/w9-lesson-recordings.json', import.meta.url), 'utf8'))
const clip = fileURLToPath(new URL('../../.qa-local/synthetic.mp4', import.meta.url))
const lifecycle = process.env.DEV_LIFECYCLE_SESSION
if (!lifecycle) throw new Error('DEV_LIFECYCLE_SESSION is required for owned Chromium tabs.')

const lessonTitle = 'Reading a stack trace'
const cohortRoute = `/admin/cohorts/${ids.primary.cohort}?tab=recordings`
const recordingEndpoint = `/api/v1/cohorts/${ids.primary.cohort}/recordings`
const lessonPath = (actor: { cohort: number, user: number }, lesson = ids.lesson) => `/lessons/${lesson}?cohort_id=${actor.cohort}&qa_user=${actor.user}`

for (const theme of ['light', 'dark'] as const) {
  test(`authoring, playback and cohort isolation in ${theme}`, async ({ browser }, info) => {
    test.setTimeout(60_000)
    const viewport = info.project.use.viewport!
    const phone = viewport.width === 390
    const context = await browser.newContext({
      baseURL: `http://127.0.0.1:${state.web_port}`, viewport, isMobile: phone, hasTouch: phone, colorScheme: theme,
    })
    const page = await context.newPage()
    const tab = `w9-lesson-recordings-${process.pid}-${viewport.width}-${theme}`
    const lifecycleArgs = ['--session', lifecycle, 'browser-tab', tab]
    try {
      execFileSync('dev-lifecycle', ['claim', ...lifecycleArgs, '--reason', 'AS-7 Playwright Chromium QA'])
    } catch (error) {
      await context.close()
      throw error
    }

    try {
      await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
      await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())

      await page.goto(`${cohortRoute}&qa_user=2`)
      const title = `QA class replay ${viewport.width} ${theme}`
      await expect(page.getByRole('heading', { name: 'Recording library' })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.locator('input[type=file]').setInputFiles(clip)
      await page.getByLabel('Title *', { exact: true }).fill(title)
      await page.getByLabel('Date recorded', { exact: true }).fill(ids.recorded_date)
      await page.getByText('Attach to lessons', { exact: true }).click()
      const suggestion = page.getByRole('button', { name: 'Suggested for this week' })
      await suggestion.click()
      const lesson = page.getByRole('checkbox', { name: new RegExp(lessonTitle) })
      await expect(lesson).toBeVisible()
      await expect(page.getByRole('checkbox', { name: /Tracing a function call/ })).toHaveCount(0)
      expect((await page.locator('summary').filter({ hasText: 'Attach to lessons' }).boundingBox())?.height).toBeGreaterThanOrEqual(44)
      expect((await page.locator('label').filter({ hasText: lessonTitle }).boundingBox())?.height).toBeGreaterThanOrEqual(44)
      await page.getByRole('searchbox', { name: 'Search lessons' }).fill('no matching lesson')
      await expect(page.getByText('No matching lessons.')).toBeVisible()
      await page.getByRole('searchbox', { name: 'Search lessons' }).fill('stack trace')
      await lesson.check()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)
      await page.locator('details').filter({ hasText: 'Attach to lessons' }).screenshot({ path: info.outputPath('staff-picker.png') })

      await page.getByRole('checkbox', { name: /Publish immediately/ }).check()
      const create = page.waitForResponse((res) => res.url().endsWith(recordingEndpoint) && res.request().method() === 'POST')
      await page.getByRole('button', { name: 'Upload and publish', exact: true }).click()
      const created = await create
      expect(created.status(), await created.text()).toBe(201)
      const { recording } = await created.json()
      expect(recording).toMatchObject({
        duration_seconds: 8, duration_display: '0:08', status: 'published', lessons: [{ id: ids.lesson }],
      })

      await page.getByRole('link', { name: title, exact: true }).click()
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
      await expect(page.getByText('0:08', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: lessonTitle })).toBeVisible()
      await page.getByRole('link', { name: 'Edit', exact: true }).click()
      await page.getByText('Attach to lessons', { exact: true }).click()
      await expect(lesson).toBeChecked()
      await page.getByRole('checkbox', { name: /Tracing a function call/ }).check()
      const patch = page.waitForResponse((res) => res.url().endsWith(`${recordingEndpoint}/${recording.id}`) && res.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      const updated = await patch
      expect(updated.status(), await updated.text()).toBe(200)
      expect((await updated.json()).recording.lessons.map((item: { id: number }) => item.id)).toEqual([ids.lesson, ids.other_lesson])

      await page.goto(lessonPath(ids.primary))
      const section = page.getByRole('region', { name: 'Class recordings' })
      const row = section.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      await expect(row).toBeVisible()
      await expect(row.getByText('0:08', { exact: true })).toBeVisible()
      await expect(row.getByText('Unwatched', { exact: true })).toBeVisible()
      const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ids.recorded_date))
      await expect(row.getByText(dateLabel, { exact: true })).toBeVisible()
      const watch = row.getByRole('link', { name: `Watch recording: ${title}` })
      await row.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      expect((await watch.boundingBox())?.height).toBeGreaterThanOrEqual(44)
      await expect.poll(() => watch.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      })).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)
      await row.screenshot({ path: info.outputPath('learner-recording.png') })
      await watch.click()
      await expect(page).toHaveURL(new RegExp(`/recordings\\?cohort_id=${ids.primary.cohort}&recording=${recording.id}`))
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
      const player = page.locator('video')
      await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.duration)).toBe(8)
      await player.evaluate((video: HTMLVideoElement) => video.play())
      await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(1.5)
      const progress = page.waitForResponse((res) => res.url().endsWith('/api/v1/watch_progress') && res.request().method() === 'PATCH')
      await player.evaluate((video: HTMLVideoElement) => video.pause())
      expect((await progress).ok()).toBe(true)
      await page.goBack()
      await expect(section.getByRole('link', { name: `Resume recording: ${title}` })).toBeVisible()

      await page.goto(lessonPath(ids.shared))
      await expect(page.getByRole('heading', { name: lessonTitle, exact: true })).toBeVisible()
      await expect(section).toHaveCount(0)
      await page.goto(`/recordings?cohort_id=${ids.shared.cohort}&recording=${recording.id}&qa_user=${ids.shared.user}`)
      await expect(page.getByRole('heading', { name: 'Recording unavailable' })).toBeVisible()
      await page.goto(lessonPath(ids.legacy))
      await expect(section.getByText('Legacy workspace replay')).toBeVisible()
      await expect(section.getByText('2:30', { exact: true })).toBeVisible()
      await expect(section.getByText(title, { exact: true })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1)
    } finally {
      try {
        await context.close()
      } finally {
        // Playwright may already have closed the page after a test failure.
        if (page.isClosed()) execFileSync('dev-lifecycle', ['release', ...lifecycleArgs])
      }
    }
  })
}
