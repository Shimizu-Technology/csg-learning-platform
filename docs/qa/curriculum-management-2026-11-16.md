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
for installed mobile clients; the web label is Published. Publishing makes a
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
