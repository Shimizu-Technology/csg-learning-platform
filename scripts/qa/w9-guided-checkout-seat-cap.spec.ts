import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test, expect, type Locator, type Page } from '../../web/node_modules/@playwright/test/index.mjs'

const harness = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8')) as { database: string }

function fixtures() {
  const output = execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/w9-guided-checkout-seat-cap-fixtures.rb'], {
    cwd: new URL('../../api/', import.meta.url).pathname,
    env: { ...process.env, PARALLEL_WORKERS: '1', DATABASE_URL: `postgresql://localhost/${harness.database}` },
    encoding: 'utf8',
  })
  return JSON.parse(output) as {
    open_id: number
    open_slug: string
    full_id: number
    full_slug: string
    program_id: number
    new_student_id: number
  }
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
}

async function touchTarget(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
  expect(box?.width).toBeGreaterThanOrEqual(44)
}

async function expectContrast(locator: Locator, minRatio = 4.5) {
  const ratio = await locator.evaluate((element) => {
    const styles = getComputedStyle(element)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    const resolveBg = (el: HTMLElement | null): string => {
      let cur: HTMLElement | null = el
      while (cur) {
        const bg = getComputedStyle(cur).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
        cur = cur.parentElement
      }
      return 'rgb(255, 255, 255)'
    }
    const luminance = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((v) => {
          const c = v / 255
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const fg = luminance(styles.color)
    const bg = luminance(resolveBg(element as HTMLElement))
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
  })
  expect(ratio).toBeGreaterThanOrEqual(minRatio)
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: guided cohort seat limit settings and public course cap states`, async ({ page }, info) => {
    test.setTimeout(90_000)
    const ids = fixtures()
    await page.addInitScript((value) => localStorage.setItem('csg-learn:theme', value), theme)
    await page.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()))

    await test.step('admin configures seat limit on guided cohort settings and program hides it', async () => {
      await page.goto(`/admin/cohorts/${ids.open_id}/settings?qa_user=1`)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const seatInput = page.locator('#offering-seat-limit')
      await expect(seatInput).toBeVisible({ timeout: 15_000 })
      await expect(seatInput).toHaveValue('15')
      await expect(page.getByText('Currently 11 of 15 seats occupied.')).toBeVisible()
      await touchTarget(seatInput)

      // Invalid seat limit shows inline validation alert.
      await seatInput.fill('0')
      await expect(page.getByText(/whole number of at least 1/i)).toBeVisible()

      // Save updated seat limit and confirm reload persistence.
      await seatInput.fill('16')
      const saveBtn = page.getByRole('button', { name: 'Save settings', exact: true })
      await touchTarget(saveBtn)
      const patchWait = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/cohorts/${ids.open_id}` && r.request().method() === 'PATCH')
      await saveBtn.click()
      const patchRes = await patchWait
      expect(patchRes.ok()).toBe(true)
      expect((await patchRes.json()).cohort).toMatchObject({ seat_limit: 16, seats_taken: 11, seats_remaining: 5, sold_out: false, unlisted: true })
      await page.reload()
      await expect(seatInput).toHaveValue('16')
      await noOverflow(page)
      await seatInput.scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`admin-guided-seat-limit-${theme}.png`) })

      // Program cohort hides the course offering / seat limit input.
      await page.goto(`/admin/cohorts/${ids.program_id}/settings?qa_user=1`)
      await expect(page.getByRole('heading', { name: 'Cohort settings' })).toBeVisible()
      await expect(page.locator('#offering-seat-limit')).toHaveCount(0)
      await noOverflow(page)
    })

    await test.step('unlisted guided cohort hides from catalog index but opens at direct slug with remaining seats', async () => {
      await page.goto(`/courses?qa_user=${ids.new_student_id}`)
      await expect(page.getByText('Python Full Cohort')).toBeVisible()
      await expect(page.getByText('Python Fundamentals Pilot')).toHaveCount(0)
      await noOverflow(page)

      await page.goto(`/courses/${ids.open_slug}?qa_user=${ids.new_student_id}`)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.getByRole('heading', { level: 1, name: 'Python Fundamentals Pilot' })).toBeVisible()
      await expect(page.getByText('Small-class course')).toBeVisible()
      const seatsPill = page.getByText('5 of 16 seats remaining')
      await expect(seatsPill).toBeVisible()
      await expectContrast(seatsPill, 4.5)
      const checkoutBtn = page.getByRole('button', { name: /Continue to secure checkout/i })
      await expect(checkoutBtn).toBeEnabled()
      await touchTarget(checkoutBtn)
      await noOverflow(page)
      await page.screenshot({ path: info.outputPath(`public-guided-open-${theme}.png`) })
    })

    await test.step('sold-out guided cohort shows disabled Cohort full state and support email', async () => {
      await page.goto(`/courses/${ids.full_slug}?qa_user=${ids.new_student_id}`)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.getByRole('heading', { level: 1, name: 'Python Full Cohort' })).toBeVisible()
      const fullPill = page.getByText('Cohort full · 0 of 1 seats remaining')
      await expect(fullPill).toBeVisible()
      await expectContrast(fullPill, 4.5)
      const disabledBtn = page.getByRole('button', { name: 'Cohort full' })
      await expect(disabledBtn).toBeDisabled()
      await touchTarget(disabledBtn)
      const mailtoLink = page.locator('main a[href^="mailto:"]')
      await expect(mailtoLink).toBeVisible()
      await expectContrast(mailtoLink, 4.5)
      await noOverflow(page)
      await page.screenshot({ path: info.outputPath(`public-guided-full-${theme}.png`) })
    })
  })
}
