import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/video-versions.json', import.meta.url), 'utf8'))
const media = readFileSync(new URL('../../.qa-local/synthetic.mp4', import.meta.url))
const session = process.env.DEV_LIFECYCLE_SESSION!
test.setTimeout(90_000)
test('author uploads, labels, reorders and removes; learner switches, resumes and remembers', async ({ page }, info) => {
  const tab = `video-versions-${info.project.name}`
  checkedLifecycle(session, 'claim', tab)
  let uploads = 0
  let finishUpload: () => void = () => undefined
  try {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort()
      if (url.pathname === '/api/v1/video_presign') return route.fulfill({ json: { upload_url: `${url.origin}/qa-storage`, fields: {}, s3_key: 'content_videos/22222222-2222-4222-8222-222222222222/desktop.mp4' } })
      if (url.pathname === '/qa-storage') {
        if (++uploads === 2) await new Promise<void>((resolve) => { finishUpload = resolve })
        return route.fulfill({ status: 204 })
      }
      if (url.pathname.endsWith('/video_stream')) return route.fulfill({ json: { stream_url: `${url.origin}/qa-media.mp4?version=${url.searchParams.get('version_id') || 'default'}`, expires_at: new Date(Date.now() + 3600000).toISOString(), video_progress: null } })
      if (url.pathname === '/qa-media.mp4') {
        const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/)
        const start = range ? Number(range[1]) : 0
        const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1
        return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) })
      }
      return route.continue()
    })
    await page.goto(`/admin/lessons/${ids.lesson}/edit?qa_user=1`)
    const versions = page.getByRole('group', { name: 'Video versions', exact: true })
    await expect(versions).toBeVisible()
    // Each viewport starts by resetting versions through the actual editor.
    while (await versions.getByRole('button', { name: /^Remove / }).count()) {
      await versions.getByRole('button', { name: /^Remove / }).first().click()
    }
    if (await page.getByLabel('Original video length (seconds)', { exact: true }).count()) await page.getByLabel('Original video length (seconds)', { exact: true }).fill('60')
    await page.getByLabel('Upload video version', { exact: true }).setInputFiles({ name: 'desktop.mp4', mimeType: 'video/mp4', buffer: media })
    await expect(versions.getByRole('textbox')).toHaveCount(2)
    await expect(page.getByText('Uploaded to storage. Waiting for the exercise to finish attaching...', { exact: true })).toBeVisible()
    await versions.getByRole('button', { name: 'Remove Alternate', exact: true }).click()
    await expect(page.getByText('Uploaded to storage. Waiting for the exercise to finish attaching...', { exact: true })).toHaveCount(0)
    const uploadStarted = page.waitForRequest('**/qa-storage')
    await page.getByLabel('Upload video version', { exact: true }).setInputFiles({ name: 'desktop.mp4', mimeType: 'video/mp4', buffer: media })
    await uploadStarted
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await versions.getByRole('textbox').nth(0).fill('Studio')
    finishUpload()
    await expect(versions.getByRole('textbox')).toHaveCount(2)
    await expect(versions.getByRole('textbox').nth(0)).toHaveValue('Studio')
    await versions.getByRole('textbox').nth(0).fill('Studio')
    await versions.getByRole('textbox').nth(1).fill('Real desktop')
    const save = async () => {
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
      await expect(page.getByText(/^Saved/).first()).toBeVisible()
    }
    await save()
    await page.reload()
    await expect(versions.getByRole('textbox').nth(0)).toHaveValue('Studio')
    await expect(page.getByLabel('Original video length (seconds)', { exact: true })).toHaveCount(0)
    await expect(versions.getByRole('textbox').nth(1)).toHaveValue('Real desktop')
    await versions.getByRole('button', { name: 'Move Real desktop up', exact: true }).click()
    await save()
    await page.reload()
    await expect(versions.getByRole('textbox').nth(0)).toHaveValue('Real desktop')
    await versions.getByRole('button', { name: 'Move Studio up', exact: true }).click()
    await save()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.qa-local/video-editor-${info.project.name}.png`, fullPage: true })
    await page.goto(`/lessons/${ids.lesson}?cohort_id=${ids.cohort}&qa_user=3`)
    const switcher = page.getByRole('group', { name: 'Video version', exact: true })
    await expect(switcher.getByRole('button', { name: 'Studio', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1)
    const savedWatch = async () => {
      const response = await page.request.get(`/api/v1/lessons/${ids.lesson}?cohort_id=${ids.cohort}`, { headers: { Authorization: 'Bearer test_token_3' } })
      expect(response.ok()).toBe(true)
      return (await response.json()).lesson.content_blocks.find((b: { id: number }) => b.id === ids.block).progress?.video_total_watched as number
    }
    const before = await savedWatch() || 0
    await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 0 })
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false)
    await page.locator('video').evaluate((v: HTMLVideoElement) => v.play())
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(2)
    await switcher.getByRole('button', { name: 'Studio', exact: true }).click()
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false)
    await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause())
    await expect.poll(savedWatch).toBeGreaterThan(before)
    const watched = await savedWatch()
    await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 12 })
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(12, 0)
    const previousSource = await page.locator('video').getAttribute('src')
    await page.getByRole('button', { name: 'Real desktop', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('video')).not.toHaveAttribute('src', previousSource!)
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2)
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(12, 0)
    const selectedId = await page.evaluate((id) => localStorage.getItem(`video-version:${id}`), ids.block)
    expect(new URL((await page.locator('video').getAttribute('src'))!).searchParams.get('version')).toBe(selectedId)
    await expect(page.getByRole('button', { name: 'Real desktop', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.locator('video').evaluate((v: HTMLVideoElement) => v.play())
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(14)
    await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause())
    await expect.poll(savedWatch).toBeGreaterThan(watched)
    expect(await savedWatch()).toBeLessThanOrEqual(watched + 4)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Real desktop', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.qa-local/video-learner-${info.project.name}.png`, fullPage: true })
    await page.goto(`/admin/lessons/${ids.lesson}/edit?qa_user=1`)
    await versions.getByRole('button', { name: 'Remove Real desktop', exact: true }).click()
    await save()
    await page.reload()
    await expect(versions.getByRole('textbox')).toHaveCount(1)
    await page.goto(`/lessons/${ids.lesson}?cohort_id=${ids.cohort}&qa_user=3`)
    await expect(page.getByRole('group', { name: 'Video version', exact: true })).toHaveCount(0)
  } finally {
    await page.close()
    checkedLifecycle(session, 'release', tab)
  }
})

test('removing an upload during a save waits for the save to settle', async ({ page }, info) => {
  const tab = `video-save-race-${info.project.name}`
  checkedLifecycle(session, 'claim', tab)
  let releaseSave: () => void = () => undefined
  let delaySave = true
  try {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort()
      if (url.pathname === '/api/v1/video_presign') return route.fulfill({ json: { upload_url: `${url.origin}/qa-storage`, fields: {}, s3_key: 'content_videos/33333333-3333-4333-8333-333333333333/race.mp4' } })
      if (url.pathname === '/qa-storage') return route.fulfill({ status: 204 })
      if (url.pathname.endsWith('/block_editor') && route.request().method() === 'PUT' && delaySave) {
        delaySave = false
        await new Promise<void>((resolve) => { releaseSave = resolve })
      }
      return route.continue()
    })
    await page.goto(`/admin/lessons/${ids.lesson}/edit?qa_user=1`)
    const versions = page.getByRole('group', { name: 'Video versions', exact: true })
    await expect(versions.getByRole('textbox')).toHaveCount(1)
    await page.getByLabel('Upload video version', { exact: true }).setInputFiles({ name: 'race.mp4', mimeType: 'video/mp4', buffer: media })
    await expect(versions.getByRole('textbox')).toHaveCount(2)
    const saveStarted = page.waitForRequest((r) => r.url().endsWith('/block_editor') && r.method() === 'PUT')
    const firstSaved = page.waitForResponse((r) => r.url().endsWith('/block_editor') && r.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await saveStarted
    await versions.getByRole('button', { name: 'Remove Alternate', exact: true }).click()
    await expect(page.getByText('Uploaded to storage. Waiting for the exercise to finish attaching...', { exact: true })).toBeVisible()
    releaseSave()
    expect((await firstSaved).ok()).toBe(true)
    await expect(page.getByText('Uploaded to storage. Waiting for the exercise to finish attaching...', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText(/^Saved/).first()).toBeVisible()
    await page.reload()
    await expect(versions.getByRole('textbox')).toHaveCount(1)
  } finally {
    releaseSave()
    await page.close()
    checkedLifecycle(session, 'release', tab)
  }
})
