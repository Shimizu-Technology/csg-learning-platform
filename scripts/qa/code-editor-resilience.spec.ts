import { test, expect, type Locator, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { checkedLifecycle } from './ownership.mjs'

const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/lesson-page.json', import.meta.url), 'utf8'))

test.setTimeout(45_000)

function runApiRuby(code: string) {
  execFileSync('bundle', ['exec', 'ruby', '-e', code], {
    cwd: new URL('../../api/', import.meta.url),
    env: { ...process.env, DATABASE_URL: `postgresql://localhost/${state.database}` },
  })
}

function resetFixtures() {
  execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/lesson-page-fixtures.rb', 'reset'], {
    cwd: new URL('../../api/', import.meta.url),
    env: { ...process.env, DATABASE_URL: `postgresql://localhost/${state.database}` },
  })
  runApiRuby(`
    require_relative '../scripts/qa/boot'
    CohortModuleSubmissionWindow.where(cohort_id: ${ids.cohort}).delete_all
    CohortModuleSubmissionWindow.where(cohort_id: ${ids.off_cohort}).delete_all
    off_enrollment = Enrollment.find_by!(cohort_id: ${ids.off_cohort}, user_id: 4)
    Submission.where(enrollment: off_enrollment).delete_all
    Progress.where(enrollment: off_enrollment).delete_all
  `)
}

function closeLegacyWindow() {
  runApiRuby(`
    require_relative '../scripts/qa/boot'
    cohort = Cohort.find(${ids.off_cohort})
    lesson = Lesson.find(${ids.redo})
    enrollment = cohort.enrollments.find_by!(user_id: 4)
    Submission.create!(enrollment: enrollment, user_id: 4, content_block: lesson.content_blocks.sole,
      text: 'print("earlier answer")', grade: 'R', graded_by_id: 2, graded_at: Time.current)
    cohort.cohort_module_submission_windows.find_or_create_by!(module_id: lesson.module_id, week_number: 1)
      .update!(submissions_close_at: 1.day.ago)
  `)
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

async function expectVisibleFocusRing(textarea: Locator, screenshot: string) {
  const frame = textarea.locator('..')
  await expect(textarea).toBeFocused()
  await expect(textarea).toHaveCSS('outline-style', 'none')
  expect(await textarea.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
  await expect(frame).toHaveCSS('border-color', 'rgb(29, 78, 216)')
  await expect(frame).toHaveCSS('box-shadow', /rgb\(29, 78, 216\).*0px 0px 0px 2px/)
  await frame.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await textarea.page().screenshot({ path: screenshot })
  await expect.poll(() => frame.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    if (rect.left < 2 || rect.top < 2 || rect.right > innerWidth - 2 || rect.bottom > innerHeight - 2) return 'viewport'
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const { overflowX, overflowY, position } = getComputedStyle(parent)
      const { left, top } = parent.getBoundingClientRect()
      const clipLeft = left + parent.clientLeft
      const clipTop = top + parent.clientTop
      if (overflowX !== 'visible' && (rect.left - 2 < clipLeft || rect.right + 2 > clipLeft + parent.clientWidth)) return parent.className
      if (overflowY !== 'visible' && (rect.top - 2 < clipTop || rect.bottom + 2 > clipTop + parent.clientHeight)) return parent.className
      // A fixed overlay is clipped by the viewport rather than the scrolling body behind it.
      if (position === 'fixed') break
    }
    return null
  })).toBeNull()
}

async function openExerciseDialog(page: Page) {
  await page.goto('/admin/content?qa_user=1&curriculum=1&pane=detail')
  const outline = page.getByRole('region', { name: 'Curriculum outline', exact: true })
  await expect(outline.getByRole('heading', { name: 'QA Program Lab', exact: true })).toBeVisible()
  const opener = outline.getByRole('button', { name: 'Exercise', exact: true }).first()
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Add exercise' })
  await expect(dialog).toBeVisible()
  return { dialog, opener }
}

async function localTraffic(page: Page, cdn: 'allow' | 'block' = 'block') {
  const cdnRequests: string[] = []
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url())
    if (hostname === '127.0.0.1' || hostname === 'localhost') return route.continue()
    if (hostname === 'cdn.jsdelivr.net') {
      cdnRequests.push(route.request().url())
      if (cdn === 'allow') return route.continue()
    }
    return route.abort('failed')
  })
  return { cdnRequests, pageErrors }
}

const session = process.env.DEV_LIFECYCLE_SESSION
if (session) {
  const tabId = (info: { testId: string }) => `code-editor-${info.testId}`
  test.beforeEach(async ({ page: _page }, info) => checkedLifecycle(session, 'claim', tabId(info)))
  test.afterEach(async ({ page }, info) => {
    await page.close()
    checkedLifecycle(session, 'release', tabId(info))
  })
}

test.describe('1280 fine-pointer code editor resilience', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Desktop 1280 only')

  test('aborted jsDelivr falls back cleanly to textarea with visible focus, handles long lines, persists draft and submission across reload', async ({ page }, info) => {
    resetFixtures()
    const { pageErrors, cdnRequests } = await localTraffic(page)

    await openLesson(page, ids.exercise, ids.cohort, 3)

    const textarea = page.getByRole('textbox', { name: 'Your code', exact: true })
    await expect(textarea).toBeVisible({ timeout: 10_000 })
    await expect(textarea).toHaveAttribute('wrap', 'off')
    await expect(page.getByText('Using the basic code editor')).toBeVisible()
    await expect(page.locator('.monaco-editor')).toHaveCount(0)

    // Tab into the fallback textarea and verify the frame shows a visible, unclipped token focus ring.
    const markSectionBefore = page.locator('main a, main button').first()
    await markSectionBefore.focus()
    for (let i = 0; i < 20; i += 1) {
      if (await textarea.evaluate((el) => document.activeElement === el)) break
      await page.keyboard.press('Tab')
    }
    await expectVisibleFocusRing(textarea, info.outputPath('learner-focus.png'))

    const longLine = `${'very_long_python_identifier_'.repeat(6)} = 7`
    const code = `${longLine}\nprint(f"abort fallback {7}")`
    await textarea.fill(code)
    expect(await textarea.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // Reload immediately to exercise the draft flush as well as restoration.
    page.once('dialog', (dialog) => dialog.accept())
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
    expect(cdnRequests.some((url) => url.endsWith('/loader.js'))).toBe(true)
  })

  test('one stalled AMD launch falls back on later mounts even after late success', async ({ page }) => {
    resetFixtures()
    const { pageErrors } = await localTraffic(page)
    let attempts = 0
    await page.route('https://cdn.jsdelivr.net/**/loader.js', (route) => {
      attempts++
      return route.fulfill({
        contentType: 'text/javascript',
        body: `
          window.require = (_deps, success) => {
            window.releaseQaMonaco = () => {
              window.monaco = { editor: {} };
              success({ m: window.monaco });
            };
          };
          window.require.config = () => {};
        `,
      })
    })

    await openLesson(page, ids.exercise, ids.cohort, 3)
    const textarea = page.getByRole('textbox', { name: 'Your code', exact: true })
    await expect(page.getByText('Loading code editor…')).toBeVisible()
    await expect(textarea).toBeVisible({ timeout: 12_000 })
    const code = 'count = 12\nprint(f"stalled attempt {count}")'
    await textarea.fill(code)
    await page.evaluate(() => (window as Window & { releaseQaMonaco: () => void }).releaseQaMonaco())
    await expect(textarea).toBeFocused()
    await expect(textarea).toHaveValue(code)
    await expect(page.locator('.monaco-editor')).toHaveCount(0)

    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByText('Waiting for review.', { exact: false })).toBeVisible()
    expect((await fetchLessonPayload(page, ids.exercise, ids.cohort, 3)).content_blocks[0].submissions[0].text).toBe(code)

    await page.getByRole('button', { name: 'Outline', exact: true }).click()
    await page.getByRole('dialog', { name: 'Course outline' }).getByRole('link', { name: 'Review the boundary case', exact: true }).click()
    await expect(textarea).toHaveValue('print("earlier answer")', { timeout: 2_500 })
    await expect(page.getByText('Using the basic code editor')).toBeVisible()
    await expect(page.getByText('Loading code editor…')).toHaveCount(0)
    expect(attempts).toBe(1)
    expect(pageErrors).toEqual([])
  })

  test('staff Escape moves fallback editor focus to Cancel, preserves values, and dismisses from neighboring controls', async ({ page }, info) => {
    const { pageErrors } = await localTraffic(page)
    const { dialog, opener } = await openExerciseDialog(page)
    const titleInput = dialog.getByLabel('Title', { exact: true })
    await titleInput.fill('QA Escape Keeps Draft')

    const solutionTextarea = dialog.getByRole('textbox', { name: 'Solution code', exact: true })
    await expect(solutionTextarea).toBeVisible({ timeout: 10_000 })
    await solutionTextarea.fill('puts "keep solution draft"')

    // Keyboard Tab from the Required checkbox onto the Solution textarea and verify visible focus ring on frame.
    const requiredCheckbox = dialog.getByRole('checkbox')
    await requiredCheckbox.focus()
    await page.keyboard.press('Tab')
    await expectVisibleFocusRing(solutionTextarea, info.outputPath('staff-focus.png'))

    // First Escape must exit the editor without closing the dialog or losing form values.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await expect(titleInput).toHaveValue('QA Escape Keeps Draft')
    await expect(solutionTextarea).toHaveValue('puts "keep solution draft"')

    // Second intentional Escape from outside the editor closes the dialog normally.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
    await opener.click()
    await titleInput.focus()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(pageErrors).toEqual([])
  })

  for (const change of ['breakpoint', 'primary pointer'] as const) test(`changing the ${change} defers the editor swap and preserves focus, selection and draft`, async ({ page }) => {
    resetFixtures()
    const { pageErrors } = await localTraffic(page, 'allow')

    await openLesson(page, ids.exercise, ids.cohort, 3)
    const monaco = page.locator('.monaco-editor').first()
    await expect(monaco).toBeVisible({ timeout: 30_000 })
    await monaco.click()
    await page.keyboard.insertText('def keep_focus():')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('return 42')
    await expect(page.locator('.monaco-editor .view-line').first()).toContainText('keep_focus')

    const cdp = change === 'primary pointer' ? await page.context().newCDPSession(page) : null
    async function preferTextarea(enabled: boolean) {
      const query = cdp ? '(pointer: coarse)' : '(max-width: 639px)'
      if (cdp) {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled })
      } else {
        await page.setViewportSize({ width: enabled ? 390 : 1280, height: 844 })
      }
      await expect.poll(() => page.evaluate((media) => matchMedia(media).matches, query)).toBe(enabled)
    }

    await preferTextarea(true)
    await expect(monaco).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Your code', exact: true })).toHaveCount(0)
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.insertText('43 # live')
    await expect(page.locator('.monaco-editor .view-line').nth(1)).toContainText('return 43 # live')

    // Leave Monaco via Escape: now swap to phone textarea preserving the full controlled draft.
    await page.keyboard.press('Escape')
    const phoneTextarea = page.getByRole('textbox', { name: 'Your code', exact: true })
    await expect(phoneTextarea).toBeVisible()
    await expect(phoneTextarea).toHaveValue('def keep_focus():\n    return 43 # live')

    // Focus textarea, set an explicit selection, and widen back to 1280px while editing: must keep textarea, focus & selection.
    await phoneTextarea.focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
    for (let i = 0; i < 'keep_focus'.length; i++) await page.keyboard.press('Shift+ArrowRight')
    await preferTextarea(false)
    await expect(phoneTextarea).toBeVisible()
    await expect(phoneTextarea).toBeFocused()
    const selection = await phoneTextarea.evaluate((el: HTMLTextAreaElement) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
    }))
    expect(selection).toEqual({ start: 4, end: 14 })
    await page.keyboard.type('kept_caret')
    await expect(phoneTextarea).toHaveValue('def kept_caret():\n    return 43 # live')

    // Blur textarea -> editor transitions cleanly back to Monaco with the updated draft preserved.
    await page.keyboard.press('Escape')
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.monaco-editor .view-line').first()).toContainText('kept_caret')
    expect(pageErrors).toEqual([])
  })

  test('normal fine-pointer desktop keeps working Monaco editor with unwrapped long line and persists submission', async ({ page }) => {
    resetFixtures()
    const { pageErrors } = await localTraffic(page, 'allow')

    await openLesson(page, ids.exercise, ids.cohort, 3)
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 })
    await page.locator('.monaco-editor').first().click()
    const longCode = `${'very_long_python_identifier_'.repeat(6)} = "monaco ok"`
    await page.keyboard.insertText(longCode)
    await expect(page.locator('.monaco-editor .view-line')).toHaveCount(1)
    await expect(page.locator('.monaco-editor .view-line').first()).toContainText('very_long_python_identifier_')

    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByText('Waiting for review.', { exact: false })).toBeVisible()
    const lesson = await fetchLessonPayload(page, ids.exercise, ids.cohort, 3)
    expect(lesson.content_blocks[0].submissions[0].text).toBe(longCode)
    expect(pageErrors).toEqual([])
  })
  test('healthy staff Monaco edits solution scratch and cohort preview remains read-only', async ({ page }) => {
    const { pageErrors } = await localTraffic(page, 'allow')
    const { dialog, opener } = await openExerciseDialog(page)
    const editor = dialog.locator('.monaco-editor')
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await editor.click()
    await page.keyboard.insertText('puts "staff scratch"')
    await expect(editor.locator('.view-line')).toContainText('staff scratch')
    await page.keyboard.press('Escape')
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await expect(editor.locator('.view-line')).toContainText('staff scratch')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()

    const writes: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/(progresses|submissions)(\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url())
    })
    await page.goto(`/admin/cohorts/${ids.cohort}/student-view/lessons/${ids.exercise}?student_id=3&qa_user=1`)
    await expect(page.getByRole('heading', { name: 'Count fictional seedlings', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^(Submit|Resubmit|Mark complete)$/ })).toHaveCount(0)
    await page.getByRole('link', { name: 'Back to Learn', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${ids.cohort}/student-view/materials`))
    expect(writes).toEqual([])
    expect(pageErrors).toEqual([])
  })

})

test.describe('390 mobile/touch v1, v2, closed-window readOnly, and modal Escape with zero Monaco CDN requests', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 640, 'Mobile 390 only')
  test.use({ isMobile: true, hasTouch: true })

  test('v2 and v1 coarse/phone lessons render textarea immediately with no jsDelivr requests, preserve wrap modes on long lines, and persist submissions', async ({ page }) => {
    resetFixtures()
    const { pageErrors, cdnRequests } = await localTraffic(page)

    // v2 cohort (user 3): unwrapped horizontal scroll inside textarea, zero page overflow
    await openLesson(page, ids.exercise, ids.cohort, 3)
    const v2Textarea = page.getByRole('textbox', { name: 'Your code', exact: true })
    await expect(v2Textarea).toBeVisible()
    await expect(v2Textarea).toHaveAttribute('wrap', 'off')
    await expect(page.locator('.monaco-editor')).toHaveCount(0)
    const v2Code = `${'very_long_python_identifier_'.repeat(5)} = "mobile v2 saved"`
    await v2Textarea.fill(v2Code)
    await expect.poll(() => v2Textarea.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    expect(await v2Textarea.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    let releasePost!: () => void
    const pending = new Promise<void>((resolve) => { releasePost = resolve })
    await page.route('**/api/v1/submissions', async (route) => {
      await pending
      await route.continue()
    })
    try {
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(v2Textarea).toBeDisabled()
      await page.keyboard.type('late edit')
      await expect(v2Textarea).toHaveValue(v2Code)
    } finally {
      releasePost()
    }
    await expect(page.getByText('Waiting for review.', { exact: false })).toBeVisible()
    const v2Lesson = await fetchLessonPayload(page, ids.exercise, ids.cohort, 3)
    expect(v2Lesson.content_blocks[0].submissions[0].text).toBe(v2Code)

    // v1 legacy cohort (user 4): soft wrap, zero page overflow, persists across reload
    await openLesson(page, ids.exercise, ids.off_cohort, 4)
    const v1Textarea = page.getByRole('textbox', { name: 'Your code', exact: true })
    await expect(v1Textarea).toBeVisible()
    await expect(v1Textarea).toHaveAttribute('wrap', 'soft')
    await expect(page.locator('.monaco-editor')).toHaveCount(0)
    const v1Code = `${'soft_wrap_token '.repeat(12)}# mobile v1 saved`
    await v1Textarea.fill(v1Code)
    expect(await v1Textarea.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByText('Submitted · waiting for review.', { exact: false })).toBeVisible()
    await page.reload()
    await expect(page.getByText('Submitted · waiting for review.', { exact: false })).toBeVisible()

    const v1Lesson = await fetchLessonPayload(page, ids.exercise, ids.off_cohort, 4)
    expect(v1Lesson.content_blocks[0].submissions[0].text).toBe(v1Code)

    expect(cdnRequests).toEqual([])
    expect(pageErrors).toEqual([])
  })

  test('closed v1 source can be selected with the keyboard but stays read-only and cannot submit', async ({ page }) => {
    resetFixtures()
    closeLegacyWindow()
    const { pageErrors, cdnRequests } = await localTraffic(page)
    await openLesson(page, ids.redo, ids.off_cohort, 4)
    await expect(page.getByRole('heading', { name: 'Week 1 submissions are closed' })).toBeVisible()
    const textarea = page.getByRole('textbox', { name: 'Your code', exact: true })
    await expect(textarea).toHaveValue('print("earlier answer")')
    await expect(textarea).toHaveJSProperty('readOnly', true)
    await expect(textarea).toBeEnabled()
    await textarea.focus()
    await page.keyboard.press('ControlOrMeta+A')
    expect(await textarea.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('print("earlier answer")')
    await page.keyboard.type('MUTATED')
    await expect(textarea).toHaveValue('print("earlier answer")')
    await expect(page.getByRole('button', { name: 'Closed', exact: true })).toBeDisabled()
    expect((await fetchLessonPayload(page, ids.redo, ids.off_cohort, 4)).content_blocks[0].submissions).toHaveLength(1)
    expect(cdnRequests).toEqual([])
    expect(pageErrors).toEqual([])
  })

  test('staff phone Escape preserves the draft and wide coarse input also skips the CDN', async ({ page }) => {
    const { pageErrors, cdnRequests } = await localTraffic(page)
    const { dialog } = await openExerciseDialog(page)
    const title = dialog.getByLabel('Title', { exact: true })
    const solution = dialog.getByRole('textbox', { name: 'Solution code', exact: true })
    await title.fill('Phone Modal Draft')
    await dialog.getByRole('checkbox').focus()
    await page.keyboard.press('Tab')
    await expect(solution).toBeFocused()
    await page.keyboard.type('puts "phone draft"')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await expect(title).toHaveValue('Phone Modal Draft')
    await expect(solution).toHaveValue('puts "phone draft"')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.setViewportSize({ width: 1280, height: 844 })
    await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    const { dialog: wideDialog } = await openExerciseDialog(page)
    await expect(wideDialog.getByRole('textbox', { name: 'Solution code', exact: true })).toBeVisible({ timeout: 2_500 })
    expect(cdnRequests).toEqual([])
    expect(pageErrors).toEqual([])
  })
})
