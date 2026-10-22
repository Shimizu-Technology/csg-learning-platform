# P3 content access and enrollment defaults

Scope: S1, S8, N-T2 from the verified connected-flow audit. Implementation owner: Codex worker; integration and merge owner: Claude lead. Branch: `fix/p3-content-access`; base: `main` at `3eee7c4`. No deployment or merge is part of this worker's acceptance.

## Context and acceptance

CSG Learn serves students, instructors, and admins across Rails API, React web, and Expo native clients. Content is reusable across cohorts; assignments and learning evidence belong to an enrollment. Students need to discover their assigned work, understand when it opens, and continue without seeing unrelated content. Sources: `docs/PRODUCT_VISION.md`, the common worker brief and verified student/staff audit (2026-10-22), and the Brain Dump's `code-school/csg-learning-platform-plan.md` (architecture/context only; its 2026-02-27 delivery plan is historical).

Required outcomes:

- S1: student module responses contain lesson summaries and availability/opening dates, without lesson blocks, submission configuration, video URLs, metadata, or solutions. Individually authorized lesson requests provide content. Staff editor payloads retain full content. Empty calendar days remain hidden.
- S8: lesson-only assignments appear under the parent module in Dashboard, Weekly Plan, and Learn. Unassigned siblings are absent from learner discovery, lesson navigation, and progress denominators.
- N-T2: current cohort module choices survive empty cohorts and apply to late enrollment. Individual exceptions stay separate after defaults are established. Alumni keep all-module access.

## Migration and deployment

`20261022010000_add_content_defaults_to_cohorts.rb` adds `cohorts.content_defaults`, a JSON snapshot keyed by module ID. Every entry records assignment, force unlock, and an optional start-date override. Cohort schedules remain the shared date source. Bulk access updates persist the defaults in the same transaction as current learner assignments and schedules.

Legacy backfill is deliberately explicit:

- If schedules or active, unexpired module assignments exist, their union defines the selected modules. Other curriculum modules are excluded.
- With no selection evidence, all current curriculum modules remain selected, preserving legacy enrollment behavior. This includes empty cohorts and cohorts with only expired/inactive assignments and no schedule.
- A module inherits force unlock only when its existing active assignments unanimously have that value. An override date is inherited only when every such assignment has the same non-null date. Mixed individual overrides produce a locked/no-override default. Historical intent cannot be recovered where all existing assignments happen to share an individual exception; these rules infer a baseline from current state.
- Existing enrollments, assignments, submissions, and progress are never rewritten by the migration. Alumni bypass these defaults and continue receiving all modules.
- New cohorts initially select their current curriculum modules. Later library modules are opt-in for existing cohorts. An explicit empty selection stays empty.

Deploy the migration before the updated API code. The migration uses SQL rather than application callbacks, runs transactionally, and is reversible by dropping only the new column. Down/up was exercised on the owned local development database. A rollback discards saved cohort defaults; after rollback, the old enrollment implementation resumes its old all-module behavior. Reapplying reconstructs defaults from then-current schedules/assignments, so an empty cohort's otherwise undocumented selection cannot survive that rollback.

Enrollment creation and paid fulfillment acquire the cohort lock before saving an enrollment, matching the bulk cohort→enrollment lock order. The paid path also locks the user before the cohort, matching manual enrollment. No checkout, payment-provider, sales-enablement, or live-data changes were made.

## Agent-executed QA

Environment: isolated development database `csg_p3_content_access_dev`; Rails port 3613 and Vite port 5613. Real application components called the real local API through a temporary fixture entrypoint. Only identity/cohort providers and local authentication were replaced with synthetic learner/admin identities; this does not prove Clerk sign-in. No live sends, payments, or production writes. Fixtures were created and removed by this worker.

Q1 — Locked module summaries and available lesson navigation: **passed** on desktop Chromium (1280×800); narrow layout also covered by the component regression. A module with an open lesson and a future lesson showed the future title and `Opens Nov 2, 2026 (ChST)`, without a lesson link. Week 2, which had no lessons, stayed hidden. The open lesson linked with the cohort query. API regressions verify a whitelist of student summary fields, individual unlocks, archived content, and unchanged staff blocks.

Q2 — Discover lesson-only work: **passed** on desktop and 390×844 web. Today and Weekly Plan showed the individually assigned lesson under its parent; Learn showed that module with exactly one assigned step. The unrelated sibling was absent. Opening the module showed only its assigned lesson. API projection tests additionally cover progress percentages and future individual unlocks. Native React component tests render the actual Learn and Today screens, verify the one-step/one-lesson count, and press the module/continue actions to their expected routes.

Q3 — Open/save/revisit learning: **passed** on narrow web. Opened an available lesson from ModuleView and used Mark done. A fresh API read confirmed one completed step out of three assigned steps, with no sibling included. Opened the individual lesson from Learn. This exposed an existing sibling-navigation leak; the fix now requires assignment as well as availability. API regression verifies no previous/next unassigned sibling.

Q4 — Empty cohort configuration and late enrollment: **passed** on narrow web. In an empty synthetic cohort, configured force unlock, saved, reloaded, and reopened Configure: the checkbox remained checked. Removed the other module through its confirmation dialog. Used Add student with invite email unchecked. The saved enrollment had only the selected module, force-unlocked; the excluded module remained unassigned. API regressions also cover explicit empty selection, date overrides, existing student exceptions, alumni behavior, and transaction rollback after a stale learning request.

Q5 — Concurrency and migration: automated regression and round-trip results are recorded in the PR. The concurrency case holds the bulk cohort lock while paid renewal waits, then acquires the enrollment lock; renewal must finish without deadlock. Backfill cases cover legacy fallback, schedule-only selection, mixed overrides, expired assignments, and unchanged existing learner records.

Native iOS/Android device interaction: **not run**. No simulator was started, per the worker assignment. Native component tests cover rendering/navigation contracts, not native keyboard, gestures, or installed-app behavior. Production delivery, real Clerk sign-in, S3 delivery, and live Stripe delivery remain outside this isolated affected-flow run.

## Verification and review

The new authorization, discovery, enrollment, and sibling-navigation regressions were run against the original controllers/projection: 6 failures and 3 errors, then restored and verified with the implementation. The concurrency regression also failed with a real PostgreSQL deadlock when the pre-review lock order was restored, and passed after restoration of the fix. Final API gate: 806 tests, 4,052 assertions, zero failures/errors/skips; RuboCop, Brakeman, and bundler-audit passed. Web `npm ci` and `npm run check` passed: 82 files, 467 tests, routing/service-worker checks, strict build, and bundle gate. Final-source narrow browser retest repeated locked date/no-link, individual Learn → lesson with no sibling navigation, and Today/Weekly Plan after the reviewer fixes.

Web Impeccable advisory check of ModuleView and CohortDetail returned an empty finding list. Independent read-only Codex review identified the fulfillment lock inversion; it was fixed and reviewed again with no further material findings. CodeRabbit status is reported separately in the PR and worker handoff.

The mobile full check passed brand validation, strict TypeScript, lint, and all 582 tests. Jest remained alive after its completed full suite; rerunning tests with explicit `--forceExit` passed and terminated. The two new screen tests also pass and terminate in isolation. This runner limitation is recorded rather than reported as a normal exit from `npm run check`.

All owned Rails/Vite processes and the preview tab were stopped/closed. Temporary browser entrypoints were removed. The isolated databases are dropped after final verification; the branch/worktree and unmerged PR remain for the integration owner.
