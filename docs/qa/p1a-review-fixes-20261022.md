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
