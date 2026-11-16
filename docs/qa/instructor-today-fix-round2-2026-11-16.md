# Instructor Today: fix round 2

CSG's learning hub serves students and staff. This round preserves the staff inbox and main's copy-before-edit/setup behavior while fixing the final review findings. Sources: `docs/PRODUCT_VISION.md`, PR #280's implementation brief, `InstructorToday`, and the existing `recordOrigin` destination-label registry. Starting head: `3bfc8372`; integrated main: `14c5b8e6`; merge commit: `c746795e`.

Acceptance: paused-learner/module growth must keep dashboard reads flat; DM return links must name their actual destination; completed/future cohort DMs must retain cohort names; unnamed cohorts must have no empty link; one remaining learner must use singular copy on web and mobile.

## Implementation and regression evidence

- Preload paused enrollments' module assignments and curriculum modules. QueryCounter grows 1 → 7 paused learners, then 1 → 2 modules, with real assignments and lesson content. Focused run: **45 → 45 → 45 logical reads**. The old service fails the learner-growth assertion at 44 → 50.
- Load conversation cohorts in a batch and use `conversation.cohort&.name` for fallback rows. An integration regression exercises completed and future cohorts; the old service returns nil instead of the cohort name.
- Use the existing `originLabel`/`backLinkText` registry for DM return links. Rendered-header tests cover Today with scope/filter, Safety, Support and an unknown internal path, checking both label and href. Old code fails Safety, Support and unknown-path labels.
- Web and native components suppress cohort links without a cohort name and use “1 more learner needs attention”. Both clients have regressions for the empty link and singular copy; all four fail against the old components.
- Merge OpenAPI structurally, preserve paths/schemas from both branches, and regenerate both transport files using `web`'s `api:generate`; no generated-file hand merge.

The old-code comparison had 2 API failures, 5 web failures and 2 mobile failures. Restoring the fixes passes the focused tests: API 15 tests / 96 assertions, web 10 tests, mobile 5 tests.

## Verification

Application source: `d56a8298` (the following documentation commit changes no application behavior). Node 22.22.3. API uses an isolated local database with `PGGSSENCMODE=disable`, `PARALLEL_WORKERS=1` and `OPENAPI_COVERAGE=1`.

- Full API: seeds 28020 and 28021, each 1,841 tests / 40,217 assertions, zero failures/errors/skips.
- RuboCop: 674 files, no offenses. Brakeman: no warnings (one existing ignored warning).
- Web: typecheck, lint, 2,331 Vitest tests / 197 files, build, post-build test:bundle and api:check passed. Advisory design scan: [].
- Mobile: typecheck, lint and 1,418 Jest tests / 136 suites passed. Lint reports 74 warnings and zero errors; no changed Today file is flagged. Existing React act warnings appear in the suite output.

The first API attempt used `db:prepare`, which seeded the isolated test database and caused unrelated extra-admin/recipient failures. That invalid run was stopped; the database was recreated with schema only before the recorded full-suite runs.

Agent-executed checks here are integration/component tests, not new browser or native-device acceptance. Safari/WebKit, native hardware, real providers and production are not run in this round. No deployment, merge, watch or new independent review performed. CodeRabbit reports review rate-limited; new fixes are not independently reviewed.

## Resource disposition

Task database `csg_today_round2_280` dropped. Lifecycle cleanup/status confirms no active owned resources. No servers or browser tabs started. The shared PostgreSQL service is borrowed and remains available. Task database: `csg_today_round2_280`; lifecycle session: `manual-20261116-180353-20263-6a47`.
