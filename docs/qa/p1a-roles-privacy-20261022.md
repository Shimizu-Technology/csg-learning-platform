# P1a roles and privacy QA — 2026-10-22

Scope: T1, N-T1, T2, T9. Integration owner: Claude lead; this worker must not merge.

## Context and acceptance

Base verified and rebased against `origin/main`: `3eee7c4c97fd2234a30fccc10ae93ada6b7e5636` (#191). Worktree: `t3-bda46e66`; branch: `fix/p1a-roles-privacy`.

Sources: `WORKER_BRIEF.md`, `PLAN.md`, and `verify-staff.md` in the lead's `e2dd1685-7507-47a2-b2aa-110cee933c2f/audit` directory; repository `docs/PRODUCT_VISION.md`, `docs/DEPLOYMENT.md`, and the affected controllers, models, and screens. The Brain Dump's `code-school/python-fundamentals-pilot-launch-runbook-2026.md` describes the invited December pilot for a small group of adult beginners. Students use phones heavily; staff manage invitations, cohorts, and support. Clerk identifies accounts; Rails/PostgreSQL enforce authorization; Netlify and Render Singapore deploy from main. Deployment was not changed or verified for this held PR.

Acceptance: roster enrollment cannot change account roles; final accepted active admin removal is rejected under concurrent writes; only admins review privacy reports/deletion requests; case owners can teach the cohort; existing invalid owners are reported without preventing unrelated work. No production data repair, real invitations, or native simulator work.

## Implementation decisions

- Existing-account creation preserves roles. Conflicting role requests return 409 before restoring accounts or dispatching invitations. Matching student accounts can be restored and enrolled through the existing two-step flow. Neither enrollment success nor failure changes their role.
- Team finds existing accounts and opens an explicit edit/role confirmation. New-account invitations and existing-account role changes are distinct actions. Self-demotion refreshes the signed-in session. A pending or archived admin does not satisfy the final-admin requirement.
- Model callbacks acquire a PostgreSQL transaction advisory lock before removing an accepted active admin. The subsequent other-admin query sees prior committed removals. A real two-connection test races demotion against archive; direct final-admin destroy/archive are also covered.
- The new owner validator runs on creation and changes to owner/enrollment. `created_by` is checked at creation, so a historical creator's later demotion cannot block edits. Existing invalid ownership returns `owner_valid: false`; web case details explain the need to reassign. The read-only `bin/rails cohort_staff_owners:audit` task reports record type, record ID, cohort ID, and owner ID, without names or case details. It does not repair data.
- New and queued case notifications check current owner access. Stored case notifications disappear from a former owner's notification feed. Invalid overdue owners are not marked notified, allowing a later retry after cohort access is restored.
- No web/native case-owner pickers exist on this base (`owner_id` appears in API contracts, not selection controls). Native support hands intervention management to web. No mobile files or dependencies changed.

## Agent-executed affected-flow ledger

Environment: isolated `csg_p1a_roles_privacy_dev`; API `127.0.0.1:3611`, web `127.0.0.1:5611`. Chromium through T3 preview, desktop 1280×800 and narrow web 390×844. Seeded accounts and a single cohort belong only to this task. A temporary Vite entry/auth adapter and server-side token verifier supplied local fixture identities; actual production components, routes, API controllers, and database writes were exercised. Fixture policy acceptance was seeded. All adapters were removed after QA. This does not verify Clerk login, physical-phone keyboard/gestures, native apps, or external email/push delivery.

Tested source: base plus this PR's implementation. Later additions cover notification access and self-demotion session refresh through automated regression tests; there were no later changes to the browser-tested roster or role-confirmation interactions.

| ID | Scenario and expected saved outcome | Result | Evidence / dimensions |
| --- | --- | --- | --- |
| Q1 | Add staff email to roster, retain input, show Team link, save no enrollment or role change | passed | Mobile instructor email; desktop self-admin email; clicked Open Team to `/admin/team`. DB retained instructor/admin roles and no enrollment for either. |
| Q2 | Restore archived student, enroll, retain student role | passed | Narrow web rendered Sam Student in roster. SQL: user 3 role 0, archived_at NULL, cohort 1 enrollment. Staff role remained 1. |
| Q3 | Duplicate enrollment fails and remains recoverable | passed | Desktop showed “Account found, but enrollment failed”; email stayed entered and student remained enrolled once with role 0. Component regression also checks retry state. |
| Q4 | Explicit Team promotion/demotion, cancel without saving, confirm saves | passed | Narrow web Add Team Member found existing student; role stayed 0 before confirmation/cancel, then became 1 after confirmation. Desktop explicitly changed the same account back to student and verified role 0. |
| Q5 | Last accepted admin cannot be demoted; pending admins do not count | passed | Desktop edit disabled Student/Instructor; narrow view showed the explanation and reachable controls. Screenshot: `browser-screenshot-127-0-0-1-mvitgozr-1672525e.png` in T3 browser artifacts. API tests cover rejection, atomic profile rollback, and a concurrent archive/demotion. |
| Q6 | Admin sees Safety queue; instructor cannot navigate to it | passed | Admin opened both privacy sections on desktop and narrow web. Instructor direct URL redirected through `/dashboard` to staff home; sidebar contained no Safety queue and no report content appeared. Unit routing test asserts denial and admin access. |
| Q7 | Existing invalid case owners are visible as a warning; unrelated work saves | passed | Desktop updated action summary; narrow web saved a recovery check-in. SQL verified both strings, unchanged owner 5, and persisted check-in. Both warnings remained; narrow view had no horizontal overflow. Audit task reported the intervention and recovery plan. |
| Q8 | Physical-device/native and real Clerk/provider flow | not_run | No iOS simulator assigned; no native code changed. Local fixture authentication and no external deliveries by design. |

Seven affected-flow cases passed; one excluded integration/device case not run. No failed or blocked cases remain. An initial workflow-toast wait used the wrong capitalization; saved database state and subsequent rendered value confirmed the successful save. Temporary API boot/auth fixture setup errors were resolved before acceptance execution.

## Engineering gate

Final results: Rails **801 tests / 4,138 assertions**, no failures/errors; RuboCop **460 files**, clean; Brakeman **0 warnings** (1 existing ignored warning); bundler-audit clean. Web **83 test files / 474 tests**, clean, plus lint, typecheck, Netlify/service-worker checks, production build, and bundle guard. Exact PR head is in the worker handoff. Commands: full Rails tests with `PARALLEL_WORKERS=2 DATABASE_URL=postgresql:///api_test_p1a_roles_privacy`, RuboCop, Brakeman, bundler-audit; web `npm ci` and `npm run check` on Node 22.22.3. Advisory Impeccable 4.6.0 scan of TeamManagement, CohortDetail, InterventionDetail, and Layout returned `[]`. No mobile gate is required because no mobile files changed.

Before implementation, the focused API run failed six regressions for role overwrite, missing privacy restrictions, missing owner scope, and retroactive edit failures. A 10-worker rerun under concurrent machine load hit the existing five-second message-delivery concurrency-test timeout; the complete two-worker rerun passed. New Team modal tests initially left exit timers past jsdom teardown; their teardown now waits for those timers, and the final full web run has no unhandled errors. The fixed focused run and full suites are separately recorded; green test counts are not a claim of whole-product acceptance.

## Deployment and cleanup

No schema migration or environment changes. Before integrating, the lead can run the read-only owner audit in the target environment, then arrange explicit reassignment using the existing intervention/recovery-plan update API. Historical invalid ownership is retained until reassigned; unrelated editing remains available.

Task-owned API/Vite processes and T3 preview tab were closed through lifecycle session `01a16106-0a9f-7031-9fe7-71a17cca840a`; status reported no active owned resources. Temporary test/development databases and parallel test copies are removed after final checks. Shared PostgreSQL, other workers, and baseline services are untouched. The held branch/worktree remain for the lead.
