import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { appendFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../../.qa-local/theme/', import.meta.url))

/*
 * Light and dark sweep (U-6.1): every main page for each role, in both
 * themes, at the project's width (1280 and 390). Light uses a saved "Light"
 * choice; dark uses System with a dark OS, so both paths are exercised.
 *
 * Each page records: axe WCAG 2.1 AA violations (contrast separately), any
 * large near-white box in dark mode (a missed hard-coded surface), horizontal
 * overflow, the <html> theme and theme-color meta, and console errors.
 * Results go to .qa-local/theme/<project>.jsonl (one line per page); screenshots alongside.
 * Run: npx playwright test --config ../scripts/qa/playwright.config.ts theme.spec.ts
 */

type Visit = { role: string; user: number; path: string; name: string }

const ADMIN: Visit[] = [
  ['/admin', 'Today'], ['/admin/students', 'Students'], ['/admin/grading', 'Grading'], ['/admin/support', 'Help'],
  ['/admin/content', 'Content'], ['/admin/cohorts', 'Cohorts'], ['/admin/cohorts/1', 'Cohort'],
  ['/admin/cohorts/1/students/3', 'Student workspace'], ['/admin/cohorts/1/watch-progress', 'Watch progress'],
  ['/admin/cohorts/1/modules/1/grading', 'Module grading'], ['/admin/submissions/1', 'Submission'],
  ['/admin/help-requests/1', 'Help request'], ['/admin/interventions/1', 'Follow-up plan'],
  ['/admin/lessons/1/edit', 'Lesson editor'], ['/admin/team', 'Team'], ['/admin/activity', 'Activity'],
  ['/admin/meetings', 'Meetings'], ['/admin/moderation', 'Moderation'], ['/messages', 'Messages'],
  ['/messages/dm/1', 'Conversation'], ['/announcements', 'Updates'], ['/profile', 'Profile'], ['/qa-missing-page', 'Not found'],
].map(([path, name]) => ({ role: 'admin', user: 1, path, name }))

const INSTRUCTOR: Visit[] = [
  ['/admin', 'Today'], ['/admin/grading', 'Grading'], ['/admin/support', 'Help'], ['/admin/students', 'Students'],
  ['/admin/submissions/1', 'Submission'], ['/admin/cohorts/1', 'Cohort'], ['/admin/content', 'Content'],
  ['/messages', 'Messages'], ['/announcements', 'Updates'], ['/profile', 'Profile'], ['/admin/team', 'Team (no access)'],
].map(([path, name]) => ({ role: 'instructor', user: 2, path, name }))

const STUDENT: Visit[] = [
  ['/dashboard', 'Today'], ['/materials', 'Learn'], ['/modules/1', 'Module'], ['/lessons/1', 'Lesson'],
  ['/lessons/3', 'Lesson with submission'], ['/recordings', 'Recordings'], ['/resources', 'Resources'], ['/meetings', 'Meetings'],
  ['/messages', 'Messages'], ['/announcements', 'Updates'], ['/announcements?tab=inbox', 'Notifications'], ['/profile', 'Profile'],
  ['/admin', 'Staff page (no access)'],
].map(([path, name]) => ({ role: 'student', user: 3, path, name }))

const SELF_PACED: Visit[] = [['/dashboard', 'Today'], ['/materials', 'Learn'], ['/lessons/19', 'Lesson']]
  .map(([path, name]) => ({ role: 'self-paced student', user: 6, path, name }))

const PUBLIC: Visit[] = [['/', 'Landing'], ['/sign-in', 'Sign in'], ['/terms', 'Terms'], ['/privacy', 'Privacy']]
  .map(([path, name]) => ({ role: 'signed out', user: 0, path, name }))

const VISITS = [...ADMIN, ...INSTRUCTOR, ...STUDENT, ...SELF_PACED, ...PUBLIC]

type Result = Visit & {
  theme: string; width: number; dataTheme: string | null; themeColor: string | null; background: string;
  overflow: number; contrast: string[]; serious: string[]; lightBoxes: string[]; errors: string[]; screenshot: string
}

async function lightBoxesInDark(page: Page) {
  return page.evaluate(() => {
    const found: string[] = []
    const luminance = (rgb: number[]) => rgb.map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (['IMG', 'VIDEO', 'IFRAME', 'svg', 'CANVAS', 'PICTURE'].includes(element.tagName)) continue
      const rect = element.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 20 || rect.bottom < 0 || rect.top > innerHeight * 3) continue
      const style = getComputedStyle(element)
      if (style.visibility === 'hidden' || style.opacity === '0') continue
      const match = style.backgroundColor.match(/rgba?\(([^)]+)\)/)
      if (!match) continue
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      if (parts.length === 4 && parts[3] < 0.5) continue
      if (luminance(parts.slice(0, 3)) > 0.6) {
        found.push(`${element.tagName.toLowerCase()}.${String(element.className).slice(0, 80)} ${Math.round(rect.width)}x${Math.round(rect.height)} ${style.backgroundColor}`)
      }
    }
    return found.slice(0, 10)
  })
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme })

    for (const visit of VISITS) {
      test(`${visit.role} · ${visit.name} (${visit.path})`, async ({ page }, info) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 200)) })
        await page.route('**/*', (route) => {
          const url = new URL(route.request().url())
          return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
        })
        // Light: an explicit saved choice. Dark: System, following the dark OS.
        await page.addInitScript((choice) => {
          try { if (choice) localStorage.setItem('csg-learn:theme', choice); else localStorage.removeItem('csg-learn:theme') } catch { /* ignore */ }
        }, theme === 'light' ? 'light' : '')
        const join = visit.path.includes('?') ? '&' : '?'
        await page.goto(visit.user ? `${visit.path}${join}qa_user=${visit.user}` : visit.path)
        await page.waitForLoadState('networkidle')
        await expect(page.locator('#boot-shell')).toHaveCount(0)
        await page.waitForTimeout(400)

        const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme || null)
        expect(dataTheme).toBe(theme)
        const themeColor = await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') || null)
        const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
        const describe = (v: { id: string; nodes: Array<{ target: unknown; any: Array<{ message: string }> }> }) =>
          v.nodes.slice(0, 6).map((node) => `${v.id} ${JSON.stringify(node.target)} ${node.any[0]?.message?.slice(0, 160) || ''}`)
        const contrast = axe.violations.filter((v) => v.id === 'color-contrast').flatMap(describe)
        const serious = axe.violations.filter((v) => v.id !== 'color-contrast' && (v.impact === 'serious' || v.impact === 'critical')).flatMap(describe)
        const lightBoxes = theme === 'dark' ? await lightBoxesInDark(page) : []

        const slug = `${visit.role}-${visit.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        const dir = `${OUT}${info.project.name}`
        mkdirSync(dir, { recursive: true })
        const screenshot = `${dir}/${theme}-${slug}.png`
        await page.screenshot({ path: screenshot, fullPage: false })

        const result: Result = { ...visit, theme, width: page.viewportSize()!.width, dataTheme, themeColor, background, overflow, contrast, serious, lightBoxes, errors, screenshot }
        appendFileSync(`${OUT}${info.project.name}.jsonl`, `${JSON.stringify(result)}\n`)
      })
    }
  })
}
