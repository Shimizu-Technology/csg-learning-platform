import { test, expect, type Page, type TestInfo } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const apiUrl = `http://127.0.0.1:${state.api_port}`
const appUrl = `http://127.0.0.1:${state.web_port}`

type Fixture = { student: number; cohort: number; enrollment: number; lesson: number; block: number }
type Theme = 'light' | 'dark'

test.use({ actionTimeout: 15_000, navigationTimeout: 20_000 })
test.describe.configure({ timeout: 120_000 })
const expectReady = expect.configure({ timeout: 15_000 })

async function prepare(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.addInitScript((choice) => localStorage.setItem('csg-learn:theme', choice), theme)
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname
    return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort()
  })
}

async function snapshot(page: Page, info: TestInfo, name: string, theme: Theme) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), name).toBeLessThanOrEqual(1)
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true })
}

function lessonPath(fixture: Fixture) {
  return `/lessons/${fixture.lesson}?cohort_id=${fixture.cohort}`
}

async function submit(page: Page, fixture: Fixture) {
  await page.goto(`${lessonPath(fixture)}&qa_user=${fixture.student}`)
  await page.getByRole('textbox', { name: 'Your answer, rich text' }).fill('A weather dashboard groups forecasts by region.')
  const sent = page.waitForResponse((response) => response.url().endsWith('/api/v1/submissions') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  const response = await sent
  expect(response.status()).toBe(201)
  return (await response.json()).submission.id as number
}

async function pass(page: Page, submissionId: number) {
  await page.goto(`/admin/submissions/${submissionId}?qa_user=2`)
  const bar = page.locator('[data-grade-bar]')
  const saved = page.waitForResponse((response) => response.url().endsWith(`/submissions/${submissionId}/grade`) && response.request().method() === 'PATCH')
  await bar.locator('button', { hasText: /^A$/ }).click()
  const response = await saved
  expect(response.status()).toBe(200)
  expect((await response.json()).submission.grade).toBe('A')
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: reviewed completion, printed name, signed-out verification, revocation and Off cohort`, async ({ page, browser }, info) => {
    const fixtures = JSON.parse(execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/w9-completion-certificate-fixtures.rb'], {
      cwd: new URL('../../api', import.meta.url).pathname, encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: `postgresql://localhost/${state.database}` },
    }).trim().split('\n').at(-1)!) as { on: Fixture; off: Fixture }
    const { on, off } = fixtures
    await prepare(page, theme)
    const submissionId = await submit(page, on)
    await page.getByRole('button', { name: 'All work handed in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'All work handed in' })).toBeVisible()
    await expect(page.getByText('Your instructor will confirm completion after reviewing your work.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'View & print certificate' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Next step', exact: true })).toHaveCount(0)
    await snapshot(page, info, 'awaiting-review', theme)

    await pass(page, submissionId)
    await page.goto(`${lessonPath(on)}&complete=1&qa_user=${on.student}`)
    await expectReady(page.getByRole('heading', { name: 'Course completed' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Explore this course' })).toHaveAttribute('href', '/courses/python-projects')
    const link = page.getByRole('link', { name: 'View & print certificate' })
    await expect(link).toBeVisible()
    const verifyPath = (await link.getAttribute('href'))!
    const code = verifyPath.split('/').at(-1)!
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/)
    const check = await page.request.get(`${apiUrl}/api/v1/enrollments/${on.enrollment}/certificate`, {
      headers: { Authorization: `Bearer test_token_${on.student}` },
    })
    expect(await check.json()).toMatchObject({ course_completed: true, certificate: { code }, next_step: { offering_slug: 'python-projects' } })

    await page.getByRole('button', { name: 'Edit printed name' }).click()
    const displayName = 'Sam Rivera'
    await page.getByRole('dialog').getByRole('textbox', { name: 'Printed name' }).fill(displayName)
    await page.getByRole('button', { name: 'Save printed name' }).click()
    await expect(page.getByText(displayName, { exact: false })).toBeVisible()
    await snapshot(page, info, 'course-completed', theme)
    await page.goto(`/dashboard?cohort_id=${on.cohort}`)
    await expectReady(page.getByRole('heading', { name: 'Course completed' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'View & print certificate' })).toHaveAttribute('href', verifyPath)
    await page.goto('/profile')
    await expect(page.getByRole('link', { name: 'View & print certificate' })).toHaveAttribute('href', verifyPath)
    await expect(page.getByText(displayName, { exact: false })).toBeVisible()

    const visitor = await browser.newContext({ viewport: page.viewportSize(), permissions: ['clipboard-read', 'clipboard-write'] })
    try {
      const publicPage = await visitor.newPage()
      await prepare(publicPage, theme)
      const verified = publicPage.waitForResponse((response) => response.url().endsWith(`/api/v1/certificates/${code}`))
      await publicPage.goto(appUrl + verifyPath)
      const response = await verified
      expect(response.request().headers().authorization).toBeUndefined()
      expect(Object.keys((await response.json()).certificate).sort()).toEqual([
        'code', 'course_title', 'holder_name', 'issued_at', 'issuer_name', 'revoked', 'revoked_at', 'wording_version',
      ])
      await expect(publicPage.getByRole('heading', { name: 'Certificate of Completion' })).toBeVisible()
      await expect(publicPage.getByText(displayName, { exact: true })).toBeVisible()
      await expect(publicPage.getByText('Verified', { exact: true })).toBeVisible()
      await expect(publicPage.getByText('Python Foundations', { exact: true })).toBeVisible()
      await expect(publicPage.getByRole('navigation')).toHaveCount(0)
      await publicPage.getByRole('button', { name: 'Copy verify link' }).click()
      await expect(publicPage.getByRole('status')).toHaveText('Link copied')
      expect(await publicPage.evaluate(() => navigator.clipboard.readText())).toBe(appUrl + verifyPath)
      const a11y = await new AxeBuilder({ page: publicPage }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      expect(a11y.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([])
      await snapshot(publicPage, info, 'public-verified', theme)
      await publicPage.evaluate(() => document.fonts.ready)
      await publicPage.emulateMedia({ media: 'print' })
      await expect(publicPage.getByRole('button', { name: 'Print / Save PDF' })).toBeHidden()
      await expect(publicPage.getByRole('heading', { name: 'Certificate of Completion' })).toBeVisible()
      await publicPage.pdf({ path: info.outputPath('certificate.pdf'), preferCSSPageSize: true })
      await publicPage.emulateMedia({ media: 'screen' })

      await page.goto(`/admin/cohorts/${on.cohort}/students/${on.student}/overview?qa_user=2`)
      const staffPanel = page.getByRole('region', { name: 'Course certificate' })
      await expect(staffPanel.getByText(code)).toBeVisible()
      await staffPanel.getByRole('button', { name: 'Revoke certificate' }).click()
      const dialog = page.getByRole('dialog', { name: 'Revoke certificate' })
      await expect(dialog.getByRole('button', { name: 'Revoke certificate', exact: true })).toBeDisabled()
      await dialog.getByRole('textbox', { name: 'Reason' }).fill('Synthetic staff review')
      await dialog.getByRole('button', { name: 'Revoke certificate', exact: true }).click()
      await expect(staffPanel.getByText('Revoked', { exact: true }).first()).toBeVisible()
      await snapshot(page, info, 'staff-revoked', theme)
      await publicPage.reload()
      await expect(publicPage.getByText('Revoked', { exact: true })).toBeVisible()
      await expect(publicPage.getByText('Verified', { exact: true })).toHaveCount(0)
      await expect(publicPage.getByRole('button', { name: 'Print / Save PDF' })).toHaveCount(0)
      await expect(publicPage.getByText('Synthetic staff review')).toHaveCount(0)
      await snapshot(publicPage, info, 'public-revoked', theme)

      await staffPanel.getByRole('button', { name: 'Reissue certificate', exact: true }).click()
      const reissue = page.getByRole('dialog', { name: 'Reissue certificate' })
      await reissue.getByRole('textbox', { name: 'Reason' }).fill('Synthetic correction')
      await reissue.getByRole('button', { name: 'Reissue certificate', exact: true }).click()
      await expect(staffPanel.getByText('Active', { exact: true })).toBeVisible()
      const replacementPath = (await staffPanel.getByRole('link', { name: 'Verify link' }).getAttribute('href'))!
      expect(replacementPath).not.toBe(verifyPath)
      await publicPage.goto(appUrl + replacementPath)
      await expect(publicPage.getByText('Verified', { exact: true })).toBeVisible()
      await expect(publicPage.getByText(displayName, { exact: true })).toBeVisible()
    } finally {
      await visitor.close()
    }

    const offSubmissionId = await submit(page, off)
    await page.getByRole('button', { name: 'Course complete', exact: true }).click()
    await expect(page.getByRole('heading', { name: /^Course complete:/ })).toBeVisible()
    await pass(page, offSubmissionId)
    await page.goto(`${lessonPath(off)}&complete=1&qa_user=${off.student}`)
    await expect(page.getByRole('heading', { name: /^Course complete:/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'View & print certificate' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Next step', exact: true })).toHaveCount(0)
    const legacy = await page.request.get(`${apiUrl}/api/v1/enrollments/${off.enrollment}/certificate`, {
      headers: { Authorization: `Bearer test_token_${off.student}` },
    })
    expect(await legacy.json()).toMatchObject({ course_completed: false, certificate: null, next_step: null })
    await snapshot(page, info, 'legacy-off', theme)
  })
}
