# Wave 3 X-6.10: Synthetic Actualize Prework Demo & 10-Minute Rehearsal

- **Date:** 2026-11-22
- **Branch:** `feat/x6-actualize-demo-rehearsal`
- **Stacked bases:**
  - PR #339 `origin/feat/x6-github-reconciliation` (`2a459632bf412cc23457c679e4536f7890d5c8ed`, originally branched from `92ec3f565a4ca4a7570264f0042b80c413257962` and cleanly merged with the latest PR #339 review fix)
  - PR #338 `origin/feat/x6-grading-workbench-suggestions` (`4815d3c18bc2f36cf22a182dc3288b01eaaaa8bf`)
  - Includes `origin/main` (`9be4022ddc333507aa7174fbb15ae4158538a9f1`) and X-6.1..X-6.9 (zero database migrations added)
- **Execution mode:** Agent-executed local QA harness (`scripts/qa/run`, loopback PostgreSQL `csg_qa_*` owned databases, Chromium 1280×844 & 390×844 in light and dark mode, Axe WCAG 2.1 AA, zero external HTTP).
- **Fixture version:** `scripts/qa/x6-actualize-demo-fixtures.rb` + `scripts/qa/x6_demo_fake_github_client.rb` (enabled only via `QA_X6_DEMO=1` inside `scripts/qa/boot.rb`), zero real student names, zero real emails (`@example.invalid` only), zero real GitHub repositories or credentials.

## OpenAPI Contract Fix Caught During Rehearsal

While running the combined X-6.4 + X-6.7 end-to-end integration test (`api/test/integration/x6_actualize_demo_rehearsal_test.rb`), OpenAPI response validation caught that `GithubSubmittedRevisionSync` persists `workflow_files` inside `submissions.github_revision` when an active `ExerciseCheckPolicy` pins `expected_workflow_path`, while `docs/openapi.json` had `additionalProperties: false` on `github_revision` without declaring optional `workflow_files`. Adding the optional `workflow_files` schema property and regenerating `web/src/types/api.generated.ts` and `mobile/src/lib/api.generated.ts` (`npm run api:generate && npm run api:check`) resolved the contract mismatch cleanly with zero migrations and zero mobile native changes.

## Rehearsal Scenario & Acceptance Ledger

All minimum journeys from §4 ("Acceptance before presenting") of `csg-learn-x6-prework-grader-parity-2026-11-18.md`:

| Journey | Coverage & Evidence | Saved API / Simulated Provider Outcome | Result |
| --- | --- | --- | --- |
| Identity & repository scope verification | Playwright 1280/390 light/dark + Rails integration test | Verified bindings bound to numeric installation/repo IDs (`demo-program`, `demo-behind`, `demo-paused`) | **Passed** |
| Instructor **Sync GitHub** | Clicked `Sync all from GitHub` in UI (`02-instructor-sync-github`) + API status check | `Synced 2 new submissions`, exact commit SHAs captured (`1111...0001`, `2222...0001`), grades remain `null` (`awaiting review`), paused learner excluded | **Passed** |
| Signed webhook (`check_run`) passing checks -> `suggest_b` | Real HMAC-SHA256 `POST /api/v1/webhooks/github` + `evaluate_grade_suggestion` | `status: "processed"`, `outcome: "suggest_b"`, `Submission.grade` remains `null`, no grade notification sent | **Passed** |
| Duplicate webhook idempotency | Re-sent identical `X-GitHub-Delivery` + HMAC-SHA256 | `duplicate: true`, `github_checks.runs.length === 1` (zero duplicated check runs or suggestions) | **Passed** |
| Signed webhook (`check_run`) failing checks -> `review_for_redo` | Real HMAC-SHA256 `POST /api/v1/webhooks/github` on `112.rb` | `status: "processed"`, `outcome: "review_for_redo"`, UI hides `Select B` button | **Passed** |
| Exercise with no check policy (`113.rb`) -> `no_suggestion` | Synced `113.rb` + evaluated via API | `outcome: "no_suggestion"`, `reason_code: "missing_policy"` | **Passed** |
| Stale SHA & superseded attempt handling | Prior attempt `112.rb` v1 after resubmission + old-SHA webhook in Rails & Playwright | `outcome: "stale_evidence"`, UI renders `[data-grade-suggestion-stale="true"]` without `Select B`; stale SHA webhook cannot alter graded `B` | **Passed** |
| Instructor confirmation (`B`) & override with `override_reason` | Keyboard `Enter` on `Select B` (does not auto-save), rubric rated, overrode with `A` + note (`04-suggest-b-override-a`) | API verified `grade: "A"`, `decision: "overridden"`, `override_reason: "Clean nil and blank-string guard"` | **Passed** |
| Redo (`R`) feedback validation & single GitHub issue despite timeout/retry | Blocked blank Redo in UI, saved `R` with feedback, simulated permanent failure (`422`) -> honest `Grade saved · GitHub feedback failed` banner (`05-redo-outage-failed-ui`), retried with `timeout_after_create` -> `Grade saved · GitHub feedback pending`, recovered & drained | Simulated provider (`example.invalid`) contains **exactly 1** issue (`state: "open"`, `#1`); Learn grade & feedback remained persisted throughout outage | **Passed** |
| Event-before-sync recovery + corrected resubmission | Signed passing `check_run` for `2222...0002` arrived before sync (`status: "staged"`), then `push_fix` + `GithubReconciliationService` (`reconcile --force-due`) | `revisions_synced >= 1`, `webhooks_replayed >= 1`, `suggestions_evaluated >= 1`; 2nd attempt created with `suggest_b`, prior `R` attempt & feedback preserved readably | **Passed** |
| Instructor confirms `B` on corrected work -> issue closed once | Selected `B`, rated rubric `Meets`, saved via `Save grade`, drained close intent (`06-fixed-resubmission-closed`) | UI shows `Issue closed`, simulated provider shows **1** issue (`state: "closed"`), Rails test verifies `close_issue` called once | **Passed** |
| Paused learner (`persona 5`) & closed submission window refusal | Sync API `404` for paused learner; `close_window` -> sync returns `synced: 0` with closed-window message | Zero submissions created for paused learner or during closed Week 1 window | **Passed** |
| Unrelated cohort / unauthorized learner (`persona 6`) refusal | `GET /api/v1/lessons/:id?cohort_id=<demo>` as persona 6 + `GET /api/v1/submissions/:id` in Rails test | Refused (`403`/`404`) | **Passed** |
| Student Today / My Work + Staff Cohort Insights | Visited `/dashboard`, `/my-work` as Behind student (`07`, `08`) and `/admin/cohorts/:id?tab=insights` (`09`) | Shows submitted vs. graded counts, remaining seeded Redo on `111.rb` (`Needs you: 1`, `Graded: 1`), and aligned objective `PREWORK-RUBY-1` | **Passed** |
| Next lesson-release preview & dry-run tick | Visited `/admin/cohorts/:id?tab=communication` (`10`) + `preview_release` CLI | Displays school timezone, separation note, `Day 2: Arrays & Enumerable Practice`, `eligible_active_count: 2`, `excluded.paused: 1`, `ScheduledTick(dry_run: true)` ok | **Passed** |
| Idempotent `reset` check | Executed `x6-actualize-demo-fixtures.rb reset` twice consecutively against the same owned QA DB | Cleanly rebuilt synthetic demo cohort & simulated provider state both times without touching base QA cohorts | **Passed** |
| Separate Cohort 3 Off-cohort regression pass | Fresh owned QA DB loaded ONLY with `first-run-states-fixtures.rb`, ran `scripts/qa/x6-cohort3-off.spec.ts` at 1280/390 light/dark | Legacy student Dashboard rendered (zero `[data-today="v2"]`), all X-6 switches `false`, zero suggestion/v2 delivery UI or API fields leaked | **Passed** |

## Viewport, Accessibility, & Automated Verification Summary

- **Pass 1 (`scripts/qa/x6-actualize-demo.spec.ts`):** **4/4** Playwright runs passed (`chromium-1280` light & dark, `chromium-390` light & dark) in 4.3m. **40/40** checkpoints verified: max horizontal overflow = **0px**, mobile interactive touch targets **>= 44px**, Axe WCAG 2.1 AA violations = **0**, console/page/unexpected network errors = **0**. Ephemeral captures remain in git-ignored `.qa-local/x6-actualize-demo/`.
- **Pass 2 (`scripts/qa/x6-cohort3-off.spec.ts` on fresh owned DB):** **4/4** Playwright runs passed (`chromium-1280` light & dark, `chromium-390` light & dark), **8/8** checkpoints verified: max horizontal overflow = **0px**, Axe WCAG 2.1 AA violations = **0**, zero console/page errors. Ephemeral captures remain in git-ignored `.qa-local/x6-cohort3-off/`.
- **Rails tests (BOTH `DB_PREPARED_STATEMENTS=true` and `DB_PREPARED_STATEMENTS=false`, `PARALLEL_WORKERS=1`, disposable DB dropped on exit):**
  - `x6_actualize_demo_rehearsal_test.rb`, `grading_workbench_suggestions_test.rb`, `github_webhooks_test.rb`, `github_issue_deliveries_test.rb`, `cohort_release_communications_test.rb`: **62 runs, 801 assertions, 0 failures** in both modes.
  - `github_reconciliation_service_test.rb`, `github_reconciliation_binding_status_test.rb`, `github_submitted_revisions_test.rb`: **34 runs, 439 assertions, 0 failures** in both modes.
  - Post-merge (`2a459632`) re-verification of `x6_actualize_demo_rehearsal_test.rb` + `github_reconciliation_service_test.rb`: **28 runs, 358 assertions, 0 failures** in both modes.
  - `github_grade_suggestion_evaluator_test.rb`, `github_submitted_revision_sync_test.rb`, `github_check_run_sync_service_test.rb`: **45 runs, 438 assertions, 0 failures** in both modes.
  - `github_app_bindings_test.rb`, `submission_github_checks_test.rb`: **13 runs, 155 assertions, 0 failures** in both modes.
  - `scheduled_tick_test.rb`, `feature_switches_test.rb`: **46 runs, 375 assertions, 0 failures** in both modes.
  - `submission_audit_test.rb` (integration + service): **51 runs, 102 assertions, 0 failures** in both modes.
  - `daily_unlock_notifications_test.rb`: **24 runs, 136 assertions, 0 failures** in both modes.
- **Static & Security checks:**
  - `bundle exec rubocop` (`api/`, 370 files): **0 offenses**.
  - `bundle exec brakeman --no-pager -q`: **0 security warnings, 0 errors**.
  - `bundle exec bundler-audit check`: **No vulnerabilities found**.
  - `web`: `eslint`, `tsc --noEmit`, `vitest` (260 files / 3577 tests), `test:netlify`, `build`, `test:bundle`, `api:check`: **all passed**.
  - `mobile`: `npx tsc --noEmit` + Jest (**142 suites / 1837 tests**): **all passed**; only `mobile/src/lib/api.generated.ts` changed (native fingerprint unchanged).

## Explicit Boundaries & Remaining Human Gates

Per `scripts/qa/README.md` and §4 of `csg-learn-x6-prework-grader-parity-2026-11-18.md`:

- **Not certified by this simulated harness:** live GitHub App installation/webhooks/issue delivery against real `api.github.com`, live Resend email delivery, real Clerk authentication, Safari / real iOS touch devices, or native Expo candidate builds.
- **Simulated provider receipts:** All simulated GitHub check run URLs and issue URLs in the local harness use `example.invalid` and are labeled simulated; they must never be presented as live GitHub integration proof.
- **Human-gated next steps:**
  - **Real integration proof** on an isolated staging deployment with a disposable GitHub App, synthetic test repositories, and test mailbox remains a separate future step before claiming live GitHub delivery.
  - **Leon's X-7 all-role phone/desktop operator walkthrough** remains human-gated and is **not** marked complete by this agent rehearsal.
- **Runtime cleanup:** All owned QA servers (`scripts/qa/run clean`) and disposable test PostgreSQL databases were stopped and dropped after QA.
