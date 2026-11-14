import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
for (const [role, id, route, heading] of [
  ['admin', 1, '/admin/students', 'Students'],
  ['instructor', 2, '/admin/grading', 'Grading'],
  ['student self-paced', 6, '/materials', 'QA Week 1'],
  ['student program', 3, '/materials', 'QA Week 1'],
] as const) {
  test(`${role} signed-in pages`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    // Provider/video URLs are deliberately inert; no browser provider traffic.
    await page.route('**/*', async request => {
      const url = new URL(request.request().url())
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return request.abort()
      return request.continue()
    })
    await page.goto(`${route}?qa_user=${id}`)
    await expect(page.getByRole('main').getByText(heading, { exact: false }).first()).toBeVisible()
    await page.goto('/messages')
    await expect(page.getByRole('textbox', { name: 'Search messages' }).or(page.getByRole('button', { name: 'Search messages', exact: true }))).toBeVisible()
    await page.goto('/announcements')
    await expect(page.getByRole('heading', { name: /Updates/ })).toBeVisible()
    expect(errors).toEqual([])
  })
}
