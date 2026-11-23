import { test, expect, type Locator } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync } from 'node:fs'
import { checkedLifecycle } from './ownership.mjs'

const ids = JSON.parse(readFileSync(new URL('../../.qa-local/recording-sections.json', import.meta.url), 'utf8'))
const session = process.env.DEV_LIFECYCLE_SESSION!
test.setTimeout(90_000)

test('plays and saves independent sections, keeps controls operable and retains whole-video credit', async ({ browser, baseURL }, info) => {
  const width = info.project.use.viewport!.width
  const touch = width !== 1280
  const user = { 1280: 3, 390: 4, 430: 9 }[width]!
  const tab = `recording-sections-${info.project.name}`
  const context = await browser.newContext({ baseURL, viewport: { width, height: 844 }, hasTouch: touch })
  const page = await context.newPage()
  checkedLifecycle(session, 'claim', tab)
  try {
    let blockSaves = true
    let failedSaves = 0
    let retriedSaves = 0
    await page.route('**/*', route => {
      return ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()
    })
    await page.route('**/video_progress', async route => {
      const payload = route.request().postDataJSON()
      if (payload.completed_section_ranges?.includes('10:12') && route.request().url().includes(`/${ids.core.block}/video_progress`)) {
        if (blockSaves) {
          failedSaves++
          return route.fulfill({ status: 503, json: { error: 'Synthetic retry check' } })
        }
        retriedSaves++
      }
      return route.continue()
    })
    const click = (locator: Locator) => touch ? locator.tap() : locator.click()
    const corePath = `/lessons/${ids.core.lesson}?cohort_id=${ids.cohort}&qa_user=${user}`
    const read = async (fixture = ids.core) => {
      const response = await page.request.get(`/api/v1/lessons/${fixture.lesson}?cohort_id=${ids.cohort}`, { headers: { Authorization: `Bearer test_token_${user}` } })
      expect(response.status()).toBe(200)
      const body = await response.json()
      return body.lesson.content_blocks.find((block: { id: number }) => block.id === fixture.block)
    }
    await page.goto(corePath)
    const video = page.locator('video')
    const time = () => video.evaluate((v: HTMLVideoElement) => v.currentTime)
    const paused = () => video.evaluate((v: HTMLVideoElement) => v.paused)
    const ready = () => expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2)
    const speed = page.getByRole('combobox', { name: 'Playback speed' })
    const slider = page.getByRole('slider', { name: 'Seek video' })
    const section = (label: string) => page.getByRole('button', { name: new RegExp(`^Play ${label},`) })
    const check = async (label: string) => expect(section(label)).toHaveAccessibleName(/section finished/)
    const playSection = async (label: string, stop: number) => {
      await click(section(label))
      await expect.poll(time).toBeGreaterThanOrEqual(stop)
      await expect.poll(paused).toBe(true)
      expect(await time()).toBeLessThan(stop + 1)
      await check(label)
    }

    await ready()
    const source = (await read()).video_progress_sources.default
    const saved = async () => (await read()).progress?.completed_video_sections?.[source] ?? []
    const sliderBox = await slider.boundingBox()
    expect(sliderBox).toMatchObject({ height: 44 })
    if (touch) {
      const videoBox = (await video.boundingBox())!
      expect(sliderBox!.y).toBeGreaterThanOrEqual(videoBox.y + videoBox.height)
    }
    await speed.selectOption('2')
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(2)

    // Seeking from a selected Core section across its stop must not count.
    await click(section('First Core'))
    await click(page.getByRole('button', { name: 'Forward 10 seconds' }))
    await expect.poll(paused).toBe(true)
    await expect.poll(time).toBeGreaterThan(10)
    await expect(section('First Core')).not.toHaveAccessibleName(/section finished/)
    expect(await saved()).toEqual([])

    await click(section('Optional practice'))
    await expect.poll(time).toBeGreaterThanOrEqual(12)
    await expect.poll(paused).toBe(true)
    const retry = page.getByRole('button', { name: 'Retry saving progress' })
    await expect(retry).toBeVisible()
    expect(await saved()).toEqual([])
    await click(page.getByRole('button', { name: 'Real desktop', exact: true }))
    await ready()
    await expect(retry).toHaveCount(0)
    await click(page.getByRole('button', { name: 'Studio', exact: true }))
    await ready()
    await expect(retry).toBeVisible()
    expect(await saved()).toEqual([])
    expect(failedSaves).toBe(1)
    blockSaves = false
    await click(retry)
    await check('Optional practice')
    await expect.poll(saved).toEqual(['10:12'])
    await expect(retry).toHaveCount(0)
    expect(retriedSaves).toBe(1)
    expect((await read()).progress.status).toBe('in_progress')
    await playSection('First Core', 3)
    await expect.poll(saved).toEqual(['10:12', '1:3'])
    await page.reload()
    await ready()
    await check('First Core')
    await check('Optional practice')
    await expect.poll(time).toBeCloseTo(3, 0)
    expect((await read()).progress.status).toBe('in_progress')

    await click(section('Second Core'))
    await check('First Core')
    await expect.poll(time).toBeGreaterThanOrEqual(7)
    await check('Second Core')
    await expect.poll(saved).toEqual(['10:12', '1:3', '5:7'])
    const completed = (await read()).progress
    expect(completed.status).toBe('completed')
    expect(completed.video_total_watched).toBeLessThan(18)
    await page.reload()
    await ready()
    for (const label of ['First Core', 'Second Core', 'Optional practice']) await check(label)
    expect((await read()).progress.completed_at).toBe(completed.completed_at)
    await video.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `.qa-local/recording-sections-${info.project.name}.png` })

    expect((await speed.boundingBox())!.width).toBeGreaterThanOrEqual(68)
    if (touch) {
      await slider.tap({ position: { x: 10, y: 22 } })
      await expect.poll(time).toBeLessThan(3)
    } else {
      await slider.focus()
      await expect(slider).toBeFocused()
      await page.keyboard.press('Home')
      await page.keyboard.press('ArrowRight')
      await expect.poll(time).toBeCloseTo(1, 1)
      await page.keyboard.press('Shift+ArrowRight')
      await expect.poll(time).toBeCloseTo(6, 1)
      await page.keyboard.press('ArrowLeft')
      await expect.poll(time).toBeCloseTo(5, 1)
      await page.keyboard.press('End')
      await expect.poll(time).toBeCloseTo(20, 0)
      await page.keyboard.press('Home')
      await expect.poll(time).toBeCloseTo(0, 0)
    }
    await click(page.getByRole('button', { name: 'Back 10 seconds' }))
    await expect.poll(time).toBeCloseTo(0, 0)
    await click(page.getByRole('button', { name: 'Forward 10 seconds' }))
    await expect.poll(time).toBeCloseTo(10, 0)
    await click(page.getByRole('button', { name: 'Forward 10 seconds' }))
    await expect.poll(time).toBeCloseTo(20, 0)
    await click(page.getByRole('button', { name: 'Back 10 seconds' }))
    await expect.poll(time).toBeCloseTo(10, 0)
    await click(page.getByRole('button', { name: 'Mute', exact: true }))
    await speed.selectOption('1.5')
    await click(page.getByRole('button', { name: 'Real desktop', exact: true }))
    await ready()
    await expect(video).toHaveAttribute('src', /version=desktop/)
    await expect.poll(time).toBeCloseTo(10, 0)
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => [v.playbackRate, v.muted])).toEqual([1.5, true])
    await expect(section('First Core')).not.toHaveAccessibleName(/section finished/)
    await click(page.getByRole('button', { name: 'Studio', exact: true }))
    await ready()
    await check('First Core')
    await expect.poll(time).toBeCloseTo(10, 0)

    await page.goto(`${corePath}&t=15`)
    await ready()
    await expect.poll(time).toBeCloseTo(15, 0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (!touch) {
      await page.setViewportSize({ width: 1280, height: 400 })
      const fullscreen = page.getByRole('button', { name: 'Full screen' })
      await click(fullscreen)
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement?.querySelector('video')))).toBe(true)
      await expect.poll(async () => (await video.boundingBox())?.height ?? 0).toBeGreaterThan(200)
      const fullVideo = (await video.boundingBox())!
      expect((await slider.boundingBox())!.y).toBeGreaterThanOrEqual(fullVideo.y + fullVideo.height)
      await expect(fullscreen).toBeInViewport()
      await click(fullscreen)
      await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
      await page.setViewportSize({ width: 1280, height: 844 })
    }
    await click(page.getByRole('button', { name: 'Restart', exact: true }))
    await expect.poll(time).toBeLessThan(2)
    await expect.poll(paused).toBe(false)
    await click(page.getByRole('button', { name: 'Pause', exact: true }))

    await page.goto(`/lessons/${ids.natural.lesson}?cohort_id=${ids.cohort}&qa_user=${user}`)
    await ready()
    await speed.selectOption('2')
    await click(page.getByRole('button', { name: 'Play', exact: true }))
    await expect.poll(time, { timeout: 15_000 }).toBeGreaterThanOrEqual(19.9)
    await expect.poll(async () => (await read(ids.natural)).progress?.status).toBe('completed')
    for (const label of ['First Core', 'Second Core', 'Optional practice', 'Finish the recording']) await check(label)
    await page.reload()
    await ready()
    await check('Finish the recording')

    await page.goto(`/lessons/${ids.whole.lesson}?cohort_id=${ids.cohort}&qa_user=${user}`)
    await ready()
    await expect(page.getByRole('region', { name: 'Recording sections' })).toHaveCount(0)
    await speed.selectOption('2')
    await click(page.getByRole('button', { name: 'Play', exact: true }))
    await expect.poll(time, { timeout: 15_000 }).toBeGreaterThanOrEqual(19.5)
    await expect.poll(async () => (await read(ids.whole)).progress?.status).toBe('completed')
    expect((await read(ids.whole)).progress.video_total_watched).toBeGreaterThanOrEqual(18)
  } finally {
    await context.close()
    checkedLifecycle(session, 'release', tab)
  }
})
