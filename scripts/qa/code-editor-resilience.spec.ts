import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/lesson-page.json', import.meta.url), 'utf8'))

test.setTimeout(90_000)

function resetFixtures() {
  execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/lesson-page-fixtures.rb', 'reset'], {
    cwd: new URL('../../api/', import.meta.url),
    env: { ...process.env, DATABASE_URL: `postgresql://localhost/${state.database}` },
  })
}

async function openLesson(page: Page, lessonId: number, cohortId: number, userId: number) {
  await page.goto(`/lessons/${lessonId}?cohort_id=${cohortId}&qa_user=${userId}`)
  await expect(page.locator('main h1').first()).toBeVisible()
}

async function fetchLessonPayload(page: Page, lessonId: number, cohortId: number, userId: number) {
  const response = await page.request.get(`/api/v1/lessons/${lessonId}?cohort_id=${cohortId}`, {
    headers: { Authorization: `Bearer test_token_${userId}` },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()).lesson
}

test.describe('1280 fine-pointer code editor resilience', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Desktop 1280 only')

  test('aborted jsDelivr falls back cleanly to textarea, persists draft and submission across reload', async ({ page }) => {
    resetFixtures()
    const pageErrors: string[] = []
    const monacoConsoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /monaco/i.test(msg.text())) monacoConsoleErrors.push(msg.text())
    })

    await page.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname
      if (host === '127.0.0.1' || host === 'localhost') return route.continue()
      return route.abort('failed')
    })

    await openLesson(page, ids.exercise, ids.cohort, 3)

    const textarea = page.getByRole('textbox', { name: 'Your code', exact: true })
    await expect(textarea).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Using the basic code editor')).toBeVisible()
    await expect(page.locator('.monaco-editor')).toHaveCount(0)

    const code = 'seedlings = 7\nprint(f"abort fallback {seedlings}")'
    await textarea.fill(code)
    // Allow debounced draft save and verify reload restores draft before submit.
    await page.waitForTimeout(450)
    await page.reload()
    await expect(textarea).toBeVisible({ timeout: 10_000 })
    await expect(textarea).toHaveValue(code)
    await expect(page.getByText(/Restored your unsent draft/)).toBeVisible()

    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByText('Waiting for review.', { exact: false })).toBeVisible()

    await page.reload()
    await expect(page.getByText('Waiting for review.', { exact: false })).toBeVisible()
    await page.getByText('View submission #1', { exact: true }).click()
    await expect(page.locator('details[open] .code-block')).toContainText('abort fallback')

    const lesson = await fetchLessonPayload(page, ids.exercise, ids.cohort, 3)
    expect(lesson.content_blocks[0].submissions[0].text).toBe(code)
    expect(pageErrors).toEqual([])
    expect(monacoConsoleErrors).toEqual([])
  })

  test('stalled jsDelivr recovers after bounded timeout, submits and persists across reload without late takeover', async ({ page }) => {
    resetFixtures()
    const pageErrors: string[] = []
    const monacoConsoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /monaco/i.test(msg.text())) monacoConsoleErrors.push(msg.text())
    })

    const stalledReleases: Array<() => void> = []
    await page.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname
      if (host === '127.0.0.1' || host === 'localhost') return route.continue()
      if (host === 'cdn.jsdelivr.net') {
        return new Promise<void>((resolve) => {
          stalledReleases.push(() => {
            void route.abort('timedout').catch(() => undefined)
            resolve()
          })
        })
      }
      return route.abort('failed')
    })

    try {
      await openLesson(page, ids.exercise, ids.cohort, 3)

      const textarea = page.getByRole('textbox', { name: 'Your code', exact: true })
      await expect(textarea).toBeVisible({ timeout: 12_000 })
      await expect(page.getByText('Using the basic code editor')).toBeVisible()

      const code = 'count = 12\nprint(f"stalled fallback {count}")'
      await textarea.fill(code)
      await expect(textarea).toHaveValue(code)
      await expect(page.locator('.monaco-editor')).toHaveCount(0)

      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(page.getByText('Waiting for review.', { exact: false })).toBeVisible()

      await page.reload()
      await expect(page.getByText('Waiting for review.', { exact: false })).toBeVisible()
      const lesson = await fetchLessonPayload(page, ids.exercise, ids.cohort, 3)
      expect(lesson.content_blocks[0].submissions[0].text).toBe(code)
      expect(pageErrors).toEqual([])
      expect(monacoConsoleErrors).toEqual([])
    } finally {
      while (stalledReleases.length) stalledReleases.pop()?.()
    }
  })

  test('normal fine-pointer desktop keeps working Monaco editor', async ({ page }) => {
    resetFixtures()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname
      return ['127.0.0.1', 'localhost', 'cdn.jsdelivr.net'].includes(host) ? route.continue() : route.abort()
    })

    await openLesson(page, ids.exercise, ids.cohort, 3)
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 })
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.insertText('print("monaco ok")')
    await expect(page.locator('.monaco-editor .view-line').first()).toContainText('monaco ok')
    expect(pageErrors).toEqual([])
  })
})

test.describe('390 mobile/touch v1 and v2 use textarea with zero Monaco CDN requests', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 640, 'Mobile 390 only')
  test.use({ isMobile: true, hasTouch: true })

  test('v2 and v1 coarse/phone lessons render textarea immediately with no jsDelivr requests and persist submissions', async ({ page }) => {
    resetFixtures()
    const pageErrors: string[] = []
    const monacoRequests: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.route('**/*', (route) => {
      const url = route.request().url()
      const host = new URL(url).hostname
      if (host === '127.0.0.1' || host === 'localhost') return route.continue()
      if (host === 'cdn.jsdelivr.net' || /monaco/i.test(url)) {
        monacoRequests.push(url)
      }
      return route.abort('failed')
    })

    // v2 cohort (user 3)
    await openLesson(page, ids.exercise, ids.cohort, 3)
    const v2Textarea = page.getByRole('textbox', { name: 'Your code', exact: true })
    await expect(v2Textarea).toBeVisible()
    await expect(v2Textarea).toHaveAttribute('wrap', 'off')
    await expect(page.locator('.monaco-editor')).toHaveCount(0)
    await v2Textarea.fill('print("mobile v2 saved")')
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByText('Waiting for review.', { exact: false })).toBeVisible()

    // v1 legacy cohort (user 4)
    await openLesson(page, ids.exercise, ids.off_cohort, 4)
    const v1Textarea = page.getByRole('textbox', { name: 'Your code', exact: true })
    await expect(v1Textarea).toBeVisible()
    await expect(v1Textarea).toHaveAttribute('wrap', 'soft')
    await expect(page.locator('.monaco-editor')).toHaveCount(0)
    const v1Code = 'print("mobile v1 saved")'
    await v1Textarea.fill(v1Code)
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByText('Submitted · waiting for review.', { exact: false })).toBeVisible()
    await page.reload()
    await expect(page.getByText('Submitted · waiting for review.', { exact: false })).toBeVisible()

    const v1Lesson = await fetchLessonPayload(page, ids.exercise, ids.off_cohort, 4)
    expect(v1Lesson.content_blocks[0].submissions[0].text).toBe(v1Code)

    expect(monacoRequests).toEqual([])
    expect(pageErrors).toEqual([])
  })
})
