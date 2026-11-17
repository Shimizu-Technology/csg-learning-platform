import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('Set DEV_LIFECYCLE_SESSION to the active dev-lifecycle session before running browser QA.')
const walkthrough = readFileSync(new URL('./student-workspace-browser.js', import.meta.url), 'utf8')
const results: unknown[] = []
const evidence = new URL('../../.qa-local/student-workspace/', import.meta.url)
mkdirSync(evidence, { recursive: true })
test.setTimeout(90_000)
const ownership = new Map<object, string>()
test.beforeEach(async ({ page }, info) => {
  const tab = `student-workspace-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', tab)
  ownership.set(page, tab)
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})
test.afterEach(async ({ page }) => {
  await page.close()
  const tab = ownership.get(page)
  if (tab) checkedLifecycle(session, 'release', tab)
  ownership.delete(page)
})
test.afterAll(() => writeFileSync(new URL(`results-${process.pid}.json`, evidence), JSON.stringify(results, null, 2)))
for (const theme of ['light', 'dark'] as const) {
  for (const [role, user] of [['admin', 1], ['instructor', 2]] as const) {
    test(`${role} ${theme}: profile links, enrollment, communication and preview`, async ({ page }, info) => {
      await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
      const consoleErrors: string[] = []
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      await page.goto(`/admin/cohorts/1/students/3/overview?qa_user=${user}`)
      await expect(page.getByRole('heading', { name: 'Why flagged', exact: true })).toBeVisible({ timeout: 15_000 })
      expect(await page.locator('html').getAttribute('data-theme')).toBe(theme)
      if (user === 1) await page.screenshot({ path: new URL(`${info.project.name}-${theme}-profile.png`, evidence).pathname, fullPage: true })
      const result = await page.evaluate(walkthrough)
      results.push({ case: 'profile', role, theme, width: info.project.use.viewport?.width, ...result, consoleErrors })
      expect(result, JSON.stringify(result)).toMatchObject({ passed: true })
      expect(consoleErrors.filter(message => /same key|unique.*key/i.test(message))).toEqual([])
    })
    test(`${role} ${theme}: save follow-up and reuse the existing plan`, async ({ page, request }, info) => {
      const headers = { Authorization: `Bearer test_token_${user}` }
      const response = await request.get('/api/v1/interventions?enrollment_id=1', { headers })
      for (const plan of (await response.json()).interventions.filter((plan: { trigger_type: string; status: string }) => plan.trigger_type === 'manual' && !['resolved', 'canceled'].includes(plan.status))) await request.patch(`/api/v1/interventions/${plan.id}`, { headers, data: { status: 'canceled' } })
      await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
      await page.goto(`/admin/cohorts/1/students/3/overview?qa_user=${user}`)
      await page.getByRole('button', { name: 'Message', exact: true }).click()
      await expect(page).toHaveURL(/\/messages\/dm\/\d+/)
      expect(new URL(page.url()).searchParams.get('cohort_id')).toBe('1')
      await expect(page.getByRole('main').getByText('QA Program', { exact: true }).first()).toBeVisible()
      await page.locator('main a').filter({ hasText: /^Back to/ }).first().click()
      await expect(page).toHaveURL(/\/admin\/cohorts\/1\/students\/3\/overview/)
      await page.getByRole('button', { name: 'Start follow-up plan', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Start follow-up plan', exact: true })
      const summary = `QA ${role} ${theme} ${info.project.name}: review the fictional counter`
      await dialog.getByRole('textbox', { name: 'Next step', exact: true }).fill(summary)
      await dialog.getByLabel(/Next follow-up/).fill('2026-12-01T16:00')
      await dialog.getByRole('button', { name: 'Start follow-up plan', exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/interventions\/\d+/)
      await expect(page.getByRole('textbox', { name: 'Next step', exact: true })).toHaveValue(summary)
      const plan = (await (await request.get(`/api/v1/interventions/${new URL(page.url()).pathname.split('/').pop()}`, { headers })).json()).intervention
      expect(plan.enrollment.id).toBe(1)
      expect(plan.owner.id).toBe(user)
      expect(plan.action_summary).toBe(summary)
      await page.getByRole('link', { name: /^Back to (QA Program|Cohort)$/ }).click()
      await expect(page.getByRole('link', { name: 'Open follow-up plan', exact: true })).toBeVisible()
      results.push({ case: 'follow-up', role, theme, width: info.project.use.viewport?.width, passed: true, plan: plan.id })
    })
    test(`${role} ${theme}: module cards and objective context`, async ({ page }, info) => {
      await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
      await page.goto(`/admin/cohorts/1?tab=learning&qa_user=${user}`)
      const card = page.getByRole('region', { name: 'QA Week 1', exact: true })
      await expect(card.getByText(/assigned lessons done or submitted/)).toBeVisible()
      const staffEntries = page.getByRole('main').locator('a[href*="student-view"]')
      await expect(staffEntries).toHaveCount(1)
      await card.getByRole('link', { name: 'Grade QA Week 1', exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/cohorts\/1\/modules\/1\/grading/)
      await expect(page.getByRole('heading', { name: /QA Week 1/ }).first()).toBeVisible()
      await page.getByRole('link', { name: /^Back to (QA Program|Cohort)$/ }).click()
      await card.getByRole('link', { name: 'Lessons in QA Week 1', exact: true }).click()
      await expect(page).toHaveURL(/\/modules\/1/)
      await expect(page.getByRole('heading', { name: 'QA Week 1', exact: true })).toBeVisible()
      await page.getByRole('link', { name: /^Back to (QA Program|Cohort)$/ }).click()
      await expect(page.getByRole('link', { name: 'Back to QA Week 1', exact: true })).toHaveCount(0)
      await card.getByRole('link', { name: '2 students assigned', exact: true }).click()
      await expect(page).toHaveURL(/tab=students&module_id=1/)
      await expect(page.getByRole('main').getByText('QA Paused', { exact: true })).toHaveCount(0)
      await page.getByRole('link', { name: 'Learning', exact: true }).click()
      await page.getByRole('link', { name: 'Learning insights', exact: true }).click()
      await expect(page).toHaveURL(/tab=insights/)
      const origin = new URL(page.url()).pathname + new URL(page.url()).search
      const objective = page.locator('details').filter({ has: page.getByText('Explain a fictional counter', { exact: true }) }).first()
      await objective.getByText('Explain a fictional counter', { exact: true }).click()
      const lesson = objective.locator('a[data-record-link="lesson"]').filter({ hasText: 'QA Lab 1.1.1' }).first()
      await expect(lesson).toBeVisible()
      await lesson.click()
      await expect(page).toHaveURL(/\/lessons\/1/)
      await expect(page.getByRole('heading', { name: 'QA Lab 1.1.1', level: 1, exact: true })).toBeVisible({ timeout: 15_000 })
      const lessonBack = page.getByRole('link', { name: /^Back to (QA Program|Cohort)$/ })
      await expect(lessonBack).toHaveAttribute('href', origin)
      await lessonBack.click()
      await expect(page).toHaveURL(/tab=insights/)
      results.push({ case: 'modules', role, theme, width: info.project.use.viewport?.width, passed: true })
    })
  }
  for (const [persona, user] of [['program', 3], ['behind', 4], ['paused', 5], ['self-paced', 6], ['new self-paced', 7], ['alumni', 8]] as const) {
    test(`${persona} ${theme}: learner boundaries`, async ({ page, request }, info) => {
      await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
      await page.goto(`/dashboard?qa_user=${user}`)
      await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible()
      await expect(page.getByRole('main').getByText('Loading student…', { exact: true })).toHaveCount(0)
      const headers = { Authorization: `Bearer test_token_${user}` }
      const dashboard = (await (await request.get('/api/v1/dashboard', { headers })).json()).dashboard
      expect(dashboard.user.role).toBe('student')
      expect(dashboard.attention).toBeUndefined()
      expect(dashboard.today?.items).toBeUndefined()
      await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (persona === 'paused') await expect(page.getByText(/Paused.*read.only/).first()).toBeVisible()
      if (persona === 'alumni') await expect(page.getByText(/library/i).first()).toBeVisible()
      await page.getByRole('link', { name: 'Learn', exact: true }).click()
      await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible()
      await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
      const lesson = page.getByRole('main').locator('a[href^="/lessons/"]').first()
      await expect(lesson).toBeVisible()
      await lesson.click()
      await expect(page.getByRole('heading', { name: /QA Lab/ }).first()).toBeVisible()
      await expect(page.locator('a[href^="/admin"]')).toHaveCount(0)
      const denied = await request.get('/api/v1/progress/student/3?cohort_id=1', { headers })
      expect(denied.status()).toBe(403)
      const communication = await request.get('/api/v1/progress/student/3/communication?cohort_id=1', { headers })
      expect(communication.status()).toBe(403)
      await page.goto('/admin/cohorts/1/students/3/overview')
      await expect(page.getByRole('heading', { name: 'No access', exact: true })).toBeVisible()
      results.push({ case: 'learner', persona, theme, width: info.project.use.viewport?.width, passed: true })
    })
  }
}

for (const theme of ['light', 'dark'] as const) for (const [role, user] of [['admin', 1], ['instructor', 2]] as const) {
  test(`${role} ${theme}: behind profile help and shared reasons`, async ({ page, request }, info) => {
    await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
    const response = await request.get('/api/v1/progress/student/4?cohort_id=1', { headers: { Authorization: `Bearer test_token_${user}` } })
    const progress = await response.json()
    await page.goto(`/admin/cohorts/1/students/4/overview?qa_user=${user}`)
    await expect(page.getByRole('heading', { name: 'Why flagged', exact: true })).toBeVisible({ timeout: 15_000 })
    for (const reason of progress.status.reasons) await expect(page.getByRole('note').getByText(reason.label, { exact: true })).toBeVisible()
    await page.getByRole('link').filter({ hasText: 'Open support' }).click()
    const help = page.getByRole('main').locator('a[href^="/admin/help-requests/"]').first()
    await expect(help).toBeVisible()
    await help.click()
    await expect(page).toHaveURL(/\/admin\/help-requests\/\d+/)
    await page.getByRole('link', { name: 'Back to QA Behind', exact: true }).click()
    await expect(page).toHaveURL(/\/students\/4\/support/)
    results.push({ case: 'behind', role, theme, width: info.project.use.viewport?.width, passed: true })
  })
}

// Opt-in second pass after student-workspace-course-fixtures.rb. Existing synthetic
// fixtures keep the precise status/action assertions above independently repeatable.
if (process.env.QA_CANONICAL_COURSE === '1') {
  const course = JSON.parse(readFileSync(new URL('../../.qa-local/student-workspace/course-fixture.json', import.meta.url), 'utf8')) as { module_name: string; lesson_count: number; people: { user_id: number; cohort_id: number; paused: boolean; alumni: boolean }[] }
  for (const theme of ['light', 'dark'] as const) for (const staff of [1, 2]) {
    test(`canonical course ${staff} ${theme}: six enrollment profiles and preview boundaries`, async ({ page }) => {
      await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
      for (const person of course.people) {
        const profile = `/admin/cohorts/${person.cohort_id}/students/${person.user_id}`
        await page.goto(`${profile}/learning?qa_user=${staff}`)
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
        await expect(page.getByRole('main').getByText(course.module_name, { exact: true }).first()).toBeVisible()
        const response = await page.request.get(`/api/v1/progress/student/${person.user_id}?cohort_id=${person.cohort_id}`, { headers: { Authorization: `Bearer test_token_${staff}` } })
        const progress = await response.json()
        expect(progress.modules[0].lessons).toHaveLength(course.lesson_count)
        await page.getByRole('link', { name: 'View as student', exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`/admin/cohorts/${person.cohort_id}/student-view`))
        if (!person.paused && !person.alumni) {
          const continueLink = page.getByRole('link', { name: 'Continue learning', exact: true })
          await expect(continueLink).toBeVisible()
          {
            const href = await continueLink.getAttribute('href')
            expect(href).toContain(`/admin/cohorts/${person.cohort_id}/student-view/lessons/`)
            await continueLink.click()
            await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
            expect(new URL(page.url()).pathname).toContain('/student-view/lessons/')
            expect(new URL(page.url()).searchParams.get('student_id')).toBe(String(person.user_id))
          }
        }
        await expect(page.getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0)
      }
    })
  }
}

for (const theme of ['light', 'dark'] as const) for (const staff of [1, 2]) {
  test(`follow-up recovery ${staff} ${theme}: keyboard, reduced motion, draft guard and failed save`, async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
    const headers = { Authorization: `Bearer test_token_${staff}` }
    const plans = await (await request.get('/api/v1/interventions?enrollment_id=1', { headers })).json()
    for (const plan of plans.interventions.filter((item: { trigger_type: string; status: string }) => item.trigger_type === 'manual' && !['resolved', 'canceled'].includes(item.status))) await request.patch(`/api/v1/interventions/${plan.id}`, { headers, data: { status: 'canceled' } })
    await page.goto(`/admin/cohorts/1/students/3/overview?qa_user=${staff}`)
    await page.getByRole('button', { name: 'Message', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: /Grade next/ })).toBeFocused()
    expect(await page.getByRole('link', { name: /Grade next/ }).evaluate(element => element.matches(':focus-visible'))).toBe(true)
    await page.getByRole('button', { name: 'Start follow-up plan', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Start follow-up plan', exact: true })
    const summary = `Retain this keyboard draft ${staff} ${theme}`
    await dialog.getByRole('textbox', { name: 'Next step', exact: true }).fill(summary)
    await dialog.getByLabel(/Next follow-up/).fill('2026-12-01T16:00')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: 'Next step', exact: true })).toHaveValue(summary)
    await page.route('**/api/v1/interventions', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic save failure' }) }) : route.continue())
    await dialog.getByRole('button', { name: 'Start follow-up plan', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Synthetic save failure')
    await expect(dialog.getByRole('textbox', { name: 'Next step', exact: true })).toHaveValue(summary)
    await page.unroute('**/api/v1/interventions')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: 'Start follow-up plan', exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: 'Next step', exact: true })).toHaveValue('')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  })
}
