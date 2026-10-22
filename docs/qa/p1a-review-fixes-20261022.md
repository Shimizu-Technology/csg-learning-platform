# P1a review fixes — 2026-10-22

Review round for PR #192, starting at 2bd6e83774507936df040d445bd6fb7f6660e33b in the existing fix/p1a-roles-privacy worktree. Integration and merge remain with the lead.

## Context and acceptance

The project orientation and original T1 / N-T1 / T2 / T9 acceptance are recorded in [the original QA ledger](p1a-roles-privacy-20261022.md). This round refreshes admin continuity and case ownership: a stale request must not remove the final accepted active admin; pending staff cannot own or receive private case follow-ups; native staff must see and recover from an invalid owner. Clerk authentication and cohort-scoped Rails authorization remain the access boundaries.

Acceptance is agent-executed affected-flow testing. Required backend cases cover stale promotion, invite acceptance, destroy, transaction serialization, aborted archive responses, creation/reassignment of both case types, pending follow-up retry, and push recipient filtering. Required screen cases cover invalid-owner visibility, save acknowledgment, failure/retry, and valid owners. Physical native-device coverage is excluded because no simulator was assigned.

## Changes and regression evidence

1. Admin continuity now locks every role/archive/Clerk-ID update and every destroy before reading the persisted row with SELECT FOR UPDATE. It combines fresh persisted values with only the attributes the request will write. Row and other-admin reads bypass the query cache. Three deterministic stale-record regressions cover instructor promotion followed by demotion/destroy and pending-admin acceptance followed by demotion.
2. Archive handles RecordNotSaved with the existing record-error 422 response. An integration test aborts the actual archive update and verifies the response and unchanged archive state.
3. Both ownership validators and both owner_valid predicates reject pending invitations. InterventionFollowUpJob already delegates to owner_valid; its regression verifies no notification and no notified timestamp until the invitation is accepted. Creation, reassignment, historical invalid-owner editing, and successful reassignment cover intervention and recovery-plan records.
4. The valid-owner push regression queues notifications for current and former recipients and verifies that both Web Push and Expo receive only the current owner's notification. Providers are stubbed; no external push was sent.
5. The concurrency regression holds thread A's update transaction open, reads pg_locks until thread B is blocked on an advisory lock, then releases A and verifies B's last-admin error. Removing the advisory-lock call temporarily caused this test to fail at the blocked-lock assertion (1 test, 1 failure); the production lock was restored before the final gate.
6. Native Intervention includes owner_valid. Invalid ownership shows “Owner can no longer access this cohort — reassign” and an “Assign to me” action through the existing PATCH endpoint. The response updates the intervention and support-queue cache; failed saves preserve the warning and permit retry. This provides native reassignment without a dead-end handoff to the web page, which has no owner selector.

Before the fixes, the focused backend run failed five regressions: stale promotion/demotion, stale promotion/destroy, stale acceptance/demotion, pending ownership creation, and pending follow-up eligibility. The added push filter regression passed the existing implementation.

## Screen QA ledger

Source: this round's final production screen, before commit. Browser: T3 Chromium against Expo web at localhost:5611, demo staff persona; 390×844 and 1280×800 CSS viewports. A temporary invalid demo owner supplied the fixture. A temporary Metro adapter excluded SQLite, which demo mode does not use: the unmodified Expo web entry otherwise fails with “Worker chunk not found for: .../expo-sqlite/web/worker.ts”. Expo also reports its existing unsupported web notification-response method; its development overlay was dismissed to exercise the screen. The adapter and invalid demo override were removed after QA.

| ID | Scenario | Result | Evidence / limit |
| --- | --- | --- | --- |
| RQ1 | Invalid owner is visible with a reachable recovery action | passed | Actual screen at both viewports; warning wraps at 390px; action height 46px; document width equals viewport width. Screenshot browser-screenshot-localhost-mviumkur-d8718b3e.png in T3 browser artifacts. |
| RQ2 | Assign to me clears the invalid-owner warning after acknowledgment | passed | Clicked actual native screen action in Expo web at both widths; warning disappears. Demo state is in memory. Rails integration tests separately verify persisted reassignment of both case types. |
| RQ3 | Pending save disables the action; rejected save retains owner and warning, then permits retry | passed | Native component tests use a deferred response and a rejected API response. Browser failure injection was not performed. |
| RQ4 | Valid owner has no warning or reassignment action | passed | Native component regression, plus post-save Expo web state. |
| RQ5 | Installed iOS/Android app, real Clerk, SQLite persistence, external push | not_run | No simulator assigned. Expo web is not native-device acceptance. Providers are stubbed in regressions. |

The screen tests schedule React Query notifications synchronously and clear their clients during cleanup, so the deferred-save assertions observe the acknowledged response.

## Engineering gate

Commands use Ruby 3.3.7 and Node 22.22.3, in this worktree only.

- API final full suite: PARALLEL_WORKERS=2 RAILS_ENV=test DATABASE_URL=postgresql:///api_test_p1a_roles_privacy bin/rails test — 807 tests, 4,247 assertions, zero failures/errors/skips.
- API RuboCop: 460 files, no offenses. Brakeman: zero warnings, one pre-existing ignored warning. bundler-audit: no vulnerabilities.
- Mobile npm ci and npm run check: brand verification, TypeScript, lint, and all 92 suites / 583 tests passed. Lint reports 19 pre-existing warnings and zero errors. Full-suite teardown retains an asynchronous handle temporarily; its command completion is recorded in the worker handoff.
- Impeccable 4.6.0 advisory on the changed native screen: [].
- Web files and dependencies were not changed, so the web gate was not rerun.
- No migration, dependency, deployment configuration, or production data changes.

## Cleanup and release limits

The task's Expo server and T3 browser tab were stopped/closed. Temporary Metro/SQLite files and the invalid demo override were removed. Isolated test databases and test-process cleanup are recorded in the handoff after the final gate. Shared services and the primary checkout were left unchanged.

This held PR has not been merged or released. A new push requires CI and CodeRabbit's incremental review; the previous head's checks do not establish review of these fixes.

## Review-fix round 2

Starting head: 13f3a571abe624a84804822eb87dedeece23c231. Tracked files were clean; the existing untracked `.codex/` directory was preserved. Rebased without conflicts onto origin/main fdc26bd (PR #193); prior commits became b0b5a2c and 530d1de. This section supersedes round 1's lock-order description. The integration lead owns merge/release.

The worker brief, audit PLAN.md, original QA ledger and docs/PRODUCT_VISION.md establish the student/staff journeys. This round's acceptance is safe concurrent invitation acceptance and role/archive updates, preservation of the last accepted admin, read-only closed interventions, and recoverable active-case reassignment.

### Lock order

Continuity transitions lock the persisted user row first, then advisory transaction lock 2026102201 only when removing an accepted active admin. Fresh persisted values are combined with only the request's dirty continuity fields. Pending-to-accepted attachment, promotion and restoration cannot remove an accepted admin and skip the advisory lock. The other-admin count does not lock user rows. Future transactions removing multiple users must lock all target rows in consistent ID order before acquiring the advisory lock; no audited path batches removals inside one transaction today.

Audit of user locks and role/archived_at/clerk_id writes under api/app, api/lib/tasks and seeds:

- UsersController update, archive/delete, unarchive and create/restore use normal model persistence. Team calls these endpoints. User archive!/unarchive!/destroy use the guard.
- Clerk attachment already holds the row; profile/authenticated-user sync uses normal persistence. Bootstrap creates a new row. ClerkIdentityBackfill/ClerkProductionProvisioner lock users to create identities without changing continuity fields.
- SendUserInviteEmailJob/UserInvitationDispatchService only write invitation delivery fields under their user locks; the latter's update_columns writes metadata only.
- Enrollment, checkout, private-meeting and importer row locks do not change user continuity fields. import_cohort_data promotions and seed role writes use model persistence in separate transactions; the import's bulk transaction writes submissions. No other continuity advisory site or bulk SQL continuity write was found.

Two PostgreSQL regressions hold the pending user's row, wait for pg_locks plus pg_blocking_pids to prove the concurrent demotion/archive is blocked there, then invoke the real attach_clerk_identity method. Both operations must finish and persist the accepted subject/identity and requested account state. Both cases raised ActiveRecord::Deadlocked with the old code. Existing cross-user advisory-contention and stale-record tests also pass.

### Screen and timing

The warning/reassignment action now requires an active intervention. Five native component tests cover pending acknowledgment, failure followed by successful retry, valid ownership, and resolved/canceled invalid owners. Explicit deferred responses resolve/reject within React act boundaries; this suite uses synchronous Query notifications, no GC timers or polling, and resets clients/mocks. No timeout was increased. The cold-cache run passed; restoring the old display condition failed exactly the two terminal-state cases.

Agent-executed Expo web/demo QA used the production screen on port 5612 with temporary invalid-owner fixtures 61 (open), 62 (resolved) and 63 (canceled). The temporary Metro SQLite adapter bypassed the existing web-worker problem and throws if used; demo persistence is disabled. The existing unsupported Expo web notification-response overlay was dismissed. All fixtures/adapters were removed afterward.

| ID | Scenario | Result | Evidence / limit |
| --- | --- | --- | --- |
| R2-1 | Acceptance versus demotion/archive completes and saves correct identity/account state | passed | Two PostgreSQL regressions; old code reproduced two deadlocks. Isolated test DB; no Clerk network request. |
| R2-2 | Concurrent removals/stale requests preserve the last accepted admin | passed | Seven continuity tests, including observable advisory contention. |
| R2-3 | Resolved/canceled invalid-owner screens preserve history and offer no reassignment/quick updates | passed | Both states at 390×844 and 1280×800; historical owner/outcome retained; no horizontal overflow. Component regressions also pass. T3 screenshot: browser-screenshot-localhost-mvivfvwn-b8e76005.png. |
| R2-4 | Active-case reassignment stays reachable and clears warning after acknowledgment | passed | Controls present at both widths; 46px action at 390px. Actual click at 390px changed owner to Leon Shimizu and removed warning/action; demo save is in memory. |
| R2-5 | Pending/failing reassignment preserves owner, permits retry and accepts subsequent success | passed | Controlled native component responses; browser failure injection excluded. |
| R2-6 | Installed native device, external Clerk/push and SQLite persistence | not_run | No simulator assigned. Expo web is not native-device acceptance. |

Final gates and cleanup are recorded below. No migration, dependency change, merge, deployment or CodeRabbit request. Web is unchanged; its gate was not rerun.

Final round-2 gate, with all temporary QA changes removed:

- API: 824 tests / 4,704 assertions, zero failures/errors/skips; RuboCop 460 files clean; Brakeman zero security warnings (one existing ignored); bundler-audit clean. Full suite and scanners exited 0.
- Mobile: npm ci and npm run check exited 0; brand/typecheck/lint and 92 suites / 591 tests passed. Lint retains 19 existing warnings, no errors. npm ci reports the existing 74 dependency advisories (19 moderate, 55 high); dependencies were not changed. Impeccable 4.6.0 advisory: [].
- Lifecycle session 01a1613c-1415-75b0-b74b-518fc341e874: owned Expo PID 61032 stopped; owned T3 browser tab closed and released. No active owned resources, simulator use or runtime handoff. The three task-created isolated test databases were dropped after verification; shared services were preserved. Worktree/branch retained for the integration lead.
