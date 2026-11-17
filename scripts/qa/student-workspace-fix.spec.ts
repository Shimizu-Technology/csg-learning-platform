import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { checkedLifecycle } from './ownership.mjs'
const session = process.env.DEV_LIFECYCLE_SESSION
if (!session) throw new Error('DEV_LIFECYCLE_SESSION is required')
const owners = new Map<object, string>()
test.setTimeout(120_000)
test.beforeEach(async ({ page }, info) => {
  const id = `workspace-fix-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-')}`
  checkedLifecycle(session, 'claim', id); owners.set(page, id)
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})
test.afterEach(async ({ page }) => { await page.close(); const id = owners.get(page); if (id) checkedLifecycle(session, 'release', id); owners.delete(page) })
for (const theme of ['light', 'dark'] as const) for (const user of [1, 2]) {
  test(`staff ${user} ${theme}: media and queue card-to-list pairs`, async ({ page, request }) => {
    await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
    for (const [student, cohort] of [[3, 1], [4, 1], [6, 2]]) {
      const origin = `/admin/cohorts/${cohort}/students/${student}/overview?qa_user=${user}`
      const headers = { Authorization: `Bearer test_token_${user}` }
      const progress = await (await request.get(`/api/v1/progress/student/${student}?cohort_id=${cohort}`, { headers })).json()
      await page.goto(origin)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 })
      for (const [label, anchor, total, done] of [
        ['Recordings completed', 'recordings', progress.media_summary.recordings_total, progress.media_summary.recordings_completed],
        ['Lesson videos completed', 'lesson-videos', progress.media_summary.lesson_videos_total, progress.media_summary.lesson_videos_completed],
      ] as const) {
        const card = page.getByRole('main').locator('a').filter({ has: page.getByText(label, { exact: true }) }).first()
        await expect(card).toContainText(`${done}/${total}`)
        await card.click()
        await expect(page.locator(`#${anchor}`)).toBeFocused()
        await expect(page.locator(`#${anchor}`).getByText(/Loading/)).toHaveCount(0)
        const rows = anchor === 'recordings' ? page.locator('#recordings a') : page.locator('#lesson-videos p').filter({ has: page.locator('a') })
        await expect(rows).toHaveCount(total)
        await expect(rows.filter({ hasText: '· Complete' })).toHaveCount(done)
        await expect(page.locator(`#${anchor}`)).not.toContainText('QA draft media fix')
        await page.goto(origin)
      }
      const waiting = page.getByRole('main').locator('a').filter({ has: page.getByText('Work waiting', { exact: true }) }).first()
      const queueResponse = page.waitForResponse(response => response.url().includes('/api/v1/grading_queue?') && response.ok())
      await waiting.click()
      await expect(page).toHaveURL(/\/admin\/grading\?/)
      const queue = await (await queueResponse).json()
      expect(queue.meta.total_count).toBe(progress.status.ungraded_count)
      expect(new URL(page.url()).searchParams.get('student_id')).toBe(String(student))
      expect(new URL(page.url()).searchParams.get('cohort_id')).toBe(String(cohort))
      await page.goto(origin)
      const supportResponse = page.waitForResponse(response => response.url().includes('/api/v1/support_queue?') && response.ok())
      await page.getByRole('main').locator('a').filter({ has: page.getByText('Open support', { exact: true }) }).first().click()
      const support = await (await supportResponse).json()
      await expect(page).toHaveURL(/\/admin\/support\?/)
      expect(support.support_queue.help_requests).toHaveLength(progress.status.help_request_count)
      expect(support.support_queue.help_requests.every((row: { student: { id: number } }) => row.student.id === student)).toBe(true)
      expect(new URL(page.url()).searchParams.get('student_id')).toBe(String(student))
      await expect(page.getByRole('heading', { name: 'Support', exact: true })).toBeVisible()
    }
  })
  test(`staff ${user} ${theme}: blocked communication and full-list destinations`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('csg-learn:theme', theme), theme)
    const forbidden: string[] = []
    page.on('response', response => { if (response.status() === 403) forbidden.push(response.url()) })
    await page.goto(`/admin/cohorts/1/students/3/communication?qa_user=${user}`)
    const communication = page.getByRole('region', { name: 'Student communication' })
    await expect(communication.getByText('Message hidden').first()).toBeVisible()
    await expect(communication).not.toContainText('QA private history')
    await expect(communication).not.toContainText('QA blocked class body')
    await expect(communication.getByRole('button', { name: 'Open direct message', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Message', exact: true })).toBeDisabled()
    await expect(communication.locator('a[href*="/messages/dm/"]')).toHaveCount(0)
    const channel = communication.locator('a[href^="/messages/"]').filter({ hasText: 'Message hidden' }).first()
    await channel.click()
    await expect(page.getByRole('main')).toContainText('Message hidden')
    expect(forbidden).toEqual([])
    await page.goto(`/admin/cohorts/1/students/4/communication?qa_user=${user}`)
    const allMessages = page.waitForResponse(response => response.url().includes('/api/v1/direct_conversations?') && response.ok())
    await page.getByRole('link', { name: 'See all messages', exact: true }).click()
    expect(new URL((await allMessages).url()).searchParams.get('student_id')).toBe('4')
    expect(new URL(page.url()).searchParams.get('cohort_id')).toBe('1')
    await page.goto(`/admin/cohorts/1/students/4/communication?qa_user=${user}`)
    const meetings = page.waitForResponse(response => response.url().includes('/api/v1/staff/private_meetings?') && response.ok())
    await page.getByRole('link', { name: 'See all meetings', exact: true }).click()
    const meetingResponse = await meetings
    expect(new URL(meetingResponse.url()).searchParams.get('student_id')).toBe('4')
    const meetingList = await meetingResponse.json()
    expect(meetingList.cohorts.flatMap((cohort: { slots: { available: boolean }[] }) => cohort.slots).some((slot: { available: boolean }) => !slot.available)).toBe(true)
    await page.goto(`/admin/cohorts/1/students/4/communication?qa_user=${user}`)
    await page.getByRole('link', { name: 'See all in #qa-class', exact: true }).click()
    await expect(page.getByRole('main')).toContainText('QA permitted class activity')
    expect(new URL(page.url()).searchParams.get('cohort_id')).toBe('1')
    await page.goto(`/admin/cohorts/1/student-view/materials?student_id=4&qa_user=${user}`)
    const exit = page.getByRole('link', { name: 'Back to student overview', exact: true }).last()
    await expect(exit).toBeVisible()
    await expect(exit).toHaveAttribute('href', '/admin/cohorts/1/students/4/overview')
    await exit.click()
    await expect(page).toHaveURL(/\/admin\/cohorts\/1\/students\/4\/overview/)
    await expect(page.getByRole('heading', { level: 1, name: 'QA Behind', exact: true })).toBeVisible()
    expect(forbidden).toEqual([])
  })
}
