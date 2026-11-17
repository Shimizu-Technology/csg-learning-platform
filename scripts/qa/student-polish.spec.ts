import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { checkedLifecycle } from './ownership.mjs'
const session = process.env.DEV_LIFECYCLE_SESSION!
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
const ids = JSON.parse(readFileSync(new URL('../../.qa-local/student-polish.json', import.meta.url), 'utf8'))
const output = new URL('../../.qa-local/student-polish/', import.meta.url)
mkdirSync(output, { recursive: true })
const mainPort = Number(process.env.QA_MAIN_WEB_PORT) || null
const owners = new Map<object, string>()
function rails(code: string) {
  return execFileSync('bundle', ['exec', 'rails', 'runner', code], { cwd: new URL('../../api/', import.meta.url), env: { ...process.env, RAILS_ENV: 'test', DATABASE_URL: `postgresql://localhost/${state.database}` }, encoding: 'utf8' }).trim()
}
test.beforeEach(async ({ page }, info) => {
  const name = `polish-${info.project.name}-${info.title}`.replace(/[^a-z0-9-]/gi, '-').slice(0,120)
  checkedLifecycle(session, 'claim', name); owners.set(page, name)
  await page.route('**/*', route => ['127.0.0.1','localhost','cdn.jsdelivr.net'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date('2026-11-18T00:00:00+10:00'))
})
test.afterEach(async ({ page }) => { await page.close(); checkedLifecycle(session, 'release', owners.get(page)!); owners.delete(page) })
for (const theme of ['light','dark']) {
  test(`Off ${theme}: main visual comparison and disclosure semantics`, async ({ page }, info) => {
    test.skip(!mainPort, 'Set QA_MAIN_WEB_PORT to the owned main-comparison Vite port')
    test.setTimeout(90_000)
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    const routes = [ `/dashboard?cohort_id=${ids.off}`, `/materials?cohort_id=${ids.off}`, `/cohorts/${ids.off}`, `/profile?cohort_id=${ids.off}`, `/recordings?cohort_id=${ids.off}`, `/resources?cohort_id=${ids.off}`, `/lessons/${ids.first}?cohort_id=${ids.off}`, `/modules/${ids.polish_module}?cohort_id=${ids.off}`, `/modules/999999?cohort_id=${ids.off}`, `/meetings?cohort_id=${ids.off}` ]
    const results: unknown[] = []
    for (const [i, route] of routes.entries()) {
      const snapshots: Array<{ text: string; geometry: unknown }> = []
      for (const [label, port] of [['main', mainPort!], ['current', state.web_port]] as const) {
        await page.goto(`http://127.0.0.1:${port}${route}${route.includes('?') ? '&' : '?'}qa_user=3`)
        await expect(page.locator('main h1, main h3').first()).toBeVisible()
        await expect(page.locator('main h1, main h3').first()).not.toHaveText(/Loading/i)
        await page.evaluate(async () => { await document.fonts.ready; if (!document.fonts.check('14px \"Manrope Variable\"')) throw new Error('Baseline fonts did not load') })
        await page.waitForTimeout(400)
        snapshots.push(await page.locator('main').evaluate(main => ({ text: main.innerText, geometry: Array.from(main.querySelectorAll('a,button,h1,h3')).filter(el => (el as HTMLElement).offsetParent).map(el => { const b=el.getBoundingClientRect(); const s=getComputedStyle(el); return { text: el.textContent, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), color:s.color, background:s.backgroundColor, font:s.font } }) })))
        await page.screenshot({ path: new URL(`${theme}-${info.project.name}-${i}-${label}.jpg`, output).pathname, fullPage:true, quality:65 })
      }
      expect(snapshots[1], route).toEqual(snapshots[0])
      if (i === 1) {
        await expect(page.locator('button h2')).toHaveCount(0)
        const disclosure = page.locator('h2 > button').first()
        const expanded = await disclosure.getAttribute('aria-expanded')
        await disclosure.focus(); await page.keyboard.press('Enter')
        await expect(disclosure).toHaveAttribute('aria-expanded', expanded === 'true' ? 'false' : 'true')
      }
      results.push({ route, equal: true })
    }
    writeFileSync(new URL(`${theme}-${info.project.name}-off-comparison.json`,output), JSON.stringify(results,null,2))
  })
  test(`On ${theme}: Profile header, cohort redirect and recovery heading`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme', value), theme)
    await page.goto(`/profile?cohort_id=${ids.program}&qa_user=${ids.program_user}`)
    await expect(page.locator('[data-page-header] h1')).toHaveText('Profile')
    for (const [path, title] of [['/my-work','My work'],['/resources','Resources'],['/recordings','Class recordings']]) {
      await page.goto(`${path}?cohort_id=${ids.program}&qa_user=${ids.program_user}`)
      await expect(page.locator('[data-page-header] h1')).toHaveText(title)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.goto(`/cohorts/${ids.program}?qa_user=${ids.program_user}`)
    await expect(page).toHaveURL(new RegExp(`/materials\\?cohort_id=${ids.program}`))
    await expect(page.locator('main h1')).toBeVisible()
    await page.locator('main h2 a').first().click()
    await expect(page).toHaveURL(/module=/)
    await page.goto(`/cohorts/invalid?qa_user=${ids.program_user}`)
    await expect(page.locator('main h1')).toHaveText(/Could not open cohort|not available|access/i)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
  for (const mode of ['On','Off']) test(`${mode} ${theme}: all block types save and recover`, async ({ page }) => {
    test.setTimeout(90_000)
    const cohort = mode === 'On' ? ids.program : ids.off
    const user = mode === 'On' ? ids.program_user : 3
    rails(`e=Enrollment.find_by!(cohort_id:${cohort},user_id:${user}); blocks=Lesson.find(${ids.polish_lesson}).content_blocks; Submission.where(enrollment:e,content_block:blocks).destroy_all; Progress.where(enrollment:e,content_block:blocks).delete_all; KnowledgeCheckAttempt.where(enrollment:e,knowledge_check_id:blocks.joins(:knowledge_check).pluck('knowledge_checks.id')).delete_all`)
    await page.addInitScript(value => localStorage.setItem('csg-learn:theme',value),theme)
    await page.route('https://www.youtube.com/embed/**',route=>route.fulfill({contentType:'text/html',body:`<button onclick='parent.postMessage(JSON.stringify({event:"onStateChange",info:0,id:${ids.polish_video_block}}),"*")'>Finish synthetic video</button>`}))
    await page.goto(`/lessons/${ids.polish_lesson}?cohort_id=${cohort}&qa_user=${user}`)
    await page.frameLocator('iframe[src*="youtube.com/embed"]').getByRole('button',{name:'Finish synthetic video'}).click()
    const blocks = page.locator('[id^="block-"]')
    const text = blocks.filter({hasText:'Polish text_submission'})
    const editor = text.locator('[contenteditable="true"]')
    await editor.fill('Synthetic answer for polish')
    // Check an actual failed save leaves the text in place before retrying.
    await page.route('**/api/v1/submissions',async route => { await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic retry"}'}); await page.unroute('**/api/v1/submissions') })
    await text.getByRole('button',{name:'Submit',exact:true}).click()
    await expect(text.getByRole('alert')).toBeVisible()
    await expect(editor).toHaveText('Synthetic answer for polish')
    await text.getByRole('button',{name:'Submit',exact:true}).click()
    await expect(text.getByText(/Waiting for review\.|Submitted · waiting for review\./)).toBeVisible()
    for (const kind of ['repo_url_submission','repo_and_live_url_submission']) {
      const block = blocks.filter({hasText:`Polish ${kind}`})
      await block.getByRole('textbox',{name:'Repository URL',exact:true}).fill('https://github.com/example/polish')
      if(kind.includes('live')) await block.getByRole('textbox',{name:'Live URL',exact:true}).fill('https://example.invalid/polish')
      await block.getByRole('button',{name:'Submit links',exact:true}).click()
      await expect(block.getByText(/Waiting for review\.|Submitted · waiting for review\./)).toBeVisible()
      if(mode==='On') await block.getByText('View submission #1',{exact:true}).click()
      for(const a of await block.locator('a[target="_blank"]').all()) expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await expect(blocks.filter({hasText:'Polish prework_github_sync'}).getByText('Submit via GitHub',{exact:true})).toBeVisible()
    const check = page.getByRole('region',{name:'Quick retrieval check'})
    await check.getByRole('button',{name:'5',exact:true}).click()
    await check.getByRole('button',{name:'Check answer',exact:true}).click()
    await expect(check.getByText('Correct — this check is complete.',{exact:true})).toBeVisible()
    if(mode==='Off') {
      const manual=blocks.filter({hasText:'Polish manual_complete'})
      await manual.getByRole('button',{name:'Mark complete',exact:true}).click()
      await expect(manual.getByText('Exercise marked complete',{exact:true})).toBeVisible()
      await manual.getByRole('button',{name:'Mark not done',exact:true}).click()
    } else {
      await page.getByRole('button',{name:'Mark complete',exact:true}).click()
    }
    const response = await page.request.get(`/api/v1/lessons/${ids.polish_lesson}?cohort_id=${cohort}`,{headers:{Authorization:`Bearer test_token_${user}`}})
    const saved=(await response.json()).lesson.content_blocks
    expect(saved.find((b:any)=>b.id===ids.polish_video_block).progress.status).toBe('completed')
    expect(saved.filter((b:any)=>b.submissions?.length)).toHaveLength(3)
    expect(saved.find((b:any)=>b.knowledge_check)?.knowledge_check.latest_attempt.correct).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({path:new URL(`${mode}-${theme}-${page.viewportSize()!.width}-blocks.jpg`,output).pathname,fullPage:true,quality:65})
  })
}
for (const theme of ['light','dark']) for (const mode of ['On','Off']) test(`canonical ${mode} ${theme}: real course content with synthetic learner`,async ({page}) => {
  const course=JSON.parse(readFileSync(new URL('../../.qa-local/student-workspace/course-fixture.json',import.meta.url),'utf8'))
  const person=course.people.find((p:any)=>p.user_id===3)
  rails(`c=Cohort.find(${person.cohort_id}); c.update!(settings:(c.settings||{}).deep_merge('features'=>{'student_experience_v2'=>${mode==='On'}}))`)
  await page.addInitScript(value=>localStorage.setItem('csg-learn:theme',value),theme)
  await page.goto(`/materials?cohort_id=${person.cohort_id}&qa_user=3`)
  await expect(page.locator('main h1')).toBeVisible()
  expect(course.lesson_count).toBe(127)
  const lesson=page.locator('main a[href^="/lessons/"]').first()
  await expect(lesson).toBeVisible()
  await lesson.click()
  await expect(page).toHaveURL(/\/lessons\//)
  await expect(page.locator('main h1')).toBeVisible()
  await expect(page.locator('main .markdown-content,main .exercise-content,main .code-block').first()).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
