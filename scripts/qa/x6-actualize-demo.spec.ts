import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs'
import AxeBuilder from '../../web/node_modules/@axe-core/playwright/dist/index.mjs'
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * Wave 3 X-6.10: Synthetic "Prework Demo — synthetic" 10-Minute Rehearsal Spec.
 *
 * Exercises every minimum journey from §4 ("Acceptance before presenting") at
 * 1280px desktop AND 390px mobile in BOTH light and dark mode:
 *   - Identity & repository scope verification (plus paused & unrelated-cohort refusal)
 *   - Instructor Sync GitHub -> source & exact commit SHA captured (awaiting review)
 *   - Signed webhook (HMAC-SHA256) passing check -> suggest_b (no final grade written)
 *   - Duplicate webhook idempotency (zero duplicated check runs)
 *   - Signed webhook failing check -> review_for_redo
 *   - No-checks exercise (113.rb) -> no_suggestion
 *   - Stale SHA handling -> stale_evidence (no Select B button)
 *   - Instructor confirmation (B) & override with override_reason persisted via API
 *   - Redo (R) required feedback validation -> save R -> outage -> failed/pending UI
 *     -> recovery with timeout-after-create -> EXACTLY ONE simulated GitHub issue
 *   - Event-before-sync recovery via hourly reconciliation + student corrected resubmission
 *     preserving prior attempt/grade/feedback -> fresh checks -> save B -> issue closed once
 *   - Closed submission window refusal
 *   - Student Today / My Work + Staff Cohort Insights (aligned objective) + Release Communications preview
 *   - Zero horizontal overflow, >=44px mobile touch targets, zero console/page errors,
 *     zero unexpected failed network requests, and 0 Axe WCAG 2.1 AA violations.
 *
 * Requires:
 *   QA_X6_DEMO=1 scripts/qa/run start
 *   (cd api && DATABASE_URL=postgresql://localhost/<qa_db> QA_X6_DEMO=1 bundle exec ruby ../scripts/qa/x6-actualize-demo-fixtures.rb setup)
 * Run:
 *   QA_SPEC=x6-actualize-demo.spec.ts node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const API_DIR = fileURLToPath(new URL('../../api', import.meta.url))
const STATE_PATH = fileURLToPath(new URL('../../.qa-local/state.json', import.meta.url))
const META_PATH = fileURLToPath(new URL('../../.qa-local/x6-actualize-demo.json', import.meta.url))
const OUT_DIR = fileURLToPath(new URL('../../.qa-local/x6-actualize-demo/', import.meta.url))

const qaState = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as {
  database: string
  api_port: number
  web_port: number
}

interface DemoMeta {
  cohort_id: number
  cohort_name: string
  module_id: number
  lesson_id: number
  upcoming_lesson_id: number
  rubric_criterion_id: number
  objective_code: string
  exercises: {
    ex111: { id: number; filename: string; title: string }
    ex112: { id: number; filename: string; title: string }
    ex113: { id: number; filename: string; title: string }
  }
  shas: {
    program_initial: string
    behind_initial: string
    behind_fixed: string
    paused_initial: string
  }
  workflow_path: string
  webhook_secret: string
  personas: {
    admin: { id: number }
    instructor: { id: number }
    program: { id: number; enrollment_id: number; installation_id: number; repository_id: number; repo_full_name: string }
    behind: { id: number; enrollment_id: number; installation_id: number; repository_id: number; repo_full_name: string }
    paused: { id: number; enrollment_id: number; installation_id: number; repository_id: number; repo_full_name: string }
    self_paced: { id: number }
  }
}

function runFixture(args: string[]): string {
  return execFileSync('bundle', ['exec', 'ruby', '../scripts/qa/x6-actualize-demo-fixtures.rb', ...args], {
    cwd: API_DIR,
    env: {
      ...process.env,
      RAILS_ENV: 'test',
      QA_X6_DEMO: '1',
      QA_WEB_PORT: String(qaState.web_port),
      DATABASE_URL: `postgresql://localhost/${qaState.database}`,
    },
    encoding: 'utf8',
  })
}

function loadMeta(): DemoMeta {
  return JSON.parse(readFileSync(META_PATH, 'utf8')) as DemoMeta
}

const headers = (user: number) => ({ Authorization: `Bearer test_token_${user}` })

async function postSignedWebhook(
  page: Page,
  secret: string,
  event: string,
  deliveryId: string,
  payload: Record<string, unknown>,
) {
  const raw = JSON.stringify(payload)
  const sig = `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`
  const res = await page.request.post(`http://127.0.0.1:${qaState.api_port}/api/v1/webhooks/github`, {
    data: raw,
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': sig,
      'X-GitHub-Delivery': deliveryId,
      'X-GitHub-Event': event,
    },
  })
  return { status: res.status(), body: (await res.json()) as Record<string, unknown> }
}

function buildCheckRunPayload(
  meta: DemoMeta,
  persona: 'program' | 'behind',
  opts: { externalId: number; name: string; sha: string; conclusion: string; status?: string },
) {
  const p = meta.personas[persona]
  const now = new Date()
  const started = new Date(now.getTime() - 30_000).toISOString()
  const completed = new Date(now.getTime() - 5_000).toISOString()
  return {
    action: 'completed',
    installation: { id: p.installation_id },
    repository: { id: p.repository_id, full_name: p.repo_full_name },
    check_run: {
      id: opts.externalId,
      name: opts.name,
      head_sha: opts.sha,
      status: opts.status ?? 'completed',
      conclusion: opts.conclusion,
      details_url: `https://example.invalid/simulated-github/${p.repo_full_name}/runs/${opts.externalId}`,
      started_at: started,
      completed_at: completed,
      workflow_path: meta.workflow_path,
      app: { slug: 'github-actions' },
      check_suite: {
        id: 7001,
        app: { name: 'Simulated GitHub Actions' },
        workflow_path: meta.workflow_path,
      },
    },
  }
}

async function open(page: Page, path: string, user: number, theme: 'light' | 'dark') {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.addInitScript((choice) => {
    try {
      localStorage.setItem('csg-learn:theme', choice)
    } catch {
      /* ignore */
    }
  }, theme)
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}qa_user=${user}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#boot-shell')).toHaveCount(0)
}

async function checkAccessibilityAndLayout(
  page: Page,
  name: string,
  project: string,
  theme: 'light' | 'dark',
  axeSelector = 'main',
) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(250)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${project} ${theme} ${name}: horizontal overflow`).toBeLessThanOrEqual(0)

  const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme || null)
  expect(dataTheme, `${project} ${theme} ${name}: active theme`).toBe(theme)

  const targetCount = await page.locator(axeSelector).count()
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  if (targetCount > 0) builder.include(axeSelector)
  const axe = await builder.analyze()
  expect(axe.violations, `${project} ${theme} ${name}: Axe WCAG 2.1 AA violations`).toEqual([])

  mkdirSync(`${OUT_DIR}${project}`, { recursive: true })
  const screenshot = `${OUT_DIR}${project}/${theme}-${name}.png`
  await page.screenshot({ path: screenshot })
  appendFileSync(
    `${OUT_DIR}ledger.jsonl`,
    `${JSON.stringify({ name, project, theme, overflow, dataTheme, violations: axe.violations.length, url: page.url(), screenshot })}\n`,
  )
}

async function expectTouchTarget(locator: ReturnType<Page['locator']>, label: string, isPhone: boolean) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (isPhone) {
    expect(box && box.height, `${label} mobile touch target height >= 44px`).toBeGreaterThanOrEqual(44)
  } else {
    expect(box && box.height, `${label} desktop control height >= 32px`).toBeGreaterThanOrEqual(32)
  }
}

test.describe.configure({ mode: 'serial' })

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme })

    test('Full 10-minute synthetic Actualize prework rehearsal end-to-end', async ({ page }, info) => {
      test.setTimeout(180_000)

      // Reset demo cohort cleanly before each viewport x theme pass so every matrix cell runs the full real loop!
      runFixture(['reset'])
      const meta = loadMeta()
      const project = info.project.name
      const isPhone = project.endsWith('390')

      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      const failedRequests: string[] = []
      let allowExpectedStatus: number | null = null

      page.on('pageerror', (err) => pageErrors.push(err.message))
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          if (allowExpectedStatus && msg.text().includes(String(allowExpectedStatus))) return
          consoleErrors.push(msg.text())
        }
      })
      page.on('response', (res) => {
        const status = res.status()
        if (status >= 400 && status !== allowExpectedStatus) {
          failedRequests.push(`${res.request().method()} ${res.url()} -> ${status}`)
        }
      })

      // -----------------------------------------------------------------------
      // Minute 0:00–1:00: Student opens Day 1 prework lesson (111.rb, 112.rb, 113.rb)
      // -----------------------------------------------------------------------
      await open(page, `/lessons/${meta.lesson_id}?cohort_id=${meta.cohort_id}`, meta.personas.program.id, theme)
      await expect(page.getByText('Greeting Badge (111.rb)').first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Score Summary (112.rb)').first()).toBeVisible()
      await expect(page.getByText('Daily Streaks (113.rb)').first()).toBeVisible()
      await checkAccessibilityAndLayout(page, '01-student-day1-lesson', project, theme)

      // Verify identity/scope boundaries via real API:
      // - Paused student (persona 5) sync refused (404 active enrollment required)
      const pausedSyncRes = await page.request.post(
        `http://127.0.0.1:${qaState.api_port}/api/v1/cohorts/${meta.cohort_id}/modules/${meta.module_id}/sync_github/${meta.personas.paused.id}`,
        { headers: headers(meta.personas.instructor.id) },
      )
      expect(pausedSyncRes.status()).toBe(404)

      // - Unrelated learner (persona 6) refused from demo cohort lesson (403/404)
      const unrelatedRes = await page.request.get(
        `http://127.0.0.1:${qaState.api_port}/api/v1/lessons/${meta.lesson_id}?cohort_id=${meta.cohort_id}`,
        { headers: headers(meta.personas.self_paced.id) },
      )
      expect([403, 404]).toContain(unrelatedRes.status())

      // -----------------------------------------------------------------------
      // Minute 1:00–2:15: Instructor clicks "Sync all from GitHub" -> exact SHAs captured
      // -----------------------------------------------------------------------
      await open(
        page,
        `/admin/cohorts/${meta.cohort_id}/modules/${meta.module_id}/grading`,
        meta.personas.instructor.id,
        theme,
      )
      const syncBtn = page.getByRole('button', { name: 'Sync all from GitHub' })
      await expectTouchTarget(syncBtn, 'Sync all from GitHub', isPhone)
      const syncResp = page.waitForResponse(
        (res) => res.url().includes(`/cohorts/${meta.cohort_id}/modules/${meta.module_id}/sync_github`) && res.request().method() === 'POST',
      )
      await syncBtn.click()
      expect((await syncResp).status()).toBe(200)
      await expect(page.locator('[role="status"]').filter({ hasText: /Synced 2 new submissions/ })).toBeVisible({ timeout: 15_000 })
      await checkAccessibilityAndLayout(page, '02-instructor-sync-github', project, theme)

      const afterSyncStatus = JSON.parse(runFixture(['status'])) as {
        submissions: Array<{ id: number; user_id: number; filename: string; commit_sha: string; grade: string | null }>
      }
      const prog111 = afterSyncStatus.submissions.find((s) => s.user_id === 3 && s.filename === '111.rb')!
      const behind112v1 = afterSyncStatus.submissions.find((s) => s.user_id === 4 && s.filename === '112.rb')!
      expect(prog111).toBeTruthy()
      expect(prog111.commit_sha).toBe(meta.shas.program_initial)
      expect(prog111.grade).toBeNull()
      expect(behind112v1).toBeTruthy()
      expect(behind112v1.commit_sha).toBe(meta.shas.behind_initial)
      expect(behind112v1.grade).toBeNull()
      // Paused student (persona 5) must have zero submissions!
      expect(afterSyncStatus.submissions.filter((s) => s.user_id === 5)).toHaveLength(0)

      // -----------------------------------------------------------------------
      // Minute 2:15–3:15: Signed webhooks (pass for 111.rb, fail for 112.rb) + duplicate idempotency
      // -----------------------------------------------------------------------
      const passPayload = buildCheckRunPayload(meta, 'program', {
        externalId: 911101,
        name: 'prework/111.rb',
        sha: meta.shas.program_initial,
        conclusion: 'success',
      })
      const whPass1 = await postSignedWebhook(page, meta.webhook_secret, 'check_run', `del-pass-${project}-${theme}`, passPayload)
      expect(whPass1.status).toBe(200)
      expect(whPass1.body.status).toBe('processed')

      // Duplicate webhook delivery must be idempotent (duplicate: true, no extra check rows)
      const whPassDup = await postSignedWebhook(page, meta.webhook_secret, 'check_run', `del-pass-${project}-${theme}`, passPayload)
      expect(whPassDup.status).toBe(200)
      expect(whPassDup.body.duplicate).toBe(true)

      const failPayload = buildCheckRunPayload(meta, 'behind', {
        externalId: 911201,
        name: 'prework/112.rb',
        sha: meta.shas.behind_initial,
        conclusion: 'failure',
      })
      const whFail = await postSignedWebhook(page, meta.webhook_secret, 'check_run', `del-fail-${project}-${theme}`, failPayload)
      expect(whFail.status).toBe(200)
      expect(whFail.body.status).toBe('processed')

      // Evaluate suggestions via real staff endpoint (and verify NO grade was written!)
      const evalPass = await page.request.post(
        `http://127.0.0.1:${qaState.api_port}/api/v1/submissions/${prog111.id}/evaluate_grade_suggestion`,
        { headers: headers(meta.personas.instructor.id) },
      )
      expect(evalPass.status()).toBe(200)
      expect(((await evalPass.json()) as { grade_suggestion: { outcome: string } }).grade_suggestion.outcome).toBe('suggest_b')

      const evalFail = await page.request.post(
        `http://127.0.0.1:${qaState.api_port}/api/v1/submissions/${behind112v1.id}/evaluate_grade_suggestion`,
        { headers: headers(meta.personas.instructor.id) },
      )
      expect(evalFail.status()).toBe(200)
      expect(((await evalFail.json()) as { grade_suggestion: { outcome: string } }).grade_suggestion.outcome).toBe('review_for_redo')

      // Confirm 111.rb still has grade === null and check count === 1 (duplicate webhook did not double it)
      const prog111CheckApi = await page.request.get(
        `http://127.0.0.1:${qaState.api_port}/api/v1/submissions/${prog111.id}`,
        { headers: headers(meta.personas.instructor.id) },
      )
      const prog111Json = (await prog111CheckApi.json()) as {
        submission: { grade: string | null; github_checks: { runs: unknown[] } }
      }
      expect(prog111Json.submission.grade).toBeNull()
      expect(prog111Json.submission.github_checks.runs).toHaveLength(1)

      // -----------------------------------------------------------------------
      // Minute 3:15–4:30: Instructor opens queue, checks suggest_b, overrides with A + reason
      // -----------------------------------------------------------------------
      await open(page, `/admin/grading?cohort_id=${meta.cohort_id}&module_id=${meta.module_id}`, meta.personas.instructor.id, theme)
      const progRow = page.locator(`#submission-row-${prog111.id}`)
      await expect(progRow).toBeVisible({ timeout: 15_000 })
      await expect(progRow).toContainText('B suggested')
      await expect(page.locator(`#submission-row-${behind112v1.id}`)).toContainText('Review for Redo')
      await checkAccessibilityAndLayout(page, '03-grading-queue-suggestions', project, theme, '[aria-label="Grading queue"]')

      await progRow.click()
      const suggestCard = page.locator('[data-grade-suggestion="suggest_b"]')
      await expect(suggestCard).toBeVisible()
      await expect(suggestCard).toContainText('Checks passed · B suggested')
      const selectBBtn = suggestCard.getByRole('button', { name: 'Select B' })
      await expectTouchTarget(selectBBtn, 'Select B', isPhone)

      // Verify keyboard navigation on review controls & Select B does NOT auto-save
      await selectBBtn.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('[data-grade-bar] button', { hasText: /^B$/ })).toHaveAttribute('aria-pressed', 'true')

      // Rate rubric criterion ("Exceeds") and override B suggestion with A + override_reason!
      const rubricBtn = page.locator('#rubric').getByRole('button', { name: 'Exceeds' }).first()
      await rubricBtn.click()
      await page.locator('[data-grade-bar] button', { hasText: /^A$/ }).click()
      const overrideInput = page.locator('[data-grade-bar]').getByLabel('Override note (optional)')
      await expectTouchTarget(overrideInput, 'Override note', isPhone)
      await overrideInput.fill('Clean nil and blank-string guard')
      await checkAccessibilityAndLayout(page, '04-suggest-b-override-a', project, theme, '[aria-label="Submission review"]')

      const saveAResp = page.waitForResponse(
        (res) => res.url().includes(`/submissions/${prog111.id}/grade`) && res.request().method() === 'PATCH',
      )
      await page.locator('[data-grade-bar]').getByRole('button', { name: 'Save and next' }).click()
      expect((await saveAResp).status()).toBe(200)

      // Verify persisted A + overridden decision + override_reason via API
      const savedProgApi = await page.request.get(
        `http://127.0.0.1:${qaState.api_port}/api/v1/submissions/${prog111.id}`,
        { headers: headers(meta.personas.instructor.id) },
      )
      const savedProgJson = (await savedProgApi.json()) as {
        submission: { grade: string; grade_suggestion: { decision: string; override_reason: string } }
      }
      expect(savedProgJson.submission.grade).toBe('A')
      expect(savedProgJson.submission.grade_suggestion.decision).toBe('overridden')
      expect(savedProgJson.submission.grade_suggestion.override_reason).toBe('Clean nil and blank-string guard')

      // -----------------------------------------------------------------------
      // Minute 4:30–6:00: Review 112.rb (review_for_redo), Redo feedback validation,
      // save R -> simulated provider outage -> honest failed UI -> retry with timeout_after_create
      // -> EXACTLY ONE simulated GitHub issue created!
      // -----------------------------------------------------------------------
      await expect.poll(() => new URL(page.url()).searchParams.get('submission')).toBe(String(behind112v1.id))
      await expect(page.locator('[data-grade-suggestion="review_for_redo"]')).toBeVisible()
      await expect(page.locator('[data-grade-suggestion="review_for_redo"]').getByRole('button', { name: 'Select B' })).toHaveCount(0)

      // Redo without feedback MUST be blocked
      await page.locator('[data-grade-bar] button', { hasText: /^Redo$/ }).click()
      await page.locator('[data-grade-bar]').getByRole('button', { name: 'Save and next' }).click()
      await expect(page.locator('[data-grade-bar] [role="alert"]')).toContainText('Write feedback before choosing Redo')

      // Write specific Redo feedback and save R
      if (isPhone) {
        const fbToggle = page.locator('[data-grade-bar] button[aria-label="Feedback"]')
        if ((await fbToggle.getAttribute('aria-expanded')) !== 'true') await fbToggle.click()
      }
      const feedbackBox = page.locator('[data-grade-bar] [contenteditable="true"], [data-grade-bar] textarea').first()
      await feedbackBox.click()
      await page.keyboard.type('Guard empty scores array before dividing so score_summary([]) returns 0.')
      if (isPhone) {
        await page.locator('[data-grade-bar] button[aria-label="Feedback"]').click()
      }

      const saveRResp = page.waitForResponse(
        (res) => res.url().includes(`/submissions/${behind112v1.id}/grade`) && res.request().method() === 'PATCH',
      )
      await page.locator('[data-grade-bar]').getByRole('button', { name: 'Save and next' }).click()
      expect((await saveRResp).status()).toBe(200)

      // Simulate provider outage (permanent issue failure -> status: failed) and drain outbox
      runFixture(['simulate_outage', '--mode', 'issue_failed', '--message', 'Simulated GitHub issue API unavailable (422)'])
      runFixture(['drain_issues', '--force-due'])

      // Open submission page -> verify honest "Grade saved · GitHub feedback failed" UI + Retry button
      await open(page, `/admin/submissions/${behind112v1.id}`, meta.personas.instructor.id, theme)
      const failedBanner = page.locator('[data-github-issue-delivery="failed"]')
      await expect(failedBanner).toBeVisible({ timeout: 15_000 })
      await expect(failedBanner).toContainText('Grade saved · GitHub feedback failed')
      await expect(failedBanner).toContainText('Your grade and feedback remain saved in Learn')
      const retryBtn = failedBanner.getByRole('button', { name: /Retry/i })
      await expectTouchTarget(retryBtn, 'Retry GitHub feedback', isPhone)
      await checkAccessibilityAndLayout(page, '05-redo-outage-failed-ui', project, theme)

      // Recover with timeout_after_create -> issue created once on simulated provider, then transient error -> status pending
      runFixture(['simulate_outage', '--mode', 'timeout_after_create'])
      const retry1Resp = page.waitForResponse(
        (res) => res.url().includes(`/submissions/${behind112v1.id}/retry_github_issue`) && res.request().method() === 'POST',
      )
      await retryBtn.click()
      expect((await retry1Resp).status()).toBe(200)
      await expect(page.locator('[data-github-issue-delivery="pending"]')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('[data-github-issue-delivery="pending"]')).toContainText('Grade saved · GitHub feedback pending')

      // Recover outage and drain again -> marker reconciliation finds existing issue -> delivered, STILL ONLY 1 ISSUE!
      runFixture(['recover_outage'])
      runFixture(['drain_issues', '--force-due'])
      await page.reload()
      await page.waitForLoadState('networkidle')
      const deliveredBanner = page.locator('[data-github-issue-delivery="delivered"]')
      await expect(deliveredBanner).toBeVisible({ timeout: 15_000 })
      await expect(deliveredBanner).toContainText('GitHub feedback delivered')

      const afterRedoDrain = JSON.parse(runFixture(['status'])) as {
        simulated_provider_issues: Record<string, Record<string, { state: string; number: number }>>
      }
      const behindIssues = Object.values(afterRedoDrain.simulated_provider_issues[String(meta.personas.behind.repository_id)] || {})
      expect(behindIssues).toHaveLength(1)
      expect(behindIssues[0].state).toBe('open')

      // -----------------------------------------------------------------------
      // Minute 6:00–7:30: Event-before-sync + Student corrected resubmission (112.rb v2)
      // -----------------------------------------------------------------------
      // 1) Signed webhook for SHA_BEHIND_2 arrives BEFORE sync -> staged!
      const fixedPassPayload = buildCheckRunPayload(meta, 'behind', {
        externalId: 911202,
        name: 'prework/112.rb',
        sha: meta.shas.behind_fixed,
        conclusion: 'success',
      })
      const whEarly = await postSignedWebhook(
        page,
        meta.webhook_secret,
        'check_run',
        `del-early-fixed-${project}-${theme}`,
        fixedPassPayload,
      )
      expect(whEarly.status).toBe(200)
      expect(whEarly.body.status).toBe('staged')

      // 2) Student pushes simulated fixed code -> hourly reconciliation imports v2, replays staged webhook, evaluates suggest_b!
      runFixture(['push_fix', '--persona', 'behind', '--exercise', '112.rb', '--sha', meta.shas.behind_fixed])
      const reconOut = JSON.parse(runFixture(['reconcile', '--force-due'])) as {
        metrics: { revisions_synced: number; webhooks_replayed: number; suggestions_evaluated: number }
      }
      expect(reconOut.metrics.revisions_synced).toBeGreaterThanOrEqual(1)
      expect(reconOut.metrics.webhooks_replayed).toBeGreaterThanOrEqual(1)
      expect(reconOut.metrics.suggestions_evaluated).toBeGreaterThanOrEqual(1)

      const afterRecon = JSON.parse(runFixture(['status'])) as {
        submissions: Array<{
          id: number
          user_id: number
          filename: string
          commit_sha: string
          grade: string | null
          feedback: string | null
          suggestion: { outcome: string } | null
        }>
      }
      const attempts112 = afterRecon.submissions.filter((s) => s.user_id === 4 && s.filename === '112.rb')
      expect(attempts112).toHaveLength(2)
      expect(attempts112[0].grade).toBe('R')
      expect(attempts112[0].feedback).toContain('Guard empty scores array')
      const behind112v2 = attempts112[1]
      expect(behind112v2.commit_sha).toBe(meta.shas.behind_fixed)
      expect(behind112v2.grade).toBeNull()
      expect(behind112v2.suggestion?.outcome).toBe('suggest_b')

      // Verify superseded prior attempt (behind112v1) shows stale evidence and CANNOT be accidentally accepted with Select B
      const evalStalePrev = await page.request.post(
        `http://127.0.0.1:${qaState.api_port}/api/v1/submissions/${behind112v1.id}/evaluate_grade_suggestion`,
        { headers: headers(meta.personas.instructor.id) },
      )
      expect(evalStalePrev.status()).toBe(200)
      expect(((await evalStalePrev.json()) as { grade_suggestion: { outcome: string } }).grade_suggestion.outcome).toBe('stale_evidence')
      await open(page, `/admin/submissions/${behind112v1.id}`, meta.personas.instructor.id, theme)
      const staleCard = page.locator('[data-grade-suggestion][data-grade-suggestion-stale="true"]')
      await expect(staleCard).toBeVisible({ timeout: 15_000 })
      await expect(staleCard.getByRole('button', { name: 'Select B' })).toHaveCount(0)

      // -----------------------------------------------------------------------
      // Minute 7:30–8:30: Instructor confirms B on fixed 112.rb -> issue closed ONCE
      // -----------------------------------------------------------------------
      await open(page, `/admin/submissions/${behind112v2.id}`, meta.personas.instructor.id, theme)
      const v2Card = page.locator('[data-grade-suggestion="suggest_b"]')
      await expect(v2Card).toBeVisible({ timeout: 15_000 })
      await v2Card.getByRole('button', { name: 'Select B' }).click()
      await page.locator('#rubric').getByRole('button', { name: 'Meets' }).first().click()
      const saveBResp = page.waitForResponse(
        (res) => res.url().includes(`/submissions/${behind112v2.id}/grade`) && res.request().method() === 'PATCH',
      )
      await page.locator('[data-grade-bar]').getByRole('button', { name: /^Save (grade|and next)$/ }).click()
      expect((await saveBResp).status()).toBe(200)

      // Drain close intent -> issue closed once!
      runFixture(['drain_issues', '--force-due'])
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('[data-github-issue-delivery="delivered"]')).toContainText('Issue closed')
      await checkAccessibilityAndLayout(page, '06-fixed-resubmission-closed', project, theme)

      const afterClose = JSON.parse(runFixture(['status'])) as {
        simulated_provider_issues: Record<string, Record<string, { state: string }>>
      }
      const closedIssues = Object.values(afterClose.simulated_provider_issues[String(meta.personas.behind.repository_id)] || {})
      expect(closedIssues).toHaveLength(1)
      expect(closedIssues[0].state).toBe('closed')

      // Stale SHA check cannot alter final B grade
      const stalePayload = buildCheckRunPayload(meta, 'behind', {
        externalId: 911299,
        name: 'prework/112.rb',
        sha: '9999999999999999999999999999999999990001',
        conclusion: 'failure',
      })
      await postSignedWebhook(page, meta.webhook_secret, 'check_run', `del-stale-${project}-${theme}`, stalePayload)
      const checkBFinal = await page.request.get(
        `http://127.0.0.1:${qaState.api_port}/api/v1/submissions/${behind112v2.id}`,
        { headers: headers(meta.personas.instructor.id) },
      )
      expect(((await checkBFinal.json()) as { submission: { grade: string } }).submission.grade).toBe('B')

      // No-checks exercise (113.rb) + Closed submission window refusal
      runFixture(['push_fix', '--persona', 'program', '--exercise', '113.rb', '--sha', '1111111111111111111111111111111111110002'])
      runFixture(['sync', 'program'])
      const statusWith113 = JSON.parse(runFixture(['status'])) as {
        submissions: Array<{ id: number; user_id: number; filename: string }>
      }
      const sub113 = statusWith113.submissions.find((s) => s.user_id === 3 && s.filename === '113.rb')!
      expect(sub113).toBeTruthy()
      const eval113 = await page.request.post(
        `http://127.0.0.1:${qaState.api_port}/api/v1/submissions/${sub113.id}/evaluate_grade_suggestion`,
        { headers: headers(meta.personas.instructor.id) },
      )
      expect(eval113.status()).toBe(200)
      expect(((await eval113.json()) as { grade_suggestion: { outcome: string } }).grade_suggestion.outcome).toBe('no_suggestion')

      // Closed window refusal
      runFixture(['close_window'])
      runFixture(['push_fix', '--persona', 'program', '--exercise', '113.rb', '--sha', '1111111111111111111111111111111111110003', '--code', 'def daily_streaks(d); d.length; end'])
      const closedSync = JSON.parse(runFixture(['sync', 'program'])) as { result: { synced: number; errors: string[] } }
      expect(closedSync.result.synced).toBe(0)
      expect(closedSync.result.errors.join(' ')).toMatch(/closed/i)
      runFixture(['open_window'])

      // -----------------------------------------------------------------------
      // Minute 8:30–9:30: Student Today / My Work + Staff Cohort Insights
      // -----------------------------------------------------------------------
      await open(page, `/dashboard?cohort_id=${meta.cohort_id}`, meta.personas.behind.id, theme)
      await expect(page.locator('[data-today="v2"]')).toBeVisible({ timeout: 15_000 })
      await checkAccessibilityAndLayout(page, '07-student-today-behind', project, theme)

      await open(page, `/my-work?cohort_id=${meta.cohort_id}`, meta.personas.behind.id, theme)
      await expect(page.locator('[data-page="my-work"]')).toBeVisible({ timeout: 15_000 })
      // Behind student still has the seeded remaining Redo on 111.rb in Needs you, AND 112.rb in Graded!
      await expect(page.locator('#my-work-tab-needs_you')).toContainText('1')
      await expect(page.locator('#my-work-tab-graded')).toContainText('1')
      await checkAccessibilityAndLayout(page, '08-student-my-work-behind', project, theme)

      await open(page, `/admin/cohorts/${meta.cohort_id}?tab=insights`, meta.personas.instructor.id, theme)
      await expect(page.getByText(meta.objective_code)).toBeVisible({ timeout: 15_000 })
      await checkAccessibilityAndLayout(page, '09-staff-cohort-insights', project, theme)

      // -----------------------------------------------------------------------
      // Minute 9:30–10:00: Release Communications preview + school timezone
      // -----------------------------------------------------------------------
      await open(page, `/admin/cohorts/${meta.cohort_id}?tab=communication`, meta.personas.instructor.id, theme)
      await expect(page.getByRole('heading', { name: 'Release communications' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/Day 2: Arrays & Enumerable Practice/)).toBeVisible()
      await checkAccessibilityAndLayout(page, '10-staff-release-communications', project, theme)

      // Confirm release preview CLI & dry-run tick succeed cleanly
      const relPreview = JSON.parse(runFixture(['preview_release'])) as {
        scheduled_tick_dry_run_ok: boolean
        release_communications: { recipients: { eligible_active_count: number; excluded: { paused: number } } }
      }
      expect(relPreview.scheduled_tick_dry_run_ok).toBe(true)
      expect(relPreview.release_communications.recipients.eligible_active_count).toBe(2)
      expect(relPreview.release_communications.recipients.excluded.paused).toBe(1)

      expect(pageErrors, `${project} ${theme} page errors`).toEqual([])
      expect(consoleErrors, `${project} ${theme} console errors`).toEqual([])
      expect(failedRequests, `${project} ${theme} failed requests`).toEqual([])
    })
  })
}
