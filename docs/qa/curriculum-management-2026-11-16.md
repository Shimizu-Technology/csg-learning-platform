# Curriculum and module management (B-1, B-2)

Scope: W5 PR 5.1, main 3b1f8c65. Agent-executed affected-flow QA on 2026-11-16,
Mac mini, synthetic fixtures only.

## Context and acceptance

The platform delivers reusable curriculum through cohorts while retaining learner
submissions and progress (PRODUCT_VISION.md; curriculum_structure_api_test.rb).
The content library mockup's management actions are in scope; Content studio,
search, progress projections and other open work are excluded. Controllers permit
staff reads and admin-only structural writes. Cohort#offering_readiness requires
an active curriculum for checkout.

The design README does not specify create status. New web curricula default to
draft, matching imports and the database default. The API status remains active
for installed mobile clients; the badge label is Active (corrected in fix round 1). Publishing makes a
curriculum eligible for offerings; other offering readiness checks still apply.

Required acceptance: versioned editing; publish/unpublish confirmations; server
archive guards; atomic persistent module ordering by keyboard and drag; delete
counts and learner evidence protection; instructor read-only access; responsive
semantic theme colors.

## Browser execution

Local synthetic harness with an owned database and loopback API/Vite ports.
The shared preview browser tested implementation d67aa982:

| Scenario | Result and saved evidence |
| --- | --- |
| Curriculum rename | Passed: QA Alumni Lab renamed, retained after reload |
| Publish/unpublish | Passed: consequences explained; saved Draft then Published |
| Archive with active cohort | Passed: confirmation blocked; API independently verifies 422 |
| Module editing | Passed: QA Week 3 revised and description saved; renamed module survives reload |
| Move buttons | Passed: complete order changed and survived reload; accessible buttons and web regression cover keyboard activation |
| Pointer drag | Passed: preview drag moved Week 1 after Week 3; reloaded order Week 3, Week 1, Week 2 |
| Delete with submissions | Passed: six lessons and three submissions shown; deletion disabled |
| Instructor | Passed: content readable; curriculum/module writes hidden |
| 1280 and 390, light and dark | Passed: semantic themes inspected; no horizontal overflow; phone control rows wrap |

Browser resizing does not establish native gestures or Safari behavior. WebKit
cannot start on this host; Safari/native UI not run. Clerk, real purchases, email
and external providers were excluded. API failures and stale edit recovery have
web regression coverage. No production data or services were used.

## Integrity and compatibility

Module deletion locks the module, lessons, blocks and knowledge checks before
checking assignments, submissions, progress and attempts. Learner data blocks
deletion. Lessons retain their existing archive workflow. Foreign-key/restriction
failures return 422, following the #261 backstop approach.

Reorder locks the curriculum, moves positions above the existing range, then
commits the final order atomically. Create, legacy update and delete share that
parent lock. Tests exercise concurrent permutations and rollback after a failure
during final positioning.

Archive rejects upcoming/active cohorts and checkout-enabled offerings.
Unpublishing retains existing learner access and prevents new checkout.
Installed mobile request shapes and optimistic version checks remain compatible.

ActivityEvent is an enumerated learner evidence stream, rather than an
administrative audit log. Curriculum administration was not added to that stream.

OpenAPI uses populated strict schemas, including nullable duration fields; shared
errors use the existing shared-error mechanism. Both generated clients were
regenerated.

## Checks and cleanup

Final gate results are recorded in the PR. The first API run exposed nullable
schema mismatches and an older test permitting active-cohort archival. Both were
corrected. Web regressions cover editing, status confirmations, move buttons,
drag/drop, delete counts/guards and API failures. API tests cover roles,
transitions, archive guards, stale versions, evidence, rollback and concurrency.

Owned browser tab, QA processes and QA database were closed/dropped. The branch
test database is dropped after testing. Borrowed listeners and shared PostgreSQL
remain available. The lifecycle helper could not start because its machine profile
was missing (schema_version validation). Exact process identities and database
names were tracked through the isolated QA harness instead.


## Fix round 1

Base: PR #264 head 608e4e5, merged with origin/main e7927777 in 0b4d3c9e.
Agent-executed on the Mac mini with Node 22.23.5, PGGSSENCMODE=disable,
PARALLEL_WORKERS=1 and isolated database csg_curriculum_round1_test.

Acceptance and evidence:

- Chromium, 1280 × 900, real ContentManagement/StructureActions components with
  in-memory API fixtures: keyboard Enter preserves focus while saving, follows
  the moved module through the middle, and switches direction at the first/last
  positions. Live-sales warning names Live Python; a separate checkbox is
  required before Confirm unpublish enables. Passed. Browser closed in finally.
- Vitest: busy controls ignore activation; document.activeElement follows reload;
  self-paced reorder cancellation prevents writes; unpublish names offerings and
  requires confirmation; Archived → Draft is available; deletion uses singular
  nouns and says “has student work” when blocked; new-cohort picker excludes
  archived curricula and includes drafts. Passed.
- API integration: isolated module assignment, lesson assignment and knowledge
  check attempt each block deletion and retain evidence. Each corresponding
  regression failed when its individual learner_data? guard was temporarily
  removed, then passed after restoration. The attempt mutation still hit the
  database backstop but failed the explicit model-guard error assertion.
- API query regression: clear query cache before each request; curriculum detail
  query count stays equal from one to five modules. Grouped evidence queries and
  preloaded lesson week counts replace per-module reads.
- API integration: staff-only deletion metadata, affected offering names,
  archived cohort-create rejection, draft cohort-create acceptance, and archived
  checkout-enable rejection passed. Two PostgreSQL race tests prove create and
  checkout-enable wait on the curriculum row lock and reject after archive commits.
- Impeccable advisory scan of all three changed UI components returned [].

The first full API run found two errors after introducing the lock callback:
a dirty associated curriculum could not be locked, and association reload affected
a progress fixture. Locking a separate persisted curriculum instance fixed both;
the affected 33 tests (314 assertions), including both race cases, then passed.
The full gate is rerun with the original failing seed 43693.

Browser scope is functional component QA with fixture responses, not a Clerk or
live-backend end-to-end test. Safari/native hardware, real payments and deployment
are not run in this fix round. Prior browser results above describe the earlier
head, not this fix's final head.

The lifecycle helper cannot begin because its machine profile is missing/invalid.
The read-only shared-context check also cannot run because
~/.config/shimizu-technology/agent-context.json is absent. Synced skill sources were
read directly. No application servers were started; the headless Chromium
process was closed explicitly. The shared PostgreSQL service is borrowed and
stays running. Final gate results and database cleanup are recorded in the PR.


Final local gates: API OPENAPI_COVERAGE=1, seed 43693: 1,547 tests,
38,149 assertions, zero failures/errors; RuboCop: 623 files, no offenses;
Brakeman: no warnings; Zeitwerk: passed. Web typecheck, lint, 2,136 Vitest tests,
build and test:bundle passed. Mobile typecheck and 1,318 Jest tests passed.
Generated API types are current. The extra grouped-payload assertions and custom
drag MIME assertion were also rerun in their affected suites.

Cleanup: csg_curriculum_round1_test was dropped and its absence verified. All
owned browser processes exited; no task servers, tabs or databases remain.
