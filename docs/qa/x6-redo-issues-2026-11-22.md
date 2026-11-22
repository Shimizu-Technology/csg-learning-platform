# Reliable Redo GitHub issues — X-6.8

## Context and invariants

Date: November 22, 2026. Base: `37f5bb31` (`origin/main`). Branch: `feat/x6-reliable-redo-issues`. Source spec: `csg-learn-x6-prework-grader-parity-2026-11-18.md` (Section 3, Slice 8: Reliable Redo issues).

This slice replaces the legacy unscoped `GithubIssueService` path for explicitly opted-in cohorts with an enrollment- and binding-scoped durable outbox (`github_issue_deliveries`), drained asynchronously outside the grading transaction:

- **`github_issue_delivery_v2` defaults `false`** in `FeatureSwitches::DEFAULTS` and requires **both** school activation and an explicit cohort `On` opt-in (`FeatureSwitches::COHORT_OPT_IN`), plus `github_app == true` and `github_sync == true`. Inherit keeps it Off even when the school switch is On.
- **Zero impact on Off cohorts (including Cohort 3):** Off cohorts continue using the existing legacy path unchanged, create zero `github_issue_deliveries` rows, receive no `github_issue_delivery` key in submission JSON, and remain byte-identical against `api/test/golden/personal_pace_off_cohorts.json`. Never runs both legacy and v2 for the same grade save; zero historical backfill.
- **Zero provider HTTP inside `SubmissionsController#grade`:** `GithubIssueDeliveryPlanner.record!` writes the durable intent row inside the grade save transaction (obsoleting any prior `pending`/`failed` intents for the same `(enrollment_id, content_block_id)`), and `GithubIssueDeliveryDrain` drains due rows via `scheduled:tick` (1-query no-op when school switch is Off) or staff `POST /api/v1/submissions/:id/retry_github_issue` using short row-lock claim/finalize phases (never holding a DB lock across GitHub HTTP).
- **Safe targeting, dedupe, and lifecycle:** Resolves cohort strictly from `submission.enrollment.cohort`, repository from `GithubRepositoryAccess.binding_for`, and prior issue strictly from `(enrollment_id, content_block_id, repository_id)`. Embeds an opaque `<!-- csg-delivery:<token> -->` marker to reconcile ambiguous timeouts before creating duplicate issues/comments, reuses open issues on repeat `R`, explicitly reopens previously closed issues on a new `R`, closes only on instructor-confirmed `A`/`B`/`C`, and never posts private staff notes.
- **PgBouncer-safe migration:** `20261122060000_create_github_issue_deliveries.rb` uses `disable_ddl_transaction!` with `SET LOCAL lock_timeout = '5s'` inside explicit `transaction`, idempotent guards, clean `down`, check constraints, foreign keys (`cascade`/`nullify`), and `CurriculumCopyForCohort` block-id remapping.

## Agent-executed browser QA

Fixtures are synthetic and local-only via `QA_GITHUB_APP=1 scripts/qa/run start` + `scripts/qa/x6-redo-issues-fixtures.rb` + `scripts/qa/x6-redo-issues.spec.ts` against bundled Chromium (`chromium-1280` and `chromium-390`, light and dark). External HTTP is blocked.

| Case | Verified outcome | 1280 | 390 |
| --- | --- | --- | --- |
| RI01 (Pending status) | Opted-in R-graded submission displays `Grade saved · GitHub feedback pending` with Lucide icon and clear queued explanation | passed, light/dark | passed, light/dark |
| RI01 (Off-cohort unchanged) | Cohort 3-shaped Off submission shows saved feedback with zero `[data-github-issue-delivery]` element | passed, light/dark | passed, light/dark |
| RI01 (FeatureSettings opt-in) | Admin Cohort Settings lists `Reliable GitHub Redo issues` with `Inherit → Off` even while school switch is On | passed, light/dark | passed, light/dark |
| RI02 (Failed → Retry → Delivered) | Failed delivery shows `Grade saved · GitHub feedback failed`, error detail, Learn-saved reassurance, and >=44px `Retry GitHub feedback` button; clicking Retry calls `POST /api/v1/submissions/:id/retry_github_issue`, transitions to `GitHub feedback delivered` with >=44px `View GitHub issue` link, and persists via API | passed, light/dark | passed, light/dark |

- `scripts/qa/x6-redo-issues.spec.ts`: **8/8 passed** (57.5s) on owned QA database `csg_qa_73689_1795315066`.
- **Accessibility & visual QA improvements caught and fixed:**
  - Axe WCAG 2.1 AA flagged `opacity-90` on the secondary line inside `bg-success-soft text-success-ink` (`3.99:1 < 4.5:1`); removing the opacity modifier restored full token contrast (`0` serious/critical Axe violations across all 20 captures).
  - Visual screenshot review at 1280px and 390px showed the delivery card sat near the sticky grade bar when placed below Saved feedback; moving it directly below artifact links at the top of `SubmissionReviewPanel` made pending/failed/delivered states and the 44px Retry action immediately visible above the fold.
- **Layout & cleanup:** `0` horizontal overflow across all 20 captures (390px and 1280px, light and dark), `0` console errors. Owned QA servers and disposable database were stopped and dropped via `scripts/qa/run clean`; local screenshots and `ledger.jsonl` remain in git-ignored `.qa-local/x6-redo-issues/`.

## Automated verification

| Check | Result |
| --- | --- |
| Rails targeted + migration + parity + query-count + completion suite (`prepared_statements=true`, `PARALLEL_WORKERS=1`) | **239 runs, 1,973 assertions, 0 failures, 0 errors, 0 skips** |
| Same Rails suite (`prepared_statements=false`, `PARALLEL_WORKERS=1`) | **239 runs, 1,973 assertions, 0 failures, 0 errors, 0 skips** |
| RuboCop (`bundle exec rubocop`) | **885 files inspected, 0 offenses** |
| Brakeman 8.1.1 (`bundle exec brakeman -q -w2 --no-pager`) | **0 errors, 0 security warnings** (1 pre-existing ignored warning) |
| Bundler Audit (`bin/bundler-audit`) | **No vulnerabilities found** |
| Web OpenAPI & type generation (`cd web && npm run api:check`) | **Passed** (`web/src/types/api.generated.ts` and `mobile/src/lib/api.generated.ts` in sync) |
| Web full check (`cd web && npm run check` + `audit:dependencies`) | **Passed**: ESLint, TypeScript, **258 Vitest files / 3,553 tests**, Netlify checks, Vite build, bundle budget |
| Mobile full check (`cd mobile && npm run check` + `audit:dependencies` + `expo install --check` + iOS/Android exports) | **Passed**: brand check, TypeScript, ESLint, **142 Jest suites / 1,837 tests**, iOS & Android bundles exported |
| QA ownership harness (`node --test scripts/qa/ownership.test.mjs`) | **5/5 passed** |

## Limits

- Local Playwright QA runs against synthetic fixtures, `FakeGithubAppClient`, and bundled Chromium; live GitHub App API delivery, native iOS/Android Expo clients, Safari, and Clerk production auth are not claimed beyond automated unit/integration coverage.
- Full CI workflows (including pooler legs) will run on the opened PR.
