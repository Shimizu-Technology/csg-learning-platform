import { test as base, expect, type Locator } from '../../web/node_modules/@playwright/test/index.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

const test = base.extend({
  hasTouch: async ({ viewport }, use) => { await use(viewport?.width === 390) },
})
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const readFixture = (name: string) => JSON.parse(readFileSync(new URL(`../../.qa-local/${name}.json`, import.meta.url), 'utf8'))
const session = process.env.DEV_LIFECYCLE_SESSION!
const auth = (id: number) => ({ headers: { Authorization: `Bearer test_token_${id}` } })

function fixture(action: string) {
  execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/actualize-student-github-fixtures.rb', action], {
    cwd: new URL('../../api/', import.meta.url),
    env: { ...process.env, DATABASE_URL: `postgresql://localhost/${state.database}` },
  })
}

test('student GitHub setup and scoped snapshots from real local Grade & Sync', async ({ page, hasTouch }, info) => {
  test.setTimeout(100_000)
  const owner = `actualize-student-github-${info.project.name}`
  checkedLifecycle(session, 'claim', owner)
  try {
    fixture('reset')
    const demo = readFixture('x6-actualize-demo')
    const direct = readFixture('lesson-page')
    const lessonUrl = `/lessons/${demo.lesson_id}?cohort_id=${demo.cohort_id}`
    const bindings = `/api/v1/enrollments/${demo.personas.program.enrollment_id}/github_repository_bindings`
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    const tapOrClick = async (control: ReturnType<typeof page.getByRole>) => {
      if (hasTouch) {
        expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44)
        await control.tap()
      } else {
        await control.click()
      }
    }
    const status = page.getByRole('region', { name: 'GitHub submission status' })
    const profile = page.getByRole('region', { name: `${demo.cohort_name} · GitHub repository` })
    const evidence = async (name: string, region: Locator) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
      await region.screenshot({ path: info.outputPath(`${name}.png`) })
    }

    await page.goto(`${lessonUrl}&qa_user=3`)
    expect(await page.evaluate(() => navigator.maxTouchPoints > 0)).toBe(hasTouch)
    await expect(status).toContainText('Choose a repository for this lesson')
    await expect(status.locator('a[href^="https://github.com"]')).toHaveCount(0)
    await tapOrClick(status.getByRole('link', { name: 'Set up GitHub in Profile' }))
    await expect(profile).toBeFocused()
    await expect(profile.getByRole('button', { name: 'Connect GitHub', exact: true })).toBeVisible()
    await expect(profile.getByRole('textbox', { name: 'Your repository' })).toHaveCount(0)
    await evidence('01-unconnected-profile', profile)

    fixture('connect')
    await page.reload()
    await expect(profile).toContainText('Connected as demo-program')
    const repo = profile.getByRole('textbox', { name: 'Your repository' })
    const save = profile.getByRole('button', { name: 'Save repository', exact: true })
    const defaultRow = profile.getByRole('listitem').filter({ hasText: 'Default for this course' })
    await repo.fill('demo-program/prework-exercises')
    await tapOrClick(save)
    await expect(defaultRow.getByText('Needs verification', { exact: true })).toBeVisible()
    await tapOrClick(defaultRow.getByRole('button', { name: 'Verify repository', exact: true }))
    await expect(defaultRow.getByText('Verified', { exact: true })).toBeVisible()
    await expect(profile).not.toContainText(/Repository \d+|the learner|installation|Enrollment default/)
    await page.reload()
    await expect(defaultRow.getByText('Verified', { exact: true })).toBeVisible()
    await evidence('02-verified-profile', profile)

    fixture('remove-access')
    await tapOrClick(profile.getByRole('button', { name: 'Reload repositories' }))
    await expect(profile).toContainText('Learn needs permission to read your repository.')
    await expect(defaultRow.getByText('Needs verification', { exact: true })).toBeVisible()
    await expect(defaultRow.getByRole('button', { name: 'Verify repository', exact: true })).toBeDisabled()
    await expect(repo).toHaveCount(0)
    fixture('restore-access')
    await tapOrClick(profile.getByRole('button', { name: 'Reload repositories' }))
    await expect(defaultRow.getByText('Verified', { exact: true })).toBeVisible()

    await page.route(`**${bindings}`, route => route.abort('internetdisconnected'))
    await tapOrClick(profile.getByRole('button', { name: 'Reload repositories' }))
    await expect(profile.getByRole('alert')).toContainText('Could not check your GitHub setup')
    await expect(defaultRow).toHaveCount(0)
    await page.unroute(`**${bindings}`)
    await tapOrClick(profile.getByRole('button', { name: 'Try again' }))
    await expect(defaultRow.getByText('Verified', { exact: true })).toBeVisible()
    for (const user of [2, 4]) expect((await page.request.get(bindings, auth(user))).status()).toBe(404)
    expect((await page.request.get(`/api/v1${lessonUrl}`, auth(6))).status()).toBe(403)

    await page.goto(lessonUrl)
    await expect(status).toContainText('Repository verified for this course.')
    await expect(status).toContainText('No saved version from this repository yet.')
    await expect(status.getByRole('link')).toHaveAttribute('href', 'https://github.com/demo-program/prework-exercises')
    await evidence('03-verified-no-snapshot', status)

    await page.goto(`/admin/cohorts/${demo.cohort_id}/modules/${demo.module_id}/grading?qa_user=2`)
    await tapOrClick(page.getByRole('button', { name: 'Sync all from GitHub' }))
    await expect(page.getByRole('status').filter({ hasText: /Synced 2 new submissions/ })).toBeVisible()

    await page.goto(`${lessonUrl}&qa_user=3`)
    const response = await page.request.get(`/api/v1${lessonUrl}`, auth(3))
    const revision = (await response.json()).lesson.github_repository_status.revisions[0]
    expect(revision.short_sha).toBe(demo.shas.program_initial.slice(0, 7))
    await expect(status.locator('time')).toHaveAttribute('datetime', revision.captured_at)
    await expect(status.getByRole('listitem')).toContainText(/111\.rb.*Last synced.*1111111/)
    await evidence('04-saved-revision', status)
    await page.reload()
    await expect(status.locator('time')).toHaveAttribute('datetime', revision.captured_at)
    await page.route(`**/api/v1${lessonUrl}`, route => route.abort('internetdisconnected'))
    await page.reload()
    await expect(status).toContainText('Current GitHub status is unavailable')
    await expect(status.getByRole('link')).toHaveCount(0)
    await expect(status.locator('time')).toHaveCount(0)
    await page.unroute(`**/api/v1${lessonUrl}`)
    await page.reload()
    await expect(status.locator('time')).toHaveAttribute('datetime', revision.captured_at)

    await page.goto('/profile')
    const override = profile.getByRole('listitem').filter({ hasText: 'Prework Week 1' })
    await profile.getByRole('combobox', { name: 'Use this repository for' }).selectOption(String(demo.module_id))
    await repo.fill('demo-program/unselected')
    await tapOrClick(save)
    await expect(override.getByText('Needs verification', { exact: true })).toBeVisible()
    await tapOrClick(override.getByRole('button', { name: 'Verify repository', exact: true }))
    await expect(override).toContainText('confirm that Learn has access on GitHub')
    await page.goto(lessonUrl)
    await expect(status).toContainText('Verify your repository for this module')
    await expect(status.locator('a[href^="https://github.com"], time')).toHaveCount(0)
    await tapOrClick(status.getByRole('link', { name: 'Set up GitHub in Profile' }))
    await tapOrClick(override.getByRole('button', { name: 'Edit repository', exact: true }))
    await expect(repo).toBeFocused()
    await repo.fill('demo-program/module-exercises')
    await tapOrClick(save)
    await expect(override.getByText('Needs verification', { exact: true })).toBeVisible()
    await tapOrClick(override.getByRole('button', { name: 'Verify repository', exact: true }))
    await expect(override.getByText('Verified', { exact: true })).toBeVisible()

    fixture('legacy')
    await page.goto(lessonUrl)
    await expect(status).toContainText('Repository verified for this module.')
    await expect(status.getByRole('link')).toHaveAttribute('href', 'https://github.com/demo-program/module-exercises')
    await expect(status).toContainText('No saved version from this repository yet.')
    await expect(status.locator('time')).toHaveCount(0)
    await evidence('05-legacy-override-no-stale-revision', status)
    fixture('disable-sync')
    await page.reload()
    await expect(page.getByRole('heading', { name: /Day 1: Ruby Methods/ })).toBeVisible()
    await expect(status).toHaveCount(0)

    // Direct CSG text submission remains editable with CDN requests blocked.
    await page.goto(`/lessons/${direct.exercise}?cohort_id=${direct.off_cohort}&qa_user=4`)
    await expect(page.getByRole('heading', { name: 'Count fictional seedlings' }).first()).toBeVisible()
    const editor = page.locator('[data-code-editor] textarea')
    await editor.fill('print("synthetic local draft")')
    await expect(editor).toHaveValue('print("synthetic local draft")')
    await expect(status).toHaveCount(0)
    await evidence('06-direct-csg-editor', editor)
  } finally {
    await page.close()
    checkedLifecycle(session, 'release', owner)
  }
})
