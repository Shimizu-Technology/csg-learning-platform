import { test, expect, type Browser, type Locator, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

// U-6.8: the shared editor in lesson blocks and plan descriptions, and editor
// preferences on the account. Needs student-workspace-course-fixtures.rb (the
// production-authored prework) loaded into the owned harness database.
const session = process.env.DEV_LIFECYCLE_SESSION!
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const API = `http://127.0.0.1:${state.api_port}/api/v1`
const headers = (id: number) => ({ Authorization: `Bearer test_token_${id}`, 'Content-Type': 'application/json' })
const shots = '.qa-local/shared-editor-finish'
mkdirSync(shots, { recursive: true })
const owned = new Map<object, string>()

async function own(page: Page, name: string) {
  checkedLifecycle(session, 'claim', name)
  owned.set(page, name)
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
}
async function release(page: Page) {
  if (!page.isClosed()) await page.close()
  const name = owned.get(page)
  if (name) checkedLifecycle(session, 'release', name)
  owned.delete(page)
}
async function themedPage(browser: Browser, theme: string, name: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, colorScheme: theme as 'light' | 'dark' })
  const page = await context.newPage()
  await own(page, name)
  await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
  return page
}

// A failed case still closes and releases every page it opened.
test.afterEach(async () => { for (const page of [...owned.keys()] as Page[]) await release(page) })

/** Switches one editor's mode with its own toggle, folded into Aa when the editor is narrow. */
async function setMode(editor: Locator, mode: 'Rich' | 'Markdown') {
  const toggle = editor.getByRole('group', { name: 'Editor mode' }).filter({ visible: true }).getByRole('button', { name: mode, exact: true })
  if (await toggle.count() === 0) await editor.getByRole('button', { name: 'Formatting and editor mode' }).click()
  await editor.getByRole('group', { name: 'Editor mode' }).filter({ visible: true }).getByRole('button', { name: mode, exact: true }).click()
  await expect(editor).toHaveAttribute('data-mode', mode.toLowerCase())
}

async function blockBody(request: { get: (url: string, options: object) => Promise<{ json: () => Promise<unknown> }> }, lessonId: number) {
  const data = await (await request.get(`${API}/lessons/${lessonId}/block_editor`, { headers: headers(1) })).json() as { lesson: { content_blocks: { id: number; block_type: string; title: string; body: string }[] } }
  return data.lesson.content_blocks.find(block => block.block_type === 'exercise')!
}

async function preferences(request: { post: (url: string, options: object) => Promise<{ json: () => Promise<unknown> }> }, userId: number) {
  const data = await (await request.post(`${API}/sessions`, { headers: headers(userId) })).json() as { user: { editor_preferences: { mode: string | null; enter_sends: boolean | null } } }
  return data.user.editor_preferences
}

/** Puts the Rich caret at the end of the paragraph holding `phrase` (as text, without Markdown). */
async function caretAfterParagraph(page: Page, phrase: string) {
  await page.evaluate((text) => {
    const surface = document.querySelector('[data-md-editor] .ProseMirror') as HTMLElement & { editor: { state: { doc: { descendants: (visit: (node: { type: { name: string }; textContent: string; nodeSize: number }, position: number) => boolean | void) => void } }; commands: { focus: () => void; setTextSelection: (position: number) => void } } }
    let at: number | null = null
    surface.editor.state.doc.descendants((node, position) => {
      if (at === null && node.type.name === 'paragraph' && node.textContent.includes(text)) at = position + node.nodeSize - 1
      return at === null
    })
    if (at === null) throw new Error(`No paragraph with ${text}`)
    surface.editor.commands.focus()
    surface.editor.commands.setTextSelection(at)
  }, phrase)
}

const LESSONS = {
  'chromium-1280-light': { id: 159, phrase: 'To view your HTML file, right click', source: 'then double click the file name.' },
  'chromium-1280-dark': { id: 174, phrase: 'Paste the HTML code below:', source: 'Paste the HTML code below:' },
  'chromium-390-light': { id: 62, phrase: 'Read the following chapters', source: 'numbers, letters, and variables.' },
  'chromium-390-dark': { id: 86, phrase: 'Commit your code and push', source: 'Commit your code and push your changes to GitHub.' },
} as const

for (const theme of ['light', 'dark']) {
  test(`${theme}: a Rich edit, then a Markdown edit, of a real lesson keeps every other block as typed`, async ({ browser, request }, info) => {
    test.setTimeout(90_000)
    const key = `${info.project.name}-${theme}` as keyof typeof LESSONS
    const lesson = LESSONS[key]
    await request.patch(`${API}/editor_preferences`, { headers: headers(1), data: { mode: 'rich' } })
    const original = (await blockBody(request, lesson.id)).body
    const tag = `QA ${key} ${Date.now().toString(36)}`
    // The caret goes to the end of the paragraph holding the phrase (earlier runs' edits included).
    const paragraphEnd = original.indexOf('\n\n', original.indexOf(lesson.source))
    const at = paragraphEnd < 0 ? original.length : paragraphEnd
    const afterRich = `${original.slice(0, at)} ${tag}.${original.slice(at)}`
    const afterMarkdown = `${afterRich}\n\nMarkdown **${tag}**`

    const page = await themedPage(browser, theme, `shared-editor-lesson-${key}`, info.project.use.viewport!)
    await page.goto(`/admin/lessons/${lesson.id}/edit?qa_user=1`)
    const editor = page.locator('[data-md-editor]').first()
    await expect(editor).toHaveAttribute('data-mode', 'rich')
    await expect(page.getByRole('textbox', { name: /instructions, rich text$/ })).toBeVisible()
    await expect(editor.getByRole('status')).toHaveCount(0) // nothing locked in this lesson
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

    await caretAfterParagraph(page, lesson.phrase)
    await page.keyboard.type(` ${tag}.`)
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await page.screenshot({ path: `${shots}/lesson-rich-${key}.png`, fullPage: false })

    await setMode(editor, 'Markdown')
    const textarea = page.getByRole('textbox', { name: /instructions, Markdown$/ })
    await expect(textarea).toHaveValue(afterRich)
    await textarea.focus()
    await textarea.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length))
    await page.keyboard.type(`\n\nMarkdown **${tag}**`)
    await page.screenshot({ path: `${shots}/lesson-markdown-${key}.png`, fullPage: false })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await expect.poll(async () => (await blockBody(request, lesson.id)).body).toBe(afterMarkdown)

    // The choice to use Markdown followed the person: a reload opens Markdown with the saved text.
    await expect.poll(async () => (await preferences(request, 1)).mode).toBe('markdown')
    await page.reload()
    await expect(page.locator('[data-md-editor]').first()).toHaveAttribute('data-mode', 'markdown')
    await expect(page.getByRole('textbox', { name: /instructions, Markdown$/ })).toHaveValue(afterMarkdown)
    await setMode(page.locator('[data-md-editor]').first(), 'Rich')
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

    // Learners read it through the same renderer: the edits, and the code block as a code block.
    await page.goto(`/lessons/${lesson.id}?cohort_id=4&qa_user=3`)
    await expect(page.getByText(tag, { exact: false }).first()).toBeVisible()
    await expect(page.locator('strong', { hasText: tag })).toBeVisible()
    await page.locator('strong', { hasText: tag }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${shots}/learner-${key}.png`, fullPage: false })
    await release(page)
    await page.context().close()
  })

  test(`${theme}: opening, switching modes and saving another field leaves real lesson text byte for byte`, async ({ browser, request }, info) => {
    test.setTimeout(90_000)
    const key = `${info.project.name}-${theme}`
    await request.patch(`${API}/editor_preferences`, { headers: headers(1), data: { mode: 'rich' } })
    const page = await themedPage(browser, theme, `shared-editor-unchanged-${key}`, info.project.use.viewport!)
    // 165 has paragraphs Rich mode can't show exactly (locked, with a warning); 109 is all editable.
    for (const lessonId of [165, 109]) {
      const before = await blockBody(request, lessonId)
      await page.goto(`/admin/lessons/${lessonId}/edit?qa_user=1`)
      const editor = page.locator('[data-md-editor]').first()
      await expect(editor).toHaveAttribute('data-mode', 'rich')
      if (lessonId === 165) {
        await expect(editor.getByRole('status')).toContainText('saved unchanged')
        await editor.getByRole('status').scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${shots}/locked-warning-${key}.png`, fullPage: false })
      } else {
        await expect(editor.getByRole('status')).toHaveCount(0)
      }
      await setMode(editor, 'Markdown')
      await expect(page.getByRole('textbox', { name: /instructions, Markdown$/ })).toHaveValue(before.body)
      await setMode(editor, 'Rich')
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

      const title = page.getByRole('article', { name: /^Exercise block/ }).getByLabel('Title', { exact: true })
      await title.fill(`${before.title} (QA)`)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
      await expect.poll(async () => (await blockBody(request, lessonId)).title).toBe(`${before.title} (QA)`)
      expect((await blockBody(request, lessonId)).body).toBe(before.body)

      await title.fill(before.title)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect.poll(async () => (await blockBody(request, lessonId)).title).toBe(before.title)
      expect((await blockBody(request, lessonId)).body).toBe(before.body)
    }
    await release(page)
    await page.context().close()
  })

  test(`${theme}: a plan description written in Rich mode is saved as Markdown and shown formatted`, async ({ browser, request }, info) => {
    test.setTimeout(90_000)
    const key = `${info.project.name}-${theme}`
    await request.patch(`${API}/editor_preferences`, { headers: headers(1), data: { mode: 'rich' } })
    const page = await themedPage(browser, theme, `shared-editor-plan-${key}`, info.project.use.viewport!)
    await page.goto('/admin/cohorts/1/students/3/learning?qa_user=1')
    await page.getByRole('button', { name: /^(Edit personal plan|Customize plan)$/ }).click()
    const note = page.getByRole('textbox', { name: 'Note for the student, rich text' })
    await note.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(`Practice **daily** for ${key}`)
    await expect(note.locator('strong')).toHaveText('daily')
    await page.screenshot({ path: `${shots}/plan-editor-${key}.png`, fullPage: false })
    await page.getByRole('button', { name: 'Save personal plan', exact: true }).click()
    await expect.poll(async () => {
      const data = await (await request.get(`${API}/enrollments/1/learning_plan`, { headers: headers(1) })).json() as { plan?: { description?: string }; learning_plan?: { description?: string } }
      return (data.plan ?? data.learning_plan)?.description
    }).toBe(`Practice **daily** for ${key}`)

    // The plan page shows the note through MarkdownText, the renderer the learner's plan card uses.
    await page.goto('/admin/learning-plans/1?qa_user=1')
    await expect(page.locator('strong', { hasText: 'daily' }).first()).toBeVisible()
    await page.screenshot({ path: `${shots}/plan-learner-${key}.png`, fullPage: false })
    await release(page)
    await page.context().close()
  })
}

const PREFERENCE_PEOPLE: Record<string, { id: number; migrate: boolean }> = {
  'chromium-1280-light': { id: 2, migrate: true },
  'chromium-1280-dark': { id: 3, migrate: true },
  'chromium-390-light': { id: 4, migrate: true },
  'chromium-390-dark': { id: 1, migrate: false },
}

// Fixture reset: these people start as never having chosen on the account, in this owned harness database only.
test.beforeAll(() => {
  if (!/^csg_qa_/.test(state.database)) throw new Error(`Refusing to reset ${state.database}`)
  const reset = spawnSync('psql', ['-d', state.database, '-c', 'UPDATE users SET editor_mode = NULL, editor_enter_sends = NULL WHERE id IN (2, 3, 4)'], { encoding: 'utf8' })
  if (reset.status !== 0) throw new Error(reset.stderr)
})

for (const theme of ['light', 'dark']) {
  test(`${theme}: editor preferences move to the account once and follow the person to another browser`, async ({ browser, request }, info) => {
    test.setTimeout(90_000)
    const key = `${info.project.name}-${theme}`
    const person = PREFERENCE_PEOPLE[key]
    const viewport = info.project.use.viewport!
    if (person.migrate) expect(await preferences(request, person.id)).toEqual({ mode: null, enter_sends: null })
    else await request.patch(`${API}/editor_preferences`, { headers: headers(1), data: { mode: 'markdown', enter_sends: false } })

    // A browser that remembered Markdown and Enter-adds-a-line before preferences were on the account.
    const first = await themedPage(browser, theme, `shared-editor-prefs-a-${key}`, viewport)
    await first.addInitScript((id) => {
      const k = `csg-editor-preferences:${id}`
      if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ mode: 'markdown', enterSends: false }))
    }, person.id)
    // Class Chat of QA Program (a channel opens its composer at every width).
    await first.goto(`/messages/1?qa_user=${person.id}`)
    const composer = first.locator('[data-md-editor]').last()
    await expect(composer).toHaveAttribute('data-mode', 'markdown')
    await expect.poll(() => preferences(request, person.id)).toEqual({ mode: 'markdown', enter_sends: false })

    // Change both here: Rich, and Enter sends.
    await setMode(composer, 'Rich')
    await composer.getByRole('button', { name: 'Formatting help' }).click()
    const enterSwitch = first.getByRole('switch', { name: 'Enter sends messages' })
    await expect(enterSwitch).toHaveAttribute('aria-checked', 'false')
    await enterSwitch.click()
    await expect(enterSwitch).toHaveAttribute('aria-checked', 'true')
    await expect(first.getByText('Saved to your account.', { exact: false })).toBeVisible()
    await first.screenshot({ path: `${shots}/prefs-help-${key}.png`, fullPage: false })
    await expect.poll(() => preferences(request, person.id)).toEqual({ mode: 'rich', enter_sends: true })

    // A reload keeps them.
    await first.reload()
    await expect(first.locator('[data-md-editor]').last()).toHaveAttribute('data-mode', 'rich')
    await first.locator('[data-md-editor]').last().getByRole('button', { name: 'Formatting help' }).click()
    await expect(first.getByRole('switch', { name: 'Enter sends messages' })).toHaveAttribute('aria-checked', 'true')

    // A second browser with nothing stored gets them from the account, and its change comes back here.
    const second = await themedPage(browser, theme, `shared-editor-prefs-b-${key}`, viewport)
    await second.goto(`/messages/1?qa_user=${person.id}`)
    const secondComposer = second.locator('[data-md-editor]').last()
    await expect(secondComposer).toHaveAttribute('data-mode', 'rich')
    await secondComposer.getByRole('button', { name: 'Formatting help' }).click()
    await expect(second.getByRole('switch', { name: 'Enter sends messages' })).toHaveAttribute('aria-checked', 'true')
    await second.keyboard.press('Escape')
    await setMode(secondComposer, 'Markdown')
    await expect.poll(() => preferences(request, person.id)).toEqual({ mode: 'markdown', enter_sends: true })
    await first.reload()
    await expect(first.locator('[data-md-editor]').last()).toHaveAttribute('data-mode', 'markdown')
    await first.screenshot({ path: `${shots}/prefs-second-browser-${key}.png`, fullPage: false })

    await release(second)
    await second.context().close()
    await release(first)
    await first.context().close()
    if (person.id === 1) await request.patch(`${API}/editor_preferences`, { headers: headers(1), data: { mode: 'rich', enter_sends: true } })
  })
}

// #304 review: stored CRLF and outer blank lines survive a one-paragraph edit, in Rich and in Markdown mode.
const CRLF_STORED = '\n\nIntro.\r\n\r\nUntouched &nbsp; paragraph.  \r\n\r\nOutro.\r\n\r\n'
const CRLF_LESSON: Record<string, number> = { 'chromium-1280': 2, 'chromium-390': 3 }

test('CRLF lesson text keeps its line endings and outer blank lines through Rich and Markdown edits', async ({ browser, request }, info) => {
  test.setTimeout(90_000)
  const lessonId = CRLF_LESSON[info.project.name]
  const textBlock = async () => {
    const data = await (await request.get(`${API}/lessons/${lessonId}/block_editor`, { headers: headers(1) })).json() as { lesson: { content_blocks: { id: number; block_type: string; body: string }[] } }
    return data.lesson.content_blocks.find(block => block.block_type === 'text')!
  }
  // Fixture: store the review's repro in this lesson's text block (owned harness database only).
  if (!/^csg_qa_/.test(state.database)) throw new Error(`Refusing to write ${state.database}`)
  const block = await textBlock()
  // psql expands :'body' (quoted as a literal) only in input it reads, not in -c.
  const set = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-d', state.database, '-v', `body=${CRLF_STORED}`, '-v', `id=${block.id}`], { encoding: 'utf8', input: "UPDATE content_blocks SET body = :'body' WHERE id = :id;\n" })
  if (set.status !== 0) throw new Error(set.stderr)
  expect((await textBlock()).body).toBe(CRLF_STORED)
  await request.patch(`${API}/editor_preferences`, { headers: headers(1), data: { mode: 'rich' } })

  const page = await themedPage(browser, 'light', `shared-editor-crlf-${info.project.name}`, info.project.use.viewport!)
  await page.goto(`/admin/lessons/${lessonId}/edit?qa_user=1`)
  const editor = page.locator('[data-md-editor]').first()
  await expect(editor).toHaveAttribute('data-mode', 'rich')
  await caretAfterParagraph(page, 'Intro.')
  await page.keyboard.type(' Edited in Rich.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  const afterRich = CRLF_STORED.replace('Intro.', 'Intro. Edited in Rich.')
  await expect.poll(async () => JSON.stringify((await textBlock()).body)).toBe(JSON.stringify(afterRich))

  await setMode(editor, 'Markdown')
  const textarea = page.getByRole('textbox', { name: /Text block 1, Markdown$/ })
  await textarea.focus()
  const at = (await textarea.inputValue()).indexOf('Outro.') + 'Outro.'.length
  await textarea.evaluate((element: HTMLTextAreaElement, position: number) => element.setSelectionRange(position, position), at)
  await page.keyboard.type(' Edited in Markdown.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  // Markdown mode writes the stored CRLF back; the leading LF blank lines become CRLF there (documented).
  const afterMarkdown = afterRich.replace('Outro.', 'Outro. Edited in Markdown.').replace(/\r?\n/g, '\r\n')
  await expect.poll(async () => JSON.stringify((await textBlock()).body)).toBe(JSON.stringify(afterMarkdown))
  await page.screenshot({ path: `${shots}/crlf-${info.project.name}.png`, fullPage: false })
  await setMode(page.locator('[data-md-editor]').first(), 'Rich')
  await release(page)
  await page.context().close()
})
